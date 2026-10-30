import {validateDosInput} from './dos-input.js';
// DOSBox Pure browser frontend. GPL-3.0-or-later; see native/DOSBOX.md.
export const DOS_BUILD = 'dosbox-pure-d9c1356-web-input-2';
// Experimental lockstep only: independent instances pass; rollback remains disabled.
export const DOS_NETPLAY_AVAILABLE = true;
export const MAX_DOS_FILE = 32 * 1024 * 1024;
let binary;
function coreBinary() {
  return binary ||= fetch(new URL('../assets/dos-core.wasm', import.meta.url)).then(async response => {
    if (!response.ok) throw new Error('DOSBox Pure kon niet worden geladen. Vernieuw de pagina.');
    return new Uint8Array(await response.arrayBuffer());
  }).catch(error => { binary = null; throw error; });
}
export function dosExtension(name) {
  const ext = String(name).match(/\.(zip|dosz|com|exe|bat)$/i)?.[1]?.toLowerCase();
  if (!ext) throw new Error('Kies een DOS-game als .zip, .dosz, .exe, .com of .bat. Een EXE heeft vaak extra bestanden nodig; gebruik dan een ZIP met de complete game.');
  return ext;
}
export function validateDos(bytes, name) {
  const ext = dosExtension(name);
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_DOS_FILE) throw new Error('Een DOS-bestand mag maximaal 32 MB zijn.');
  if (['zip','dosz'].includes(ext) && !(bytes[0] === 80 && bytes[1] === 75 && [3,5].includes(bytes[2]))) throw new Error('Dit is geen geldig DOS-ZIP-bestand.');
  return ext;
}
export class DosCore {
  static async create({ onFrame = () => {}, onAudio = () => {}, wasmBinary } = {}) {
    const { default: createDOS } = await import('../assets/dos-core.mjs');
    const module = await createDOS({ wasmBinary: wasmBinary || await coreBinary(), print: () => {}, printErr: () => {} });
    const core = new DosCore(module, onFrame, onAudio);
    if (!module._rr_init()) throw core.error('DOSBox Pure kon niet starten.');
    return core;
  }
  constructor(module, onFrame, onAudio) { Object.assign(this, { module, onFrame, onAudio, system: 'dos', fps: 60, build: DOS_BUILD }); }
  error(message) { const detail = this.module.UTF8ToString(this.module._rr_error_ptr()); return new Error(detail ? message + ' ' + detail : message); }
  load(bytes, system = 'dos', { name = 'game.zip', overclock = 100 } = {}) {
    const ext = validateDos(bytes, name), m = this.module, path = '/games/game.' + ext;
    m.FS.writeFile(path, bytes); m.FS.utime(path, 1704067200000, 1704067200000);
    const encoded = new TextEncoder().encode(path + '\0'), ptr = m._malloc(encoded.length);
    try {
      m.HEAPU8.set(encoded, ptr);
      m._rr_load(ptr, overclock);
      if (!m._rr_last_result()) throw this.error('DOSBox Pure kon deze game niet laden.');
      this.fps = m._rr_frame_rate(); this.overclock = overclock; this.name = name;
    } finally { m._free(ptr); }
  }
  input(port, state) {
    const value=validateDosInput(state),m=this.module,ptr=m._malloc(256);
    try {
      const keys=new Uint16Array([...new Set([...value.keys,...(value.mouse.wheel<0?[280]:value.mouse.wheel>0?[281]:[])])]);m.HEAPU8.set(new Uint8Array(keys.buffer),ptr);
      m._rr_set_input(port,ptr,keys.length,value.modifiers,value.mouse.x,value.mouse.y,value.mouse.wheel,value.mouse.buttons,value.joy.enabled,Math.round(value.joy.x*32767),Math.round(value.joy.y*32767),value.joy.buttons);
    } finally {m._free(ptr);}
  }
  run(p1, p2, replay = false, inputs = null) {
    const m = this.module;
    if(inputs){this.input(0,inputs[0]);this.input(1,inputs[1]);}
    m._rr_frame(p1, p2);
    if (!m._rr_last_result()) throw this.error('DOSBox Pure kon het frame niet uitvoeren.');
    if (!replay) {
      const w = m._rr_video_width(), h = m._rr_video_height();
      if (w && h) this.onFrame(new Uint32Array(m.HEAPU8.buffer, m._rr_video_ptr(), w*h), w, h);
      const count = m._rr_audio_count(), samples = new Int16Array(m.HEAPU8.buffer, m._rr_audio_ptr(), count);
      for (let i=0;i<count;i+=2) this.onAudio(samples[i]/32768, samples[i+1]/32768);
    }
  }
  stateSections(){const m=this.module;return Array.from({length:m._rr_section_count()},(_,i)=>({name:m.UTF8ToString(m._rr_section_name(i)),start:m._rr_section_start(i),end:m._rr_section_end(i)}));}
  save() {
    const m = this.module; m._rr_save(); const size = m._rr_last_result();
    if (!size || size > 64*1024*1024) throw this.error('DOSBox Pure kon deze speltoestand niet opslaan.');
    return m.HEAPU8.slice(m._rr_state_ptr(), m._rr_state_ptr()+size);
  }
  restore(state) {
    if (!(state instanceof Uint8Array) || !state.length || state.length > 64*1024*1024) throw new Error('Ongeldige DOS-speltoestand.');
    const m = this.module, ptr = m._malloc(state.length);
    try { m.HEAPU8.set(state, ptr); m._rr_restore(ptr, state.length); if (!m._rr_last_result()) throw this.error('DOSBox Pure kon deze speltoestand niet laden.'); }
    finally { m._free(ptr); }
  }
  destroy() { this.module._rr_destroy(); }
}
