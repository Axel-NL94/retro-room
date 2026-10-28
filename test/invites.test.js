import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { InviteConnection, PeerConnection, parseInvitation, DIRECT_ICE } from '../web/src/connection.js';
import { INVITE_VERSION } from '../web/src/protocol.js';

class FakeConnection extends EventEmitter {
  constructor(metadata = { app: 'retroroom', version: INVITE_VERSION, name: 'Gast' }) {
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
  connection.emit('data', { type: 'room', id: 'wrong', version: INVITE_VERSION });
  assert.equal(joined, 0); assert.equal(invites.room, null);
  connection.emit('data', { type: 'room', id, version: INVITE_VERSION, host: 'Axel', game: 'Room Rally' });
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


test('older clients with ROM sharing cannot join a local-ROM-only host', async () => {
  const invites=new InviteConnection(FakePeer);await invites.create({game:'Room Rally'});
  const old=new FakeConnection({app:'retroroom',version:1,name:'Old client'});
  invites.accept(old);old.emit('open');
  assert.equal(old.messages[0].type,'rejected');assert.equal(invites.connection,null);
  invites.leave();
});

test('peer transport has only control/input channels and cannot send files', () => {
  const connection=new FakeConnection(),created=[];
  connection.dataChannel={readyState:'open',bufferedAmount:0};
  connection.peerConnection={connectionState:'connected',createDataChannel(label,options){
    created.push(label);return {label,readyState:'open',bufferedAmount:0,send(value){this.sent=value;},close(){this.closed=true;}};
  }};
  const peer=new PeerConnection(connection,true);connection.emit('open');
  assert.deepEqual(created,['input']);assert.equal(peer.opened,true);
  assert.equal(peer.transfer,undefined);assert.equal(peer.rom,undefined);
  const unexpected={label:'rom',close(){this.closed=true;}};
  peer.pc.ondatachannel({channel:unexpected});assert.equal(unexpected.closed,true);
  for(const channel of ['control','input','rom']) assert.throws(()=>peer.send(channel,new Uint8Array(1024)));
  peer.send('input',{type:'input',frame:4,buttons:1,epoch:'test',bytes:new Uint8Array(16384)});
  assert.deepEqual(JSON.parse(peer.input.sent),{type:'input',frame:4,buttons:1,epoch:'test'});
  let error;peer.addEventListener('error',e=>{error=e.detail;});
  peer.input.onmessage({data:new ArrayBuffer(16)});assert.match(error,/Ongeldig/);
  peer.close();
});
