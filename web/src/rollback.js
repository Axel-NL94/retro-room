export const NETPLAY_VERSION = 'retroroom-nes-1-jsnes-2.1.0';

// Snapshots are states immediately BEFORE frame n. A packet always names the
// frame on which its input must be applied, independent of either wall clock.
export class RollbackSession {
  constructor(core, { player = 1, delay = 2, window = 12, send = () => {} } = {}) {
    this.core = core;
    this.player = player;
    this.delay = delay;
    this.window = window;
    this.send = send;
    this.frame = 0;
    this.confirmed = delay - 1;
    this.local = new Map();
    this.remote = new Map();
    this.used = new Map();
    this.states = new Map();
    this.dirty = null;
    this.rollbacks = 0;
    this.waiting = false;
    for (let f = 0; f < delay; f++) {
      this.local.set(f, 0);
      this.remote.set(f, 0);
    }
  }

  receive(frame, buttons) {
    if (!Number.isSafeInteger(frame) || frame < 0 || frame > this.frame + 180 ||
        !Number.isInteger(buttons) || buttons < 0 || buttons > 255) {
      throw new Error('Ongeldige spelinvoer ontvangen.');
    }
    const previous = this.remote.get(frame);
    if (previous !== undefined && previous !== buttons) {
      throw new Error('Tegenstrijdige invoer voor hetzelfde frame.');
    }
    if (frame < this.frame - 180) return;
    this.remote.set(frame, buttons);
    if (frame < this.frame && this.used.get(frame) !== buttons) {
      if (!this.states.has(frame)) throw new Error('Verbinding te ver achtergeraakt. Start samen opnieuw.');
      this.dirty = Math.min(this.dirty ?? frame, frame);
    }
    while (this.remote.has(this.confirmed + 1)) this.confirmed++;
  }

  simulate(frame, replay) {
    this.states.set(frame, this.core.save());
    const remote = this.remote.get(frame) ?? this.used.get(frame - 1) ?? 0;
    this.used.set(frame, remote);
    const local = this.local.get(frame) ?? 0;
    this.core.run(this.player === 1 ? local : remote, this.player === 2 ? local : remote, replay);
  }

  reconcile() {
    if (this.dirty === null) return;
    const start = this.dirty;
    this.core.restore(this.states.get(start));
    for (let f = start; f < this.frame; f++) this.simulate(f, true);
    this.rollbacks++;
    this.dirty = null;
  }

  tick(buttons) {
    this.reconcile();
    const target = this.frame + this.delay;
    if (!this.local.has(target)) {
      this.local.set(target, buttons);
      this.send({ type: 'input', frame: target, buttons });
    }
    this.waiting = this.frame > this.confirmed + this.window;
    if (this.waiting) return false;
    this.simulate(this.frame++, false);
    // Keep enough confirmed history for checksums without retaining entire games.
    const oldest = this.frame - 180;
    for (const map of [this.local, this.remote, this.used]) {
      for (const key of map.keys()) if (key < oldest) map.delete(key);
    }
    // NES states are relatively large. Only speculative frames need snapshots.
    const oldestState = Math.min(this.frame - this.window - 2, this.confirmed + 1);
    for (const key of this.states.keys()) {
      if (key < oldest || (key < oldestState && key % 120 !== 0)) this.states.delete(key);
    }
    return true;
  }

  confirmedState() {
    this.reconcile();
    const frame = Math.floor(Math.min(this.frame - 1, this.confirmed + 1) / 120) * 120;
    const state = this.states.get(frame);
    return state ? { frame, hash: stateHash(state) } : null;
  }

  hashAt(frame) {
    this.reconcile();
    if (frame > this.confirmed + 1) return null;
    const state = this.states.get(frame);
    return state ? stateHash(state) : null;
  }
}

export function stateHash(state) {
  const value = JSON.stringify(state.data ?? state);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
