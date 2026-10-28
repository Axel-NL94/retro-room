// requestAnimationFrame stops in hidden windows. A worker supplies background
// ticks while a game is running; it never decides whether a game is paused.
export class PlaybackClock {
  constructor(tick, { page = document, now = () => performance.now(),
    requestFrame = callback => requestAnimationFrame(callback), cancelFrame = id => cancelAnimationFrame(id),
    createWorker = () => new Worker(new URL('./playback-worker.js', import.meta.url), { type: 'module' }),
    setTimer = callback => setInterval(callback, 1000 / 60), clearTimer = id => clearInterval(id) } = {}) {
    Object.assign(this, { tick, page, now, requestFrame, cancelFrame, createWorker, setTimer, clearTimer });
    this.running = false; this.background = false; this.generation = 0;
    this.frame = null; this.timer = null; this.worker = null; this.workerFailed = false;
    this.visibilityChanged = () => this.syncVisibility();
    this.page.addEventListener('visibilitychange', this.visibilityChanged);
  }

  setRunning(running) {
    if (this.running === running) return;
    this.running = running;
    this.syncVisibility();
  }

  syncVisibility() {
    this.generation++;
    if (this.frame !== null) this.cancelFrame(this.frame);
    if (this.timer !== null) this.clearTimer(this.timer);
    this.frame = this.timer = null;
    this.worker?.postMessage({ type: 'stop', generation: this.generation });
    this.background = this.running && this.page.hidden;
    if (!this.running) return;
    if (!this.background) {
      const generation = this.generation;
      const frame = () => {
        if (!this.running || this.background || generation !== this.generation) return;
        this.frame = this.requestFrame(frame);
        this.tick(this.now());
      };
      this.frame = this.requestFrame(frame);
      return;
    }
    if (!this.worker && !this.workerFailed) {
      try {
        const worker = this.worker = this.createWorker();
        this.worker.onmessage = ({ data }) => {
          if (data?.type !== 'tick' || data.generation !== this.generation || !this.running || !this.background) return;
          try { this.tick(this.now()); }
          finally { this.worker?.postMessage({ type: 'ack', generation: data.generation }); }
        };
        this.worker.onerror = event => {
          if (this.worker !== worker) return;
          event.preventDefault(); this.workerFailed = true;
          this.worker.terminate(); this.worker = null; this.syncVisibility();
        };
      } catch { this.workerFailed = true; }
    }
    if (this.worker) this.worker.postMessage({ type: 'start', generation: this.generation });
    else {
      const generation = this.generation;
      this.timer = this.setTimer(() => {
        if (this.running && this.background && generation === this.generation) this.tick(this.now());
      });
    }
  }

  destroy() {
    this.setRunning(false); this.generation++;
    this.page.removeEventListener('visibilitychange', this.visibilityChanged);
    this.worker?.terminate(); this.worker = null;
  }
}
