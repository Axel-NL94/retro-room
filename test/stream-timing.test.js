import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GameStream } from '../web/src/game-stream.js';
import { STREAM_VERSION } from '../web/src/stream-protocol.js';

const token = '44444444-4444-4444-8444-444444444444';
function clock(run) {
  const original = { setTimeout, clearTimeout, setInterval, clearInterval };
  let now = 0, id = 0; const jobs = new Map();
  globalThis.setTimeout = (fn, ms) => { jobs.set(++id, { fn, at: now + ms }); return id; };
  globalThis.clearTimeout = globalThis.clearInterval = key => jobs.delete(key);
  globalThis.setInterval = () => ++id;
  function advance(target) {
    for (;;) {
      const next = [...jobs].filter(([,j]) => j.at <= target).sort((a,b) => a[1].at-b[1].at)[0];
      if (!next) break;
      now = next[1].at; jobs.delete(next[0]); next[1].fn();
    }
    now = target;
  }
  try { run(advance); } finally { Object.assign(globalThis, original); }
}
class Call extends EventEmitter {
  constructor() {
    super(); this.peer = 'host'; this.metadata = { app: 'retroroom-stream', version: STREAM_VERSION, token };
    this.peerConnection = new EventTarget(); this.peerConnection.connectionState = 'connecting';
  }
  answer() {}
  close() { if (!this.closed) { this.closed = true; this.emit('close'); } }
  state(value) { this.peerConnection.connectionState = value; this.peerConnection.dispatchEvent(new Event('connectionstatechange')); }
}
function guest() {
  const media = new GameStream({ connection: { peer: 'host' }, host: false, token });
  const errors = []; media.addEventListener('error', event => errors.push(event.detail));
  const call = new Call(); media.accept(call);
  return { media, call, errors };
}
test('slow negotiation followed by delayed first frame gets a separate playback deadline', () => clock(advance => {
  const { media, call, errors } = guest();
  advance(30000); call.state('connected');
  assert.equal(media.stage, 'first-frame');
  advance(55000); assert.equal(call.closed, undefined);
  media.ready(); advance(90000);
  assert.deepEqual(errors, []); assert.equal(media.closed, false); media.close();
}));
test('connected transport with no decoded frame reports playback failure, not network failure', () => clock(advance => {
  const { media, call, errors } = guest();
  advance(5000); call.state('connected');
  advance(34999); assert.equal(media.closed, false);
  advance(35000); assert.equal(media.closed, true);
  assert.match(errors[0], /mediaverbinding is verbonden.*eerste beeld/);
}));
test('negotiation without progress still times out and tears down the call', () => clock(advance => {
  const { media, call, errors } = guest();
  advance(45000); assert.equal(media.closed, true); assert.ok(call.closed);
  assert.match(errors[0], /niet op tijd worden opgezet/);
}));
test('brief media disconnect recovers without closing the stream', () => clock(advance => {
  const { media, call, errors } = guest();
  call.state('connected'); media.ready();
  advance(20000); call.state('disconnected'); assert.equal(media.stage, 'recovering');
  advance(20500); call.state('connected');
  assert.equal(media.stage, 'playing'); advance(80000);
  assert.equal(media.closed, false); assert.deepEqual(errors, []); media.close();
}));
test('persistent disconnect has a bounded recovery deadline that repeated events cannot extend', () => clock(advance => {
  const { media, call, errors } = guest();
  call.state('connected'); media.ready();
  advance(2000); call.state('disconnected');
  advance(13000); call.state('disconnected');
  advance(14000); assert.equal(media.closed, true); assert.ok(call.closed);
  assert.match(errors[0], /niet worden hersteld/);
}));
test('decode readiness during disconnection does not cancel recovery deadline', () => clock(advance => {
  const { media, call, errors } = guest();
  call.state('connected'); call.state('disconnected'); media.ready();
  advance(12000); assert.equal(media.closed, true); assert.equal(errors.length, 1);
}));
test('closing media removes transport listeners and cancels every deadline', () => clock(advance => {
  const { media, call, errors } = guest();
  call.state('connected'); call.state('disconnected'); media.close();
  call.state('connected'); advance(100000);
  assert.deepEqual(errors, []); assert.equal(media.stage, 'recovering');
}));
