import test from 'node:test';
import assert from 'node:assert/strict';
import { NES } from 'jsnes';
import { NesCore, validateRom, romHash } from '../web/src/emulator.js';
import { RollbackSession, stateHash } from '../web/src/rollback.js';
import { makeDemoRom } from '../scripts/demo-rom.js';

const rom = makeDemoRom();
function core() { const c = new NesCore(NES); c.load(rom); return c; }

test('original demo is a valid ROM and both controller ports work', () => {
  validateRom(rom);
  const c = core();
  for (let f = 0; f < 20; f++) c.run(0, 0);
  assert.equal(c.nes.cpu.mem[0], 24);
  assert.equal(c.nes.cpu.mem[1], 24);
  c.run(1, 0); c.run(0, 0); c.run(0, 1); c.run(0, 0);
  assert.equal(c.nes.cpu.mem[0], 28);
  assert.equal(c.nes.cpu.mem[1], 28);
});

test('NES save/restore deterministically replays video, CPU and audio state', () => {
  const a = core();
  for (let f = 0; f < 70; f++) a.run(f % 3 === 0 ? 1 : 0, f % 7 === 0 ? 1 : 0);
  const snapshot = a.save();
  for (let f = 0; f < 30; f++) a.run(f % 2, (f + 1) % 2);
  const expected = stateHash(a.save());
  a.restore(snapshot);
  for (let f = 0; f < 30; f++) a.run(f % 2, (f + 1) % 2, true);
  assert.equal(stateHash(a.save()), expected);
});

test('two NES peers converge under delayed, reordered and duplicate inputs', () => {
  const a = core(), b = core();
  let clock = 0;
  const queue = [];
  const schedule = (target, message, extra) => {
    queue.push({ target, message, at: clock + extra });
    if (message.frame % 23 === 0) queue.push({ target, message, at: clock + extra + 1 });
  };
  let left, right;
  left = new RollbackSession(a, { player: 1, send: m => schedule(right, m, 1 + m.frame % 7) });
  right = new RollbackSession(b, { player: 2, send: m => schedule(left, m, 1 + m.frame % 5) });
  while (left.frame < 200 || right.frame < 200) {
    for (let i = queue.length - 1; i >= 0; i--) {
      const q = queue[i];
      if (q.at <= clock) { q.target.receive(q.message.frame, q.message.buttons); queue.splice(i, 1); }
    }
    if (left.frame < 200) left.tick(left.frame % 5 === 0 ? 1 : 0);
    if (right.frame < 200) right.tick(right.frame % 7 === 0 ? 1 : 0);
    clock++;
    assert.ok(clock < 1000, 'must not deadlock');
  }
  for (const q of queue) q.target.receive(q.message.frame, q.message.buttons);
  left.reconcile(); right.reconcile();
  assert.ok(left.rollbacks > 0);
  assert.ok(right.rollbacks > 0);
  assert.equal(stateHash(a.save()), stateHash(b.save()));
  assert.equal(left.hashAt(120), right.hashAt(120));
});

test('prediction is bounded during network outage and resumes after delivery', () => {
  const a = new RollbackSession(core());
  for (let i = 0; i < 100; i++) a.tick(0);
  assert.ok(a.frame <= 14);
  assert.equal(a.waiting, true);
  for (let f = 2; f < 30; f++) a.receive(f, 0);
  assert.equal(a.tick(0), true);
  assert.equal(a.waiting, false);
});

test('reject malformed ROMs and input packets', async () => {
  assert.throws(() => validateRom(new Uint8Array([1, 2, 3])));
  assert.throws(() => validateRom(rom.subarray(0, 100)));
  const s = new RollbackSession(core());
  assert.throws(() => s.receive(-1, 0));
  assert.throws(() => s.receive(2, 4096));
  assert.throws(() => s.receive(10000, 0));
  assert.equal((await romHash(rom)).length, 64);
});
