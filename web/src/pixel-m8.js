// SPDX-License-Identifier: MIT
import createPicoCore from '../assets/pico-core.js';

export const PIXEL_M8_BUILD = 'pixel-m8-0.11.9-web-1';
export const MAX_PIXEL_CART = 8 * 1024 * 1024;
const SAVE_PREFIX = 'retroroom-pixel-m8-save:';
let binary;
const coreBinary = () => binary ||= fetch(new URL('../assets/pico-core.wasm', import.meta.url)).then(async response => {
  if (!response.ok) throw new Error('Pixel-M8 kon niet worden geladen. Vernieuw de pagina.');
  return new Uint8Array(await response.arrayBuffer());
}).catch(error => { binary = null; throw error; });

export function validatePixelCart(bytes, name) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_PIXEL_CART) throw new Error('Kies een PICO-8-cartridge van maximaal 8 MB (.p8 of .p8.png).');
  const png = /\.p8\.png$/i.test(name);
  if (png ? ![137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)
    : !/\.p8$/i.test(name) || !new TextDecoder().decode(bytes.subarray(0,64)).startsWith('pico-8 cartridge')) {
    throw new Error('Dit is geen geldige .p8- of .p8.png-cartridge.');
  }
}

// RetroRoom directions occupy bits 4..7; PICO-8 uses left/right/up/down/O/X.
export function pixelPad(bits) {
  return ((bits >>> 6) & 3) | ((bits >>> 2) & 12) | ((bits & 3) << 4);
}

export class PixelM8Core {
  static async create({onFrame = () => {}, onAudio = () => {}, wasmBinary, storage} = {}) {
    if (storage === undefined) { try { storage = globalThis.localStorage; } catch { /* Optional persistence. */ } }
    const module = await createPicoCore({wasmBinary: wasmBinary || await coreBinary(), print: () => {}, printErr: () => {}});
    module.FS.mkdirTree('/carts'); module.FS.mkdirTree('/persist/carts'); module.FS.mkdirTree('/persist/saves');
    const core = new PixelM8Core(module, onFrame, onAudio, storage);
    core.restoreStorage();
    return core;
  }
  constructor(module, onFrame, onAudio, storage) {
    Object.assign(this, {module, onFrame, onAudio, storage, system: 'p8', build: PIXEL_M8_BUILD,
      fps: 60, supportsSavestates: false, ticks: 0, loaded: false, saved: new Map()});
    this.resetAudio();
  }
  stringCall(fn, text, ...args) {
    const m = this.module, p = m._malloc(m.lengthBytesUTF8(text) + 1);
    if (!p) throw new Error('Pixel-M8 heeft niet genoeg geheugen.');
    try { m.stringToUTF8(text, p, m.lengthBytesUTF8(text) + 1); return m[fn](p, ...args); }
    finally { m._free(p); }
  }
  error(fallback) { return new Error(`${fallback} ${this.module.UTF8ToString(this.module._pc_error())}`.trim()); }
  load(bytes, system = 'p8', {name = 'game.p8', overclock = 100} = {}) {
    if (system !== 'p8' || overclock !== 100) throw new Error('Pixel-M8 ondersteunt alleen de standaard CPU-snelheid.');
    validatePixelCart(bytes, name);
    this.flush();
    const path = /\.p8\.png$/i.test(name) ? '/carts/game.p8.png' : '/carts/game.p8';
    this.module.FS.writeFile(path, bytes);
    if (!this.stringCall('_pc_open', path, 0)) throw this.error('Pixel-M8 kon deze cartridge niet laden.');
    this.loaded = true; this.ticks = 0; this.overclock = 100; this.resetAudio();
  }
  resetAudio() { this.audioIndex = 0; this.audioNext = 0; this.audioPrevious = 0; }
  run(p1, p2, replay = false) {
    if (replay) throw new Error('Pixel-M8 ondersteunt nog geen rollback.');
    const m = this.module;
    m._pc_buttons(0, pixelPad(p1)); m._pc_buttons(1, pixelPad(p2));
    m._pc_clock(Date.now() / 1000);
    if (!m._pc_tick()) throw this.error('Pixel-M8 kon het frame niet uitvoeren.');
    const pending = m.UTF8ToString(m._pc_pending());
    if (pending) throw new Error('Deze game heeft een extra cartridge nodig. Multi-cartridge-games worden nog niet ondersteund.');
    this.onFrame(new Uint32Array(m.HEAPU8.buffer, m._pc_frame(), 128 * 128), 128, 128);
    // Continuous linear resampling: 22,050 Hz mono -> RetroRoom's 48,000 Hz stereo.
    // Carry the fractional phase and previous sample across video-frame boundaries.
    const pcm = new Int16Array(m.HEAPU8.buffer, m._pc_audio(), m._pc_audio_size());
    for (const value of pcm) {
      const sample = value / 32768, index = this.audioIndex++;
      while (this.audioNext <= index) {
        const fraction = this.audioNext - (index - 1);
        const out = index === 0 ? sample : this.audioPrevious + (sample - this.audioPrevious) * fraction;
        this.onAudio(out, out); this.audioNext += 22050 / 48000;
      }
      this.audioPrevious = sample;
    }
    if (++this.ticks % 60 === 0) this.flush();
  }
  restoreStorage() {
    try {
      for (let i = 0; i < this.storage?.length; i++) {
        const key = this.storage.key(i);
        if (!key?.startsWith(SAVE_PREFIX)) continue;
        const name = key.slice(SAVE_PREFIX.length);
        if (!/^(?:[a-f0-9]{2}){1,64}\.pcsave$/.test(name)) continue;
        const text = this.storage.getItem(key), data = JSON.parse(text);
        if (!Array.isArray(data) || data.length !== 268 || !data.every(v => Number.isInteger(v) && v >= 0 && v <= 255)) continue;
        this.module.FS.writeFile('/persist/saves/' + name, Uint8Array.from(data)); this.saved.set(name, text);
      }
    } catch { /* Blocked or damaged browser storage must not prevent playing. */ }
  }
  flush() {
    if (!this.loaded || !this.module) return;
    if (!this.module._pc_flush()) throw this.error('Pixel-M8 kon de voortgang niet bewaren.');
    // Only cartdata()/dset() progress: never cartridges or a full VM snapshot.
    for (const name of this.module.FS.readdir('/persist/saves')) {
      if (!/^(?:[a-f0-9]{2}){1,64}\.pcsave$/.test(name)) continue;
      const data = this.module.FS.readFile('/persist/saves/' + name);
      if (data.length !== 268) continue;
      const text = JSON.stringify([...data]);
      if (this.saved.get(name) === text) continue;
      try { this.storage?.setItem(SAVE_PREFIX + name, text); this.saved.set(name, text); }
      catch { /* The game continues if local storage is unavailable or full. */ }
    }
  }
  destroy() {
    if (!this.module) return;
    try { this.flush(); } finally { this.module._pc_release(); this.module = null; this.loaded = false; }
  }
}
