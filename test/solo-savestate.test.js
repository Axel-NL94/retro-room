import test from 'node:test';
import assert from 'node:assert/strict';
import {canUseSoloSavestates,stageSavestate} from '../web/src/solo-savestate.js';
import {encodeDosSoloState,decodeDosSoloState,DOS_SOLO_STATE_LIMIT} from '../web/src/dos-savestate.js';
import {encodeSavestate,decodeSavestate} from '../web/src/savestate.js';
import {DOS_BUILD} from '../web/src/dos.js';
import {translate} from '../web/src/i18n.js';
import {readFileSync} from 'node:fs';
const native=()=>new Uint8Array(32).fill(7),bytes=text=>new TextEncoder().encode(text);

test('DOS save/import is available for solo and paused solo, never a room, host stream or guest',()=>{
  const base={core:{},game:{system:'dos'},isHost:true,roomId:null,peer:null,inviteConnection:null,mode:'solo',pausedMode:null};
  assert.equal(canUseSoloSavestates(base),true);assert.equal(canUseSoloSavestates({...base,mode:'paused',pausedMode:'solo'}),true);
  for(const patch of [{roomId:'room'},{peer:{}},{inviteConnection:{}},{isHost:false},{core:null},{game:null},{mode:'online'},{mode:'paused',pausedMode:'online'}])assert.equal(canUseSoloSavestates({...base,...patch}),false);
});
test('DOS container round-trips native state, launch path and disk files without game bytes',()=>{
  const files=[{name:'game.pure.zip',bytes:bytes('save disk')},{name:'sub/config.dbp',bytes:bytes('config')}];
  const result=decodeDosSoloState(encodeDosSoloState(native(),files,'C:\\SUB\\DUO.COM -x','zip'));
  assert.deepEqual(result,{native:native(),files,program:'C:\\SUB\\DUO.COM -x',extension:'zip'});
});
test('DOS containers reject truncated data, traversal, duplicate paths, collisions and oversized disks',()=>{
  const value=encodeDosSoloState(native(),[{name:'game.pure.zip',bytes:bytes('disk')}],'','com');
  for(const broken of [new Uint8Array(),value.subarray(0,8),value.subarray(0,value.length-1),new Uint8Array(value.length+1)])assert.throws(()=>decodeDosSoloState(broken));
  for(const name of ['../x','/x','sub/../x','sub\\x','sub//x','x\0y','.','..'])assert.throws(()=>encodeDosSoloState(native(),[{name,bytes:bytes('x')}],'','zip'));
  for(const names of [['a','a'],['a','a/b']])assert.throws(()=>encodeDosSoloState(native(),names.map(name=>({name,bytes:bytes('x')})),'','zip'));
  assert.throws(()=>encodeDosSoloState(native(),[{name:'x',bytes:new Uint8Array(32*1024*1024+1)}],'','zip'),/te groot/);
  assert.throws(()=>encodeDosSoloState(native(),[],'x\ncommand','zip'));
  assert.throws(()=>encodeDosSoloState(native(),[],'','js'));
  assert.ok(DOS_SOLO_STATE_LIMIT<100*1024*1024);
});
test('DOS .rrstate checks exact game, build, CPU and container integrity before native restore',async()=>{
  const game={system:'dos',hash:'a'.repeat(64),overclock:500,name:'same.zip'};
  const state=encodeDosSoloState(native(),[],'','zip'),file=await encodeSavestate(state,game,DOS_BUILD);
  assert.deepEqual((await decodeSavestate(file,game,DOS_BUILD)).state,state);
  await assert.rejects(()=>decodeSavestate(file,{...game,hash:'b'.repeat(64)},DOS_BUILD),/andere ROM/);
  await assert.rejects(()=>decodeSavestate(file,game,'old-dos-build'),/emulatorversie/);
  await assert.rejects(()=>decodeSavestate(file,{...game,overclock:100},DOS_BUILD),/500% CPU/);
  const corrupt=file.slice();corrupt[corrupt.length-1]^=1;await assert.rejects(()=>decodeSavestate(corrupt,game,DOS_BUILD),/beschadigd/);
});
test('failed, cancelled and image-less staging instances are destroyed and never returned',async()=>{
  for(const kind of ['restore','cancel','frame']){
    let destroyed=0,current=true;
    const candidate={restoreSolo:async()=>{if(kind==='restore')throw Error('restore failed');if(kind==='cancel')current=false;},run(){},destroy(){destroyed++;}};
    await assert.rejects(()=>stageSavestate({CoreClass:{create:async()=>candidate},game:{system:'dos'},state:new Uint8Array(),isCurrent:()=>current}));
    assert.equal(destroyed,1,kind);
  }
});
test('DOS checkpoint notes, errors and recovery statuses are translated into English',()=>{
  for(const file of ['dos-savestate.js','solo-savestate.js','dos.js']){
    const code=readFileSync(new URL('../web/src/'+file,import.meta.url),'utf8');
    for(const match of code.matchAll(/new Error\('([^']+)'\)/g))assert.notEqual(translate(match[1]),match[1],match[1]);
  }
  assert.equal(translate('DOS-omgeving voorbereiden…'),'Preparing DOS environment…');
  assert.equal(translate('Je DOS-voortgang is geladen.'),'Your DOS progress has been loaded.');
});
