// Tailcat DERP transport; WireGuard plus the invitation's AES-GCM room key.
// The invitation secret stays in the URL fragment, never in the relay URL.
import { TailcatTransport } from './tailcat-transport.js';
import { INVITE_VERSION, peerMessage } from './protocol.js';
const encode = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
export const newRelaySecret = () => encode(crypto.getRandomValues(new Uint8Array(32)));
export const validRelaySecret = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const encoder = new TextEncoder(), decoder = new TextDecoder();
const failMessage = 'De Tailcat-fallback is niet bereikbaar. Probeer later opnieuw of gebruik een ander netwerk.';

export class RelayRoom extends EventTarget {
  constructor(id, secret, { TransportClass = TailcatTransport, host = false, address = '', timeout = 75000 } = {}) {
    super(); this.id = id; this.secret = secret; this.TransportClass = TransportClass; this.host = host; this.address = address; this.timeout = timeout;
    this.outgoing = Promise.resolve(); this.incoming = Promise.resolve(); this.closed = false;
  }
  emit(type, detail = {}) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  async connect() {
    if (this.pending) return this.pending;
    this.pending = this.open();
    return this.pending;
  }
  async open() {
    if (!validRelaySecret(this.secret)) throw new Error('Deze uitnodiging mist de fallback-sleutel. Vraag de host om een nieuwe link.');
    this.key = await crypto.subtle.importKey('raw', decode(this.secret), 'AES-GCM', false, ['encrypt', 'decrypt']);
    if (this.closed) throw new Error('Kamer gesloten.');
    const transport = this.transport = new this.TransportClass({ timeout: this.timeout });
    transport.addEventListener('unavailable', () => { if (!this.closed) { this.emit('unavailable'); this.close(); } });
    transport.addEventListener('left', ({ detail }) => this.emit('left', detail));
    transport.addEventListener('packet', ({ detail: { uid, data } }) => {
      if (this.closed || typeof data !== 'string' || data.length > 8192) return;
      let packet;
      try { packet = JSON.parse(data); } catch { return; }
      if (typeof uid !== 'string' || packet.v !== INVITE_VERSION ||
          typeof packet.iv !== 'string' || !/^[A-Za-z0-9_-]{16}$/.test(packet.iv) ||
          typeof packet.body !== 'string' || packet.body.length > 6000 || !/^[A-Za-z0-9_-]+$/.test(packet.body)) return;
      this.incoming = this.incoming.then(async () => {
        try {
          const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(packet.iv), additionalData: encoder.encode(this.id) }, this.key, decode(packet.body));
          if (!this.closed) this.emit('packet', { uid, payload: JSON.parse(decoder.decode(bytes)) });
        } catch { /* Invalid key or packet; never pass unauthenticated game data. */ }
      });
    });
    this.address = await transport.open({ host: this.host, address: this.address });
    if (this.closed) throw new Error('Kamer gesloten.');
    this.connected = true;
  }

  send(payload, uid) {
    if (this.closed || !this.connected) throw new Error(failMessage);
    const bytes = encoder.encode(JSON.stringify(payload));
    if (bytes.length > 4096) throw new Error('Relaybericht te groot.');
    this.outgoing = this.outgoing.then(async () => {
      if (this.closed) return;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const body = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(this.id) }, this.key, bytes);
      if (this.closed) return;
      if (!this.connected || this.transport.bufferedAmount > 128 * 1024) throw new Error('De relayverbinding loopt te ver achter. Verbind opnieuw.');
      const packet = JSON.stringify({ v: INVITE_VERSION, iv: encode(iv), body: encode(new Uint8Array(body)) });
      this.transport.send(packet, uid);
    }).catch(() => { if (!this.closed) { this.emit('unavailable'); this.close(); } });
  }
  close() { this.closed = true; this.connected = false; this.transport?.close(); }
}

// One stable logical connection survives a change of physical transport. Message IDs
// and acknowledgements prevent lost/duplicate input when old relay packets arrive late.
export class RelayConnection {
  constructor(relay, uid, attempt, { version = INVITE_VERSION, name = '' } = {}) {
    this.relayRoom = relay; this.uid = uid; this.attempt = attempt; this.relay = true; this.route = 'Tailcat'; this.relayAvailable = true;
    this.metadata = { app: 'retroroom', version, name }; this.listeners = new Map();
    this.open = false; this.closed = false; this.sequence = 0; this.received = -1; this.inputs = [];
    this.next = 0; this.expected = 0; this.pending = new Map(); this.incoming = new Map();
    this.onPacket = ({ detail: { uid: sender, payload } }) => {
      if (this.closed || sender !== this.uid || payload?.attempt !== this.attempt ||
          !Number.isSafeInteger(payload.sequence) || payload.sequence <= this.received) return;
      this.received = payload.sequence; this.lastRelay = Date.now(); this.relayAvailable = true;
      this.receive(payload);
    };
    this.onLeft = ({ detail }) => { if (detail !== uid) return; this.relayAvailable = false; if (this.route !== 'P2P') this.close(false); };
    this.onUnavailable = () => { this.relayAvailable = false; if (this.route !== 'P2P') this.close(false); };
    relay.addEventListener('packet', this.onPacket); relay.addEventListener('left', this.onLeft);
    relay.addEventListener('unavailable', this.onUnavailable);
  }
  on(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  off(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, data) { for (const fn of [...(this.listeners.get(type) || [])]) fn(data); }
  activate() {
    if (this.closed) return;
    this.open = true; this.lastSeen = this.lastRelay = Date.now();
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastSeen > 15000) {
        if (this.route === 'P2P') this.detachDirect(); else this.close(false);
        if (this.closed) return;
      }
      try {
        this.packet('heartbeat');
        // Keep the encrypted fallback available, without sending game input there.
        if (this.route === 'P2P' && this.relayAvailable && !this.relayRoom.closed) this.packet('standby', undefined, true);
      } catch (error) { this.emit('error', error); }
    }, 4000);
    this.emit('open');
  }
  receive(payload) {
    try {
      if (!Number.isSafeInteger(payload.ack) || payload.ack < -1 || payload.ack >= this.next) throw new Error('Invalid acknowledgement');
      if (!['play', 'heartbeat', 'standby', 'upgrade', 'leave'].includes(payload.kind)) return;
      if (payload.kind !== 'standby') this.lastSeen = Date.now();
      for (const id of this.pending.keys()) if (id <= payload.ack) this.pending.delete(id);
      if (payload.kind === 'leave') { this.close(false); return; }
      if (payload.kind === 'upgrade') { this.emit('upgrade', payload.signal); return; }
      if (payload.kind !== 'play') return;
      if (!Array.isArray(payload.messages) || payload.messages.length > 8) throw new Error('Invalid batch');
      const validated = payload.messages.map(m => {
        if (!Number.isSafeInteger(m.id) || m.id < 0 || m.id >= this.expected + 2048) throw new Error('Invalid message sequence');
        return { id: m.id, channel: m.channel, data: peerMessage(m.channel, m.data) };
      });
      for (const m of validated) if (m.id >= this.expected && !this.incoming.has(m.id)) this.incoming.set(m.id, m);
      while (this.incoming.has(this.expected)) {
        const m = this.incoming.get(this.expected); this.incoming.delete(this.expected++);
        this.emit('data', { channel: m.channel, data: m.data });
      }
    } catch { this.emit('error', new Error('Ongeldig spelbericht via de verbinding.')); }
  }
  packet(kind, messages, relayOnly = false, signal) {
    const payload = { kind, attempt: this.attempt, ack: this.expected - 1, ...(messages ? { messages } : {}), ...(signal ? { signal } : {}) };
    if (!relayOnly && this.route === 'P2P' && this.direct?.open) {
      if (this.direct.dataChannel?.bufferedAmount > 128 * 1024) throw new Error('De verbinding loopt te ver achter.');
      this.direct.send({ wire: 'retroroom-route-1', nonce: this.nonce, ...payload });
    } else this.relayRoom.send({ ...payload, sequence: this.sequence++ }, this.uid);
  }
  signal(value) { if (!this.closed && !this.relayRoom.closed) this.packet('upgrade', undefined, true, value); }
  attachDirect(connection, nonce) {
    if (this.closed || this.direct) return false;
    this.direct = connection; this.nonce = nonce;
    const data = payload => {
      if (this.direct !== connection || this.closed || payload?.wire !== 'retroroom-route-1' ||
          payload.nonce !== nonce || payload.attempt !== this.attempt) return;
      if (JSON.stringify(payload).length > 4096) { this.emit('error', new Error('Spelbericht te groot.')); return; }
      this.receive(payload);
    };
    const lost = () => this.detachDirect(connection);
    this.directListeners = { data, lost };
    connection.on('data', data); connection.on('close', lost); connection.on('error', lost);
    return true;
  }
  useDirect() {
    if (this.closed || !this.direct?.open || this.route === 'P2P') return;
    clearTimeout(this.flushTimer); this.flushTimer = null; this.inputs = [];
    this.route = 'P2P'; this.lastSeen = Date.now();
    try { this.replay(); this.emit('route', this.route); } catch { this.detachDirect(); }
  }
  detachDirect(connection = this.direct) {
    if (!connection || this.direct !== connection) return;
    const { data, lost } = this.directListeners;
    connection.off('data', data); connection.off('close', lost); connection.off('error', lost);
    this.direct = null; this.nonce = null; connection.close();
    if (this.route !== 'P2P' || this.closed) return;
    if (!this.relayAvailable || this.relayRoom.closed || Date.now() - this.lastRelay > 15000) { this.close(false); return; }
    this.route = 'Tailcat'; this.lastSeen = Date.now();
    try { this.replay(); this.emit('route', this.route); } catch { this.close(false); }
  }
  replay() {
    let batch = [];
    for (const message of this.pending.values()) {
      if (batch.length && (batch.length === 8 || JSON.stringify([...batch, message]).length > 3000)) {
        this.packet('play', batch); batch = [];
      }
      batch.push(message);
    }
    if (batch.length) this.packet('play', batch);
    this.packet('heartbeat');
  }
  send(value) {
    const data = peerMessage(value.channel, value.data); // No generic binary/file API.
    if (!this.open || this.closed) throw new Error('De andere speler is niet verbonden.');
    if (this.pending.size >= 2048) throw new Error('De verbinding loopt te ver achter.');
    const message = { id: this.next++, channel: value.channel, data }; this.pending.set(message.id, message);
    if (value.channel === 'input') {
      this.inputs.push(message);
      if (this.inputs.length >= 8) this.flush();
      else this.flushTimer ||= setTimeout(() => this.flush(), 4);
    } else {
      this.flush(); this.packet('play', [message]);
    }
  }
  flush() {
    clearTimeout(this.flushTimer); this.flushTimer = null;
    if (this.inputs.length) this.packet('play', this.inputs.splice(0));
  }
  close(notify = true) {
    if (this.closed) return;
    if (notify && this.open) { try { this.packet('leave'); } catch { /* Already offline. */ } }
    this.closed = true; this.open = false; clearTimeout(this.flushTimer); clearInterval(this.heartbeat); this.inputs = [];
    this.pending.clear(); this.incoming.clear(); this.detachDirect();
    this.relayRoom.removeEventListener('packet', this.onPacket); this.relayRoom.removeEventListener('left', this.onLeft);
    this.relayRoom.removeEventListener('unavailable', this.onUnavailable); this.emit('close');
  }
}
