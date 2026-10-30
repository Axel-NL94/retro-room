// Only bounded encrypted RetroRoom packets cross this worker boundary.
import '../vendor/tailcat/wasm_exec.js';
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const connections = new Map();
let starting = false;
const emit = (type, fields = {}) => postMessage({ type, ...fields });
async function boot() {
  const go = new globalThis.Go();
  const response = await fetch('../assets/tailcat.wasm.gz');
  if (!response.ok) throw new Error('Tailcat ontbreekt.');
  const bytes = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const ready = new Promise(resolve => { globalThis.onTailcatReady = resolve; });
  const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
  void go.run(instance).catch(() => emit('error'));
  await ready;
}
function attach(conn, uid) {
  if (connections.size >= 4 || conn.port !== 1) { conn.close(); return; }
  const entry = { conn, writing: Promise.resolve() }; connections.set(uid, entry);
  void (async () => {
    let pending = new Uint8Array(0);
    try {
      for (;;) {
        const chunk = await conn.read(); if (chunk === null) break;
        if (chunk.length > 65536) throw new Error('Te groot.');
        const next = new Uint8Array(pending.length + chunk.length); next.set(pending); next.set(chunk, pending.length); pending = next;
        while (pending.length >= 4) {
          const length = new DataView(pending.buffer, pending.byteOffset, 4).getUint32(0);
          if (!length || length > 8192) throw new Error('Ongeldig frame.');
          if (pending.length < length + 4) break;
          emit('packet', { uid, data: decoder.decode(pending.subarray(4, length + 4)) });
          pending = pending.slice(length + 4);
        }
      }
    } catch { /* EOF or a malformed/unreachable peer. */ }
    finally { connections.delete(uid); conn.close(); emit('left', { uid }); }
  })();
}
onmessage = async ({ data }) => {
  try {
    if (data.op === 'open' && !starting) {
      starting = true; emit('stage', { stage: 'loading' }); await boot(); emit('stage', { stage: 'loaded' });
      const derpMapURL = 'https://tailcat.dev/derpmap.json';
      if (data.host) {
        const listener = await globalThis.tailcatListen({ derpMapURL, verbose: false, onConnection: conn => attach(conn, crypto.randomUUID()) });
        emit('ready', { address: listener.addr });
      } else {
        emit('stage', { stage: 'dialing' });
        const conn = await globalThis.tailcatDial({ addr: data.address, derpMapURL, port: 1, verbose: false });
        attach(conn, 'host'); emit('ready');
      }
    } else if (data.op === 'send') {
      const body = encoder.encode(data.data);
      if (!body.length || body.length > 8192) throw new Error('Te groot.');
      const targets = data.uid ? [connections.get(data.uid)].filter(Boolean) : [...connections.values()];
      if (!targets.length) { emit('written', { bytes: body.length }); return; }
      const frame = new Uint8Array(4 + body.length); new DataView(frame.buffer).setUint32(0, body.length); frame.set(body, 4);
      await Promise.all(targets.map(entry => entry.writing = entry.writing.then(() => entry.conn.write(frame)).catch(() => entry.conn.close())));
      emit('written', { bytes: body.length });
    }
  } catch { emit('error'); }
};
