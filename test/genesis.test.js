import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GenesisCore,validateGenesisRom,genesisPad,GENESIS_BUILD} from '../web/src/genesis.js';
import {makeGenesisDemo} from '../scripts/demo-genesis.js';
import {RollbackSession,stateHash} from '../web/src/rollback.js';
import {encodeSavestate,decodeSavestate} from '../web/src/savestate.js';
import {romHash} from '../web/src/emulator.js';
import {cartridgeSystem} from '../web/src/mesen.js';
import {createGameConfig,verifyLocalRom,peerMessage} from '../web/src/protocol.js';
import {STREAM_VERSION} from '../web/src/stream-protocol.js';
import {defaultSettings,normalizeSettings,actionsFor,inputBits,assignBinding} from '../web/src/input.js';
import {applyGamePatch} from '../web/src/patcher-core.js';
import {ips} from './patcher-fixtures.js';

const wasmBinary=new Uint8Array(await readFile(new URL('../web/assets/genesis-core.wasm',import.meta.url)));
const create=options=>GenesisCore.create({wasmBinary,...options});
const ram=core=>{const p=core.module._rr_ram_ptr();return Array.from({length:40},(_,i)=>core.module.HEAPU8[p+(i^1)]);};
test('Mega Drive runs original homebrew with video, 48 kHz sound and all eight buttons on both ports',async()=>{
  let frames=0,samples=0,peak=0;
  const core=await create({onFrame:(p,w,h)=>{assert.equal(p.length,w*h);assert.ok([256,320].includes(w));assert.ok([192,224].includes(h));frames++;},onAudio:(l,r)=>{samples++;peak=Math.max(peak,Math.abs(l),Math.abs(r));}});
  core.load(makeGenesisDemo());for(let f=0;f<65;f++)core.run(0,0);
  assert.equal(frames,65);assert.ok(samples>51000&&samples<53000);assert.ok(peak>0.01);assert.ok(core.fps>59&&core.fps<61);
  const expected={0:[0,16,0],1:[16,0,0],8:[32,0,0],9:[0,0,4],10:[0,0,2],11:[0,0,1],2:[0,0,8],3:[0,32,0],4:[1,0,0],5:[2,0,0],6:[4,0,0],7:[8,0,0]};
  for(let player=0;player<2;player++)for(const [bit,value]of Object.entries(expected)){
    for(let f=0;f<3;f++)core.run(player===0?1<<bit:0,player===1?1<<bit:0);
    assert.deepEqual(ram(core).slice(player*4,player*4+3),value,`player ${player+1}, bit ${bit}`);
    assert.deepEqual(ram(core).slice((1-player)*4,(1-player)*4+3),[0,0,0]);
  }
  core.destroy();
});
for(const overclock of [100,500])test(`Mega Drive ${overclock}% cold restore and replay remain identical across both sides of the startup clock delay`,async()=>{
  let frame;
  const a=await create({onFrame:p=>frame=p.slice()}),b=await create();
  const rom=makeGenesisDemo();a.load(rom,'md',{overclock});b.load(rom,'md',{overclock});assert.deepEqual(a.save(),b.save());
  for(const checkpoint of [10,39,98,102,150]){
    a.load(rom,'md',{overclock});
    for(let f=0;f<checkpoint;f++)a.run(f%2?1:256,f%3?2:512);
    const state=a.save();
    for(let f=0;f<16;f++)a.run(f%2?1:2048,f%3?1024:4);
    const expected=stateHash(a.save()),video=stateHash(new Uint8Array(frame.buffer));
    a.restore(state);for(let f=0;f<16;f++)a.run(f%2?1:2048,f%3?1024:4);
    assert.equal(stateHash(a.save()),expected,`replay ${checkpoint}`);assert.equal(stateHash(new Uint8Array(frame.buffer)),video);
    b.load(rom,'md',{overclock});b.restore(state);for(let f=0;f<16;f++)b.run(f%2?1:2048,f%3?1024:4);
    assert.equal(stateHash(b.save()),expected,`cold restore ${checkpoint}`);
  }
  a.destroy();b.destroy();
});
test('Mega Drive rollback converges under delayed, reordered two-player input',async()=>{
  const a=await create(),b=await create(),rom=makeGenesisDemo();a.load(rom,'md',{overclock:500});b.load(rom,'md',{overclock:500});
  let left,right,clock=0;const queue=[];
  left=new RollbackSession(a,{player:1,send:m=>queue.push({to:right,m,at:clock+1+m.frame%6})});
  right=new RollbackSession(b,{player:2,send:m=>queue.push({to:left,m,at:clock+1+m.frame%7})});
  while(left.frame<180||right.frame<180){
    for(let i=queue.length-1;i>=0;i--)if(queue[i].at<=clock){const q=queue.splice(i,1)[0];q.to.receive(q.m.frame,q.m.buttons);}
    if(left.frame<180)left.tick(left.frame%3===0?1|1024:256);
    if(right.frame<180)right.tick(right.frame%5===0?2|2048:512);
    assert.ok(++clock<1000);
  }
  for(const q of queue)q.to.receive(q.m.frame,q.m.buttons);left.reconcile();right.reconcile();
  assert.ok(left.rollbacks&&right.rollbacks);assert.equal(stateHash(a.save()),stateHash(b.save()));assert.equal(left.hashAt(120),right.hashAt(120));
  a.destroy();b.destroy();
});
test('Mega Drive overclock adds CPU work without changing video cadence; PAL remains 50 Hz',async()=>{
  const core=await create(),rom=makeGenesisDemo({busy:true});
  const count=()=>{const r=ram(core);return r[34]*256+r[35];};
  const counts=[];let fps;
  for(const overclock of [100,200,300,400,500]){
    core.load(rom,'md',{overclock});for(let f=0;f<120;f++)core.run(0,0);
    const before=count();for(let f=0;f<10;f++)core.run(0,0);counts.push((count()-before+65536)%65536);
    fps??=core.fps;assert.equal(core.fps,fps);
  }
  assert.ok(counts[0]>0);assert.ok(counts[4]>counts[0]*3,JSON.stringify(counts));
  core.load(makeGenesisDemo({pal:true}));assert.ok(core.fps>49&&core.fps<51);core.destroy();
});
test('Mega Drive ROM matching, streaming metadata and local savestate containers use their own system/build',async()=>{
  const bytes=makeGenesisDemo(),game={name:'Mega Duo',bytes,hash:await romHash(bytes),system:'md',demo:true,overclock:100};
  assert.equal(cartridgeSystem(bytes,'Mega Duo.md'),'md');assert.equal(cartridgeSystem(bytes,'Mega Duo.bin'),'md');
  await verifyLocalRom(bytes,createGameConfig(game));const wrong=bytes.slice();wrong[0x210]^=1;await assert.rejects(verifyLocalRom(wrong,createGameConfig(game)),/overeen/);
  const token=crypto.randomUUID();assert.equal(peerMessage('control',{type:'stream-game',version:STREAM_VERSION,token,name:'Mega Duo',system:'md',overclock:100}).system,'md');
  const core=await create();core.load(bytes);for(let f=0;f<12;f++)core.run(1,0);const state=core.save();
  const file=await encodeSavestate(state,game,GENESIS_BUILD);assert.deepEqual((await decodeSavestate(file,game,GENESIS_BUILD)).state,state);
  assert.throws(()=>core.restore(new Uint8Array(50)));assert.throws(()=>core.restore(new Uint8Array(state.length)));core.destroy();
  for(const invalid of [new Uint8Array(512),bytes.subarray(0,511)])assert.throws(()=>validateGenesisRom(invalid));
});
test('Mega Drive profiles migrate independently and map the entire six-button controller',()=>{
  const old=defaultSettings();delete old.md;const settings=normalizeSettings(old);
  assert.equal(actionsFor('md').find(a=>a.bit===8).name,'C');assert.equal(actionsFor('md').find(a=>a.bit===2).name,'Mode');
  assert.equal(inputBits(settings.md[0],new Set(['KeyA','KeyS','KeyD','KeyF','KeyQ','KeyW']),null,'md'),0xf03);
  assignBinding(settings.md[0],'keyboard',8,'KeyZ');assert.equal(inputBits(settings.md[0],new Set(['KeyZ']),null,'md'),256);assert.deepEqual(settings.snes[0].keyboard[8],['KeyD']);
  const seen=new Set();for(const {bit}of actionsFor('md')){const mapped=genesisPad(1<<bit);assert.ok(mapped&&(mapped&(mapped-1))===0);assert.ok(!seen.has(mapped));seen.add(mapped);}
});

test('Mega Drive local savestates restore battery-backed SRAM into a fresh instance',async()=>{
  const a=await create(),b=await create(),rom=makeGenesisDemo({sram:true});a.load(rom);b.load(rom);
  for(let f=0;f<30;f++)a.run(0,0);
  const saved=a.save(),before=ram(a)[24];assert.ok(before>0);
  for(let f=0;f<9;f++)a.run(0,0);const expected=ram(a)[24];assert.notEqual(expected,before);
  b.restore(saved);for(let f=0;f<9;f++)b.run(0,0);assert.equal(ram(b)[24],expected);assert.equal(stateHash(b.save()),stateHash(a.save()));a.destroy();b.destroy();
});
test('Game patcher accepts Mega Drive IPS without mutating the source',async()=>{
  const source=makeGenesisDemo(),original=source.slice();
  const result=await applyGamePatch({system:'md',source,patch:ips([{at:0x120,data:new TextEncoder().encode('MY OWN DEMO')}]),format:'ips'});
  assert.deepEqual(source,original);assert.notDeepEqual(result.bytes,source);validateGenesisRom(result.bytes);
});
