// Itty's documented WebSocket wire protocol; no account, keys or hosted backend.
// The invitation secret stays in the URL fragment, never in the relay URL.
import { INVITE_VERSION, peerMessage } from './protocol.js';
const encode = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
export const newRelaySecret = () => encode(crypto.getRandomValues(new Uint8Array(32)));
export const validRelaySecret = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const encoder = new TextEncoder(), decoder = new TextDecoder();
const failMessage = 'De Itty Sockets-fallback is niet bereikbaar. Probeer later opnieuw of gebruik een ander netwerk.';

export class RelayRoom extends EventTarget {
  constructor(id, secret, { WebSocketClass = globalThis.WebSocket, timeout = 10000 } = {}) {
    super(); this.id = id; this.secret = secret; this.WebSocketClass = WebSocketClass; this.timeout = timeout;
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
    return new Promise((resolve, reject) => {
      const ws = this.ws = new this.WebSocketClass('wss://itty.ws/c/retroroom-' + this.id + '?announce=true');
      let settled = false;
      const timer = this.openTimer = setTimeout(() => { reject(new Error(failMessage)); this.close(); }, this.timeout);
      ws.onopen = () => { settled = true; clearTimeout(timer); resolve(); };
      ws.onerror = () => { if (!settled) reject(new Error(failMessage)); this.emit('unavailable'); this.close(); };
      ws.onclose = () => { clearTimeout(timer); if (!settled) reject(new Error(failMessage)); if (!this.closed) { this.closed = true; this.emit('unavailable'); } };
      ws.onmessage = event => {
        if (this.closed || typeof event.data !== 'string' || event.data.length > 8192) return;
        let envelope;
        try { envelope = JSON.parse(event.data); } catch { return; }
        if (envelope.type === 'error') { this.emit('unavailable'); this.close(); return; }
        if (envelope.type === 'leave' && typeof envelope.uid === 'string') { this.emit('left', envelope.uid); return; }
        const packet = envelope.message;
        if (typeof envelope.uid !== 'string' || !packet || packet.v !== INVITE_VERSION ||
            typeof packet.iv !== 'string' || !/^[A-Za-z0-9_-]{16}$/.test(packet.iv) ||
            typeof packet.body !== 'string' || packet.body.length > 6000 || !/^[A-Za-z0-9_-]+$/.test(packet.body)) return;
        // Web Crypto is async: serialize both directions so input/control ordering survives.
        this.incoming = this.incoming.then(async () => {
          try {
            const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(packet.iv), additionalData: encoder.encode(this.id) }, this.key, decode(packet.body));
            if (!this.closed) this.emit('packet', { uid: envelope.uid, payload: JSON.parse(decoder.decode(bytes)) });
          } catch { /* An unrelated client or a packet without the invitation key. */ }
        });
      };
    });
  }
  send(payload, uid) {
    if (this.closed || this.ws?.readyState !== 1) throw new Error(failMessage);
    const bytes = encoder.encode(JSON.stringify(payload));
    if (bytes.length > 4096) throw new Error('Relaybericht te groot.');
    this.outgoing = this.outgoing.then(async () => {
      if (this.closed) return;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const body = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(this.id) }, this.key, bytes);
      if (this.closed) return;
      if (this.ws.readyState !== 1 || this.ws.bufferedAmount > 128 * 1024) throw new Error('De relayverbinding loopt te ver achter. Verbind opnieuw.');
      const packet = JSON.stringify({ v: INVITE_VERSION, iv: encode(iv), body: encode(new Uint8Array(body)) });
      this.ws.send((uid ? '\x1f' + uid + '\x1f' : '') + packet);
    }).catch(() => { if (!this.closed) { this.emit('unavailable'); this.close(); } });
  }
  close() { this.closed = true; clearTimeout(this.openTimer); this.ws?.close(); }
}

// A paired, two-player connection with the same event interface as PeerJS.
export class RelayConnection {
  constructor(relay, uid, attempt, { version = INVITE_VERSION, name = '' } = {}) {
    this.relayRoom = relay; this.uid = uid; this.attempt = attempt; this.relay = true;
    this.metadata = { app: 'retroroom', version, name }; this.listeners = new Map();
    this.open = false; this.closed = false; this.sequence = 0; this.received = -1; this.inputs = [];
    this.onPacket = ({ detail: { uid: sender, payload } }) => {
      if (this.closed || sender !== this.uid || payload?.attempt !== this.attempt ||
          !Number.isSafeInteger(payload.sequence) || payload.sequence <= this.received) return;
      this.received = payload.sequence; this.lastSeen = Date.now();
      if (payload.kind === 'leave') { this.close(false); return; }
      if (payload.kind !== 'play') return;
      try {
        if (!Array.isArray(payload.messages) || payload.messages.length > 8) throw new Error('Ongeldig relaybericht.');
        const validated = payload.messages.map(m => ({ channel: m.channel, data: peerMessage(m.channel, m.data) }));
        for (const m of validated) this.emit('data', m);
      } catch { this.emit('error', new Error('Ongeldig spelbericht via de relay.')); }
    };
    this.onLeft = ({ detail }) => { if (detail === uid) this.close(false); };
    this.onUnavailable = () => this.close(false);
    relay.addEventListener('packet', this.onPacket); relay.addEventListener('left', this.onLeft);
    relay.addEventListener('unavailable', this.onUnavailable);
  }
  on(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  off(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, data) { for (const fn of [...(this.listeners.get(type) || [])]) fn(data); }
  activate() {
    if (this.closed) return;
    this.open = true; this.lastSeen = Date.now();
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastSeen > 15000) { this.close(false); return; }
      this.packet('heartbeat');
    }, 4000);
    this.emit('open');
  }
  packet(kind, messages) { this.relayRoom.send({ kind, attempt: this.attempt, sequence: this.sequence++, ...(messages ? { messages } : {}) }, this.uid); }
  send(value) {
    const data = peerMessage(value.channel, value.data); // No generic binary/file API.
    if (!this.open || this.closed) throw new Error('De andere speler is niet verbonden.');
    if (value.channel === 'input') {
      this.inputs.push({ channel: 'input', data });
      if (this.inputs.length >= 8) this.flush();
      else this.flushTimer ||= setTimeout(() => this.flush(), 32);
    } else {
      this.flush(); this.packet('play', [{ channel: 'control', data }]);
    }
  }
  flush() {
    clearTimeout(this.flushTimer); this.flushTimer = null;
    if (this.inputs.length) this.packet('play', this.inputs.splice(0));
  }
  close(notify = true) {
    if (this.closed) return;
    if (notify && !this.relayRoom.closed && this.open) { try { this.packet('leave'); } catch { /* Already offline. */ } }
    this.closed = true; this.open = false; clearTimeout(this.flushTimer); clearInterval(this.heartbeat); this.inputs = [];
    this.relayRoom.removeEventListener('packet', this.onPacket); this.relayRoom.removeEventListener('left', this.onLeft);
    this.relayRoom.removeEventListener('unavailable', this.onUnavailable); this.emit('close');
  }
}
