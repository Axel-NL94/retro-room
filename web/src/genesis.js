// SPDX-License-Identifier: MIT
import createGenesis from '../assets/genesis-core.mjs';
import {validateOverclock} from './protocol.js';

export const GENESIS_BUILD = 'genesis-plus-gx-f27655b-web-1';
import {validateGenesisRom} from './genesis-rom.js';
export {validateGenesisRom,MAX_GENESIS_ROM} from './genesis-rom.js';
let binary;
const coreBinary = () => binary ||= fetch(new URL('../assets/genesis-core.wasm',import.meta.url)).then(async response=>{
  if(!response.ok)throw new Error('De Mega Drive-emulator kon niet worden geladen. Vernieuw de pagina.');
  return new Uint8Array(await response.arrayBuffer());
}).catch(error=>{binary=null;throw error;});

// RetroRoom: A=0, B=1, C=8, X=9, Y=10, Z=11, Mode=2, Start=3.
// Genesis Plus GX: A=RetroPad Y, B=B, C=A, X=L, Y=X, Z=R.
export function genesisPad(bits){return (bits&0x8fc)|((bits&1)<<1)|((bits&2)>>>1)|(bits&0x100)|((bits&0x200)<<1)|((bits&0x400)>>>1);}

export class GenesisCore {
  static async create({onFrame=()=>{},onAudio=()=>{},wasmBinary}={}){
    const module=await createGenesis({wasmBinary:wasmBinary||await coreBinary(),print:()=>{},printErr:()=>{}});
    if(!module._rr_init())throw new Error('Genesis Plus GX kon niet starten.');
    return new GenesisCore(module,onFrame,onAudio);
  }
  constructor(module,onFrame,onAudio){Object.assign(this,{module,onFrame,onAudio,system:'md',build:GENESIS_BUILD,fps:60,statePointer:0,stateCapacity:0});}
  load(bytes,system='md',{overclock=100}={}){
    if(system!=='md')throw new Error('Dit systeem wordt nog niet ondersteund.');
    validateGenesisRom(bytes);validateOverclock(overclock);
    const m=this.module,p=m._malloc(bytes.length);
    if(!p)throw new Error('Niet genoeg geheugen voor deze Mega Drive-ROM.');
    try{m.FS.writeFile('/game.md',bytes);m.HEAPU8.set(bytes,p);if(!m._rr_load(p,bytes.length,overclock))throw new Error('Genesis Plus GX kon deze ROM niet laden.');this.fps=m._rr_frame_rate();this.overclock=overclock;}
    finally{m._free(p);}
  }
  run(p1,p2,replay=false){
    const m=this.module;
    if(!m._rr_frame(genesisPad(p1),genesisPad(p2)))throw new Error('Genesis Plus GX kon het frame niet uitvoeren.');
    if(replay)return;
    const w=m._rr_video_width(),h=m._rr_video_height();
    if(w&&h)this.onFrame(new Uint32Array(m.HEAPU8.buffer,m._rr_video_ptr(),w*h),w,h);
    const count=m._rr_audio_count(),samples=new Int16Array(m.HEAPU8.buffer,m._rr_audio_ptr(),count);
    for(let i=0;i<count;i+=2)this.onAudio(samples[i]/32768,samples[i+1]/32768);
  }
  save(){const m=this.module,n=m._rr_save();if(!n||n>2*1024*1024)throw new Error('Genesis Plus GX kon de speltoestand niet bewaren.');return m.HEAPU8.slice(m._rr_state_ptr(),m._rr_state_ptr()+n);}
  restore(state){
    if(!(state instanceof Uint8Array)||!state.length||state.length>2*1024*1024)throw new Error('Ongeldige Mega Drive-speltoestand.');
    const m=this.module;
    if(state.length>this.stateCapacity){m._free(this.statePointer);this.statePointer=m._malloc(state.length);this.stateCapacity=state.length;}
    m.HEAPU8.set(state,this.statePointer);
    if(!m._rr_restore(this.statePointer,state.length))throw new Error('Genesis Plus GX kon de speltoestand niet herstellen.');
  }
  destroy(){this.module._rr_destroy();this.module._free(this.statePointer);this.statePointer=this.stateCapacity=0;}
}
