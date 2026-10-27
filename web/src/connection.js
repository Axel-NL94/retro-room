export class LobbyConnection extends EventTarget {
  constructor() { super(); this.socket = null; this.url = ''; this.iceServers = []; }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  async connect(url) {
    const parsed = new URL(url);
    if (!['ws:', 'wss:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Gebruik een geldige ws://- of wss://-server.');
    if (location.protocol === 'https:' && parsed.protocol !== 'wss:') throw new Error('Deze website heeft een beveiligde wss://-server nodig.');
    if (this.socket) { this.socket.onclose = null; this.socket.close(); }
    this.url = parsed.href;
    const socket = this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { socket.close(); reject(new Error('De lobbyserver reageert niet. Controleer het serveradres.')); }, 10000);
      socket.onopen = () => { clearTimeout(timeout); resolve(); };
      socket.onerror = () => { clearTimeout(timeout); reject(new Error('Kan de lobbyserver niet bereiken.')); };
      socket.onmessage = event => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'welcome') this.iceServers = message.iceServers;
          this.emit(message.type, message);
        } catch { this.emit('error', { message: 'Ongeldig bericht van de lobbyserver.' }); }
      };
      socket.onclose = () => {
        clearTimeout(timeout);
        reject(new Error('Verbinding met de lobbyserver gesloten.'));
        if (this.socket === socket) { this.socket = null; this.emit('offline', {}); }
      };
    });
    this.emit('online', {});
  }
  get online() { return this.socket?.readyState === WebSocket.OPEN; }
  send(message) {
    if (!this.online) throw new Error('Verbind eerst met een lobbyserver via Instellingen.');
    this.socket.send(JSON.stringify(message));
  }
}

export class PeerConnection extends EventTarget {
  constructor(lobby, host) {
    super(); this.lobby = lobby; this.host = host; this.closed = false;
    this.pc = new RTCPeerConnection({ iceServers: lobby.iceServers });
    this.pendingCandidates = [];
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate && !this.closed) {
        try { this.lobby.send({ type: 'signal', data: { type: 'candidate', candidate: candidate.toJSON() } }); }
        catch { this.emit('error', 'De lobbyverbinding is onderbroken.'); }
      }
    };
    this.pc.onconnectionstatechange = () => this.emit('state', this.pc.connectionState);
    this.pc.ondatachannel = ({ channel }) => this.bind(channel);
    if (host) {
      this.bind(this.pc.createDataChannel('control', { ordered: true }));
      this.bind(this.pc.createDataChannel('rom', { ordered: true }));
      this.bind(this.pc.createDataChannel('input', { ordered: false }));
    }
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  bind(channel) {
    if (!['control', 'rom', 'input'].includes(channel.label)) { channel.close(); return; }
    this[channel.label] = channel;
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => {
      if (!this.opened && ['control', 'rom', 'input'].every(k => this[k]?.readyState === 'open')) {
        this.opened = true; this.emit('open', {});
      }
    };
    channel.onerror = () => { if (!this.closed) this.emit('state', 'disconnected'); };
    channel.onclose = () => { if (!this.closed) this.emit('state', 'disconnected'); };
    channel.onmessage = event => {
      try {
        if (typeof event.data === 'string' && event.data.length > 65536) throw new Error('Message too large');
        const value = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        this.emit(channel.label, value);
      } catch { this.emit('error', 'Ongeldig bericht van de andere speler.'); }
    };
  }
  async offer() {
    await this.pc.setLocalDescription(await this.pc.createOffer());
    this.lobby.send({ type: 'signal', data: { type: 'offer', sdp: this.pc.localDescription.sdp } });
  }
  async signal(data) {
    if (this.closed) return;
    if (data.type === 'candidate') {
      if (this.pc.remoteDescription) await this.pc.addIceCandidate(data.candidate);
      else this.pendingCandidates.push(data.candidate);
    } else if (data.type === 'offer' || data.type === 'answer') {
      if ((data.type === 'offer') === this.host) throw new Error('Onverwachte verbindingsaanvraag.');
      await this.pc.setRemoteDescription({ type: data.type, sdp: data.sdp });
      for (const candidate of this.pendingCandidates.splice(0)) await this.pc.addIceCandidate(candidate);
      if (data.type === 'offer') {
        await this.pc.setLocalDescription(await this.pc.createAnswer());
        this.lobby.send({ type: 'signal', data: { type: 'answer', sdp: this.pc.localDescription.sdp } });
      }
    }
  }
  send(channel, data) {
    const target = this[channel];
    if (target?.readyState !== 'open') throw new Error('De andere speler is niet verbonden.');
    if (target.bufferedAmount > 4 * 1024 * 1024) throw new Error('De verbinding loopt te ver achter.');
    target.send(data instanceof ArrayBuffer || ArrayBuffer.isView(data) ? data : JSON.stringify(data));
  }
  async transfer(bytes, metadata, progress) {
    this.send('rom', { type: 'begin', ...metadata, size: bytes.byteLength });
    for (let offset = 0; offset < bytes.length; offset += 16384) {
      if (this.closed) throw new Error('Overdracht geannuleerd.');
      if (this.rom.bufferedAmount > 262144) {
        await new Promise((resolve, reject) => {
          this.rom.bufferedAmountLowThreshold = 65536;
          const timeout = setTimeout(() => { cleanup(); reject(new Error('ROM-overdracht duurde te lang.')); }, 15000);
          const ready = () => { cleanup(); resolve(); };
          const closed = () => { cleanup(); reject(new Error('ROM-overdracht onderbroken.')); };
          const cleanup = () => { clearTimeout(timeout); this.rom.removeEventListener('bufferedamountlow', ready); this.rom.removeEventListener('close', closed); };
          this.rom.addEventListener('bufferedamountlow', ready);
          this.rom.addEventListener('close', closed);
          if (this.rom.bufferedAmount <= 65536) ready();
        });
      }
      this.send('rom', bytes.subarray(offset, offset + 16384));
      progress(Math.min(bytes.length, offset + 16384) / bytes.length);
    }
    this.send('rom', { type: 'complete' });
  }
  close() { this.closed = true; this.pc.close(); }
}
