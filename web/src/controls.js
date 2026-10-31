import {DOS_OUTPUTS,DOS_DEFAULT_OUTPUTS,dosPadInput} from './dos-input.js';
import { actionsFor, defaultProfile, loadSettings, saveSettings, assignBinding, validKey,
  readGamepads, resolvePads, activeBindings, inputBits, keyLabel, padLabel } from './input.js';

export function createControls({ pressed, touched, release, currentSystem, localCoop, onChange }) {
  const $ = id => document.getElementById(id), dialog = $('controls-dialog');
  let storage;
  try { storage = localStorage; } catch { /* In-memory profiles still work. */ }
  const settings = loadSettings(storage);
  let system = 'nes', player = 0, capture = null, raf = null, deviceSignature = '';
  const uiKeys = new Set(), blockedPads = new Set();
  const profile = () => settings[system][player];
  const describeKeys = (system, player, bits) => bits.map(bit => {
    const action = actionsFor(system).find(action => action.bit === bit);
    return `${action.name}: ${settings[system][player].keyboard[bit].map(keyLabel).join(' / ') || '—'}`;
  }).join(' · ');
  function guide() {
    const system = currentSystem();
    $('keyboard-guide').textContent = describeKeys(system, 0, [4, 5, 6, 7, 0, 1, 3, 2]);
    $('snes-controls-guide').textContent = describeKeys(system === 'dos' ? 'dos' : 'snes', 0, [8, 9, 10, 11]);
    $('snes-controls-guide').hidden = system === 'nes';
    $('solo-controls').textContent = 'Tweede speler op dit apparaat — ' + describeKeys(system, 1, actionsFor(system).map(action => action.bit));
    if(system==='dos'){$('keyboard-guide').textContent='Volledig toetsenbord, inclusief Ctrl/Alt/Shift, F1–F12 en numeriek toetsenblok.';$('snes-controls-guide').hidden=true;$('solo-controls').textContent='Het toetsenbord en de muis zijn gedeeld. Een tweede lokale controller gebruikt profiel 2.';}
    $('game-hint').textContent = system==='dos'?'Klik in het beeld voor het toetsenbord. DOS-menu: Alt+Shift+M · toetsverdeling, beurten en Escape.':' '+describeKeys(system, 0, [0, 1, 3]) + ' · Besturing instellen via ⚙';
  }
  function persist() {
    const saved = saveSettings(storage, settings);
    $('controls-storage').textContent = saved ? 'Automatisch opgeslagen in deze browser, apart voor NES, SNES en DOS.' : 'Opslaan is geblokkeerd in deze browser. Je instellingen werken tot je deze pagina sluit.';
    guide(); onChange?.();
  }
  function finishCapture(message = 'Kies een knop om opnieuw in te stellen.') {
    capture = null; release(); uiKeys.clear();
    $('binding-capture').hidden = true;
    $('controls-status').textContent = message;
    renderRows();
  }
  function storeBinding(binding) {
    const { kind, bit } = capture;
    assignBinding(profile(), kind, bit, binding);
    persist(); finishCapture('Opgeslagen. Een bestaande koppeling aan dezelfde knop is verplaatst.');
  }
  function beginCapture(kind, bit) {
    release(); uiKeys.clear();
    capture = { kind, bit, armed: false, device: null };
    const name = actionsFor(system).find(action => action.bit === bit).name;
    $('binding-capture').hidden = false;
    $('capture-prompt').textContent = kind === 'keyboard'
      ? `${name}: druk op een toets. Escape annuleert.`
      : `${name}: laat alle controllerknoppen los en druk daarna op een knop of beweeg een stick. Escape annuleert.`;
    $('controls-status').textContent = '';
    renderRows(); $('cancel-binding').focus();
  }
  function renderRows() {
    const rows = actionsFor(system).map(({ bit, name }) => {
      const row = document.createElement('tr'); row.dataset.bit = bit;
      const label = document.createElement('th'); label.scope = 'row'; label.textContent = name;
      row.append(label);
      for (const kind of ['keyboard', 'gamepad']) {
        const cell = document.createElement('td'), button = document.createElement('button');
        button.type = 'button'; button.className = 'binding-button';
        if(system==='dos'&&kind==='keyboard') {
          const select=document.createElement('select');select.setAttribute('aria-label','DOS-toets voor '+name);
          select.append(new Option('Niet ingesteld',''));
          for(const code of Object.keys(DOS_OUTPUTS))select.append(new Option(keyLabel(code),code));
          select.value=profile().dosOutputs[bit];select.onchange=()=>{profile().dosOutputs[bit]=select.value;persist();};cell.append(select);row.append(cell);continue;
        }
        const text = profile()[kind][bit].map(kind === 'keyboard' ? keyLabel : padLabel).join(' / ') || 'Niet ingesteld';
        button.textContent = capture?.kind === kind && capture.bit === bit ? 'Wachten op invoer…' : text;
        button.setAttribute('aria-label', `${kind === 'keyboard' ? 'Toetsenbord' : 'Controller'} ${name}: ${text}`);
        button.onclick = () => beginCapture(kind, bit); cell.append(button); row.append(cell);
      }
      const cell = document.createElement('td'), indicator = document.createElement('span');
      indicator.className = 'input-indicator'; indicator.textContent = '○'; indicator.setAttribute('aria-label', `${name} niet ingedrukt`);
      cell.append(indicator); row.append(cell); return row;
    });
    $('control-bindings').replaceChildren(...rows);
  }
  function renderDevices(pads) {
    const choice = profile().device;
    const options = [new Option(`Automatisch · controller ${player + 1}`, 'auto'), new Option('Geen controller · alleen toetsenbord', 'none')];
    for (const pad of pads) options.push(new Option(`${pad.index + 1}: ${pad.id}`, String(pad.index)));
    let value = choice.mode;
    if (choice.mode === 'specific') {
      value = String(choice.index);
      if (!pads.some(pad => pad.index === choice.index && pad.id === choice.id)) {
        // Do not silently substitute another model that reuses a disconnected index.
        value = 'disconnected'; options.push(new Option(`Losgekoppeld: ${choice.id}`, value));
      }
    }
    $('control-device').replaceChildren(...options); $('control-device').value = value;
    deviceSignature = `${system}:${player}:${JSON.stringify(choice)}:${pads.map(pad => `${pad.index}:${pad.id}`).join('|')}`;
  }
  function renderProfile() {
    finishCapture(); renderDevices(readGamepads());
    $('dos-controller-options').hidden=system!=='dos';$('control-dos-mode').value=profile().dosMode||'keyboard';
    $('control-key-column').textContent=system==='dos'?'DOS-toets / muisknop':'Toetsenbord';
    $('control-deadzone').value = String(Math.round(profile().deadzone * 100));
    $('deadzone-value').textContent = `${$('control-deadzone').value}%`;
    $('control-profile-note').textContent = player === 0
      ? 'Jouw eigen besturing: speler 1 als host of solo, speler 2 als je online meespeelt.'
      : 'Alleen voor een tweede speler op dit apparaat tijdens solo. Online stelt je vriend zijn eigen besturing in.';
  }
  function poll() {
    if (!dialog.open) return;
    const pads = readGamepads();
    const signature = `${system}:${player}:${JSON.stringify(profile().device)}:${pads.map(pad => `${pad.index}:${pad.id}`).join('|')}`;
    if (signature !== deviceSignature) renderDevices(pads);
    const pad = resolvePads(settings[system], pads, player === 1 || localCoop() ? 2 : 1)[player];
    const desired = profile().device;
    const selected = pads.find(pad => desired.mode === 'specific' ? pad.index === desired.index && pad.id === desired.id : desired.mode === 'auto' && pad.index === player);
    const status = pad ? `Verbonden: ${pad.id}` : selected
      ? 'Deze controller wordt door het andere lokale profiel gebruikt. Kies een andere controller.'
      : desired.mode === 'none' ? 'Controller uitgeschakeld voor dit profiel. Je toetsenbord blijft beschikbaar.'
        : 'Geen controller voor dit profiel. Sluit er een aan en druk op een knop om hem te herkennen.';
    if ($('control-pad-status').textContent !== status) $('control-pad-status').textContent = status;
    if (capture?.kind === 'gamepad') {
      const identity = pad ? `${pad.index}:${pad.id}` : null;
      if (capture.device !== identity) { capture.device = identity; capture.armed = false; }
      const active = activeBindings(pad, Math.max(0.6, profile().deadzone));
      if (pad && active.length === 0) capture.armed = true;
      else if (capture.armed && active.length) { storeBinding(active[0]); }
    }
    const bits = capture ? 0 : inputBits(profile(), uiKeys, pad, system);
    for (const row of $('control-bindings').rows) {
      const down = !!(bits & 1 << Number(row.dataset.bit)), indicator = row.querySelector('.input-indicator');
      if (indicator.dataset.down === String(down)) continue;
      indicator.dataset.down = String(down);
      indicator.classList.toggle('active', down); indicator.textContent = down ? '●' : '○';
      indicator.setAttribute('aria-label', `${row.firstChild.textContent} ${down ? 'ingedrukt' : 'niet ingedrukt'}`);
    }
    raf = requestAnimationFrame(poll);
  }
  function open() {
    system = currentSystem(); player = 0;
    $('control-system').value = system; $('control-profile').value = '0';
    release(); renderProfile(); persist(); dialog.showModal(); dialog.scrollTop = 0; poll();
  }
  document.querySelectorAll('[data-controls]').forEach(button => { button.onclick = open; });
  document.querySelectorAll('[data-dos-preset]').forEach(button=>{button.onclick=()=>{profile().dosOutputs=[...DOS_DEFAULT_OUTPUTS[Number(button.dataset.dosPreset)]];profile().dosMode='keyboard';renderProfile();persist();};});
  $('control-dos-mode').onchange=event=>{profile().dosMode=event.target.value;persist();};
  $('control-system').onchange = event => { system = event.target.value; renderProfile(); };
  $('control-profile').onchange = event => { player = Number(event.target.value); renderProfile(); };
  $('control-device').onchange = event => {
    const value = event.target.value, pad = readGamepads().find(pad => String(pad.index) === value);
    profile().device = pad ? { mode: 'specific', index: pad.index, id: pad.id } : { mode: value === 'none' ? 'none' : 'auto' };
    finishCapture(); persist(); renderDevices(readGamepads());
  };
  $('control-deadzone').oninput = event => {
    profile().deadzone = Number(event.target.value) / 100;
    $('deadzone-value').textContent = `${event.target.value}%`; persist();
  };
  $('reset-controls').onclick = () => { settings[system][player] = defaultProfile(system, player); renderProfile(); persist(); $('controls-status').textContent = 'Standaardinstellingen hersteld voor dit profiel en deze console.'; };
  $('cancel-binding').onclick = () => finishCapture('Instellen geannuleerd.');
  $('clear-binding').onclick = () => { if (capture) storeBinding(null); };
  dialog.addEventListener('cancel', event => { if (capture) { event.preventDefault(); finishCapture('Instellen geannuleerd.'); } });
  dialog.addEventListener('close', () => {
    cancelAnimationFrame(raf); capture = null; release(); uiKeys.clear();
    for (const pad of readGamepads()) if (activeBindings(pad, 0.15).length) blockedPads.add(pad.index);
  });
  document.addEventListener('keydown', event => {
    if (!dialog.open || event.ctrlKey || event.metaKey || event.altKey) return;
    if (capture) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.code === 'Escape') finishCapture('Instellen geannuleerd.');
      else if (capture.kind === 'keyboard' && validKey(event.code) && !event.repeat) storeBinding(event.code);
      return;
    }
    if (validKey(event.code)) uiKeys.add(event.code);
  }, true);
  document.addEventListener('keyup', event => uiKeys.delete(event.code));
  window.addEventListener('blur', () => uiKeys.clear());
  function deviceHint() {
    const pads = readGamepads();
    $('gamepad-hint').textContent = pads.length ? `${pads.length} controller${pads.length > 1 ? 's' : ''} verbonden. Kies en test ze bij Besturing.` : 'Sluit een USB- of Bluetooth-controller aan en druk op een knop. Stel hem in via Besturing.';
  }
  for (const event of ['gamepadconnected', 'gamepaddisconnected']) window.addEventListener(event, deviceHint);
  guide(); deviceHint();
  return {
    guide,
    hasKey(code) {
      const profiles = settings[currentSystem()];
      return profiles.slice(0, localCoop() ? 2 : 1).some(profile => profile.keyboard.some(keys => keys.includes(code)));
    },
    dosPad(player,bits) {
      const profiles=settings.dos;let pad=resolvePads(profiles,readGamepads(),localCoop()?2:1)[player];if(pad&&blockedPads.has(pad.index))pad=null;
      const axis=index=>{const v=pad?.axes[index]||0,d=profiles[player].deadzone;return Math.abs(v)<=d?0:Math.sign(v)*Math.min(1,(Math.abs(v)-d)/(1-d));};
      return dosPadInput(bits,profiles[player],{x:axis(0),y:axis(1)},player);
    },
    buttons(player, touch = false, keyboard = true) {
      if (document.hidden || document.querySelector('dialog[open]')) return 0;
      const system = currentSystem(), profiles = settings[system];
      let pad = resolvePads(profiles, readGamepads(), localCoop() ? 2 : 1)[player];
      if (pad && blockedPads.has(pad.index)) {
        if (!activeBindings(pad, profiles[player].deadzone).length) blockedPads.delete(pad.index);
        else pad = null;
      }
      return inputBits(profiles[player], keyboard?pressed:new Set(), pad, system, touch ? touched : []);
    }
  };
}
