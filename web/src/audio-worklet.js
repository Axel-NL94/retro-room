class RetroAudio extends AudioWorkletProcessor {
  constructor() {
    super(); this.left = new Float32Array(8192); this.right = new Float32Array(8192);
    this.read = 0; this.write = 0; this.count = 0;
    this.port.onmessage = ({ data }) => {
      if (data === 'clear') { this.count = 0; this.read = this.write; return; }
      for (let i = 0; i < data.length; i += 2) {
        if (this.count >= 4096) { this.read = (this.write - 1024 + 8192) % 8192; this.count = 1024; }
        this.left[this.write] = data[i]; this.right[this.write] = data[i + 1];
        this.write = (this.write + 1) % 8192; this.count++;
      }
    };
  }
  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    for (let i = 0; i < left.length; i++) {
      if (this.count) {
        left[i] = this.left[this.read]; if (right) right[i] = this.right[this.read];
        this.read = (this.read + 1) % 8192; this.count--;
      } else { left[i] = 0; if (right) right[i] = 0; }
    }
    return true;
  }
}
registerProcessor('retro-audio', RetroAudio);
