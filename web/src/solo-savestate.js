import {emptyDosInput} from './dos-input.js';

export function canUseSoloSavestates({core,game,isHost,roomId,peer,inviteConnection,mode,pausedMode}){
  return !!core&&core.supportsSavestates!==false&&!!game&&isHost&&!roomId&&!peer&&!inviteConnection&&mode!=='online'&&!(mode==='paused'&&pausedMode==='online');
}
export async function stageSavestate({CoreClass,game,state,isCurrent=()=>true,onProgress=()=>{}}){
  let candidate,preview;
  const check=()=>{if(!isCurrent())throw new DOMException('Geannuleerd','AbortError');};
  try{
    candidate=await CoreClass.create({onFrame:(frame,width,height)=>{preview={frame:frame.slice(),width,height};}});
    check();
    if(game.system==='dos')await candidate.restoreSolo(state,game.bytes,game,{isCurrent,onProgress});
    else{candidate.load(game.bytes,game.system,game);candidate.restore(state);}
    // DOS submits a buffered frame; two neutral frames replace the boot image
    // and release any keys that were held at the time of the checkpoint.
    for(let i=0;i<(game.system==='dos'?2:1);i++){
      check();candidate.run(0,0,false,game.system==='dos'?[emptyDosInput(),emptyDosInput()]:null);
    }
    check();
    if(!preview)throw new Error('De savestate leverde geen geldig gamebeeld op.');
    return {candidate,preview};
  }catch(error){candidate?.destroy?.();throw error;}
}
