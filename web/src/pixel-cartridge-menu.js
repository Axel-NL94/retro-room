// SPDX-License-Identifier: MIT
import {readPixelCartridges} from './pixel-cartridges.js';

export function createPixelCartridgeMenu({context,add,cancel,release}) {
  const $=id=>document.getElementById(id),dialog=$('pixel-cartridges-dialog');
  let busy=false,generation=0,shownCore=null;
  function update(){
    const state=context(),enabled=!!state.core&&state.host&&state.system==='p8';
    $('pixel-cartridges-button').hidden=!enabled;
    if(!enabled){generation++;busy=false;shownCore=null;if(dialog.open)dialog.close();return;}
    if(shownCore!==state.core){generation++;busy=false;shownCore=state.core;$('pixel-cartridge-error').textContent='';}
    $('pixel-cartridge-files').disabled=busy;
    $('pixel-cartridge-cancel').hidden=!state.waiting;
    $('pixel-cartridge-cancel').disabled=busy;
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
    const expected=shownCore,ticket=++generation;busy=true;update();$('pixel-cartridge-error').textContent='';
    try{
      const loaded=await readPixelCartridges(files);
      if(ticket!==generation||context().core!==expected)return;
      add(loaded);
    }catch(error){if(ticket===generation)$('pixel-cartridge-error').textContent=error.message;}
    finally{if(ticket===generation){busy=false;event.target.value='';update();}}
  };
  $('pixel-cartridge-cancel').onclick=()=>{if(!busy){cancel();dialog.close();}};
  dialog.addEventListener('close',release);
  return {update,request(name){update();if(name)open();},close(){generation++;busy=false;dialog.close();}};
}
