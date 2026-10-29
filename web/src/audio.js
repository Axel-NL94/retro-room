export class AudioSink {
  constructor() { this.samples = []; this.enabled = false; this.context = null; this.node = null; }
  async prepare() {
    if (!this.context) {
      this.context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      await this.context.audioWorklet.addModule(new URL('./audio-worklet.js', import.meta.url));
      this.node = new AudioWorkletNode(this.context, 'retro-audio', { outputChannelCount: [2] });
      this.gain = this.context.createGain(); this.gain.gain.value = 0; this.node.connect(this.gain).connect(this.context.destination);
      this.captureDestination = this.context.createMediaStreamDestination(); this.node.connect(this.captureDestination);
    }
    await this.context.resume();
  }
  async enable() { await this.prepare(); this.enabled = true; this.gain.gain.value = 0.65; }
  async capture() { await this.prepare(); this.streaming = true; return this.captureDestination.stream; }
  releaseCapture() { this.streaming = false; }
  mute() { this.enabled = false; if (this.gain) this.gain.gain.value = 0; this.clear(); }
  push(left, right) { if (this.node && (this.enabled || this.streaming)) this.samples.push(left, right); }
  flush() {
    if (this.node && this.samples.length) {
      const data = new Float32Array(this.samples); this.node.port.postMessage(data, [data.buffer]);
    }
    this.samples.length = 0;
  }
  clear() { this.samples.length = 0; this.node?.port.postMessage('clear'); }
}
