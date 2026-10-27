import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { InviteConnection, parseInvitation, DIRECT_ICE } from '../web/src/connection.js';

class FakeConnection extends EventEmitter {
  constructor(metadata = { app: 'retroroom', version: 1, name: 'Gast' }) {
    super(); this.metadata = metadata; this.label = 'retroroom'; this.serialization = 'json'; this.messages = [];
  }
  send(data) { this.messages.push(data); }
  close() { this.closed = true; this.emit('close'); }
}
class FakePeer extends EventEmitter {
  constructor(id, options) {
    super(); this.id = id; this.options = options;
    queueMicrotask(() => { this.open = true; this.emit('open', id); });
  }
  connect(id, options) { this.target = id; this.outgoing = new FakeConnection(options.metadata); return this.outgoing; }
  destroy() { this.destroyed = true; }
}
const id = 'd86fbdf8-fee9-4feb-8a60-2549a13294f1';

test('invitations accept only valid new room IDs, never arbitrary server endpoints', () => {
  assert.equal(parseInvitation(`https://example.com/retro-room/#room=${id}&server=wss://untrusted.example`), id);
  assert.equal(parseInvitation(id.toUpperCase()), id);
  for (const value of ['A1B2C3D4E5', '', 'javascript:alert(1)', 'https://example.com/#room=bad']) {
    assert.throws(() => parseInvitation(value));
  }
  assert.ok(DIRECT_ICE.iceServers.every(server => server.urls.startsWith('stun:')));
});

test('only an active host accepts one invited guest and closing invalidates the old link', async () => {
  const invites = new InviteConnection(FakePeer);
  let accepted = 0;
  invites.addEventListener('guest-joined', () => accepted++);
  await invites.create({ name: 'Axel', game: 'Room Rally' });
  const oldId = invites.room.id;
  const guest = new FakeConnection(); invites.accept(guest); guest.emit('open');
  assert.equal(accepted, 1);
  assert.equal(guest.messages[0].game, 'Room Rally');
  const extra = new FakeConnection(); invites.accept(extra); extra.emit('open');
  assert.equal(extra.messages[0].type, 'rejected');
  assert.equal(accepted, 1); assert.equal(invites.connection, guest);
  guest.close(); assert.equal(invites.connection, null); assert.equal(invites.room.id, oldId);
  const endpoint = invites.endpoint; invites.leave(); assert.equal(endpoint.destroyed, true);
  await invites.create({ game: 'New room' });
  assert.notEqual(invites.room.id, oldId); invites.leave();
});

test('a guest waits for the matching host handshake and cannot accept incoming players', async () => {
  const invites = new InviteConnection(FakePeer);
  let joined = 0; invites.addEventListener('joined', () => joined++);
  await invites.join(id, 'Gast');
  const connection = invites.connection;
  assert.equal(invites.endpoint.target, 'rr-' + id);
  connection.emit('data', { type: 'room', id: 'wrong', version: 1 });
  assert.equal(joined, 0); assert.equal(invites.room, null);
  connection.emit('data', { type: 'room', id, version: 1, host: 'Axel', game: 'Room Rally' });
  assert.equal(joined, 1); assert.equal(invites.room.game, 'Room Rally');
  const incoming = new FakeConnection(); invites.accept(incoming); incoming.emit('open');
  assert.equal(incoming.messages[0].type, 'rejected');
  invites.leave();
});

test('unavailable host releases a pending invitation so a fresh link can be tried', async () => {
  const invites = new InviteConnection(FakePeer);
  let message; invites.addEventListener('error', e => { message = e.detail.message; });
  await invites.join(id, 'Gast');
  const stale = invites.connection;
  invites.endpoint.emit('error', { type: 'peer-unavailable' });
  assert.equal(invites.connection, null); assert.match(message, /gesloten/);
  await invites.join(id, 'Gast'); const current = invites.connection;
  stale.emit('close'); assert.equal(invites.connection, current);
  invites.leave();
});
