import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {PixelM8Core,validatePixelCart,pixelPad} from '../web/src/pixel-m8.js';
import {makePixelDemo} from '../scripts/demo-pixel-m8.js';
import {crc32} from '../web/src/patcher-core.js';
import {cartridgeSystem} from '../web/src/mesen.js';
import {defaultSettings,normalizeSettings,actionsFor,inputBits,assignBinding} from '../web/src/input.js';
import {canUseSoloSavestates} from '../web/src/solo-savestate.js';
import {STREAM_VERSION,streamMessage} from '../web/src/stream-protocol.js';
import {createGameConfig} from '../web/src/protocol.js';

const wasmBinary=new Uint8Array(await readFile(new URL('../web/assets/pico-core.wasm',import.meta.url)));
const create=options=>PixelM8Core.create({wasmBinary,...options});
const cart=lua=>new TextEncoder().encode('pico-8 cartridge // original RetroRoom test\nversion 42\n__lua__\n'+lua+'\n');
const verify=(core,expr)=>assert.equal(core.stringCall('_pc_verify',expr),1,expr);
class Storage {
  data=new Map();get length(){return this.data.size;}
  key(index){return [...this.data.keys()][index];}getItem(key){return this.data.get(key)??null;}
  setItem(key,value){this.data.set(key,value);}
}
// Original, uncompressed RGBA cartridge fixture. Each pixel embeds one byte.
function pngCart(code){
  const memory=Buffer.alloc(160*205);memory.write(code,0x4300);memory[0x8000]=42;
  const rows=Buffer.alloc(205*(160*4+1));
  for(let y=0;y<205;y++)for(let x=0;x<160;x++){
    const b=memory[y*160+x],at=y*641+1+x*4;
    rows[at]=(b>>>4)&3;rows[at+1]=(b>>>2)&3;rows[at+2]=b&3;rows[at+3]=252|((b>>>6)&3);
  }
  const chunk=(name,data)=>{const body=Buffer.concat([Buffer.from(name),data]),head=Buffer.alloc(4),sum=Buffer.alloc(4);head.writeUInt32BE(data.length);sum.writeUInt32BE(crc32(body));return Buffer.concat([head,body,sum]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(160);header.writeUInt32BE(205,4);header[8]=8;header[9]=6;
  return new Uint8Array(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]));
}

test('Pixel-M8 runs original demo with square video, audible continuously resampled audio and two independent ports',async()=>{
  let frames=0,samples=0,peak=0,colors=new Set();
  const core=await create({onFrame:(p,w,h)=>{assert.equal(w,128);assert.equal(h,128);assert.equal(p.length,16384);frames++;colors=new Set(p);},onAudio:(l,r)=>{assert.equal(l,r);assert.ok(Math.abs(l)<=1);samples++;peak=Math.max(peak,Math.abs(l));}});
  core.load(makePixelDemo(),'p8',{name:'Pixel Duo.p8'});
  for(let i=0;i<120;i++)core.run(i===20?1:0,i>30?128:0);
  assert.equal(frames,120);assert.ok(colors.size>=4);assert.ok(Math.abs(samples-96000)<=3);assert.ok(peak>0.01);
  verify(core,'x[1]==32 and x[2]==116 and score==1');core.destroy();
});

test('Pixel-M8 forwards every direction/O/X to the proper player and releases inputs',async()=>{
  const core=await create();core.load(cart('function _update60() a=btn(0) b=btn(0,1) end'),'p8');
  for(let player=0;player<2;player++)for(const [bit,native] of [[6,1],[7,2],[4,4],[5,8],[0,16],[1,32]]){
    core.run(player===0?1<<bit:0,player===1?1<<bit:0);
    // Read btn masks directly through the core's read-only expression verifier.
    verify(core,`btn(${Math.log2(native)},${player}) and not btn(${Math.log2(native)},${1-player})`);
  }
  core.run(0,0);verify(core,'btn()==0');core.destroy();
});

test('Pixel-M8 accepts original text and PNG cartridges, keeps 30/60 Hz updates, and rejects bad containers',async()=>{
  const core=await create();
  const png=pngCart('n=0 function _update() n+=1 end function _draw() cls(8) end');
  assert.equal(cartridgeSystem(png,'homebrew.p8.png'),'p8');core.load(png,'p8',{name:'homebrew.p8.png'});
  for(let i=0;i<60;i++)core.run(0,0);verify(core,'n==30');
  core.load(cart('n=0 function _update60() n+=1 end'),'p8');for(let i=0;i<60;i++)core.run(0,0);verify(core,'n==60');
  for(const [bytes,name] of [[new Uint8Array(12),'x.p8'],[makePixelDemo(),'x.p8.png'],[new Uint8Array(9*1024*1024),'x.p8'],[makePixelDemo(),'x.exe']])assert.throws(()=>validatePixelCart(bytes,name));
  assert.throws(()=>core.load(makePixelDemo(),'p8',{overclock:500}));
  assert.throws(()=>core.run(0,0,true),/rollback/);core.destroy();
});

test('Pixel-M8 cartdata persists across fresh instances without storing a cartridge; blocked storage remains playable',async()=>{
  const storage=new Storage(),first=await create({storage});
  first.load(makePixelDemo(),'p8',{name:'Pixel Duo.p8'});first.run(1,0);first.run(0,0);first.run(0,2);first.destroy();
  assert.equal(storage.length,1);assert.equal(JSON.parse([...storage.data.values()][0]).length,268);
  const second=await create({storage});second.load(makePixelDemo(),'p8',{name:'Pixel Duo.p8'});second.run(0,0);verify(second,'score==2');
  second.load(cart('cartdata("another_test_id") n=dget(0) function _update60() end'),'p8');second.run(0,0);verify(second,'n==0');second.destroy();
  const third=await create({storage});third.load(makePixelDemo(),'p8',{name:'Pixel Duo.p8'});third.run(0,0);verify(third,'score==2');third.destroy();
  const blocked=await create({storage:{get length(){throw new Error('blocked');},setItem(){throw new Error('quota');}}});
  blocked.load(makePixelDemo(),'p8',{name:'Pixel Duo.p8'});for(let i=0;i<61;i++)blocked.run(i===1?1:0,0);blocked.destroy();
});

test('Pixel-M8 profiles migrate without changing other consoles and accept mapped keyboard/gamepad input for either player',()=>{
  const old=defaultSettings();delete old.p8;old.nes[0].keyboard[0]=['KeyZ'];const s=normalizeSettings(old);
  assert.deepEqual(s.nes[0].keyboard[0],['KeyZ']);assert.equal(actionsFor('p8').length,6);
  assert.equal(inputBits(s.p8[0],new Set(['ArrowLeft','KeyA','Enter','ShiftLeft']),null,'p8'),65);
  assignBinding(s.p8[0],'keyboard',0,'KeyZ');assert.equal(inputBits(s.p8[0],new Set(['KeyZ']),null,'p8'),1);
  const pad={buttons:[{pressed:true}],axes:[1,0]};assert.equal(pixelPad(inputBits(s.p8[1],new Set(),pad,'p8')),18);
});

test('Pixel-M8 stream metadata carries no cartridge and unsupported rollback/savestate/overclock stay unavailable',()=>{
  const token=crypto.randomUUID(),message={type:'stream-game',token,version:STREAM_VERSION,name:'Pixel Duo.p8',system:'p8',overclock:100};
  assert.deepEqual(streamMessage('control',{...message,bytes:makePixelDemo(),url:'private'}),message);
  assert.throws(()=>streamMessage('control',{...message,overclock:200}));
  assert.throws(()=>createGameConfig({name:message.name,bytes:makePixelDemo(),system:'p8',hash:'a'.repeat(64),overclock:100,demo:true}));
  assert.equal(canUseSoloSavestates({core:{supportsSavestates:false},game:{system:'p8'},isHost:true,mode:'solo'}),false);
});

test('Pixel-M8 missing continuation cartridge fails clearly instead of attempting an unavailable server proxy',async()=>{
  const core=await create();core.load(cart('function _update60() load("#retroroom_missing") end'),'p8');
  assert.throws(()=>core.run(0,0),/extra cartridge/);core.destroy();
});
