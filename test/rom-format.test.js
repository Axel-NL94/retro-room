import test from 'node:test';
import assert from 'node:assert/strict';
import { NES } from 'jsnes';
import { NesCore, validateRom } from '../web/src/emulator.js';
import { stateHash } from '../web/src/rollback.js';
import { makeDemoRom } from '../scripts/demo-rom.js';

function nes2() { const bytes = makeDemoRom(); bytes[7] |= 8; return bytes; }
function core(bytes) { const c = new NesCore(NES); c.load(bytes); return c; }

test('NES 2.0 demo loads natively, preserves its bytes and replays deterministically', () => {
  const bytes = nes2(), original = bytes.slice();
  validateRom(bytes);
  const a = core(bytes), b = core(makeDemoRom());
  assert.equal(a.nes.rom.isNES2, true);
  assert.equal(a.nes.rom.mapperType, 0);
  for (let i = 0; i < 30; i++) { a.run(i % 2, i % 3 === 0 ? 1 : 0); b.run(i % 2, i % 3 === 0 ? 1 : 0); }
  assert.equal(stateHash(a.save()), stateHash(b.save()));
  const saved = a.save();
  for (let i = 0; i < 10; i++) a.run(i % 2, 0);
  const expected = stateHash(a.save());
  a.restore(saved);
  for (let i = 0; i < 10; i++) a.run(i % 2, 0, true);
  assert.equal(stateHash(a.save()), expected);
  assert.deepEqual(bytes, original);
});

test('NES 2.0 extended linear sizes require all PRG and CHR data', () => {
  const header = nes2().subarray(0, 16);
  const large = new Uint8Array(16 + 256 * 16384 + 8192);
  large.set(header); large[4] = 0; large[9] = 1;
  assert.doesNotThrow(() => validateRom(large));
  assert.throws(() => validateRom(large.subarray(0, large.length - 1)), /onvolledig/);
  const chr = new Uint8Array(16 + 16384 + 256 * 8192);
  chr.set(header); chr[5] = 0; chr[9] = 16;
  assert.doesNotThrow(() => validateRom(chr));
  assert.throws(() => validateRom(chr.subarray(0, chr.length - 1)), /onvolledig/);
});

test('NES 2.0 exponent sizes load the same PRG and CHR as linear sizes', () => {
  const bytes = nes2(); bytes[4] = 14 << 2; bytes[5] = 13 << 2; bytes[9] = 255;
  validateRom(bytes);
  const a = core(bytes), b = core(nes2());
  for (let i = 0; i < 12; i++) { a.run(i % 2, 0); b.run(i % 2, 0); }
  assert.equal(stateHash(a.save()), stateHash(b.save()));
  assert.throws(() => validateRom(bytes.subarray(0, bytes.length - 1)), /onvolledig/);
  bytes[4] = 63 << 2;
  assert.throws(() => validateRom(bytes), /onvolledig/);
});

test('trainer bytes are included in validation and skipped before NES 2.0 PRG data', () => {
  const bytes = nes2(), trained = new Uint8Array(bytes.length + 512);
  trained.set(bytes.subarray(0, 16)); trained[6] |= 4;
  trained.set(bytes.subarray(16), 16 + 512);
  const a = core(trained), b = core(bytes);
  for (let i = 0; i < 12; i++) { a.run(i % 2, 0); b.run(i % 2, 0); }
  assert.equal(stateHash(a.save()), stateHash(b.save()));
  assert.throws(() => validateRom(trained.subarray(0, trained.length - 1)), /onvolledig/);
});

test('unsupported console variants and misaligned bank layouts fail before loading', () => {
  const bytes = nes2(); bytes[7] |= 1;
  assert.throws(() => validateRom(bytes), /consoletype/);
  bytes[7] &= ~3; bytes[4] = 13 << 2; bytes[9] = 15;
  assert.throws(() => validateRom(bytes), /bankgrootte/);
  const empty = nes2(); empty[4] = 0;
  assert.throws(() => validateRom(empty), /onvolledig/);
});
