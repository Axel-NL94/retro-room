import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { InviteConnection, PeerConnection } from '../web/src/connection.js';
import { RelayRoom, newRelaySecret } from '../web/src/relay.js';
import { INVITE_VERSION } from '../web/src/protocol.js';
import { readFile } from 'node:fs/promises';
import { MesenCore } from '../web/src/mesen.js';
import { makeDemoRom } from '../scripts/demo-rom.js';
import { RollbackSession, stateHash } from '../web/src/rollback.js';

// In-memory duplex byte transport. The production adapter uses Tailcat workers.
class MemoryTransport extends EventTarget {
  static rooms = new Map(); static wires = []; static count = 0;
  constructor() { super(); this.uid = 'u' + ++MemoryTransport.count; this.bufferedAmount = 0; this.closed = false; }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  async open({ host, address }) {
    this.host = host;
    if (host) {
      this.address = 'tc' + crypto.randomUUID().replaceAll('-', ''); this.clients = new Map();
      MemoryTransport.rooms.set(this.address, this); return this.address;
    }
    this.server = MemoryTransport.rooms.get(address);
    if (!this.server) throw new Error('Kamer gesloten.');
    this.server.clients.set(this.uid, this); return '';
  }
  send(data, uid) {
    MemoryTransport.wires.push(data);
    const targets = this.host ? (uid ? [this.clients.get(uid)].filter(Boolean) : [...this.clients.values()]) : [this.server];
    for (const peer of targets) queueMicrotask(() => { if (!peer.closed) peer.emit('packet', { uid: this.host ? 'host' : this.uid, data }); });
  }
  close() {
    if (this.closed) return; this.closed = true;
    if (this.host) {
      MemoryTransport.rooms.delete(this.address);
      for (const peer of this.clients.values()) peer.emit('left', 'host');
    } else { this.server?.clients.delete(this.uid); this.server?.emit('left', this.uid); }
  }
}
class TestRelay extends RelayRoom { constructor(id, key, options) { super(id, key, { ...options, TransportClass: MemoryTransport }); } }
class BlockedConnection extends EventEmitter {
  close() { this.closed = true; this.emit('close'); }
}
class Peer extends EventEmitter {
  constructor(id) { super(); this.id = id; queueMicrotask(() => { this.open = true; this.emit('open'); }); }
  connect() { return new BlockedConnection(); }
  destroy() { this.destroyed = true; }
}
const options = { RelayRoomClass: TestRelay, directTimeout: 20, relayTimeout: 1000 };
const link = host => `https://example.test/#room=${host.room.id}&key=${host.secret}&tc=${host.relayRoom.address}`;
async function until(fn, timeout = 1000) {
  const deadline = Date.now() + timeout;
  while (!fn()) { if (Date.now() > deadline) throw new Error('Timed out'); await sleep(5); }
}
async function pair(t, PeerClass = Peer, overrides = {}) {
  const host = new InviteConnection(PeerClass, { ...options, ...overrides }), guest = new InviteConnection(PeerClass, { ...options, ...overrides });
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
  const before = MemoryTransport.wires.length;
  await guest.join(link(host), 'Guest');
  guest.connection.netplayReady = true; guest.connection.onNetplayReady();
  await sleep(50);
  assert.equal(guest.relayRoom, null); assert.equal(guest.fallbackStarting, false);
  assert.equal(MemoryTransport.wires.length, before);
});

test('blocked P2P automatically pairs via encrypted Tailcat fallback and batches validated input', async t => {
  const { hp, gp, host, guest } = await pair(t);
  assert.equal(hp.route, 'Tailcat'); assert.equal(gp.route, 'Tailcat');
  assert.equal(guest.room.game, 'Local only');
  const received = [];
  gp.addEventListener('input', e => received.push(e.detail));
  for (let frame = 2; frame < 6; frame++) hp.send('input', { type: 'input', frame, buttons: 129, epoch: 'test', bytes: [1, 2, 3] });
  await until(() => received.length === 4);
  assert.deepEqual(received.map(m => m.frame), [2, 3, 4, 5]); assert.equal(received[0].bytes, undefined);
  const wires = MemoryTransport.wires.join('');
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
  host.relayRoom.transport.close(); await until(() => closed);
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


test('an unavailable Tailcat listener preserves a usable direct host room with an explicit warning', async t => {
  class UnavailableRelay extends EventTarget {
    connect(){return Promise.reject(new Error('Offline'));}
    close(){this.closed=true;}
  }
  const host=new InviteConnection(Peer,{...options,RelayRoomClass:UnavailableRelay});t.after(()=>host.leave());
  let warned=false;host.addEventListener('relay-unavailable',()=>{warned=true});
  await host.create({name:'Host'});assert.ok(host.room);assert.ok(host.online);assert.equal(host.relayRoom,null);assert.equal(warned,true);
});
test('leaving while the Tailcat listener starts cancels creation without resurrecting a room', async()=>{
  class SlowRelay extends EventTarget {
    connect(){return new Promise((resolve,reject)=>{this.cancel=reject});}
    close(){this.closed=true;this.cancel?.(new Error('Closed'));}
  }
  const host=new InviteConnection(Peer,{...options,RelayRoomClass:SlowRelay});
  const creating=host.create({});await until(()=>host.relayRoom?.cancel);const relay=host.relayRoom;
  host.leave();await creating;assert.equal(host.room,null);assert.equal(host.relayRoom,null);assert.equal(relay.closed,true);
});

// A real two-ended event wire for negotiation and route-switch tests. Only the
// initial connection is blocked; background candidates can succeed or fail.
class DirectWire extends EventEmitter {
  static held = []; static hold = false;
  constructor(peer, options) { super(); Object.assign(this, options); this.peer = peer; this.open = false;
    this.dataChannel = { bufferedAmount: 0 }; this.peerConnection = Object.freeze({ connectionState: 'connected', getStats: async()=>new Map() }); }
  send(value) {
    if (!this.open || this.closed) throw new Error('closed');
    const deliver=()=>{if(!this.other.closed)this.other.emit('data', structuredClone(value));};
    if(DirectWire.hold && value.wire) DirectWire.held.push(deliver); else queueMicrotask(deliver);
  }
  close() { if(this.closed)return;this.closed=true;this.open=false;this.emit('close');this.other?.close(); }
}
class RecoveringPeer extends Peer {
  static peers = new Map(); static blocked = false; static attempts = 0;
  constructor(id) { super(id); RecoveringPeer.peers.set(id,this); }
  connect(id, options) {
    if(options.label!=='retroroom-upgrade')return super.connect();
    RecoveringPeer.attempts++;
    if(RecoveringPeer.blocked)return new BlockedConnection();
    const target=RecoveringPeer.peers.get(id);
    const out=new DirectWire(id,options), incoming=new DirectWire(this.id,options);out.other=incoming;incoming.other=out;
    queueMicrotask(()=>{target.emit('connection',incoming);if(out.closed||incoming.closed)return;
      incoming.open=out.open=true;incoming.emit('open');out.emit('open');});
    return out;
  }
  destroy(){super.destroy();RecoveringPeer.peers.delete(this.id);}
}
const retryOptions={upgradeOptions:{delays:[15,25,40],timeout:80}};
test('a failed background probe leaves Tailcat playable; a later P2P success preserves the session',async t=>{
  RecoveringPeer.blocked=true;RecoveringPeer.attempts=0;
  t.after(()=>{RecoveringPeer.blocked=false;});
  const {host,guest,hp,gp}=await pair(t,RecoveringPeer,retryOptions);
  const hc=host.connection,gc=guest.connection;let opens=0;hp.addEventListener('open',()=>opens++);gp.addEventListener('open',()=>opens++);
  await until(()=>RecoveringPeer.attempts>=1);await sleep(100);
  assert.equal(hp.route,'Tailcat');assert.equal(hp.closed,false);assert.equal(host.connection,hc);
  const received=[];gp.addEventListener('control',e=>received.push(e.detail));
  hp.send('control',{type:'ping',time:123});await until(()=>received.length===1);
  RecoveringPeer.blocked=false;await until(()=>hp.route==='P2P'&&gp.route==='P2P');
  assert.equal(host.connection,hc);assert.equal(guest.connection,gc);assert.equal(opens,0);
  const relayCount=MemoryTransport.wires.length;
  hp.send('control',{type:'ping',time:124});await until(()=>received.length===2);await sleep(20);
  assert.equal(MemoryTransport.wires.length,relayCount,'game payload bypasses Tailcat');
  assert.deepEqual(received.map(m=>m.time),[123,124]);
});
test('unacknowledged relay input is replayed once in order on P2P, including a paused control message',async t=>{
  const {host,hp,gp}=await pair(t,RecoveringPeer,{upgradeOptions:{delays:[60000],timeout:1000}});
  const received=[];gp.addEventListener('input',e=>received.push(e.detail.frame));gp.addEventListener('control',e=>received.push(e.detail.type));
  // Delay a genuine authenticated relay packet until after the route changes.
  const relay=host.relayRoom,send=relay.send.bind(relay);const delayed=[];
  relay.send=(payload,uid)=>{if(payload.kind==='play')delayed.push(()=>send(payload,uid));else send(payload,uid);};
  hp.send('input',{type:'input',frame:1,buttons:1,epoch:'test'});hp.send('control',{type:'pause',paused:true,epoch:'test'});
  assert.equal(received.length,0);
  await host.upgrade.offer();await until(()=>hp.route==='P2P'&&gp.route==='P2P');
  hp.send('input',{type:'input',frame:2,buttons:2,epoch:'test'});await until(()=>received.length===3);
  delayed.forEach(fn=>fn());await sleep(30);assert.deepEqual(received,[1,'pause',2]);
  gp.connection.packet('heartbeat');await until(()=>host.connection.pending.size===0);
});
test('a dropped upgraded channel returns to Tailcat and retries, without duplicate or lost input',async t=>{
  const {host,hp,gp}=await pair(t,RecoveringPeer,{upgradeOptions:{delays:[60000],timeout:1000}});
  await host.upgrade.offer();await until(()=>hp.route==='P2P'&&gp.route==='P2P');
  const received=[];gp.addEventListener('input',e=>received.push(e.detail.frame));
  DirectWire.hold=true;t.after(()=>{DirectWire.hold=false;DirectWire.held=[];});
  hp.send('input',{type:'input',frame:12,buttons:3,epoch:'test'});await sleep(10);
  host.connection.direct.close();await until(()=>hp.route==='Tailcat'&&gp.route==='Tailcat');
  await until(()=>received.length===1);DirectWire.held.splice(0).forEach(fn=>fn());
  hp.send('input',{type:'input',frame:13,buttons:4,epoch:'test'});await until(()=>received.length===2);
  assert.deepEqual(received,[12,13]);assert.equal(hp.closed,false);
  DirectWire.hold=false;await host.upgrade.offer();await until(()=>hp.route==='P2P'&&gp.route==='P2P');
});
test('an authenticated P2P upgrade keeps working if the standby relay disappears',async t=>{
  const {host,guest,hp,gp}=await pair(t,RecoveringPeer,retryOptions);
  await until(()=>hp.route==='P2P'&&gp.route==='P2P');host.relayRoom.transport.close();
  await sleep(20);assert.ok(host.connection);assert.ok(guest.connection);
  const received=[];gp.addEventListener('control',e=>received.push(e.detail));hp.send('control',{type:'ping',time:77});
  await until(()=>received.length===1);assert.equal(received[0].time,77);
});
test('foreign, stale and unauthorized candidates cannot replace the paired relay participant',async t=>{
  const {host,hp}=await pair(t,RecoveringPeer,{upgradeOptions:{delays:[60000],timeout:1000}});
  const original=host.connection;
  for(const metadata of [{},{app:'retroroom',version:INVITE_VERSION,room:host.room.id,attempt:original.attempt,nonce:crypto.randomUUID()}]){
    const candidate=new DirectWire('rr-'+crypto.randomUUID(),{label:'retroroom-upgrade',serialization:'json',metadata});
    host.accept(candidate);assert.equal(candidate.closed,true);assert.equal(host.connection,original);
  }
  // Even somebody holding the invitation key has a different Tailcat UID/attempt.
  host.relayRoom.emit('packet',{uid:'stranger',payload:{kind:'upgrade',sequence:99,attempt:original.attempt,ack:-1,
    signal:{step:'offer',nonce:crypto.randomUUID(),peer:'rr-'+crypto.randomUUID()}}});
  assert.equal(host.upgrade.nonce,undefined);assert.equal(hp.route,'Tailcat');
});
test('leaving cancels scheduled/probing upgrades and late async work cannot resurrect a room',async t=>{
  const {host,guest}=await pair(t,RecoveringPeer,retryOptions);const upgrade=host.upgrade;
  const pending=upgrade.offer();host.leave();await pending;guest.leave();await sleep(120);
  assert.equal(upgrade.closed,true);assert.equal(upgrade.timer,null);assert.equal(upgrade.deadline,null);assert.equal(host.connection,null);
});

test('two real Mesen rollback instances converge through Tailcat, live P2P upgrade and failback',async t=>{
  const {host,hp,gp}=await pair(t,RecoveringPeer,{upgradeOptions:{delays:[60000],timeout:1000}});
  const wasmBinary=new Uint8Array(await readFile(new URL('../web/assets/mesen-core.wasm',import.meta.url)));
  const a=await MesenCore.create({wasmBinary}),b=await MesenCore.create({wasmBinary});
  a.load(makeDemoRom());b.load(makeDemoRom());
  const left=new RollbackSession(a,{player:1,send:m=>hp.send('input',{...m,epoch:'route-test'})});
  const right=new RollbackSession(b,{player:2,send:m=>gp.send('input',{...m,epoch:'route-test'})});
  hp.addEventListener('input',({detail:m})=>left.receive(m.frame,m.buttons));gp.addEventListener('input',({detail:m})=>right.receive(m.frame,m.buttons));
  const routes=[];hp.addEventListener('route',e=>routes.push(e.detail));
  let probing=false,dropped=false,clock=0;
  while(left.frame<140||right.frame<140){
    if(!probing&&left.frame>=40){probing=true;void host.upgrade.offer();}
    if(!dropped&&left.frame>=90&&hp.route==='P2P'){dropped=true;host.connection.direct.close();}
    if(left.frame<140)left.tick(left.frame%3===0?1:0);
    if(right.frame<140)right.tick(right.frame%5===0?1:0);
    await sleep(1);assert.ok(++clock<1000,'must continue advancing across route changes');
  }
  hp.connection.flush();gp.connection.flush();await until(()=>left.confirmed>=139&&right.confirmed>=139);
  left.reconcile();right.reconcile();
  assert.deepEqual(routes,['P2P','Tailcat']);assert.equal(dropped,true);
  assert.equal(stateHash(a.save()),stateHash(b.save()));assert.equal(left.hashAt(120),right.hashAt(120));
});
