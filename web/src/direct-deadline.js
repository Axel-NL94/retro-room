// Give an advancing ICE negotiation time to finish, but never wait indefinitely.
export function directDeadline(connection, { idle = 15000, maximum = 45000, timeout, failed = timeout,
  setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let stopped = false, timer, signature;
  const pc = connection.peerConnection;
  const finish = fn => { if (!stopped) { stop(); fn(); } };
  const renew = () => { clearTimer(timer); timer = setTimer(() => finish(timeout), idle); };
  const progress = () => {
    if (stopped) return;
    if (pc?.connectionState === 'failed' || pc?.iceConnectionState === 'failed') { finish(failed); return; }
    const next = [pc?.iceGatheringState, pc?.iceConnectionState, pc?.connectionState, pc?.signalingState, connection.open].join('|');
    if (signature !== next) { signature = next; renew(); }
  };
  const candidates = new Set();
  const candidate = event => {
    const value = event.candidate?.candidate;
    if (stopped || typeof value !== 'string' || !value || value.length > 2048 || candidates.size >= 64 || candidates.has(value)) return;
    candidates.add(value); renew();
  };
  const events = ['icegatheringstatechange', 'iceconnectionstatechange', 'connectionstatechange', 'signalingstatechange'];
  const hard = setTimer(() => finish(timeout), maximum);
  function stop() {
    if (stopped) return; stopped = true; clearTimer(timer); clearTimer(hard);
    for (const event of events) pc?.removeEventListener?.(event, progress);
    pc?.removeEventListener?.('icecandidate', candidate);
    connection.off?.('open', progress);
  }
  for (const event of events) pc?.addEventListener?.(event, progress);
  pc?.addEventListener?.('icecandidate', candidate);
  connection.on('open', progress); progress();
  return stop;
}
