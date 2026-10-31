import {applyGamePatch,inspectPatchSource} from './patcher-core.js';
self.onmessage=async ({data})=>{
  try{
    const options={...data,source:new Uint8Array(data.source)};
    if(data.type==='inspect')self.postMessage({result:await inspectPatchSource(options)});
    else if(data.type==='patch'){
      const result=await applyGamePatch({...options,patch:new Uint8Array(data.patch)});
      self.postMessage({result},[result.bytes.buffer]);
    }else throw new Error('Onbekende patchopdracht.');
  }catch(error){self.postMessage({error:error?.message||'Het patchen is niet gelukt.'});}
};
