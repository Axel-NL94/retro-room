let running = false, generation = 0, timer = null, awaiting = false;
function tick() {
  timer = null;
  if (!running || awaiting) return;
  awaiting = true;
  self.postMessage({ type: 'tick', generation });
}
self.onmessage = ({ data }) => {
  if (data?.type === 'start' || data?.type === 'stop') {
    clearTimeout(timer); timer = null; awaiting = false;
    generation = data.generation; running = data.type === 'start';
    if (running) tick();
  } else if (data?.type === 'ack' && running && awaiting && data.generation === generation) {
    // At most one outstanding tick, including after browser/OS suspension.
    awaiting = false;
    timer = setTimeout(tick, 1000 / 120);
  }
};
