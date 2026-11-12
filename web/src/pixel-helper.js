// SPDX-License-Identifier: MIT
import {validatePixelCart} from './pixel-cartridges.js';
const CHANNEL = 'retroroom-pico-helper-1', MAX_BYTES = 4 * 1024 * 1024;
const idOf = request => typeof request === 'string' && /^#[a-z0-9_-]{1,64}$/i.test(request) ? request.slice(1).toLowerCase() : null;
export class PixelHelperBridge {
  constructor(target = globalThis.window) { this.target = target; }
  call(type,id,{signal,timeout = type === 'ping' ? 1200 : 30000} = {}) {
    return new Promise((resolve,reject) => {
      const target = this.target, request = crypto.randomUUID(); let timer;
      const finish = (error,result) => { clearTimeout(timer); target.removeEventListener('message',receive); signal?.removeEventListener('abort',abort); error ? reject(error) : resolve(result); };
      const abort = () => { target.postMessage({channel:CHANNEL,type:'cancel',request},target.location.origin); finish(new DOMException('Cancelled','AbortError')); };
      const receive = event => {
        if (event.source !== target || event.origin !== target.location.origin || event.data?.channel !== CHANNEL ||
            event.data.type !== 'reply' || event.data.request !== request) return;
        finish(null,event.data.result);
      };
      if (signal?.aborted) { reject(new DOMException('Cancelled','AbortError')); return; }
      target.addEventListener('message',receive); signal?.addEventListener('abort',abort,{once:true});
      timer = setTimeout(() => { target.postMessage({channel:CHANNEL,type:'cancel',request},target.location.origin); finish(new Error('unavailable')); },timeout);
      target.postMessage({channel:CHANNEL,type,request,...(id ? {id} : {})},target.location.origin);
    });
  }
  async available(options) { try { const result = await this.call('ping',null,options); return result?.ok === true && result.protocol === 1; } catch(error) { if(error.name === 'AbortError')throw error; return false; } }
  async download(request,options) {
    const id = idOf(request); if (!id) throw new Error('invalid-id');
    const result = await this.call('get',id,options);
    if (result?.ok !== true) throw new Error(['busy','rate-limit','cancelled','not-found','too-large','invalid-cartridge'].includes(result?.error) ? result.error : 'download-failed');
    if (result.id !== id || typeof result.base64 !== 'string' || !result.base64 || result.base64.length > Math.ceil(MAX_BYTES/3)*4 ||
        (result.base64.length%4!==0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(result.base64))) throw new Error('invalid-cartridge');
    const bytes = Uint8Array.from(atob(result.base64),character => character.charCodeAt(0));
    if (bytes.length > MAX_BYTES) throw new Error('too-large');
    validatePixelCart(bytes,id+'.p8.png'); return {name:id+'.p8.png',bytes};
  }
}
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
export class PixelCartCache {
  constructor(indexedDB) {
    if(arguments.length===0)try{indexedDB=globalThis.indexedDB;}catch{ /* Storage access can be denied. */ }
    this.indexedDB = indexedDB;
  }
  open() {
    if (!this.indexedDB) return Promise.resolve(null);
    return this.pending ||= new Promise(resolve => {
      let finished = false; const done = db => { if(finished){db?.close();return;}finished=true;clearTimeout(timer);resolve(db); };
      const timer = setTimeout(()=>done(null),2000);
      try {
        const request = this.indexedDB.open('retroroom-pico-cartridges',1);
        request.onupgradeneeded = () => request.result.createObjectStore('carts',{keyPath:'id'});
        request.onsuccess = () => { const db=request.result;db.onversionchange=()=>{db.close();this.pending=null;};done(db); };
        request.onerror = request.onblocked = () => done(null);
      } catch { done(null); }
    });
  }
  async transaction(mode,operation) {
    const db = await this.open(); if(!db)return null;
    return new Promise(resolve => {
      let result=null,tx,finished=false;
      const done=value=>{if(finished)return;finished=true;clearTimeout(timer);resolve(value);};
      const timer=setTimeout(()=>{try{tx?.abort();}catch{}done(null);},2000);
      try {
        tx=db.transaction('carts',mode);
        tx.oncomplete=()=>done(result);tx.onerror=tx.onabort=()=>done(null);
        operation(tx.objectStore('carts'),value=>{result=value;});
      } catch { done(null); }
    });
  }
  async get(request) {
    const id=idOf(request);if(!id)return null;
    const record=await this.transaction('readonly',(store,set)=>{const job=store.get(id);job.onsuccess=()=>set(job.result);});
    try {
      if(!record||!(record.bytes instanceof ArrayBuffer)||record.bytes.byteLength>MAX_BYTES)return null;
      const bytes=new Uint8Array(record.bytes);validatePixelCart(bytes,id+'.p8.png');
      if(record.hash!==await digest(bytes)){await this.remove(request);return null;}
      return {name:id+'.p8.png',bytes};
    } catch { await this.remove(request);return null; }
  }
  async put(request,file) {
    const id=idOf(request);if(!id||file.bytes.length>MAX_BYTES)return false;
    const bytes=file.bytes.slice().buffer,hash=await digest(bytes);
    return !!await this.transaction('readwrite',(store,set)=>{
      const job=store.getAll();job.onsuccess=()=>{
        const others=job.result.filter(record=>record.id!==id).sort((a,b)=>a.savedAt-b.savedAt);
        let size=others.reduce((n,r)=>n+(r.bytes?.byteLength||0),0)+bytes.byteLength;
        while(others.length&&(size>64*1024*1024||others.length>=128)){const old=others.shift();size-=old.bytes?.byteLength||0;store.delete(old.id);}
        store.put({id,bytes,hash,savedAt:Date.now()});set(true);
      };
    });
  }
  async remove(request){const id=idOf(request);if(id)await this.transaction('readwrite',(store,set)=>{store.delete(id);set(true);});}
}
export function helperError(error) {
  if(error?.message==='not-found')return 'Deze vervolgcartridge is niet beschikbaar bij Lexaloffle.';
  if(error?.message==='busy'||error?.message==='rate-limit')return 'De extensie is nog bezig. Wacht even en probeer opnieuw.';
  if(error?.message==='too-large'||error?.message==='invalid-cartridge')return 'De gedownloade cartridge is ongeldig of te groot.';
  return 'De cartridge kon niet worden gedownload. Controleer je verbinding en probeer opnieuw.';
}
export class PixelCartridgeLoader {
  constructor({context,add,change,cache=new PixelCartCache(),bridge=new PixelHelperBridge()}) {
    Object.assign(this,{context,add,change,cache,bridge,generation:0,state:{phase:'idle'}});
  }
  stateTo(phase,extra={}){this.state={phase,...extra};this.change(this.state);}
  cancel(){this.generation++;this.controller?.abort();this.controller=null;this.stateTo('idle');}
  async request(name) {
    this.cancel();if(!name)return;
    const core=this.context().core, id=idOf(name);if(!core||!id)return;
    const ticket=this.generation,controller=this.controller=new AbortController();
    const current=()=>ticket===this.generation&&this.context().core===core&&this.context().waiting===name;
    this.stateTo('loading',{request:name});
    try {
      const cached=await this.cache.get(name);if(!current())return;
      if(cached){
        try{this.add([cached]);if(current())this.stateTo('error',{error:'De cartridge kon niet worden geladen.'});return;}
        catch{await this.cache.remove(name);if(!current())return;}
      }
      if(!await this.bridge.available({signal:controller.signal})){if(current())this.stateTo('missing',{request:name});return;}
      if(!current())return;
      const file=await this.bridge.download(name,{signal:controller.signal});if(!current())return;
      this.add([file]);
      // add() synchronously clears the VM request and cancels its UI task. The
      // successfully parsed cartridge can still be committed to persistent cache.
      const saved=await this.cache.put(name,file);
      if(this.context().core===core&&!saved)this.change({phase:'storage-unavailable'});
    } catch(error){if(current()&&error.name!=='AbortError')this.stateTo('error',{request:name,error:helperError(error)});}
  }
}
