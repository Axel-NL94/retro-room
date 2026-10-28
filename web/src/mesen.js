import createMesen from '../assets/mesen-core.mjs';
import { validateRom } from './emulator.js';
export { OVERCLOCK_VALUES, validateOverclock } from './protocol.js';
import { validateOverclock } from './protocol.js';

export const MESEN_BUILD = 'mesence-4c4e069-web-3';
let binary;
function coreBinary() {
  return binary ||= fetch(new URL('../assets/mesen-core.wasm', import.meta.url)).then(async response => {
    if (!response.ok) throw new Error('De Mesen-emulator kon niet worden geladen. Vernieuw de pagina.');
    return new Uint8Array(await response.arrayBuffer());
  }).catch(error => { binary = null; throw error; });
}

// One independent WebAssembly instance per player; the native core owns all
// emulated CPU/PPU/APU state. Snapshots stay local and never include the ROM.
export class MesenCore {
  static async create({ onFrame = () => {}, onAudio = () => {}, wasmBinary } = {}) {
    const module = await createMesen({ wasmBinary: wasmBinary || await coreBinary(), print: () => {}, printErr: () => {} });
    const core = new MesenCore(module, onFrame, onAudio);
    if (!module._rr_init()) throw core.error('Mesen kon niet starten.');
    return core;
  }
  constructor(module, onFrame, onAudio) {
    this.module = module; this.onFrame = onFrame; this.onAudio = onAudio;
    this.statePointer = 0; this.stateCapacity = 0; this.fps = 60.0988;
  }
  error(fallback) {
    const message = this.module.UTF8ToString(this.module._rr_error_ptr());
    return new Error(message ? `${fallback} ${message}` : fallback);
  }
  load(bytes, system = 'nes', { overclock = 100 } = {}) {
    validateOverclock(overclock);
    if (system === 'nes') validateRom(bytes, { alignedBanks: false });
    else if (system === 'snes') validateSnesRom(bytes);
    else throw new Error('Dit systeem wordt nog niet ondersteund.');
    this.system = system;
    const m = this.module, pointer = m._malloc(bytes.length), path = m._malloc(16);
    try {
      const filename = system === 'snes' ? '/game.sfc' : '/game.nes';
      // This Libretro core opens its content path through stdio. MEMFS stays
      // entirely inside this WebAssembly instance; no ROM is written to disk.
      m.FS.writeFile(filename, bytes);
      m.HEAPU8.set(bytes, pointer); m.HEAPU8.set(new TextEncoder().encode(filename + '\0'), path);
      if (!m._rr_load(pointer, bytes.length, path, overclock)) throw this.error('Deze ROM kan niet door Mesen worden geladen.');
      this.overclock = overclock;
      this.fps = m._rr_frame_rate();
    } finally { m._free(pointer); m._free(path); }
  }
  run(p1, p2, replay = false) {
    // RetroPad uses B=0 and A=8; retain the website's established NES bit layout.
    const pad = bits => (bits & 0xcfc) | ((bits & 1) << 8) | ((bits >> 1) & 1) | ((bits & 0x100) << 1) | ((bits & 0x200) >> 8);
    const m = this.module;
    if (!m._rr_frame(pad(p1), pad(p2))) throw this.error('Mesen kon het frame niet uitvoeren.');
    if (!replay) {
      const width = m._rr_video_width(), height = m._rr_video_height();
      const frame = new Uint32Array(m.HEAPU8.buffer, m._rr_video_ptr(), width * height);
      this.onFrame(frame, width, height);
      const count = m._rr_audio_count();
      const samples = new Int16Array(m.HEAPU8.buffer, m._rr_audio_ptr(), count);
      for (let i = 0; i < count; i += 2) this.onAudio(samples[i] / 32768, samples[i + 1] / 32768);
    }
  }
  save() {
    const m = this.module, size = m._rr_save();
    if (!size || size > 16 * 1024 * 1024) throw this.error('Mesen kon de speltoestand niet bewaren.');
    return m.HEAPU8.slice(m._rr_state_ptr(), m._rr_state_ptr() + size);
  }
  restore(state) {
    const m = this.module;
    if (!(state instanceof Uint8Array) || !state.length || state.length > 16 * 1024 * 1024) throw new Error('Ongeldige Mesen-speltoestand.');
    if (state.length > this.stateCapacity) {
      m._free(this.statePointer); this.statePointer = m._malloc(state.length); this.stateCapacity = state.length;
    }
    m.HEAPU8.set(state, this.statePointer);
    if (!m._rr_restore(this.statePointer, state.length)) throw this.error('Mesen kon de speltoestand niet herstellen.');
  }
}

export function validateSnesRom(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 32768 || bytes.length > 8 * 1024 * 1024) throw new Error('Kies een SNES-ROM (.sfc of .smc) van maximaal 8 MB.');
  const offset = bytes.length % 1024 === 512 ? 512 : 0;
  const valid = [0x7fc0, 0xffc0, 0x40ffc0].some(header => {
    header += offset;
    return header + 64 <= bytes.length && (bytes[header + 0x15] & 0x20) && bytes[header + 0x3d] >= 0x80;
  });
  if (!valid) throw new Error('Er is geen geldige SNES-header gevonden. Kies een uitgepakt .sfc- of .smc-bestand.');
}
export function cartridgeSystem(bytes, name) {
  if (bytes[0] === 0x4e && bytes[1] === 0x45 && bytes[2] === 0x53 && bytes[3] === 0x1a) { validateRom(bytes, { alignedBanks: false }); return 'nes'; }
  if (/\.(sfc|smc)$/i.test(name)) { validateSnesRom(bytes); return 'snes'; }
  validateRom(bytes); return 'nes';
}
