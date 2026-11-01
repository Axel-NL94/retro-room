import {messages} from './translations.js';

// Preserve the original Dutch text so that switching back never translates an
// English string twice, including text inserted later by the game UI.
const originals = new WeakMap();
const originalAttributes = new WeakMap();
const translatedAttributes = ['aria-label', 'aria-description', 'title', 'placeholder', 'alt'];
const skipped = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'SVG']);
const languageKey = 'retroroom-language';
let language = 'en';
try { language = localStorage.getItem(languageKey) === 'nl' ? 'nl' : 'en'; }
catch { /* Default to English in private browsing too. */ }

const dynamicTranslations = [
  [/^Kies jouw (NES|SNES|DOS)-ROM voor (.+)\. De versie, regio en eventuele hack moeten overeenkomen\.$/, (_, system, name) => `Choose your ${system} ROM for ${name}. The version, region, and any hacks must match.`],
  [/^Je kiest (NES|SNES|DOS)\. Laad je eigen (.+) en stel de emulator in\.$/, (_, system, file) => `You chose ${system}. Load your own ${file === 'gamebestanden' ? 'game files' : 'ROM'} and configure the emulator.`],
  [/^Kies je (NES|SNES|DOS)-ROM$/, (_, system) => `Choose your ${system} ROM`],
  [/^Kies eerst een (NES|SNES|DOS)-ROM( of gebruik onze demo)?\.$/, (_, system, demo) => `Choose a ${system} ROM first${demo ? ' or try our demo' : ''}.`],
  [/^Dit is een (NES|SNES|DOS)-ROM\. Kies een (NES|SNES|DOS)-ROM of ga terug naar de consolekeuze\.$/, (_, found, wanted) => `This is a ${found} ROM. Choose a ${wanted} ROM or go back to console selection.`],
  [/^(\d+)% CPU-ruimte\. Start de game opnieuw om te spelen\.$/, (_, amount) => `${amount}% CPU time. Restart the game to play.`],
  [/^CPU-overclock: (\d+)%. Speler 2 krijgt automatisch dezelfde instelling\.$/, (_, amount) => `CPU overclock: ${amount}%. Player 2 automatically receives the same setting.`],
  [/^Speler (\d+) heeft de besturing$/, (_, player) => `Player ${player} has control`],
  [/^Kies een (NES|SNES|DOS)-ROM$/, (_, system) => `Choose a ${system} ROM`],
  [/^(\d+) controllers? verbonden\. Kies en test ze bij Besturing\.$/, (_, count) => `${count} controller(s) connected. Select and test them under Controls.`],
  [/^(.+) schuift aan\. Verbinding maken…$/, (_, player) => `${player} is joining. Connecting…`],
  [/^(.+): druk op een toets\. Escape annuleert\.$/, (_, action) => `${action}: press a key. Escape cancels.`],
  [/^(.+): laat alle controllerknoppen los en druk daarna op een knop of beweeg een stick\. Escape annuleert\.$/, (_, action) => `${action}: release all controller buttons, then press a button or move a stick. Escape cancels.`],
  [/^(.+) niet ingedrukt$/, (_, action) => `${action} not pressed`],
  [/^(.+) ingedrukt$/, (_, action) => `${action} pressed`],
  [/^DOS-toets voor (.+)$/, (_, action) => `DOS key for ${action}`],
  [/^(NES|SNES|MS-DOS) patcher kiezen$/, (_, system) => `Select ${system} patcher`],
  [/^Deze savestate gebruikt (\d+)% CPU\. Kies eerst dezelfde overclockinstelling\.$/, (_, amount) => `This save state uses ${amount}% CPU. Choose the same overclock setting first.`],
  [/^Het gepatchte bestand moet tussen 1 byte en (\d+) MB blijven\.$/, (_, amount) => `The patched file must be between 1 byte and ${amount} MB.`],
  [/^De oorspronkelijke DOS-bytes op positie (\d+) komen niet overeen\.$/, (_, offset) => `The original DOS bytes do not match at offset ${offset}.`],
  [/^Origineel voor patch: (.+?) bytes( · kopieerheader verwijderd)?\nCRC32: (.+?)\nSHA-256: (.+)$/, (_, bytes, header, crc, sha) => `Original for patch: ${bytes} bytes${header ? ' · copier header removed' : ''}\nCRC32: ${crc}\nSHA-256: ${sha}`],
  [/^Knop (\d+)$/, (_, index) => `Button ${index}`],
  [/^As (\d+) ([−+])$/, (_, index, direction) => `Axis ${index} ${direction}`]
];

export function translate(text) {
  if (language === 'nl') return text;
  const leading = text.match(/^\s*/)?.[0] || '';
  const trailing = text.match(/\s*$/)?.[0] || '';
  const value = text.trim();
  if (!value) return text;
  const exact = messages.get(value);
  if (exact !== undefined) return leading + exact + trailing;
  for (const [pattern, replacement] of dynamicTranslations) {
    if (pattern.test(value)) return leading + value.replace(pattern, replacement) + trailing;
  }
  // Some UI updates combine a translated status with a contextual prefix.
  if (value.startsWith('Toetsenbord ') || value.startsWith('Controller ')) {
    const parts = value.split(' ');
    const label = parts.shift();
    return leading + (messages.get(label) || label) + ' ' + parts.join(' ') + trailing;
  }
  // Controller guides contain multiple action labels separated by middots.
  const guide = value
    .replace(/(^| · )(Omhoog|Omlaag|Links|Rechts)(?=:)/g, (_, prefix, action) => prefix + (messages.get(action) || action))
    .replace(/\bKnop (\d+)\b/g, (_, index) => `Button ${index}`)
    .replace(/\bAs (\d+)\b/g, (_, index) => `Axis ${index}`);
  return guide === value ? text : leading + guide + trailing;
}

function localizeNode(node) {
  if (!node.parentElement || skipped.has(node.parentElement.tagName) || node.parentElement.closest('[data-no-translate]')) return;
  let data = originals.get(node);
  if (!data || node.nodeValue !== data.rendered) {
    data = {source: node.nodeValue, rendered: node.nodeValue};
    originals.set(node, data);
  }
  const target = language === 'nl' ? data.source
    : data.source.trim() === 'Klaar' && node.parentElement.closest('#controls-dialog .controls-footer')
      ? data.source.replace('Klaar', 'Done') : translate(data.source);
  data.rendered = target;
  if (node.nodeValue !== target) node.nodeValue = target;
}

function localizeAttributes(element) {
  if (element.closest('[data-no-translate]')) return;
  let map = originalAttributes.get(element);
  if (!map) { map = new Map(); originalAttributes.set(element, map); }
  const names = element.matches('meta[name="description"]')
    ? [...translatedAttributes, 'content'] : translatedAttributes;
  for (const name of names) {
    const value = element.getAttribute(name);
    if (value === null) { map.delete(name); continue; }
    let data = map.get(name);
    if (!data || value !== data.rendered) {
      data = {source: value, rendered: value};
      map.set(name, data);
    }
    const next = language === 'nl' ? data.source : translate(data.source);
    data.rendered = next;
    if (next !== value) element.setAttribute(name, next);
  }
}

function localizeTree(root) {
  if (root.nodeType === Node.TEXT_NODE) { localizeNode(root); return; }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  if (root.closest('[data-no-translate]') || skipped.has(root.tagName)) return;
  localizeAttributes(root);
  const nodes = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = nodes.nextNode())) localizeNode(node);
  for (const element of root.querySelectorAll('*')) localizeAttributes(element);
}

function localizePage() {
  document.documentElement.lang = language;
  localizeTree(document.body);
  const title = document.querySelector('title');
  if (title) localizeTree(title);
  // Translate only the untouched default room title, never a custom room name.
  const roomName = document.getElementById('room-title-input');
  if (roomName && (roomName.value === 'Nog één potje' || roomName.value === 'One more round'))
    roomName.value = language === 'en' ? 'One more round' : 'Nog één potje';
  const description = document.querySelector('meta[name="description"]');
  if (description) localizeAttributes(description);
}

function initLanguageMenu() {
  const header = document.querySelector('header.topbar');
  if (!header) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'language-switcher';
  wrapper.dataset.noTranslate = '';
  wrapper.innerHTML = `
    <button type="button" class="language-current" aria-expanded="false" aria-haspopup="true">
      <span class="language-flag" aria-hidden="true"></span>
      <span class="language-code"></span><span aria-hidden="true">⌄</span>
    </button>
    <div class="language-menu" hidden>
      <button type="button" data-select-language="en">🇬🇧 English</button>
      <button type="button" data-select-language="nl">🇳🇱 Nederlands</button>
    </div>`;
  const actions = header.querySelector('.topbar-actions');
  if (!actions) header.classList.add('language-header-legal');
  (actions || header).append(wrapper);
  const toggle = wrapper.querySelector('.language-current');
  const menu = wrapper.querySelector('.language-menu');
  function close() { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
  function refresh() {
    wrapper.querySelector('.language-flag').textContent = language === 'en' ? '🇬🇧' : '🇳🇱';
    wrapper.querySelector('.language-code').textContent = language.toUpperCase();
    toggle.setAttribute('aria-label', language === 'en' ? 'Language: English. Change language' : 'Taal: Nederlands. Taal wijzigen');
    wrapper.querySelectorAll('[data-select-language]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.selectLanguage === language));
    });
  }
  toggle.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    toggle.setAttribute('aria-expanded', String(!menu.hidden));
  });
  wrapper.querySelectorAll('[data-select-language]').forEach(button => button.addEventListener('click', () => {
    setLanguage(button.dataset.selectLanguage);
    refresh();
    close();
    toggle.focus();
  }));
  document.addEventListener('click', event => { if (!wrapper.contains(event.target)) close(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) { close(); toggle.focus(); }
  });
  refresh();
}

export function setLanguage(next) {
  if (next !== 'en' && next !== 'nl') return;
  language = next;
  try { localStorage.setItem(languageKey, next); } catch { /* Optional persistence. */ }
  localizePage();
}

function init() {
  initLanguageMenu();
  localizePage();
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') localizeNode(record.target);
      else if (record.type === 'attributes') localizeAttributes(record.target);
      else for (const node of record.addedNodes) localizeTree(node);
    }
  });
  observer.observe(document.documentElement, {
    subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: [...translatedAttributes, 'content']
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
}
