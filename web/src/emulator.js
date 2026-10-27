export class NesCore {
  constructor(NES, { onFrame = () => {}, onAudio = () => {} } = {}) {
    this.silent = false;
    this.nes = new NES({
      sampleRate: 48000,
      emulateSound: true,
      onFrame: frame => { if (!this.silent) onFrame(frame); },
      onAudioSample: (l, r) => { if (!this.silent) onAudio(l, r); },
    });
  }
  load(bytes) { this.nes.loadROM(bytes); }
  run(p1, p2, replay = false) {
    this.silent = replay;
    for (let b = 0; b < 8; b++) {
      for (const [player, bits] of [[1, p1], [2, p2]]) {
        if (bits & (1 << b)) this.nes.buttonDown(player, b);
        else this.nes.buttonUp(player, b);
      }
    }
    this.nes.frame();
    this.silent = false;
  }
  // The upstream JSON save format omits transient cycle/render state. Rollback
  // needs exact frame-boundary snapshots, including aliases to banked tiles.
  // Keep object identities and copy their data; never clone callbacks or NES.
  save() {
    const targets = [], data = [], seen = new Map();
    const visit = value => {
      if (value === this.nes || typeof value === 'function') return { skip: true };
      if (value === null || typeof value !== 'object') return { value };
      if (seen.has(value)) return { ref: seen.get(value) };
      const ref = targets.length;
      seen.set(value, ref); targets.push(value); data.push(null);
      if (ArrayBuffer.isView(value)) data[ref] = { bytes: value.slice() };
      else {
        const props = {};
        for (const key of Object.keys(value)) {
          const saved = visit(value[key]);
          if (!saved.skip) props[key] = saved;
        }
        data[ref] = { props, ...(Array.isArray(value) ? { length: value.length } : {}) };
      }
      return { ref };
    };
    visit({ cpu: this.nes.cpu, ppu: this.nes.ppu, papu: this.nes.papu,
      mmap: this.nes.mmap, controllers: this.nes.controllers });
    return { data, targets };
  }
  restore({ data, targets }) {
    for (let i = 0; i < data.length; i++) {
      const node = data[i], target = targets[i];
      if (node.bytes) target.set(node.bytes);
      else {
        if (node.length !== undefined) target.length = node.length;
        for (const key of Object.keys(target)) {
          if (!(key in node.props) && target[key] !== this.nes && typeof target[key] !== 'function') delete target[key];
        }
        for (const [key, value] of Object.entries(node.props)) {
          target[key] = value.ref !== undefined ? targets[value.ref] : value.value;
        }
      }
    }
  }
}

export function validateRom(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 16 || bytes.length > 8 * 1024 * 1024) {
    throw new Error('Kies een NES-ROM van maximaal 8 MB.');
  }
  if (bytes[0] !== 0x4e || bytes[1] !== 0x45 || bytes[2] !== 0x53 || bytes[3] !== 0x1a) {
    throw new Error('Dit is geen iNES-ROM (.nes). SNES, Sega en PS1 volgen later.');
  }
  if ((bytes[7] & 0x0c) === 0x08) throw new Error('NES 2.0-ROMs worden in deze versie nog niet ondersteund.');
  const required = 16 + ((bytes[6] & 4) ? 512 : 0) + bytes[4] * 16384 + bytes[5] * 8192;
  if (bytes.length < required || bytes[4] === 0) throw new Error('Het ROM-bestand is onvolledig.');
}

export async function romHash(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
