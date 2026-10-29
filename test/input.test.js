import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, INPUT_STORAGE_KEY, defaultProfile, defaultSettings, normalizeSettings, loadSettings, saveSettings,
  assignBinding, resolvePads, readGamepads, inputBits, activeBindings } from '../web/src/input.js';

const pad = (index, id = 'Testpad') => ({ index, id, connected: true, buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] });
test('default primary keyboard uses arrows and ASDFQW; local players do not share keys', () => {
  const settings = defaultSettings();
  for (const system of ['nes', 'snes']) {
    const [first, second] = settings[system];
    for (const key of second.keyboard.flat()) assert.ok(!first.keyboard.flat().includes(key));
    const expected = { KeyA: 1, KeyS: 2, Enter: 8, ShiftLeft: 4, ShiftRight: 4, ArrowUp: 16, ArrowDown: 32, ArrowLeft: 64, ArrowRight: 128, KeyD: 256, KeyF: 512, KeyQ: 1024, KeyW: 2048 };
    for (const [key, bits] of Object.entries(expected)) assert.equal(inputBits(first, new Set([key]), null, system), bits & (system === 'snes' ? 4095 : 255));
  }
});
test('each local profile has independent mappings, and guest can use the primary profile for port 2', () => {
  const profiles = defaultSettings().snes;
  assignBinding(profiles[0], 'keyboard', 0, 'KeyZ');
  assignBinding(profiles[1], 'keyboard', 1, 'KeyX');
  const keys = new Set(['KeyZ', 'KeyX']);
  assert.equal(inputBits(profiles[0], keys, null, 'snes'), 1);
  assert.equal(inputBits(profiles[1], keys, null, 'snes'), 2);
  // Network role never changes the local profile; its mask is forwarded as the guest input.
  assert.equal(inputBits(profiles[0], new Set(['KeyZ']), null, 'snes'), 1);
});
test('rebinding moves a physical input and clearing unbinds only that action', () => {
  const profile = defaultProfile('snes', 0);
  assignBinding(profile, 'keyboard', 0, 'KeyS');
  assert.deepEqual(profile.keyboard[1], []);
  assert.equal(inputBits(profile, new Set(['KeyS']), null, 'snes'), 1);
  assignBinding(profile, 'keyboard', 0, null);
  assert.equal(inputBits(profile, new Set(['KeyS']), null, 'snes'), 0);
  assignBinding(profile, 'gamepad', 0, { type: 'axis', index: 0, direction: -1 });
  assert.deepEqual(profile.gamepad[6], [{ type: 'button', index: 14 }]);
  const before = structuredClone(profile);
  assignBinding(profile, 'keyboard', 0, 'Escape');
  assignBinding(profile, 'gamepad', 0, { type: 'axis', index: -1, direction: 5 });
  assert.deepEqual(profile, before);
});
test('stick thresholds, button values, opposite directions and NES/SNES masks', () => {
  const profile = defaultProfile('snes', 0), controller = pad(0);
  controller.axes[0] = -0.44;
  assert.equal(inputBits(profile, new Set(), controller, 'snes'), 0);
  controller.axes[0] = -0.46;
  assert.equal(inputBits(profile, new Set(), controller, 'snes'), 64);
  controller.buttons[15].pressed = true;
  assert.equal(inputBits(profile, new Set(['ArrowUp', 'ArrowDown']), controller, 'snes'), 0);
  controller.axes[0] = 0; controller.buttons[15].pressed = false;
  controller.buttons[5].value = 0.8;
  assert.equal(inputBits(profile, new Set(), controller, 'snes'), 2048);
  assert.equal(inputBits(profile, new Set(), controller, 'nes'), 0);
  assert.equal(inputBits(profile, new Set(), null, 'nes', [0, 8, 4, 5, 999, -1]), 1);
  controller.axes[2] = NaN;
  assert.deepEqual(activeBindings(controller), [{ type: 'button', index: 5 }]);
});
test('NES and SNES standard gamepad positions remain distinct; every action can be remapped', () => {
  const controller = pad(0); controller.buttons[1].pressed = true;
  assert.equal(inputBits(defaultProfile('nes', 0), new Set(), controller, 'nes'), 2);
  assert.equal(inputBits(defaultProfile('snes', 0), new Set(), controller, 'snes'), 1);
  for (const { bit } of ACTIONS) {
    const profile = defaultProfile('snes', 0), controller = pad(0);
    assignBinding(profile, 'gamepad', bit, { type: 'button', index: 17 });
    controller.buttons[17].pressed = true;
    assert.equal(inputBits(profile, new Set(), controller, 'snes'), 1 << bit);
  }
});
test('gamepad holes and disconnects never move player 2 to player 1', () => {
  const first = pad(0), second = pad(1), profiles = defaultSettings().nes;
  assert.deepEqual(resolvePads(profiles, [first, second]), [first, second]);
  assert.deepEqual(resolvePads(profiles, [second]), [null, second]);
  assert.deepEqual(readGamepads({ getGamepads: () => [null, second, { ...first, connected: false }] }), [second]);
  assert.deepEqual(resolvePads(profiles, []), [null, null]);
  assert.deepEqual(readGamepads({ getGamepads() { throw new Error('SecurityError'); } }), []);
  assert.deepEqual(readGamepads({}), []);
});
test('explicit pad picks reserve devices, cannot control both players and ignore replacement models', () => {
  const profiles = defaultSettings().nes, first = pad(0), third = pad(2, 'Other pad');
  profiles[1].device = { mode: 'specific', id: first.id, index: 0 };
  assert.deepEqual(resolvePads(profiles, [first, third]), [null, first]);
  // An online player does not reserve controllers for the unused second local profile.
  assert.deepEqual(resolvePads(profiles, [first, third], 1), [first, null]);
  profiles[0].device = { mode: 'specific', id: third.id, index: 2 };
  assert.deepEqual(resolvePads(profiles, [first, third]), [third, first]);
  assert.deepEqual(resolvePads(profiles, [first, { ...third, id: 'Replacement' }]), [null, first]);
  profiles[1].device = { ...profiles[0].device };
  assert.deepEqual(resolvePads(profiles, [first, third]), [third, null]);
  profiles[0].device = { mode: 'none' };
  assert.deepEqual(resolvePads(profiles, [first, third]), [null, third]);
});
test('settings round-trip preserves profiles and console-specific mappings', () => {
  let stored = null;
  const storage = { getItem(key) { assert.equal(key, INPUT_STORAGE_KEY); return stored; }, setItem(key, value) { assert.equal(key, INPUT_STORAGE_KEY); stored = value; } };
  const settings = defaultSettings();
  assignBinding(settings.snes[1], 'keyboard', 11, 'Numpad9');
  settings.nes[0].device = { mode: 'specific', id: 'A controller', index: 3 };
  settings.snes[1].deadzone = 0.8;
  assert.equal(saveSettings(storage, settings), true);
  assert.deepEqual(loadSettings(storage), settings);
  assert.notDeepEqual(settings.nes[1], settings.snes[1]);
});
test('unavailable, malformed and future storage falls back safely; stored values are bounded', () => {
  const blocked = { getItem() { throw new Error(); }, setItem() { throw new Error(); } };
  assert.deepEqual(loadSettings(blocked), defaultSettings());
  assert.equal(saveSettings(blocked, defaultSettings()), false);
  assert.deepEqual(loadSettings({ getItem: () => '{wrong' }), defaultSettings());
  assert.deepEqual(normalizeSettings({ version: 99 }), defaultSettings());
  const settings = defaultSettings();
  settings.nes[0].keyboard[0] = ['Escape', 'KeyA', 'KeyA', 'bad'];
  settings.nes[0].keyboard[1] = ['KeyA'];
  settings.nes[0].gamepad[0] = [{ type: 'button', index: 999 }, { type: 'axis', index: 0, direction: 0 }];
  settings.nes[0].deadzone = 1000;
  settings.nes[0].device = { mode: 'specific', id: 'bad', index: -1 };
  const normalized = normalizeSettings(settings);
  assert.deepEqual(normalized.nes[0].keyboard[0], ['KeyA']);
  assert.deepEqual(normalized.nes[0].keyboard[1], []);
  assert.deepEqual(normalized.nes[0].gamepad[0], []);
  assert.equal(normalized.nes[0].deadzone, 0.9);
  assert.deepEqual(normalized.nes[0].device, { mode: 'auto' });
});
