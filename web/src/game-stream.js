import { STREAM_VERSION, streamToken } from './stream-protocol.js';

// Only emulator canvas + synthesized game audio are captured. Never request
// camera/microphone/display access and never send ROMs through a data channel.
export class GameStream extends EventTarget {
  constructor({ endpoint, connection, host, token, timeout = 45000, frameTimeout = 30000, reconnectTimeout = 12000,
    MediaStreamClass = globalThis.MediaStream } = {}) {
    super(); Object.assign(this, { endpoint, connection, host, token: streamToken(token), timeout, frameTimeout, reconnectTimeout, MediaStreamClass });
    this.closed = false; this.call = null; this.tracks = [];
    this.diagnostics = [];
    if (!connection?.peer || connection.relay) throw new Error('Streamen heeft een directe WebRTC-verbinding nodig. Itty ondersteunt geen video of audio.');
  }
  emit(type, detail) { if (!this.closed) this.dispatchEvent(new CustomEvent(type, { detail })); }
  status(stage, message) {
    this.stage = stage;
    this.diagnostics.push({ time: Math.round(performance.now()), stage });
    if (this.diagnostics.length > 32) this.diagnostics.shift();
    this.emit('status', { stage, message });
  }
  fail(message) { if (this.closed) return; this.emit('error', message); this.close(); }
  start(canvas, audioStream) {
    if (!this.host || this.closed || this.call) throw new Error('Deze stream kan niet worden gestart.');
    try {
      this.canvas = canvas;
      let video = canvas.captureStream(0);
      if (!video.getVideoTracks()[0]?.requestFrame) {
        video.getTracks().forEach(track => track.stop()); video = canvas.captureStream(60);
      }
      this.tracks = video.getTracks();
      const audioTracks = audioStream.getAudioTracks();
      if (!audioTracks.length) throw new Error('Het gamegeluid is niet beschikbaar voor streamen.');
      this.tracks.push(...audioTracks.map(track => track.clone()));
      this.videoTrack = video.getVideoTracks()[0]; this.videoTrack.contentHint = 'detail';
      const stream = new this.MediaStreamClass(this.tracks);
      const call = this.endpoint.call(this.connection.peer, stream, {
        metadata: { app: 'retroroom-stream', version: STREAM_VERSION, token: this.token },
      });
      if (!call) throw new Error('De videostream kon niet worden gestart.');
      this.bind(call); this.captureFrame(true);
      // A still preview must arrive before the guest can mark themselves ready.
      // Refresh it after negotiation as well as when emulation produces frames.
      this.previewTimer = setInterval(() => this.captureFrame(true), 500);
    } catch (error) { this.close(); throw error; }
  }
  accept(call) {
    if (this.closed || this.host || this.call || call.peer !== this.connection.peer ||
        call.metadata?.app !== 'retroroom-stream' || call.metadata?.version !== STREAM_VERSION || call.metadata?.token !== this.token) {
      call.close(); return false;
    }
    this.bind(call); call.answer(); this.monitor(call); return true;
  }
  bind(call) {
    this.call = call;
    this.status('negotiating', 'De verbinding voor beeld en geluid wordt opgezet…');
    this.timer = setTimeout(() => this.fail('De mediaverbinding kon niet op tijd worden opgezet. Verbind opnieuw of probeer een ander netwerk. Itty kan de videostream niet overnemen.'), this.timeout);
    call.on('stream', stream => {
      if (this.host || this.closed || this.remote === stream) return;
      this.remote = stream; this.emit('stream', stream);
    });
    call.on('error', error => {
      this.diagnostics.push({ time: Math.round(performance.now()), stage: 'error', type: String(error?.type || 'media-error').slice(0, 64) });
      this.fail('De verbinding voor beeld en geluid is mislukt. Verlaat de kamer en verbind opnieuw.');
    });
    call.on('close', () => this.fail('De stream is gesloten. Verlaat de kamer en verbind opnieuw.'));
    this.monitor(call);
  }
  monitor(call) {
    if (!call.peerConnection || this.monitored === call.peerConnection) return;
    this.monitored = call.peerConnection;
    const changed = () => {
      if (this.closed) return;
      const state = call.peerConnection?.connectionState;
      if (state === 'connected') {
        clearTimeout(this.timer); clearTimeout(this.recoveryTimer);
        if (this.stage === 'playing' || this.stage === 'first-frame') return;
        this.captureFrame(true);
        if (this.host || this.mediaReady) this.ready();
        else {
          this.status('first-frame', 'Verbonden. Wachten op het eerste gamebeeld en geluid…');
          this.frameTimer = setTimeout(() => this.fail('De mediaverbinding is verbonden, maar het eerste beeld en geluid komen niet binnen. Klik op het gamescherm of probeer opnieuw.'), this.frameTimeout);
        }
      }
      if (state === 'disconnected' && this.stage !== 'recovering') {
        clearTimeout(this.timer); clearTimeout(this.frameTimer);
        this.status('recovering', 'Beeld en geluid zijn tijdelijk onderbroken. Verbinding herstellen…');
        this.recoveryTimer = setTimeout(() => this.fail('De mediaverbinding kon niet worden hersteld. Verbind opnieuw met de uitnodigingslink.'), this.reconnectTimeout);
      }
      if (['failed','closed'].includes(state)) this.fail('De WebRTC-stream is weggevallen. Verbind opnieuw met de uitnodigingslink.');
    };
    this.onConnectionChange = changed;
    call.peerConnection?.addEventListener('connectionstatechange', changed);
    changed();
  }
  ready() {
    if (this.closed) return;
    this.mediaReady = true; clearTimeout(this.timer); clearTimeout(this.frameTimer);
    if (this.monitored?.connectionState !== 'disconnected') { clearTimeout(this.recoveryTimer); this.status('playing', 'Beeld en geluid zijn verbonden.'); }
  }
  captureFrame(refresh = false) {
    if (this.closed) return;
    if (refresh) this.canvas?.getContext?.('2d')?.drawImage(this.canvas, 0, 0);
    this.videoTrack?.requestFrame?.();
  }
  close() {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.timer); clearTimeout(this.frameTimer); clearTimeout(this.recoveryTimer); clearInterval(this.previewTimer);
    this.playbackCleanup?.();
    this.monitored?.removeEventListener('connectionstatechange', this.onConnectionChange);
    this.call?.close(); this.tracks.forEach(track => track.stop());
    this.remote?.getTracks().forEach(track => track.stop()); this.tracks = [];
  }
}
