import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { PlaybackClock } from '../web/src/playback-clock.js';
import { MesenCore } from '../web/src/mesen.js';
import { makeDemoRom } from '../scripts/demo-rom.js';
import { RollbackSession, stateHash } from '../web/src/rollback.js';

function harness(tick, { failWorker = false } = {}) {
  const page = new EventTarget(); page.hidden = false;
  let now = 0, id = 0;
  const frames = new Map(), timers = new Map(), messages = [];
  const worker = { postMessage: data => messages.push(data), terminate() { this.terminated = true; } };
  const clock = new PlaybackClock(tick, { page, now: () => now,
    requestFrame: callback => { frames.set(++id, callback); return id; }, cancelFrame: key => frames.delete(key),
    createWorker: () => { if (failWorker) throw new Error('unavailable'); return worker; },
    setTimer: callback => { timers.set(++id, callback); return id; }, clearTimer: key => timers.delete(key) });
  return { clock, page, worker, frames, timers, messages,
    frame(time) { now = time; const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); },
    background(time, generation = clock.generation) { now = time; worker.onmessage({ data: { type: 'tick', generation } }); },
    hidden(hidden) { page.hidden = hidden; page.dispatchEvent(new Event('visibilitychange')); } };
}

test('visibility switches frame sources without pausing, doubling ticks or resuming a manual pause', () => {
  const ticks = [], h = harness(time => ticks.push(time));
  h.clock.setRunning(true); h.frame(16);
  assert.deepEqual(ticks, [16]); assert.equal(h.frames.size, 1);
  const staleFrame = [...h.frames.values()][0];
  h.hidden(true); assert.equal(h.frames.size, 0); assert.equal(h.clock.running, true);
  h.background(33); staleFrame();
  assert.deepEqual(ticks, [16, 33]); assert.equal(h.messages.at(-1).type, 'ack');
  const hiddenGeneration = h.clock.generation;
  h.hidden(false); h.background(40, hiddenGeneration); h.frame(50);
  assert.deepEqual(ticks, [16, 33, 50]);
  h.clock.setRunning(false); h.hidden(true); h.hidden(false); h.frame(80); h.background(90);
  assert.deepEqual(ticks, [16, 33, 50]); assert.equal(h.clock.running, false);
  h.clock.setRunning(true); h.frame(100); assert.equal(ticks.at(-1), 100);
  h.clock.destroy(); assert.equal(h.frames.size, 0); assert.equal(h.worker.terminated, true);
});

test('missing or failed workers retain a bounded timer fallback and stop on manual pause', () => {
  for (const failWorker of [true, false]) {
    let ticks = 0; const h = harness(() => ticks++, { failWorker });
    h.hidden(true); h.clock.setRunning(true);
    if (!failWorker) h.worker.onerror({ preventDefault() {} });
    assert.equal(h.timers.size, 1); assert.equal(h.frames.size, 0);
    const stale = [...h.timers.values()][0]; stale(); assert.equal(ticks, 1);
    h.hidden(false); stale(); assert.equal(ticks, 1); assert.equal(h.timers.size, 0);
    h.hidden(true); assert.equal(h.timers.size, 1);
    h.clock.setRunning(false); assert.equal(h.timers.size, 0); h.clock.destroy();
  }
});

test('background worker waits for acknowledgement and discards ticks from old runs', async () => {
  let id = 0; const messages = [], timers = new Map();
  const self = { postMessage: data => messages.push(data) };
  vm.runInNewContext(await readFile(new URL('../web/src/playback-worker.js', import.meta.url), 'utf8'), {
    self, setTimeout: fn => { timers.set(++id, fn); return id; }, clearTimeout: key => timers.delete(key),
  });
  const send = (type, generation) => self.onmessage({ data: { type, generation } });
  send('start', 1); assert.equal(messages.length, 1); assert.equal(timers.size, 0);
  send('ack', 0); assert.equal(timers.size, 0);
  send('ack', 1); assert.equal(timers.size, 1);
  send('ack', 1); assert.equal(timers.size, 1);
  const stale = [...timers.values()][0];
  send('stop', 2); stale(); assert.equal(messages.length, 1); assert.equal(timers.size, 0);
  send('start', 3); send('ack', 1); assert.equal(messages.length, 2); assert.equal(timers.size, 0);
  send('ack', 3); const next = [...timers.values()][0]; timers.clear(); next();
  assert.equal(messages.length, 3); assert.equal(messages.at(-1).generation, 3);
});

test('a hidden NES peer keeps advancing with worker ticks and converges with the visible peer', async () => {
  const wasmBinary = new Uint8Array(await readFile(new URL('../web/assets/mesen-core.wasm', import.meta.url)));
  const a = await MesenCore.create({ wasmBinary }), b = await MesenCore.create({ wasmBinary });
  a.load(makeDemoRom()); b.load(makeDemoRom());
  let one, two;
  one = new RollbackSession(a, { player: 1, send: packet => two.receive(packet.frame, packet.buttons) });
  two = new RollbackSession(b, { player: 2, send: packet => one.receive(packet.frame, packet.buttons) });
  const foreground = harness(() => one.tick(0)), background = harness(() => two.tick(0));
  foreground.clock.setRunning(true); background.clock.setRunning(true); background.hidden(true);
  for (let frame = 0; frame < 180; frame++) {
    foreground.frame(frame * 1000 / 60); background.background(frame * 1000 / 60);
  }
  one.reconcile(); two.reconcile();
  assert.equal(one.frame, 180); assert.equal(two.frame, 180);
  assert.equal(stateHash(a.save()), stateHash(b.save()));
  background.clock.setRunning(false); background.background(4000);
  assert.equal(two.frame, 180);
  background.hidden(false); background.frame(4016); assert.equal(two.frame, 180);
  foreground.clock.destroy(); background.clock.destroy();
});
