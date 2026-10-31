import {PATCH_LIMITS,MAX_PATCH_BYTES,MAX_JSON_PATCH_BYTES,patchedFilename} from './patcher-core.js';
import {startPatchJob} from './patcher-job.js';

export function createGamePatcher({onOpen=()=>{}}={}) {
  const $=id=>document.getElementById(id),dialog=$('patcher-dialog');
  const source=$('patch-source-file'),patch=$('patch-file'),strip=$('patch-snes-header');
  let system=null,generation=0,job=null,busy=false,sourceInfo=null,downloadUrl=null;
  const names={nes:'NES',snes:'SNES',dos:'MS-DOS'};
  function status(message,error=false){$('patch-status').textContent=message;$('patch-status').classList.toggle('patch-error',error);}
  function clearResult(){
    if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=null;
    $('patch-result').hidden=true;$('patch-download').removeAttribute('href');
  }
  function updateButtons(){
    $('patch-apply').disabled=busy||!sourceInfo||!patch.files[0];
    $('patch-cancel').hidden=!busy;dialog.setAttribute('aria-busy',String(busy));
  }
  function invalidate(){
    generation++;job?.cancel();job=null;busy=false;sourceInfo=null;
    $('patch-source-details').textContent='';clearResult();updateButtons();return generation;
  }
  function validateFiles(file,patchFile){
    if(!file)throw new Error('Kies eerst je eigen originele bestand.');
    if(!file.size||file.size>PATCH_LIMITS[system]+(system==='snes'?512:0))throw new Error('Het originele bestand is leeg of te groot.');
    if(system==='nes'&&!/\.nes$/i.test(file.name))throw new Error('Kies een uitgepakte .nes-ROM.');
    if(system==='snes'&&!/\.(sfc|smc)$/i.test(file.name))throw new Error('Kies een uitgepakte .sfc- of .smc-ROM.');
    if(system==='dos'&&/\.(zip|dosz|7z|rar)$/i.test(file.name))throw new Error('Pak de DOS-game eerst uit. Kies het losse bestand dat de JSON-patch wijzigt, bijvoorbeeld GAME.EXE.');
    if(patchFile){
      if(!(system==='dos'?/\.json$/i:/\.(ips|bps)$/i).test(patchFile.name))throw new Error(system==='dos'?'Kies een .json-patch in het RetroRoom-formaat.':'Kies een .ips- of .bps-patch.');
      if(!patchFile.size||patchFile.size>(system==='dos'?MAX_JSON_PATCH_BYTES:MAX_PATCH_BYTES))throw new Error('De patch is leeg of te groot.');
    }
  }
  async function run(type){
    const ticket=invalidate(),file=source.files[0],patchFile=patch.files[0];
    if(!file){status('Kies je eigen originele bestand en je patch.');return;}
    try{
      validateFiles(file,patchFile);
      busy=true;updateButtons();status(type==='inspect'?'Origineel controleren…':'Patch toepassen…');
      const sourceBytes=await file.arrayBuffer();
      const patchBytes=type==='patch'?await patchFile.arrayBuffer():null;
      if(ticket!==generation)return;
      job=startPatchJob({type,system,source:sourceBytes,patch:patchBytes,format:patchFile?.name.split('.').pop().toLowerCase(),stripSnesHeader:strip.checked});
      const result=await job.promise;if(ticket!==generation)return;
      sourceInfo=type==='inspect'?result:result.source;
      $('patch-source-details').textContent=`Origineel voor patch: ${sourceInfo.size.toLocaleString('nl-NL')} bytes${sourceInfo.headerRemoved?' · kopieerheader verwijderd':''}\nCRC32: ${sourceInfo.crc32}\nSHA-256: ${sourceInfo.sha256}`;
      if(type==='patch'){
        downloadUrl=URL.createObjectURL(new Blob([result.bytes],{type:'application/octet-stream'}));
        const link=$('patch-download');link.href=downloadUrl;link.download=patchedFilename(file.name,system,strip.checked);
        $('patch-result-details').textContent=`${link.download} · ${result.size.toLocaleString('nl-NL')} bytes\nCRC32: ${result.crc32}\nSHA-256: ${result.sha256}`;
        $('patch-result').hidden=false;
        status(result.verified?'Klaar. Origineel en resultaat gecontroleerd.':'Klaar. IPS controleert de ROM-versie niet; test zelf of de hack goed werkt.');
      }else status('Origineel gelezen. Kies je patch en klik op Patch toepassen.');
    }catch(error){if(ticket===generation&&error.name!=='AbortError')status(error.message,true);}
    finally{if(ticket===generation){busy=false;job=null;updateButtons();}}
  }
  function reset(){
    invalidate();system=null;source.value='';patch.value='';strip.checked=false;
    $('patch-console-picker').hidden=false;$('patch-fields').hidden=true;
    status('Kies eerst voor welk systeem je wilt patchen.');
  }
  for(const original of document.querySelectorAll('#console-picker .console-tile')){
    const tile=original.cloneNode(true),value=tile.dataset.console;delete tile.dataset.console;
    tile.dataset.patchSystem=value;tile.setAttribute('aria-label',`${names[value]} patcher kiezen`);
    tile.querySelector('span').textContent=value==='dos'?'Los bestand · JSON-patch':'ROM · IPS / BPS';
    tile.onclick=()=>{
      invalidate();system=value;source.value='';patch.value='';strip.checked=false;
      $('patch-console-picker').hidden=true;$('patch-fields').hidden=false;
      $('patch-system-name').textContent=names[value];
      source.accept=value==='nes'?'.nes':value==='snes'?'.sfc,.smc':'';
      patch.accept=value==='dos'?'.json':'.ips,.bps';
      $('patch-source-label').textContent=value==='dos'?'1. Jouw originele DOS-bestand':'1. Jouw originele ROM';
      $('patch-format-note').textContent=value==='dos'?'RetroRoom JSON v1 · maximaal 4 MB':'IPS of BPS · maximaal 32 MB';
      $('patch-source-note').textContent=value==='dos'?'Los bestand, bijvoorbeeld .exe, .com of .dat · maximaal 32 MB':'Uitgepakte ROM · maximaal 8 MB (exclusief eventuele SNES-kopieerheader)';
      $('patch-snes-options').hidden=value!=='snes';strip.disabled=true;
      $('patch-dos-note').hidden=value!=='dos';$('patch-rom-note').hidden=value==='dos';
      status('Kies je eigen originele bestand en je patch.');$('patch-back').focus();
    };
    $('patch-console-picker').append(tile);
  }
  source.onchange=()=>{
    strip.checked=false;strip.disabled=system!=='snes'||source.files[0]?.size%1024!==512;
    void run('inspect');
  };
  patch.onchange=()=>void run('inspect');strip.onchange=()=>void run('inspect');
  $('patch-apply').onclick=()=>void run('patch');
  $('patch-cancel').onclick=()=>{invalidate();status('Geannuleerd. Kies je bestand opnieuw om verder te gaan.');};
  $('patch-back').onclick=()=>{reset();$('patch-console-picker button').focus();};
  dialog.addEventListener('close',reset);
  $('game-patcher-button').onclick=()=>{onOpen();reset();dialog.showModal();};
  reset();
}
