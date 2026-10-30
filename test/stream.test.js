import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GameStream } from '../web/src/game-stream.js';
import { StreamInput, STREAM_VERSION, playMode } from '../web/src/stream-protocol.js';
import { peerMessage, INVITE_VERSION } from '../web/src/protocol.js';
import { InviteConnection } from '../web/src/connection.js';
import { AudioSink } from '../web/src/audio.js';
const token = '44444444-4444-4444-8444-444444444444', epoch = '55555555-5555-4555-8555-555555555555';
class Track {
  constructor(kind) { this.kind = kind; this.frames = 0; }
  clone() { return new Track(this.kind); }
  stop() { this.stopped = true; }
  requestFrame() { this.frames++; }
}
class Stream {
  constructor(tracks) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
  getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
}
class Call extends EventEmitter {
  constructor(peer = 'approved', metadata = { app: 'retroroom-stream', version: STREAM_VERSION, token }) {
    super(); this.peer = peer; this.metadata = metadata;
    this.peerConnection = new EventTarget(); this.peerConnection.connectionState = 'connecting';
  }
  answer(stream) { this.answered = true; this.answerStream = stream; }
  close() { this.closed = true; this.emit('close'); }
}
test('stream protocol sends only bounded metadata and controller state, never ROMs or signaling payloads', () => {
  const game = { type: 'stream-game', version: STREAM_VERSION, token, name: 'Own game', system: 'snes', overclock: 500 };
  assert.deepEqual(peerMessage('control', { ...game, bytes: new Uint8Array(9999), hash: 'a'.repeat(64), url: 'https://example.com/rom' }), game);
  const input = { type: 'stream-input', token, epoch, sequence: 9, buttons: 4095 };
  assert.deepEqual(peerMessage('input', { ...input, rom: [1,2,3] }), input);
  for (const value of [{ ...input, buttons: 4096 }, { ...input, sequence: -1 }, { ...input, epoch: 'old' },
    { ...game, token: [token] }, { ...game, overclock: 150 }, { type: 'stream-file', token, bytes: [1] }, new Uint8Array(20)]) {
    assert.throws(() => peerMessage(value.type === 'stream-input' ? 'input' : 'control', value));
  }
  assert.throws(() => playMode('unknown')); assert.equal(playMode(), 'netplay');
});
test('stream controller ignores reordered/old sessions and releases held buttons after missing heartbeats', () => {
  let now = 0; const input = new StreamInput(epoch, { now: () => now });
  input.receive({ epoch, sequence: 2, buttons: 1 }); assert.equal(input.current(), 1);
  input.receive({ epoch, sequence: 1, buttons: 2 }); assert.equal(input.current(), 1);
  input.receive({ epoch: token, sequence: 999, buttons: 3 }); assert.equal(input.current(), 1);
  now = 251; assert.equal(input.current(), 0);
  input.receive({ epoch, sequence: 3, buttons: 0 }); now = 300; assert.equal(input.current(), 0);
});
test('host media contains only canvas and cloned game audio, and cleanup preserves the local audio track', () => {
  const video = new Track('video'), audio = new Track('audio'); let sent;
  const call = new Call(), endpoint = { call(peer, stream, options) { sent = { peer, stream, options }; return call; } };
  const media = new GameStream({ endpoint, connection: { peer: 'approved' }, host: true, token, MediaStreamClass: Stream });
  media.start({ captureStream: () => new Stream([video]) }, new Stream([audio]));
  assert.equal(sent.peer, 'approved'); assert.deepEqual(sent.options.metadata, { app: 'retroroom-stream', version: STREAM_VERSION, token });
  assert.deepEqual(sent.stream.getTracks().map(t => t.kind), ['video','audio']);
  assert.notEqual(sent.stream.getAudioTracks()[0], audio); assert.ok(video.frames >= 1);
  media.close(); assert.ok(video.stopped); assert.ok(sent.stream.getAudioTracks()[0].stopped); assert.equal(audio.stopped, undefined);
  assert.ok(call.closed);
});
test('guest answers only the approved host and token, without supplying local media', () => {
  const media = new GameStream({ connection: { peer: 'approved' }, host: false, token });
  for (const call of [new Call('other'), new Call('approved', { app: 'retroroom-stream', version: STREAM_VERSION, token: epoch })]) {
    assert.equal(media.accept(call), false); assert.ok(call.closed); assert.equal(call.answered, undefined);
  }
  const accepted = new Call(); assert.equal(media.accept(accepted), true); assert.ok(accepted.answered); assert.equal(accepted.answerStream, undefined);
  const second = new Call(); assert.equal(media.accept(second), false); assert.ok(second.closed);
  let remote; media.addEventListener('stream', e => { remote = e.detail; });
  const stream = new Stream([new Track('video'), new Track('audio')]);
  accepted.emit('stream', stream); media.ready(); assert.equal(remote, stream);
  media.close(); assert.ok(stream.getTracks().every(t => t.stopped));
});
test('missing or disconnected media fails explicitly and closes its tracks', async () => {
  const timed = new GameStream({ connection: { peer: 'approved' }, host: false, token, timeout: 5 });
  let message; timed.addEventListener('error', e => { message = e.detail; }); timed.accept(new Call());
  await new Promise(resolve => setTimeout(resolve, 15)); assert.match(message, /Tailcat/); assert.ok(timed.closed);
  const disconnected = new GameStream({ connection: { peer: 'approved' }, host: false, token });
  const call = new Call(); disconnected.accept(call); disconnected.ready();
  call.peerConnection.connectionState = 'failed'; call.peerConnection.dispatchEvent(new Event('connectionstatechange'));
  assert.ok(disconnected.closed); assert.ok(call.closed);
  assert.throws(() => new GameStream({ connection: { peer: 'approved', relay: true }, token }), /Tailcat/);
});
class Data extends EventEmitter { constructor(options = {}) { super(); Object.assign(this, options); } close() { this.emit('close'); } }
class Peer extends EventEmitter {
  constructor(id) { super(); this.id = id; queueMicrotask(() => { this.open = true; this.emit('open'); }); }
  connect(peer, options) { return new Data({ peer, ...options }); }
  destroy() { this.destroyed = true; }
}
test('stream invitations select the matching mode and never open an Tailcat fallback', async () => {
  let relays = 0;
  class Relay { constructor() { relays++; throw new Error('must not create relay'); } }
  const host = new InviteConnection(Peer, { RelayRoomClass: Relay });
  await host.create({ name: 'Host', game: 'Demo', playMode: 'stream' });
  assert.equal(host.room.playMode, 'stream'); assert.equal(relays, 0);
  const guest = new InviteConnection(Peer, { RelayRoomClass: Relay }); let rejection;
  guest.addEventListener('rejected', e => { rejection = e.detail.message; });
  await guest.join('https://example.com/#room=' + host.room.id + '&mode=stream&key=unused', 'Guest');
  assert.equal(guest.connection.metadata.playMode, 'stream'); assert.equal(guest.connection.metadata.version, INVITE_VERSION);
  await guest.fallback(); assert.match(rejection, /Tailcat ondersteunt geen videostreams/); assert.equal(relays, 0);
  host.leave(); guest.leave();
});
test('host speaker mute keeps synthesized audio feeding the stream until capture is released', async () => {
  const previous = [globalThis.AudioContext, globalThis.AudioWorkletNode];
  const routes = [];
  const source = { connect(node) { routes.push(node); return node; }, port: { postMessage() {} } };
  globalThis.AudioWorkletNode = class { constructor() { return source; } };
  globalThis.AudioContext = class {
    constructor() { this.audioWorklet = { async addModule() {} }; this.destination = {}; }
    createGain() { return { gain: { value: 1 }, connect(node) { return node; } }; }
    createMediaStreamDestination() { return { stream: new Stream([new Track('audio')]) }; }
    async resume() {}
  };
  try {
    const audio = new AudioSink(); await audio.enable(); const captured = await audio.capture();
    audio.mute(); audio.push(0.25, -0.25);
    assert.equal(audio.gain.gain.value, 0); assert.deepEqual(audio.samples, [0.25,-0.25]); assert.equal(routes.length, 2);
    assert.equal(captured.getAudioTracks().length, 1);
    audio.clear(); audio.releaseCapture(); audio.push(0.5,0.5); assert.equal(audio.samples.length, 0);
  } finally { [globalThis.AudioContext, globalThis.AudioWorkletNode] = previous; }
});
