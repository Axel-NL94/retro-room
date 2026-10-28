import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { InviteConnection, PeerConnection } from '../web/src/connection.js';
import { RelayRoom, newRelaySecret } from '../web/src/relay.js';
import { INVITE_VERSION } from '../web/src/protocol.js';

// Emulates Itty's documented wire envelope, identities, broadcasts and DMs.
class MemorySocket {
  static rooms = new Map(); static wires = []; static count = 0;
  constructor(url) {
    this.url = url; this.uid = 'u' + ++MemorySocket.count; this.readyState = 0; this.bufferedAmount = 0;
    const sockets = MemorySocket.rooms.get(url) || new Set(); MemorySocket.rooms.set(url, sockets); this.sockets = sockets;
    queueMicrotask(() => { if (this.readyState === 3) return; sockets.add(this); this.readyState = 1; this.onopen?.(); });
  }
  send(wire) {
    MemorySocket.wires.push(wire);
    let uid; if (wire[0] === '\x1f') { const end = wire.indexOf('\x1f', 1); uid = wire.slice(1, end); wire = wire.slice(end + 1); }
    const message = JSON.parse(wire);
    for (const peer of this.sockets) if (peer !== this && (!uid || peer.uid === uid)) {
      queueMicrotask(() => { if (peer.readyState === 1) peer.onmessage?.({ data: JSON.stringify({ uid: this.uid, message }) }); });
    }
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3; this.sockets.delete(this); this.onclose?.();
    for (const peer of this.sockets) peer.onmessage?.({ data: JSON.stringify({ type: 'leave', uid: this.uid }) });
  }
}
class TestRelay extends RelayRoom { constructor(id, key) { super(id, key, { WebSocketClass: MemorySocket, timeout: 100 }); } }
class BlockedConnection extends EventEmitter {
  close() { this.closed = true; this.emit('close'); }
}
class Peer extends EventEmitter {
  constructor(id) { super(); this.id = id; queueMicrotask(() => { this.open = true; this.emit('open'); }); }
  connect() { return new BlockedConnection(); }
  destroy() { this.destroyed = true; }
}
const options = { RelayRoomClass: TestRelay, directTimeout: 20, relayTimeout: 1000 };
const link = host => `https://example.test/#room=${host.room.id}&key=${host.secret}`;
async function until(fn, timeout = 1000) {
  const deadline = Date.now() + timeout;
  while (!fn()) { if (Date.now() > deadline) throw new Error('Timed out'); await sleep(5); }
}
async function pair(t) {
  const host = new InviteConnection(Peer, options), guest = new InviteConnection(Peer, options);
  t.after(() => { host.leave(); guest.leave(); });
  let hp, gp;
  host.addEventListener('guest-joined', e => { hp = new PeerConnection(e.detail.connection, true); });
  guest.addEventListener('joining', e => { if (e.detail.connection.relay) gp = new PeerConnection(e.detail.connection, false); });
  guest.addEventListener('joined', () => gp?.approve());
  await host.create({ name: 'Host', game: 'Local only' }); await guest.join(link(host), 'Guest');
  await until(() => hp?.opened && gp?.opened);
  return { host, guest, hp, gp };
}

test('P2P is tried first: a ready direct connection never opens a guest relay or relays game data', async t => {
  const host = new InviteConnection(Peer, options), guest = new InviteConnection(Peer, options);
  t.after(() => { host.leave(); guest.leave(); });
  await host.create({ name: 'Host' }); await host.relayRoom.connect();
  const before = MemorySocket.wires.length;
  await guest.join(link(host), 'Guest');
  guest.connection.netplayReady = true; guest.connection.onNetplayReady();
  await sleep(50);
  assert.equal(guest.relayRoom, null); assert.equal(guest.fallbackStarting, false);
  assert.equal(MemorySocket.wires.length, before);
});

test('blocked P2P automatically pairs via encrypted Itty fallback and batches validated input', async t => {
  const { hp, gp, host, guest } = await pair(t);
  assert.equal(hp.route, 'Itty Sockets'); assert.equal(gp.route, 'Itty Sockets');
  assert.equal(guest.room.game, 'Local only');
  const received = [];
  gp.addEventListener('input', e => received.push(e.detail));
  for (let frame = 2; frame < 6; frame++) hp.send('input', { type: 'input', frame, buttons: 129, epoch: 'test', bytes: [1, 2, 3] });
  await until(() => received.length === 4);
  assert.deepEqual(received.map(m => m.frame), [2, 3, 4, 5]); assert.equal(received[0].bytes, undefined);
  const wires = MemorySocket.wires.join('');
  assert.ok(!wires.includes('buttons')); assert.ok(!wires.includes('Local only')); assert.ok(!wires.includes(host.secret));
  for (const channel of ['rom', 'control', 'input']) assert.throws(() => hp.send(channel, new Uint8Array(32)));
  assert.equal(hp.transfer, undefined);
});

test('a third guest cannot take over an active fallback and closing releases the seat', async t => {
  const { host, guest, hp } = await pair(t);
  const third = new InviteConnection(Peer, options); t.after(() => third.leave());
  let rejected; third.addEventListener('rejected', e => { rejected = e.detail.message; });
  await third.join(link(host), 'Third'); await until(() => rejected);
  assert.match(rejected, /bezet/); assert.equal(host.connection, hp.connection);
  guest.leave(); await until(() => host.connection === null);
  assert.ok(host.room); assert.equal(host.relayRoom.closed, false);
});

test('wrong invitation key cannot read a room or complete its handshake', async t => {
  const host = new InviteConnection(Peer, options), guest = new InviteConnection(Peer, { ...options, relayTimeout: 60 });
  t.after(() => { host.leave(); guest.leave(); });
  let rejected; guest.addEventListener('rejected', e => { rejected = e.detail.message; });
  await host.create({ game: 'Private' }); await guest.join(link(host).replace(host.secret, newRelaySecret()), 'Wrong key');
  await until(() => rejected);
  assert.equal(guest.room, null); assert.equal(host.connection, null); assert.match(rejected, /niet bereikbaar/);
});

test('late direct events cannot overwrite an accepted fallback', async t => {
  const host = new InviteConnection(Peer, options), guest = new InviteConnection(Peer, options);
  t.after(() => { host.leave(); guest.leave(); });
  await host.create({}); await guest.join(link(host), 'Guest'); const stale = guest.connection;
  await until(() => guest.connection?.relay);
  const current = guest.connection; stale.emit('error', new Error('late')); stale.emit('close');
  assert.equal(guest.connection, current); assert.equal(guest.room.id, host.room.id);
});

test('leaving during P2P negotiation cancels fallback, and a closed host cannot be joined', async t => {
  const host = new InviteConnection(Peer, options), guest = new InviteConnection(Peer, { ...options, relayTimeout: 60 });
  t.after(() => { host.leave(); guest.leave(); });
  await host.create({}); const invitation = link(host);
  await guest.join(invitation, 'Guest'); guest.leave(); await sleep(40);
  assert.equal(guest.connection, null); assert.equal(guest.relayRoom, null);
  host.leave(); let error; guest.addEventListener('rejected', e => { error = e.detail.message; });
  await guest.join(invitation, 'Guest'); await until(() => error); assert.match(error, /gesloten/);
});

test('both relay clients report failure on a dropped socket without silently restarting a game', async t => {
  const { host, guest, gp } = await pair(t); let closed = false;
  guest.addEventListener('room-closed', () => { closed = true; });
  host.relayRoom.ws.close(); await until(() => closed);
  assert.equal(gp.control.readyState, 'closed'); assert.equal(guest.room, null);
});

test('old invitation versions are rejected and cannot enable file sharing through fallback', async t => {
  const host = new InviteConnection(Peer, options); t.after(() => host.leave());
  await host.create({}); await host.relayRoom.connect();
  host.relayPacket({ uid: 'old', payload: { kind: 'join', attempt: crypto.randomUUID(), version: INVITE_VERSION - 1 } });
  assert.equal(host.connection, null);
});


test('an unreachable P2P broker still permits an invited relay fallback', async t => {
  class OfflinePeer extends Peer {
    constructor(id) { super(id); this.open = false; }
    on(type, fn) { super.on(type, fn); if (type === 'open') this.off(type, fn); if (type === 'error') queueMicrotask(() => this.emit('error', { type: 'network' })); return this; }
  }
  const host = new InviteConnection(OfflinePeer, options), guest = new InviteConnection(OfflinePeer, options);
  t.after(() => { host.leave(); guest.leave(); });
  await host.create({}); await guest.join(link(host), 'Guest');
  await until(() => guest.connection?.relay); assert.equal(guest.room.id, host.room.id);
});

test('an unavailable relay releases a blocked invitation instead of claiming to be connected', async t => {
  class UnavailableRelay extends EventTarget {
    connect() { return Promise.reject(new Error('Relay offline')); }
    close() { this.closed = true; }
  }
  const guest = new InviteConnection(Peer, { ...options, RelayRoomClass: UnavailableRelay });
  t.after(() => guest.leave()); let rejected;
  guest.addEventListener('rejected', e => { rejected = e.detail.message; });
  await guest.join(`https://example.test/#room=${crypto.randomUUID()}&key=${newRelaySecret()}`, 'Guest');
  await until(() => rejected); assert.equal(rejected, 'Relay offline'); assert.equal(guest.connection, null); assert.equal(guest.room, null);
});
