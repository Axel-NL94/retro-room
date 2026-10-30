// Tailcat runs in a disposable worker, outside the emulator's main thread.
// Only the pinned upstream compact public-region format is accepted. Embedded
// custom DERP endpoints (including insecure test endpoints) are never dialled.
export function validTailcatAddress(value) {
  if (typeof value !== 'string' || !/^tc[A-Za-z0-9_-]{20,2046}$/.test(value)) return false;
  try {
    const bytes = Uint8Array.from(atob(value.slice(2).replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
    let offset = 0;
    const count = bytes[offset++] - 0xa0;
    if (count < 3 || count > 4) return false;
    const fields = new Set();
    for (let n = 0; n < count; n++) {
      if (bytes[offset++] !== 0x61) return false;
      const field = String.fromCharCode(bytes[offset++]);
      if (!['p', 'k', 'q', 'i'].includes(field) || fields.has(field)) return false;
      fields.add(field);
      if (field === 'i') {
        const head = bytes[offset++]; let region = head;
        if (head === 24) region = bytes[offset++];
        else if (head === 25) { region = new DataView(bytes.buffer).getUint16(offset); offset += 2; }
        else if (head === 26) { region = new DataView(bytes.buffer).getUint32(offset); offset += 4; }
        else if (head > 23) return false;
        if (!region || region > 0x7fffffff) return false;
      } else {
        if (bytes[offset++] !== 0x58 || bytes[offset++] !== 32 || offset + 32 > bytes.length) return false;
        if (!bytes.subarray(offset, offset + 32).some(b => b !== 0)) return false;
        offset += 32;
      }
    }
    return offset === bytes.length && ['p', 'q', 'i'].every(field => fields.has(field));
  } catch { return false; }
}

export class TailcatTransport extends EventTarget {
  constructor({ WorkerClass = globalThis.Worker, timeout = 75000 } = {}) {
    super(); this.WorkerClass = WorkerClass; this.timeout = timeout; this.closed = false; this.bufferedAmount = 0;
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  open({ host, address }) {
    if (this.closed) return Promise.reject(new Error('Kamer gesloten.'));
    if (!host && !validTailcatAddress(address)) return Promise.reject(new Error('Deze link mist een geldig Tailcat-adres. Vraag de host om een nieuwe link.'));
    return new Promise((resolve, reject) => {
      this.rejectOpen = reject;
      const worker = this.worker = new this.WorkerClass(new URL('./tailcat-worker.js', import.meta.url), { type: 'module' });
      this.timer = setTimeout(() => this.fail(), this.timeout);
      worker.onerror = () => this.fail();
      worker.onmessage = ({ data }) => {
        if (this.closed) return;
        if (data.type === 'ready') {
          if (host && !validTailcatAddress(data.address)) { this.fail(); return; }
          clearTimeout(this.timer); this.rejectOpen = null; resolve(data.address || '');
        } else if (data.type === 'packet' && typeof data.uid === 'string' && typeof data.data === 'string' && data.data.length <= 8192) this.emit('packet', data);
        else if (data.type === 'left') this.emit('left', data.uid);
        else if (data.type === 'written') this.bufferedAmount = Math.max(0, this.bufferedAmount - data.bytes);
        else if (data.type === 'stage') { this.stage = data.stage; this.emit('stage', data.stage); }
        else if (data.type === 'error') this.fail();
      };
      worker.postMessage({ op: 'open', host, address });
    });
  }
  send(data, uid) {
    if (this.closed || !this.worker) throw new Error('Tailcat is niet verbonden.');
    const bytes = new TextEncoder().encode(data).length;
    if (bytes > 8192 || this.bufferedAmount + bytes > 128 * 1024) { this.fail(); throw new Error('De Tailcat-verbinding loopt te ver achter. Verbind opnieuw.'); }
    this.bufferedAmount += bytes;
    this.worker.postMessage({ op: 'send', data, uid });
  }
  fail() { if (this.closed) return; this.close(); this.emit('unavailable'); }
  close() {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.timer); this.worker?.terminate();
    this.rejectOpen?.(new Error('De Tailcat-fallback is niet bereikbaar. Probeer later opnieuw of gebruik een ander netwerk.'));
    this.rejectOpen = null;
  }
}
