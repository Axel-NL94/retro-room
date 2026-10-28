// P2P first. Itty is a waiting rendezvous on the host and carries game traffic
// only after the guest's direct connection fails or times out. No ROM bytes.
import { INVITE_VERSION, peerMessage } from './protocol.js';
import { RelayRoom, RelayConnection, newRelaySecret, validRelaySecret } from './relay.js';
export const DIRECT_ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const ROOM_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function parseInvitation(value) {
  let code = String(value).trim();
  if (/^https?:\/\//i.test(code)) code = new URLSearchParams(new URL(code).hash.slice(1)).get('room') || '';
  if (!ROOM_ID.test(code)) throw new Error('Plak een geldige RetroRoom-uitnodigingslink. Oude kamercodes werken niet meer.');
  return code.toLowerCase();
}
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

export class InviteConnection extends EventTarget {
  constructor(PeerClass = globalThis.Peer, { RelayRoomClass = RelayRoom, directTimeout = 10000, relayTimeout = 12000 } = {}) {
    super(); this.PeerClass = PeerClass; this.RelayRoomClass = RelayRoomClass;
    this.directTimeout = directTimeout; this.relayTimeout = relayTimeout;
    this.endpoint = null; this.pending = null; this.room = null; this.connection = null; this.host = false;
    this.generation = 0;
  }
  emit(type, detail = {}) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  get online() { return !!this.endpoint?.open && !this.endpoint.disconnected; }
  async connect() {
    if (this.online) return;
    if (this.pending) return this.pending;
    if (!this.PeerClass) throw new Error('De P2P-verbindingsdienst kon niet worden geladen.');
    this.pending = new Promise((resolve, reject) => {
      const endpoint = this.endpoint && !this.endpoint.destroyed ? this.endpoint : new this.PeerClass('rr-' + crypto.randomUUID(), {
        secure: true, config: DIRECT_ICE, debug: 0
      });
      const fresh = this.endpoint !== endpoint;
      this.endpoint = endpoint;
      let settled = false;
      const done = error => {
        if (settled) return; settled = true; this.cancelConnect = null;
        clearTimeout(timer); endpoint.off('open', opened); endpoint.off('error', failed);
        error ? reject(error) : resolve();
      };
      const timer = setTimeout(() => done(new Error('De P2P-verbindingsdienst reageert niet.')), this.directTimeout);
      this.cancelConnect = () => done(new Error('Verbinding geannuleerd.'));
      const opened = () => { done(); this.emit('online'); };
      const failed = () => done(new Error('De P2P-verbindingsdienst is niet bereikbaar.'));
      endpoint.on('open', opened); endpoint.on('error', failed);
      if (fresh) {
        endpoint.on('connection', connection => this.accept(connection));
        endpoint.on('disconnected', () => { if (this.endpoint === endpoint) this.emit('offline'); });
        endpoint.on('error', error => {
          if (this.endpoint !== endpoint) return;
          if (error.type === 'peer-unavailable' && this.joinInfo && !this.connection?.netplayReady) void this.fallback();
        });
      } else if (endpoint.disconnected) endpoint.reconnect();
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
  relayFor(id, secret) {
    if (!this.RelayRoomClass) return null;
    const relay = this.relayRoom = new this.RelayRoomClass(id, secret);
    relay.addEventListener('packet', e => { if (this.relayRoom === relay) this.relayPacket(e.detail); });
    relay.addEventListener('unavailable', () => {
      if (this.relayRoom !== relay) return;
      this.emit('relay-unavailable');
      if (this.fallbackStarting) this.rejectJoin('P2P lukt niet en de Itty Sockets-fallback is niet bereikbaar. Probeer een ander netwerk of probeer later opnieuw.');
    });
    return relay;
  }
  async create(info) {
    if (this.room || this.connection) throw new Error('Verlaat eerst je huidige kamer.');
    const generation = this.generation;
    try { await this.connect(); } catch { /* A relay-only room can still be reached. */ }
    if (generation !== this.generation) return;
    this.host = true;
    this.room = { id: this.endpoint?.id?.slice(3) || crypto.randomUUID(), host: text(info.name, 24) || 'Speler 1',
      title: text(info.title, 48) || 'Nog één potje', game: text(info.game, 80) };
    this.secret = newRelaySecret();
    const relay = this.relayFor(this.room.id, this.secret);
    if (!this.online && relay) {
      try { await relay.connect(); } catch (error) { this.leave(); throw error; }
    } else if (relay) void relay.connect().catch(() => { if (this.relayRoom === relay) this.emit('relay-unavailable'); });
    if (generation !== this.generation) return;
    this.emit('created', this.room);
  }
  async join(value, name) {
    const id = parseInvitation(value);
    if (this.room || this.connection || this.joinInfo) throw new Error('Verlaat eerst je huidige kamer.');
    const params = /^https?:\/\//i.test(String(value).trim()) ? new URLSearchParams(new URL(value).hash.slice(1)) : null;
    this.secret = params?.get('key') || '';
    this.joinInfo = { id, name: text(name, 24) || 'Speler 2', attempt: crypto.randomUUID() };
    this.host = false; this.emit('negotiating');
    const generation = this.generation;
    try { await this.connect(); } catch { if (generation === this.generation) await this.fallback(); return; }
    if (generation !== this.generation) return;
    if ('rr-' + id === this.endpoint.id) { this.joinInfo = null; throw new Error('Dit is je eigen kamerlink. Deel hem met iemand anders.'); }
    const connection = this.endpoint.connect('rr-' + id, { label: 'retroroom', serialization: 'json', reliable: true,
      metadata: { app: 'retroroom', version: INVITE_VERSION, name: this.joinInfo.name } });
    this.watch(connection);
    connection.on('data', message => {
      if (this.connection !== connection || this.room) return;
      if (message?.type === 'rejected') { this.rejectJoin(text(message.message, 160)); return; }
      if (message?.type !== 'room' || message.id !== id || message.version !== INVITE_VERSION) return;
      this.room = { id, host: text(message.host, 24), title: text(message.title, 48), game: text(message.game, 80) };
      this.emit('joined', this.room);
    });
    this.emit('joining', { connection, id });
  }
  accept(connection) {
    if (!this.host || !this.room || this.connection || connection.label !== 'retroroom' ||
        connection.serialization !== 'json' || connection.metadata?.app !== 'retroroom' || connection.metadata?.version !== INVITE_VERSION) {
      const timer = setTimeout(() => connection.close(), 10000);
      connection.on('error', () => { clearTimeout(timer); connection.close(); });
      connection.on('open', () => {
        connection.send({ type: 'rejected', message: 'Deze kamer is al bezet of gebruikt een andere versie. Vernieuw allebei de pagina.' });
        setTimeout(() => { clearTimeout(timer); connection.close(); }, 300);
      });
      return;
    }
    this.watch(connection);
    connection.on('open', () => {
      if (this.connection === connection) connection.send({ type: 'room', version: INVITE_VERSION, ...this.room });
    });
    this.emit('guest-joined', { connection, name: text(connection.metadata.name, 24) || 'Speler 2' });
  }
  watch(connection) {
    this.connection = connection;
    connection.onNetplayReady = () => {
      if (this.connection !== connection) return;
      clearTimeout(this.joinTimeout); clearTimeout(this.relayJoinTimeout);
      this.fallbackStarting = false;
      if (!this.host && !connection.relay) { this.relayRoom?.close(); this.relayRoom = null; }
    };
    if (!connection.relay) this.joinTimeout = setTimeout(() => {
      if (this.connection !== connection || connection.netplayReady) return;
      if (this.host) this.emit('fallback', { message: 'P2P lukt nog niet. Wachten op de Itty Sockets-fallback…' });
      else void this.fallback();
    }, this.directTimeout);
    connection.on('close', () => {
      if (this.connection !== connection) return;
      if (!connection.netplayReady && !connection.relay) {
        if (!this.host) void this.fallback();
        else { this.connection = null; clearTimeout(this.joinTimeout); this.emit('guest-left'); }
        return;
      }
      this.connection = null; clearTimeout(this.joinTimeout);
      this.emit(this.host ? 'guest-left' : 'room-closed');
      if (!this.host) { this.room = null; this.joinInfo = null; this.relayRoom?.close(); this.relayRoom = null; }
    });
    connection.on('error', () => {
      if (this.connection !== connection) return;
      if (!connection.netplayReady && !connection.relay) {
        if (!this.host) void this.fallback();
        else this.emit('fallback', { message: 'P2P lukt niet. Wachten op de Itty Sockets-fallback…' });
      } else this.rejectJoin('De spelverbinding is weggevallen. Verbind opnieuw met de uitnodigingslink.');
    });
  }
  async fallback() {
    if (this.host || !this.joinInfo || this.connection?.netplayReady || this.fallbackStarting) return;
    if (!validRelaySecret(this.secret)) { this.rejectJoin('P2P lukt niet. Plak de volledige nieuwe uitnodigingslink om de fallback te gebruiken.'); return; }
    this.fallbackStarting = true; clearTimeout(this.joinTimeout);
    this.emit('fallback', { message: 'P2P lukt niet. Verbinden via Itty Sockets…' });
    const info = this.joinInfo, generation = this.generation;
    try {
      const relay = this.relayRoom && !this.relayRoom.closed ? this.relayRoom : this.relayFor(info.id, this.secret);
      if (!relay) throw new Error('Fallback niet beschikbaar.');
      await relay.connect();
      if (generation !== this.generation || !this.fallbackStarting || info !== this.joinInfo) return;
      relay.send({ kind: 'join', version: INVITE_VERSION, attempt: info.attempt, name: info.name });
      this.relayJoinTimeout = setTimeout(() => {
        if (this.fallbackStarting) this.rejectJoin('Ook via Itty Sockets is de host niet bereikbaar. De kamer is mogelijk gesloten of de relay wordt geblokkeerd.');
      }, this.relayTimeout);
    } catch (error) { if (generation === this.generation && this.fallbackStarting) this.rejectJoin(error.message); }
  }
  relayPacket({ uid, payload }) {
    if (!payload || typeof payload !== 'object') return;
    if (this.host && this.room && payload.kind === 'join' && payload.version === INVITE_VERSION && ROOM_ID.test(payload.attempt)) {
      if (this.connection?.netplayReady || this.connection?.relay) {
        this.relayRoom.send({ kind: 'rejected', attempt: payload.attempt, message: 'Deze kamer is al bezet.' }, uid); return;
      }
      this.dropConnection();
      const connection = new RelayConnection(this.relayRoom, uid, payload.attempt, { name: text(payload.name, 24) || 'Speler 2' });
      this.watch(connection);
      this.emit('guest-joined', { connection, name: connection.metadata.name });
      this.relayRoom.send({ kind: 'accepted', version: INVITE_VERSION, attempt: payload.attempt, room: this.room }, uid);
      connection.activate(); return;
    }
    if (this.host || !this.fallbackStarting || payload.attempt !== this.joinInfo?.attempt) return;
    if (payload.kind === 'rejected') { this.rejectJoin(text(payload.message, 160)); return; }
    if (payload.kind !== 'accepted' || payload.version !== INVITE_VERSION || payload.room?.id !== this.joinInfo.id) return;
    clearTimeout(this.relayJoinTimeout); this.dropConnection();
    const connection = new RelayConnection(this.relayRoom, uid, payload.attempt);
    this.watch(connection); this.emit('joining', { connection, id: this.joinInfo.id });
    this.room = { id: this.joinInfo.id, host: text(payload.room.host, 24), title: text(payload.room.title, 48), game: text(payload.room.game, 80) };
    this.fallbackStarting = false; this.emit('joined', this.room); connection.activate();
  }
  rejectJoin(message) {
    clearTimeout(this.relayJoinTimeout); this.fallbackStarting = false;
    this.dropConnection();
    if (!this.host) { this.joinInfo = null; this.room = null; this.relayRoom?.close(); this.relayRoom = null; }
    this.emit('rejected', { message });
  }
  dropConnection() {
    clearTimeout(this.joinTimeout);
    const connection = this.connection; this.connection = null; connection?.close();
  }
  leave() {
    this.generation++; this.cancelConnect?.(); clearTimeout(this.relayJoinTimeout); this.fallbackStarting = false; this.joinInfo = null;
    this.dropConnection(); this.room = null; this.host = false; this.secret = null;
    this.relayRoom?.close(); this.relayRoom = null;
    const endpoint = this.endpoint; this.endpoint = null; endpoint?.destroy();
  }
}

export class PeerConnection extends EventTarget {
  constructor(connection, host) {
    super(); this.connection = connection; this.host = host; this.closed = false; this.approved = host;
    if (connection.relay) {
      this.route = 'Itty Sockets';
      this.pc = { connectionState: 'connecting' };
      connection.on('data', ({ channel, data }) => {
        if (this.closed) return;
        try { this.emit(channel, peerMessage(channel, data)); } catch (error) { this.emit('error', error.message); }
      });
      connection.on('open', () => {
        this.pc.connectionState = 'connected';
        this.control = this.input = { readyState: 'open' }; this.ready();
      });
      connection.on('close', () => {
        this.control = this.input = { readyState: 'closed' }; this.pc.connectionState = 'disconnected';
        if (!this.closed) this.emit('state', 'disconnected');
      });
      connection.on('error', error => { if (!this.closed) this.emit('error', error.message); });
      return;
    }
    this.route = 'P2P'; this.pc = connection.peerConnection;
    // Preserve PeerJS's initial control-channel handler; add separate raw channels
    // on the same SCTP/DTLS connection for unordered controller input only.
    const initialChannel = this.pc.ondatachannel;
    this.pc.ondatachannel = event => {
      if (event.channel.label === 'retroroom') initialChannel?.call(this.pc, event);
      else this.bind(event.channel);
    };
    this.pc.onconnectionstatechange = () => this.emit('state', this.pc.connectionState);
    connection.on('data', data => {
      if (this.closed || ['room', 'rejected'].includes(data?.type)) return;
      try { this.emit('control', peerMessage('control', data)); }
      catch (error) { this.emit('error', error.message); }
    });
    connection.on('close', () => { if (!this.closed) this.emit('state', 'disconnected'); });
    connection.on('open', () => {
      this.control = connection.dataChannel;
      if (host) {
        this.bind(this.pc.createDataChannel('input', { ordered: false }));
      }
      this.ready();
    });
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  approve() { this.approved = true; this.ready(); }
  ready() {
    if (!this.closed && !this.opened && this.approved && ['control', 'input'].every(k => this[k]?.readyState === 'open')) {
      this.opened = true; this.connection.netplayReady = true; this.connection.onNetplayReady?.(); this.emit('open', {});
    }
  }
  bind(channel) {
    if (channel.label !== 'input' || this[channel.label]) { channel.close(); return; }
    this[channel.label] = channel; channel.binaryType = 'arraybuffer';
    channel.onopen = () => this.ready();
    channel.onerror = channel.onclose = () => { if (!this.closed) this.emit('state', 'disconnected'); };
    channel.onmessage = event => {
      try {
        if (typeof event.data !== 'string' || event.data.length > 512) throw new Error('Invalid input');
        this.emit('input', peerMessage('input', JSON.parse(event.data)));
      } catch { this.emit('error', 'Ongeldig bericht van de andere speler.'); }
    };
  }
  send(channel, data) {
    const message = peerMessage(channel, data);
    const target = this[channel];
    if (target?.readyState !== 'open') throw new Error('De andere speler is niet verbonden.');
    if (target.bufferedAmount > 4 * 1024 * 1024) throw new Error('De verbinding loopt te ver achter.');
    if (this.connection.relay) this.connection.send({ channel, data: message });
    else if (channel === 'control') this.connection.send(message);
    else target.send(JSON.stringify(message));
  }
  close() { this.closed = true; this.connection.close(); }
}
