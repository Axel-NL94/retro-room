import { INVITE_VERSION } from './protocol.js';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const peerId = value => typeof value === 'string' && /^rr-[a-f0-9-]{36}$/i.test(value) && UUID.test(value.slice(3));
const steps = new Set(['offer', 'answer', 'permit', 'ready', 'cancel']);
function signal(value) {
  if (!value || !steps.has(value.step) || !UUID.test(value.nonce) ||
      (['offer', 'answer'].includes(value.step) && !peerId(value.peer))) return null;
  return { step: value.step, nonce: value.nonce, ...(['offer', 'answer'].includes(value.step) ? { peer: value.peer } : {}) };
}

// Probe in the background. Only the already authenticated relay partner can
// authorize a candidate, and the game keeps its existing connection/session.
export class DirectUpgrade {
  constructor(invite, connection, { delays = [5000, 15000, 30000, 60000], timeout = 30000 } = {}) {
    this.invite = invite; this.connection = connection; this.delays = delays; this.timeout = timeout;
    this.failures = 0; this.closed = false;
    this.onSignal = value => { const message = signal(value); if (message) void this.receive(message); };
    this.onRoute = route => { if (route === 'Tailcat') { this.reset(); this.schedule(); } };
    this.onClose = () => this.close();
    connection.on('upgrade', this.onSignal); connection.on('route', this.onRoute); connection.on('close', this.onClose);
    this.schedule();
  }
  current() { return !this.closed && !this.connection.closed && this.invite.connection === this.connection; }
  schedule() {
    if (!this.current() || !this.invite.host || this.connection.route !== 'Tailcat' || this.timer || this.nonce) return;
    const delay = this.delays[Math.min(this.failures, this.delays.length - 1)];
    this.timer = setTimeout(() => { this.timer = null; void this.offer(); }, delay);
  }
  begin(nonce) {
    this.reset(); this.nonce = nonce;
    this.deadline = setTimeout(() => this.fail(), this.timeout);
  }
  async online(nonce) {
    try { await this.invite.connect(); } catch { return false; }
    return this.current() && this.nonce === nonce && this.invite.online;
  }
  send(step, extra = {}) { this.connection.signal({ step, nonce: this.nonce, ...extra }); }
  async offer() {
    if (!this.current() || this.connection.route !== 'Tailcat') return;
    const nonce = crypto.randomUUID(); this.begin(nonce);
    if (!await this.online(nonce)) { if (this.nonce === nonce) this.fail(); return; }
    this.send('offer', { peer: this.invite.endpoint.id });
  }
  async receive(message) {
    if (!this.current() || this.connection.route !== 'Tailcat') return;
    const { step, nonce } = message;
    if (step === 'offer' && !this.invite.host) {
      // A newer authenticated offer supersedes a failed probe, never the game.
      if (nonce === this.nonce) return;
      this.begin(nonce); this.remotePeer = message.peer;
      if (!await this.online(nonce)) { if (this.nonce === nonce) this.fail(); return; }
      this.send('answer', { peer: this.invite.endpoint.id }); return;
    }
    if (nonce !== this.nonce) return;
    if (step === 'cancel') { this.fail(false); return; }
    if (step === 'answer' && this.invite.host && !this.remotePeer) {
      this.remotePeer = message.peer; this.send('permit'); return;
    }
    if (step === 'permit' && !this.invite.host && !this.candidate) {
      try {
        const candidate = this.invite.endpoint.connect(this.remotePeer, { label: 'retroroom-upgrade', serialization: 'json', reliable: true,
          metadata: { app: 'retroroom', version: INVITE_VERSION, room: this.invite.room.id, attempt: this.connection.attempt, nonce } });
        this.bind(candidate);
      } catch { this.fail(); }
      return;
    }
    if (step === 'ready' && this.invite.host && this.proven && this.candidate?.open) {
      this.sendProbe('commit');
    }
  }
  accept(candidate) {
    const metadata = candidate.metadata;
    if (!this.current() || !this.invite.host || this.connection.route !== 'Tailcat' || !this.nonce || this.candidate ||
        candidate.peer !== this.remotePeer || candidate.label !== 'retroroom-upgrade' || candidate.serialization !== 'json' ||
        metadata?.app !== 'retroroom' || metadata.version !== INVITE_VERSION || metadata.room !== this.invite.room.id ||
        metadata.attempt !== this.connection.attempt || metadata.nonce !== this.nonce) { candidate.close(); return; }
    this.bind(candidate);
  }
  bind(candidate) {
    this.candidate = candidate;
    const nonce = this.nonce;
    this.onData = value => {
      if (!this.current() || this.candidate !== candidate || this.nonce !== nonce || value?.probe !== 'retroroom-upgrade-1' || value.nonce !== nonce) return;
      if (value.step === 'hello' && this.invite.host) {
        if (!this.attached) this.attached = this.connection.attachDirect(candidate, nonce);
        this.proven = this.attached; if (this.proven) this.sendProbe('hello-ack');
      } else if (value.step === 'hello-ack' && !this.invite.host) {
        if (!this.attached) this.attached = this.connection.attachDirect(candidate, nonce);
        if (this.attached) this.send('ready');
      } else if (value.step === 'commit' && !this.invite.host && this.attached) {
        this.sendProbe('commit-ack'); this.success();
      } else if (value.step === 'commit-ack' && this.invite.host && this.proven) this.success();
    };
    this.onOpen = () => { if (!this.invite.host && this.candidate === candidate) this.sendProbe('hello'); };
    this.onLost = () => { if (this.candidate === candidate) this.fail(); };
    candidate.on('data', this.onData); candidate.on('open', this.onOpen);
    candidate.on('close', this.onLost); candidate.on('error', this.onLost);
    if (candidate.open) this.onOpen();
  }
  sendProbe(step) { this.candidate.send({ probe: 'retroroom-upgrade-1', nonce: this.nonce, step }); }
  success() {
    clearTimeout(this.deadline); this.deadline = null; this.failures = 0;
    this.connection.useDirect();
    // The stable RelayConnection owns the working candidate from here on.
    this.unbind(); this.candidate = null; this.nonce = null; this.attached = false; this.proven = false;
  }
  unbind() {
    const c = this.candidate; if (!c) return;
    c.off('data', this.onData); c.off('open', this.onOpen); c.off('close', this.onLost); c.off('error', this.onLost);
  }
  fail(notify = true) {
    if (!this.current()) return;
    if (notify && this.nonce) this.send('cancel');
    this.failures++; this.reset(); this.schedule();
  }
  reset() {
    clearTimeout(this.timer); clearTimeout(this.deadline); this.timer = this.deadline = null;
    const candidate = this.candidate; this.unbind(); this.candidate = null;
    this.nonce = this.remotePeer = null; this.proven = this.attached = false;
    if (candidate) { this.connection.detachDirect(candidate); candidate.close(); }
  }
  close() {
    if (this.closed) return; this.closed = true; this.reset();
    this.connection.off('upgrade', this.onSignal); this.connection.off('route', this.onRoute); this.connection.off('close', this.onClose);
  }
}
