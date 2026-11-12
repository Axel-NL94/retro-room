import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {cartridgeId,cartridgeUrl,allowedPage,downloadCartridge,toBase64,MAX_DOWNLOAD} from '../extensions/pico-helper/download.js';
import {PixelHelperBridge,PixelCartridgeLoader,PixelCartCache} from '../web/src/pixel-helper.js';
import {extensionPackage} from '../scripts/extension-package.js';
const image=()=>{const bytes=new Uint8Array(33);bytes.set([137,80,78,71,13,10,26,10],0);bytes.set([73,72,68,82],12);const v=new DataView(bytes.buffer);v.setUint32(16,160);v.setUint32(20,205);return bytes;};
const file=()=>({name:'part2.p8.png',bytes:image()});
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test('helper accepts only the official page, bounded IDs and matching fixed Lexaloffle data links',()=>{
 assert.equal(allowedPage('https://axel-nl94.github.io/retro-room/#room=secret'),true);
 for(const url of ['http://axel-nl94.github.io/retro-room/','https://evil.test/retro-room/','https://axel-nl94.github.io/retro-room-other/','https://axel-nl94.github.io/another/'])assert.equal(allowedPage(url),false);
 assert.equal(cartridgeId('Part-2'),'part-2');
 for(const id of ['#test','../test','test?url=https://evil.test','',null,'x'.repeat(65)])assert.throws(()=>cartridgeId(id));
 assert.equal(cartridgeUrl('<a href="/bbs/cposts/pa/part2-3.p8.png">cart</a>','part2'),'https://www.lexaloffle.com/bbs/cposts/pa/part2-3.p8.png');
 for(const url of ['https://evil.test/bbs/cposts/pa/part2.p8.png','https://www.lexaloffle.com.evil.test/bbs/cposts/pa/part2.p8.png','https://user@www.lexaloffle.com/bbs/cposts/pa/part2.p8.png','/bbs/cposts/pa/part2.p8.png?x=1','/bbs/cposts/pa/other.p8.png','javascript:alert(1)','/bbs/cposts/pa/part2.p8.png#x'])assert.throws(()=>cartridgeUrl(`<a href="${url}">cart</a>`,'part2'));
});
test('download performs bounded credential-free fixed-host GETs and validates PNG dimensions',async()=>{
 const calls=[];const fetcher=async(url,options)=>{calls.push({url,options});return calls.length===1?new Response('<a href="/bbs/cposts/pa/part2-1.p8.png">cart</a>'):new Response(image());};
 const result=await downloadCartridge('PART2',{fetcher});assert.equal(result.id,'part2');assert.deepEqual(result.bytes,image());
 assert.equal(calls.length,2);assert.ok(calls[0].url.endsWith('?cid=part2'));
 assert.ok(calls.every(c=>c.options.credentials==='omit'&&c.options.redirect==='error'&&c.options.referrerPolicy==='no-referrer'));
 await assert.rejects(downloadCartridge('part2',{fetcher:async()=>new Response('x',{headers:{'content-length':'9999999'}})}),/too-large/);
 await assert.rejects(downloadCartridge('part2',{fetcher:async()=>new Response(new Uint8Array(512*1024+1))}),/too-large/);
 let count=0;await assert.rejects(downloadCartridge('part2',{fetcher:async()=>++count===1?new Response('<a href="/bbs/cposts/pa/part2.p8.png">x</a>'):new Response('not png')}),/invalid-cartridge/);
});
class Page extends EventTarget {
 constructor(reply){super();this.location={origin:'https://axel-nl94.github.io'};this.reply=reply;this.messages=[];}
 postMessage(message,origin){this.messages.push(message);assert.equal(origin,this.location.origin);queueMicrotask(()=>{if(message.type!=='cancel')this.reply?.(message,this);});}
 respond(request,result,{origin=this.location.origin,source=this}={}){const e=new Event('message');Object.assign(e,{source,origin,data:{channel:'retroroom-pico-helper-1',type:'reply',request,result}});this.dispatchEvent(e);}
}
test('page bridge rejects foreign replies, requires the handshake and validates downloaded bytes',async()=>{
 const page=new Page((m,p)=>{p.respond(m.request,{ok:true,protocol:1},{origin:'https://evil.test'});p.respond('old',{ok:true,protocol:1});
  p.respond(m.request,m.type==='ping'?{ok:true,protocol:1}:{ok:true,id:'part2',base64:toBase64(image())});});
 const bridge=new PixelHelperBridge(page);assert.equal(await bridge.available(),true);assert.deepEqual(await bridge.download('#part2'),file());
 const controller=new AbortController(),blocked=new PixelHelperBridge(new Page());const pending=blocked.download('#part2',{signal:controller.signal});controller.abort();await assert.rejects(pending,{name:'AbortError'});
 assert.equal(blocked.target.messages.at(-1).type,'cancel');
 await assert.rejects(new PixelHelperBridge(new Page((m,p)=>p.respond(m.request,{ok:true,id:'wrong',base64:'AAAA'}))).download('#part2'),/invalid-cartridge/);
 assert.equal(await new PixelHelperBridge(new Page()).available({timeout:5}),false);
 const bytes=new Uint8Array(MAX_DOWNLOAD);bytes.set(image());
 const large=new PixelHelperBridge(new Page((m,p)=>p.respond(m.request,{ok:true,id:'part2',base64:toBase64(bytes)})));
 assert.equal((await large.download('#part2')).bytes.length,MAX_DOWNLOAD,'large valid messages do not overflow a regex stack');
});
function loaderFixture({available=true,cached=null,put=true,download=async()=>file()}={}){
 let current={core:{},waiting:'#part2'},lookups=0,provided=0,stored=0,states=[];
 const cache={get:async()=>cached,put:async()=>{stored++;return put;},remove:async()=>{}};
 const loader=new PixelCartridgeLoader({context:()=>current,cache,bridge:{available:async()=>{lookups++;return available;},download},add:()=>{provided++;current.waiting='';loader.cancel();},change:s=>states.push(s.phase)});
 return {loader,states,get lookups(){return lookups;},get provided(){return provided;},get stored(){return stored;},replace(){current={core:{},waiting:'#part2'};}};
}
test('cache hit needs no extension; missing helper gives the installation state without resetting a VM',async()=>{
 const cached=loaderFixture({cached:file()});await cached.loader.request('#part2');assert.equal(cached.provided,1);assert.equal(cached.lookups,0);
 const missing=loaderFixture({available:false});await missing.loader.request('#part2');assert.equal(missing.provided,0);assert.equal(missing.loader.state.phase,'missing');
});
test('download is parsed before caching, cache quota failure leaves the game running, and late replies are discarded',async()=>{
 const loaded=loaderFixture({put:false});await loaded.loader.request('#part2');assert.equal(loaded.provided,1);assert.equal(loaded.stored,1);assert.ok(loaded.states.includes('storage-unavailable'));
 let complete;const late=loaderFixture({download:()=>new Promise(resolve=>{complete=resolve;})});const pending=late.loader.request('#part2');await tick();late.replace();complete(file());await pending;
 assert.equal(late.provided,0);assert.equal(late.stored,0);
 const cancelled=loaderFixture({download:()=>Promise.reject(new Error('not-found'))});await cancelled.loader.request('#part2');assert.equal(cancelled.loader.state.phase,'error');assert.match(cancelled.loader.state.error,/Lexaloffle/);
});
test('blocked browser storage fails open without storing cartridges in cookies/localStorage',async()=>{
 const cache=new PixelCartCache({open(){throw new Error('blocked');}});assert.equal(await cache.get('#part2'),null);assert.equal(await cache.put('#part2',file()),false);
});
test('content bridge is idempotent, origin-gated and exposes only ID-based downloads',async()=>{
 const source=await readFile(new URL('../extensions/pico-helper/content.js',import.meta.url),'utf8');
 const listeners=[],sent=[],replies=[];const window={addEventListener:(k,fn)=>listeners.push(fn),postMessage:x=>replies.push(x)};window.top=window;
 const location={origin:'https://axel-nl94.github.io',pathname:'/retro-room/'};
 const chrome={runtime:{sendMessage:async x=>{sent.push(x);return {ok:true,protocol:1};}}};
 const context={window,location,chrome};runInNewContext(source,context);runInNewContext(source,context);assert.equal(listeners.length,1);
 const request=crypto.randomUUID(),data={channel:'retroroom-pico-helper-1',type:'get',request,id:'part2'};
 await listeners[0]({source:window,origin:'https://evil.test',data});await listeners[0]({source:window,origin:location.origin,data:{...data,id:'https://evil.test'}});assert.equal(sent.length,0);
 await listeners[0]({source:window,origin:location.origin,data});assert.equal(sent.length,1);assert.equal(sent[0].id,'part2');assert.equal(replies.length,1);
});
test('download package is deterministic, contains complete source/license, and requests no all-sites/camera/cookie permission',async()=>{
 const root=new URL('../',import.meta.url).pathname,zip=await extensionPackage(root);assert.deepEqual(zip,await extensionPackage(root));
 assert.equal(zip.readUInt32LE(0),0x04034b50);const names=[];let offset=0;
 while(zip.readUInt32LE(offset)===0x04034b50){const size=zip.readUInt32LE(offset+18),length=zip.readUInt16LE(offset+26);names.push(zip.subarray(offset+30,offset+30+length).toString());offset+=30+length+size;}
 for(const name of ['manifest.json','background.js','content.js','download.js','LICENSE','README.md'])assert.ok(names.includes(name));
 const manifest=JSON.parse(await readFile(root+'extensions/pico-helper/manifest.json','utf8'));
 assert.deepEqual(manifest.host_permissions,['https://www.lexaloffle.com/*','https://lexaloffle.com/*']);assert.deepEqual(manifest.permissions,['activeTab','scripting']);assert.equal(manifest.manifest_version,3);
});

test('background worker gates sender identity/frame/path, validates IDs, aborts jobs and activates only RetroRoom tabs',async()=>{
 const source=(await readFile(new URL('../extensions/pico-helper/background.js',import.meta.url),'utf8')).replace(/^import .*;\n/m,'');
 let handler,removed,clicked,complete,downloads=0,injections=0,aborted=false;
 const chrome={runtime:{id:'this-extension',onMessage:{addListener:fn=>{handler=fn;}}},tabs:{onRemoved:{addListener:fn=>{removed=fn;}}},action:{onClicked:{addListener:fn=>{clicked=fn;}}},scripting:{executeScript:async()=>injections++}};
 const fakeDownload=(id,{signal})=>{downloads++;signal.addEventListener('abort',()=>{aborted=true;});return new Promise(resolve=>{complete=()=>resolve({id,bytes:image()});});};
 runInNewContext(source,{chrome,allowedPage,cartridgeId,downloadCartridge:fakeDownload,toBase64,AbortController,setTimeout,clearTimeout,URL});
 const sender={id:'this-extension',frameId:0,tab:{id:1},url:'https://axel-nl94.github.io/retro-room/#room=private'};
 const request=crypto.randomUUID(),message={type:'get',id:'part2',request};const replies=[];
 for(const change of [{id:'other-extension'},{frameId:1},{url:'https://evil.test/retro-room/'},{url:'https://axel-nl94.github.io/other/'}])handler(message,{...sender,...change},r=>replies.push(r));
 assert.equal(downloads,0);assert.equal(replies.length,0);
 handler({...message,id:'https://evil.test'},sender,r=>replies.push(r));assert.equal(replies.pop().error,'invalid-id');
 assert.equal(handler(message,sender,r=>replies.push(r)),true);assert.equal(downloads,1);
 handler({...message,request:crypto.randomUUID()},sender,r=>replies.push(r));assert.equal(replies.pop().error,'busy');
 handler({type:'cancel',request:crypto.randomUUID()},sender,()=>{});assert.equal(aborted,false);
 handler({type:'cancel',request},sender,()=>{});assert.equal(aborted,true);complete();await tick();
 await clicked({id:1,url:'https://evil.test/'});assert.equal(injections,0);await clicked({id:1,url:sender.url});assert.equal(injections,1);
 handler({...message,request:crypto.randomUUID()},sender,()=>{});removed(1);complete();await tick();
});
