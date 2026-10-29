import { STREAM_VERSION, streamToken } from './stream-protocol.js';

// Only emulator canvas + synthesized game audio are captured. Never request
// camera/microphone/display access and never send ROMs through a data channel.
export class GameStream extends EventTarget {
  constructor({ endpoint, connection, host, token, timeout = 15000,
    MediaStreamClass = globalThis.MediaStream } = {}) {
    super(); Object.assign(this, { endpoint, connection, host, token: streamToken(token), timeout, MediaStreamClass });
    this.closed = false; this.call = null; this.tracks = [];
    if (!connection?.peer || connection.relay) throw new Error('Streamen heeft een directe WebRTC-verbinding nodig. Itty ondersteunt geen video of audio.');
  }
  emit(type, detail) { if (!this.closed) this.dispatchEvent(new CustomEvent(type, { detail })); }
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
    this.timer = setTimeout(() => this.fail('De WebRTC-stream komt niet binnen. Probeer een ander netwerk of maak een kamer met eigen ROMs. Itty kan de videostream niet overnemen.'), this.timeout);
    call.on('stream', stream => {
      if (this.host || this.closed || this.remote === stream) return;
      this.remote = stream; this.emit('stream', stream);
    });
    call.on('error', () => this.fail('De verbinding voor beeld en geluid is mislukt. Verlaat de kamer en verbind opnieuw.'));
    call.on('close', () => this.fail('De stream is gesloten. Verlaat de kamer en verbind opnieuw.'));
    this.monitor(call);
  }
  monitor(call) {
    if (!call.peerConnection || this.monitored === call.peerConnection) return;
    this.monitored = call.peerConnection;
    const changed = () => {
      if (this.closed) return;
      const state = call.peerConnection?.connectionState;
      if (state === 'connected' && this.host) { this.ready(); this.captureFrame(true); }
      if (['failed','disconnected','closed'].includes(state)) this.fail('De WebRTC-stream is weggevallen. Verbind opnieuw met de uitnodigingslink.');
    };
    call.peerConnection?.addEventListener('connectionstatechange', changed);
    changed();
  }
  ready() { clearTimeout(this.timer); }
  captureFrame(refresh = false) {
    if (this.closed) return;
    if (refresh) this.canvas?.getContext?.('2d')?.drawImage(this.canvas, 0, 0);
    this.videoTrack?.requestFrame?.();
  }
  close() {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.timer); clearInterval(this.previewTimer);
    this.call?.close(); this.tracks.forEach(track => track.stop());
    this.remote?.getTracks().forEach(track => track.stop()); this.tracks = [];
  }
}
