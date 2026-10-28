// PeerJS Cloud handles discovery only. Explicit STUN-only configuration keeps
// Inputs and game metadata use a direct connection. ROMs never enter this transport.
import { INVITE_VERSION, peerMessage } from './protocol.js';
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
  constructor(PeerClass = globalThis.Peer) {
    super(); this.PeerClass = PeerClass; this.endpoint = null; this.pending = null;
    this.room = null; this.connection = null; this.host = false;
  }
  emit(type, detail = {}) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  get online() { return !!this.endpoint?.open && !this.endpoint.disconnected; }
  async connect() {
    if (this.online) return;
    if (this.pending) return this.pending;
    if (!this.PeerClass) throw new Error('De verbindingsmodule kon niet worden geladen. Vernieuw de pagina.');
    this.pending = new Promise((resolve, reject) => {
      const endpoint = this.endpoint && !this.endpoint.destroyed ? this.endpoint : new this.PeerClass('rr-' + crypto.randomUUID(), {
        secure: true, config: DIRECT_ICE, debug: 0
      });
      const fresh = this.endpoint !== endpoint;
      this.endpoint = endpoint;
      const done = error => {
        clearTimeout(timer); endpoint.off('open', opened); endpoint.off('error', failed);
        error ? reject(error) : resolve();
      };
      const timer = setTimeout(() => done(new Error('De uitnodigingsdienst reageert niet. Probeer het later opnieuw.')), 15000);
      const opened = () => { done(); this.emit('online'); };
      const failed = () => done(new Error('De uitnodigingsdienst is niet bereikbaar. Probeer opnieuw.'));
      endpoint.on('open', opened); endpoint.on('error', failed);
      if (fresh) {
        endpoint.on('connection', connection => this.accept(connection));
        endpoint.on('disconnected', () => { if (this.endpoint === endpoint) this.emit('offline'); });
        endpoint.on('error', error => {
          if (this.endpoint !== endpoint) return;
          if (error.type === 'peer-unavailable') {
            this.dropConnection();
            this.emit('error', { message: 'Deze kamer is gesloten of de host is offline. Vraag om een nieuwe link.' });
          }
        });
      } else if (endpoint.disconnected) endpoint.reconnect();
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
  async create(info) {
    if (this.room || this.connection) throw new Error('Verlaat eerst je huidige kamer.');
    await this.connect();
    this.host = true;
    this.room = { id: this.endpoint.id.slice(3), host: text(info.name, 24) || 'Speler 1',
      title: text(info.title, 48) || 'Nog één potje', game: text(info.game, 80) };
    this.emit('created', this.room);
  }
  async join(value, name) {
    const id = parseInvitation(value);
    if (this.room || this.connection) throw new Error('Verlaat eerst je huidige kamer.');
    await this.connect();
    if ('rr-' + id === this.endpoint.id) throw new Error('Dit is je eigen kamerlink. Deel hem met iemand anders.');
    this.host = false;
    const connection = this.endpoint.connect('rr-' + id, { label: 'retroroom', serialization: 'json', reliable: true,
      metadata: { app: 'retroroom', version: INVITE_VERSION, name: text(name, 24) || 'Speler 2' } });
    this.watch(connection);
    connection.on('data', message => {
      if (this.connection !== connection || this.room) return;
      if (message?.type === 'rejected') {
        this.dropConnection(); this.emit('rejected', { message: text(message.message, 160) }); return;
      }
      if (message?.type !== 'room' || message.id !== id || message.version !== INVITE_VERSION) return;
      this.room = { id, host: text(message.host, 24), title: text(message.title, 48), game: text(message.game, 80) };
      clearTimeout(this.joinTimeout);
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
        connection.send({ type: 'rejected', message: 'Deze kamer is al bezet of niet meer beschikbaar.' });
        // Let the reliable channel deliver the rejection before closing it.
        setTimeout(() => { clearTimeout(timer); connection.close(); }, 300);
      });
      return;
    }
    this.watch(connection);
    connection.on('open', () => {
      if (this.connection !== connection) return;
      clearTimeout(this.joinTimeout);
      connection.send({ type: 'room', version: INVITE_VERSION, ...this.room });
    });
    this.emit('guest-joined', { connection, name: text(connection.metadata.name, 24) || 'Speler 2' });
  }
  watch(connection) {
    this.connection = connection;
    this.joinTimeout = setTimeout(() => {
      if (this.connection !== connection) return;
      this.dropConnection();
      this.emit('rejected', { message: 'Rechtstreeks verbinden lukt niet op dit netwerk. Probeer een ander netwerk; deze versie heeft geen relay.' });
    }, 25000);
    connection.on('close', () => {
      if (this.connection !== connection) return;
      this.connection = null; clearTimeout(this.joinTimeout);
      this.emit(this.host ? 'guest-left' : 'room-closed');
      if (!this.host) this.room = null;
    });
    connection.on('error', () => {
      if (this.connection !== connection) return;
      this.dropConnection();
      this.emit('rejected', { message: 'De directe verbinding is mislukt. Probeer een ander netwerk of een nieuwe uitnodiging.' });
    });
  }
  dropConnection() {
    clearTimeout(this.joinTimeout);
    const connection = this.connection; this.connection = null; connection?.close();
  }
  leave() {
    this.dropConnection(); this.room = null; this.host = false;
    const endpoint = this.endpoint; this.endpoint = null; endpoint?.destroy();
  }
}

export class PeerConnection extends EventTarget {
  constructor(connection, host) {
    super(); this.connection = connection; this.host = host; this.closed = false; this.approved = host;
    this.pc = connection.peerConnection;
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
      this.opened = true; this.emit('open', {});
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
    if (channel === 'control') this.connection.send(message);
    else target.send(JSON.stringify(message));
  }
  close() { this.closed = true; this.connection.close(); }
}
