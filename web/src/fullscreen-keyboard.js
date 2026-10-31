// Escape capture is optional. Unsupported/denied browsers retain their own exit
// shortcut; a user-selected DOS-Escape alias remains usable without a lock.
export function createFullscreenKeyboard({keyboard,active,onStatus=()=>{}}) {
  let generation=0;
  return {
    async acquire(){
      const request=++generation;
      if(!keyboard?.lock||!active()){onStatus(false);return false;}
      try{
        await keyboard.lock(['Escape']);
        if(request!==generation||!active()){keyboard.unlock?.();return false;}
        onStatus(true);return true;
      }catch{if(request===generation)onStatus(false);return false;}
    },
    release(){generation++;keyboard?.unlock?.();onStatus(false);}
  };
}
