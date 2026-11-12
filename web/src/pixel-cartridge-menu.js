// SPDX-License-Identifier: MIT
import {readPixelCartridges} from './pixel-cartridges.js';
import {PixelCartridgeLoader} from './pixel-helper.js';

export function createPixelCartridgeMenu({context,add,cancel,release,changed=()=>{}}) {
  const $=id=>document.getElementById(id),dialog=$('pixel-cartridges-dialog');
  let busy=false,generation=0,shownCore=null,loadState={phase:'idle'};
  const loader=new PixelCartridgeLoader({context,add,change:state=>{
    if(state.phase==='storage-unavailable'){$('pixel-cache-note').hidden=false;return;}
    loadState=state;renderHelper();changed();
    if(['missing','error'].includes(state.phase))open();
  }});
  function renderHelper(){
    $('pixel-helper-needed').hidden=loadState.phase!=='missing';
    $('pixel-helper-loading').hidden=loadState.phase!=='loading';
    $('pixel-helper-retry').hidden=!['missing','error'].includes(loadState.phase);
    $('pixel-helper-retry').textContent=loadState.phase==='missing'?'Extensie opnieuw controleren':'Opnieuw proberen';
    if(loadState.phase==='error')$('pixel-cartridge-error').textContent=loadState.error;
  }
  $('pixel-helper-retry').onclick=()=>{const request=context().waiting;if(request){$('pixel-cartridge-error').textContent='';dialog.close();void loader.request(request);}};
  function update(){
    const state=context(),enabled=!!state.core&&state.host&&state.system==='p8';
    $('pixel-cartridges-button').hidden=!enabled;
    if(!enabled){if(shownCore||loadState.phase!=='idle'){generation++;busy=false;shownCore=null;loader.cancel();}if(dialog.open)dialog.close();return;}
    if(shownCore!==state.core){generation++;busy=false;shownCore=state.core;loader.cancel();$('pixel-cartridge-error').textContent='';$('pixel-cache-note').hidden=true;}
    $('pixel-cartridge-files').disabled=busy||loadState.phase==='loading';
    $('pixel-cartridge-cancel').hidden=!state.waiting;
    $('pixel-cartridge-cancel').disabled=false;renderHelper();
    $('pixel-cartridge-request').textContent=state.waiting||'';
    $('pixel-cartridge-wait').hidden=!state.waiting;
    $('pixel-cartridge-count').textContent=`${state.files.length} cartridges geladen`;
    $('pixel-cartridge-list').replaceChildren(...state.files.map(file=>{const item=document.createElement('li');item.textContent=file.name;return item;}));
  }
  function open(){update();if(!shownCore)return;release();if(!dialog.open)dialog.showModal();}
  $('pixel-cartridges-button').onclick=open;
  $('pixel-cartridge-files').onchange=async event=>{
    if(busy||!shownCore)return;
    const files=event.target.files;if(!files.length)return;
    loader.cancel();const expected=shownCore,ticket=++generation;busy=true;update();$('pixel-cartridge-error').textContent='';
    try{
      const loaded=await readPixelCartridges(files);
      if(ticket!==generation||context().core!==expected)return;
      add(loaded);
    }catch(error){if(ticket===generation)$('pixel-cartridge-error').textContent=error.message;}
    finally{if(ticket===generation){busy=false;event.target.value='';update();}}
  };
  $('pixel-cartridge-cancel').onclick=()=>{generation++;busy=false;loader.cancel();cancel();dialog.close();};
  dialog.addEventListener('close',release);
  return {update,get loading(){return loadState.phase==='loading';},request(name){update();if(!name){loader.cancel();if(dialog.open)dialog.close();}else void loader.request(name);},close(){generation++;busy=false;loader.cancel();dialog.close();}};
}
