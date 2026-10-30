// Input profiles describe local people, not network ports. The guest also uses profile 0.
export const INPUT_STORAGE_KEY = 'retroroom-controls-v1';
export const ACTIONS = [
  { bit: 4, name: 'Omhoog' }, { bit: 5, name: 'Omlaag' },
  { bit: 6, name: 'Links' }, { bit: 7, name: 'Rechts' },
  { bit: 0, name: 'A' }, { bit: 1, name: 'B' },
  { bit: 8, name: 'X' }, { bit: 9, name: 'Y' },
  { bit: 10, name: 'L' }, { bit: 11, name: 'R' },
  { bit: 2, name: 'Select' }, { bit: 3, name: 'Start' }
];
export function actionsFor(system) { return ACTIONS.filter(a => system !== 'nes' || a.bit < 8); }
const clone = value => JSON.parse(JSON.stringify(value));
export function defaultProfile(system, player) {
  const keys = player === 0
    ? ['KeyA', 'KeyS', ['ShiftLeft', 'ShiftRight'], 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyD', 'KeyF', 'KeyQ', 'KeyW']
    : ['KeyN', 'KeyM', 'KeyR', 'KeyT', 'KeyI', 'KeyK', 'KeyJ', 'KeyL', 'KeyU', 'KeyO', 'KeyY', 'KeyH'];
  const indices = system === 'snes' ? [1, 0, 8, 9, 12, 13, 14, 15, 3, 2, 4, 5] : [0, 1, 8, 9, 12, 13, 14, 15, 3, 2, 4, 5];
  return {
    keyboard: keys.map(key => Array.isArray(key) ? [...key] : [key]),
    gamepad: indices.map((index, bit) => {
      const bindings = [{ type: 'button', index }];
      if (bit >= 4 && bit <= 7) bindings.push({ type: 'axis', index: bit < 6 ? 1 : 0, direction: bit % 2 ? 1 : -1 });
      return bindings;
    }),
    device: { mode: 'auto' }, deadzone: 0.45
  };
}
export function defaultSettings() {
  return { version: 1, nes: [defaultProfile('nes', 0), defaultProfile('nes', 1)], snes: [defaultProfile('snes', 0), defaultProfile('snes', 1)], dos: [defaultProfile('dos', 0), defaultProfile('dos', 1)] };
}
export function validKey(code) {
  return typeof code === 'string' && /^(Key[A-Z]|Digit[0-9]|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter)|Arrow(?:Up|Down|Left|Right)|Shift(?:Left|Right)|Enter|Space|Tab|Backspace|CapsLock|BracketLeft|BracketRight|Semicolon|Quote|Comma|Period|Slash|Backslash|Minus|Equal|Backquote|Home|End|PageUp|PageDown|Insert|Delete)$/.test(code);
}
export function validBinding(binding) {
  return binding && Number.isInteger(binding.index) && binding.index >= 0 &&
    (binding.type === 'button' && binding.index < 128 ||
     binding.type === 'axis' && binding.index < 32 && [-1, 1].includes(binding.direction));
}
export function bindingId(binding) { return `${binding.type}:${binding.index}:${binding.direction ?? ''}`; }
export function normalizeSettings(value) {
  const defaults = defaultSettings();
  if (!value || value.version !== 1) return defaults;
  for (const system of ['nes', 'snes', 'dos']) for (let player = 0; player < 2; player++) {
    const source = value[system]?.[player], target = defaults[system][player];
    if (!source || typeof source !== 'object') continue;
    for (const kind of ['keyboard', 'gamepad']) {
      if (!Array.isArray(source[kind]) || source[kind].length !== 12) continue;
      const used = new Set();
      target[kind] = source[kind].map(list => {
        if (!Array.isArray(list)) return [];
        return list.slice(0, 4).filter(item => {
          if (kind === 'keyboard' ? !validKey(item) : !validBinding(item)) return false;
          const id = kind === 'keyboard' ? item : bindingId(item);
          if (used.has(id)) return false;
          used.add(id); return true;
        }).map(item => kind === 'keyboard' ? item : item.type === 'axis'
          ? { type: 'axis', index: item.index, direction: item.direction } : { type: 'button', index: item.index });
      });
    }
    if (Number.isFinite(source.deadzone)) target.deadzone = Math.min(0.9, Math.max(0.15, source.deadzone));
    if (source.device?.mode === 'none') target.device = { mode: 'none' };
    if (source.device?.mode === 'specific' && typeof source.device.id === 'string' && source.device.id.length <= 512 &&
        Number.isInteger(source.device.index) && source.device.index >= 0 && source.device.index < 32) {
      target.device = { mode: 'specific', id: source.device.id, index: source.device.index };
    }
  }
  return defaults;
}
export function loadSettings(storage) {
  try { return normalizeSettings(JSON.parse(storage?.getItem(INPUT_STORAGE_KEY))); }
  catch { return defaultSettings(); }
}
export function saveSettings(storage, settings) {
  try { storage.setItem(INPUT_STORAGE_KEY, JSON.stringify(settings)); return true; }
  catch { return false; }
}
export function assignBinding(profile, kind, bit, binding) {
  if (!['keyboard', 'gamepad'].includes(kind) || !Number.isInteger(bit) || bit < 0 || bit > 11) return;
  if (binding !== null && (kind === 'keyboard' ? !validKey(binding) : !validBinding(binding))) return;
  const id = binding === null ? null : kind === 'keyboard' ? binding : bindingId(binding);
  // One physical input does one thing within a profile. Rebinding moves it.
  profile[kind] = profile[kind].map(list => list.filter(item => (kind === 'keyboard' ? item : bindingId(item)) !== id));
  profile[kind][bit] = binding === null ? [] : [clone(binding)];
}
export function readGamepads(navigatorObject = globalThis.navigator) {
  try { return Array.from(navigatorObject?.getGamepads?.() || []).filter(pad => pad?.connected !== false && pad); }
  catch { return []; }
}
// Explicit choices reserve a physical index before automatic assignment. Never renumber null slots.
export function resolvePads(profiles, pads, activePlayers = 2) {
  const result = [null, null], used = new Set();
  for (let player = 0; player < activePlayers; player++) {
    const device = profiles[player].device;
    if (device.mode !== 'specific') continue;
    const pad = pads.find(pad => pad.index === device.index && pad.id === device.id);
    if (pad && !used.has(pad.index)) { result[player] = pad; used.add(pad.index); }
  }
  for (let player = 0; player < activePlayers; player++) {
    if (profiles[player].device.mode !== 'auto') continue;
    // Profile 2 keeps its controller when profile 1 disconnects; holes do not shift assignments.
    const pad = pads.find(pad => pad.index === player && !used.has(pad.index));
    if (pad) { result[player] = pad; used.add(pad.index); }
  }
  return result;
}
export function bindingDown(binding, pad, deadzone) {
  if (!pad) return false;
  if (binding.type === 'button') {
    const button = pad.buttons[binding.index];
    return !!button && (button.pressed || button.value > 0.5);
  }
  const value = pad.axes[binding.index];
  return Number.isFinite(value) && value * binding.direction > deadzone;
}
export function activeBindings(pad, deadzone = 0.6) {
  if (!pad) return [];
  const result = [];
  pad.buttons.forEach((button, index) => { if (button?.pressed || button?.value > 0.5) result.push({ type: 'button', index }); });
  pad.axes.forEach((value, index) => { if (Number.isFinite(value) && Math.abs(value) > deadzone) result.push({ type: 'axis', index, direction: Math.sign(value) }); });
  return result;
}
export function inputBits(profile, keys, pad, system, touch = []) {
  let bits = 0;
  for (const { bit } of actionsFor(system)) {
    if (profile.keyboard[bit].some(key => keys.has(key)) || profile.gamepad[bit].some(binding => bindingDown(binding, pad, profile.deadzone))) bits |= 1 << bit;
  }
  for (const bit of touch) if (Number.isInteger(bit) && bit >= 0 && bit < 12) bits |= 1 << bit;
  if ((bits & 48) === 48) bits &= ~48;
  if ((bits & 192) === 192) bits &= ~192;
  return bits & (system === 'nes' ? 255 : 4095);
}
export function keyLabel(code) {
  return ({ ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'Shift links', ShiftRight: 'Shift rechts', Space: 'Spatie',
    BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`' })[code] || code?.replace(/^Key|^Digit/, '').replace('Numpad', 'Num ');
}
export function padLabel(binding) {
  return binding.type === 'button' ? `Knop ${binding.index + 1}` : `As ${binding.index + 1} ${binding.direction < 0 ? '−' : '+'}`;
}
