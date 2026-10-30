import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DosCore, DOS_NETPLAY_AVAILABLE, validateDos } from '../web/src/dos.js';
import {emptyDosInput} from '../web/src/dos-input.js';
import {makeDosInputFixture} from '../scripts/dos-input-fixture.js';
import { makeDosDemo } from '../scripts/demo-dos.js';
import { defaultSettings, normalizeSettings, inputBits } from '../web/src/input.js';
import { createGameConfig, peerMessage } from '../web/src/protocol.js';
import { STREAM_VERSION } from '../web/src/stream-protocol.js';
import { InviteConnection } from '../web/src/connection.js';
import { EventEmitter } from 'node:events';
import { sha256 } from '../scripts/licensing.js';

function positions(frame) {
  let red=-1,green=-1;
  for(let i=0;i<frame.length;i++) {
    const c=frame[i];
    if(red<0&&(c&255)>150&&((c>>8)&255)<110)red=i;
    if(green<0&&((c>>8)&255)>150&&(c&255)<110)green=i;
  }
  return [red,green];
}
function zip(entries) {
  let offset=0;const parts=[],central=[];
  for(const [name,bytes] of entries) {
    const file=Buffer.from(name),body=Buffer.from(bytes);let crc=0xffffffff;
    for(const byte of body){crc^=byte;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    crc=(crc^0xffffffff)>>>0;
    const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt32LE(crc,14);h.writeUInt32LE(body.length,18);h.writeUInt32LE(body.length,22);h.writeUInt16LE(file.length,26);
    parts.push(h,file,body);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc,16);c.writeUInt32LE(body.length,20);c.writeUInt32LE(body.length,24);c.writeUInt16LE(file.length,28);c.writeUInt32LE(offset,42);central.push(c,file);offset+=h.length+file.length+body.length;
  }
  const dir=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);
  return new Uint8Array(Buffer.concat([...parts,dir,end]));
}
test('DOS validates local content and game metadata never includes files', () => {
  const demo=makeDosDemo();assert.equal(validateDos(demo,'DEMO.COM'),'com');
  assert.throws(()=>validateDos(new Uint8Array(),'x.com'));
  assert.throws(()=>validateDos(demo,'x.zip'));
  assert.throws(()=>validateDos(demo,'x.js'));
  const config=createGameConfig({bytes:demo,name:'DOS Duo.com',system:'dos',hash:'a'.repeat(64),demo:true,overclock:100});
  assert.equal(config.system,'dos');assert.ok(!('bytes' in config));
  const stream=peerMessage('control',{type:'stream-game',version:STREAM_VERSION,token:'44444444-4444-4444-8444-444444444444',name:'Demo',system:'dos',overclock:100,bytes:demo});
  assert.ok(!('bytes' in stream));assert.equal(DOS_NETPLAY_AVAILABLE,true);
});
test('DOS input profiles persist independently and support both local people', () => {
  const settings=defaultSettings();settings.dos[0].keyboard[0]=['KeyZ'];
  const restored=normalizeSettings(JSON.parse(JSON.stringify(settings)));
  assert.equal(inputBits(restored.dos[0],new Set(['KeyZ']),null,'dos'),1);
  assert.equal(inputBits(restored.dos[1],new Set(['KeyN']),null,'dos'),1);
  assert.deepEqual(restored.nes[0].keyboard[0],['KeyA']);
  assert.equal(inputBits(restored.dos[0],new Set(['KeyD']),null,'dos'),256);
});
test('DOS direct-only rooms do not open an Tailcat fallback', async () => {
  class Data extends EventEmitter{close(){this.emit('close');}}
  class Peer extends EventEmitter {
    constructor(id){super();this.id=id;queueMicrotask(()=>{this.open=true;this.emit('open');});}
    connect(peer,options){return Object.assign(new Data(),{peer,...options});}
    destroy(){}
  }
  class Relay { constructor(){throw new Error('Unexpected relay');} }
  const host=new InviteConnection(Peer,{RelayRoomClass:Relay});
  await host.create({name:'Host',game:'Demo',playMode:'netplay',directOnly:true});
  const guest=new InviteConnection(Peer,{RelayRoomClass:Relay});let message;
  guest.addEventListener('rejected',e=>{message=e.detail.message;});
  await guest.join('https://example.com/#room='+host.room.id+'&direct=1','Guest');await guest.fallback();
  assert.match(message,/geen Tailcat/);host.leave();guest.leave();
});
test('DOS native COM and complete ZIP render and both players move on one virtual PC', async () => {
  const binary=await readFile(new URL('../web/assets/dos-core.wasm',import.meta.url));
  let frameA,frameB,peak=0;
  const a=await DosCore.create({wasmBinary:binary,onFrame:f=>{frameA=f.slice();},onAudio:(l,r)=>{peak=Math.max(peak,Math.abs(l),Math.abs(r));}});
  const b=await DosCore.create({wasmBinary:binary,onFrame:f=>{frameB=f.slice();}});
  try {
    const demo=makeDosDemo(),options={name:'demo.com',overclock:100};
    a.load(demo,'dos',options);for(let i=0;i<6;i++)a.run(0,0);
    a.load(demo,'dos',options);for(let i=0;i<30;i++)a.run(0,0);
    assert.deepEqual(positions(frameA),[19250,38450]);
    for(let i=0;i<12;i++)a.run(128,128);
    assert.deepEqual(positions(frameA),[19251,38451]);
    a.run(0,0);const saved=a.save();assert.ok(saved.length<64*1024*1024);
    b.load(demo,'dos',options);for(let i=0;i<30;i++)b.run(0,0);b.restore(saved);b.run(0,0);
    assert.deepEqual(positions(frameA),positions(frameB));
    const files=zip([['DEMO.COM',demo],['DOSBOX.BAT',new TextEncoder().encode('@DEMO.COM\r\n')]]);
    a.load(files,'dos',{name:'complete.zip',overclock:100});for(let i=0;i<60;i++)a.run(0,0);
    assert.deepEqual(positions(frameA),[19250,38450]);
    // The ZIP start menu must accept a physical keyboard, not only a gamepad.
    const menu=zip([['INPUT.COM',makeDosInputFixture()],['OTHER.COM',makeDosInputFixture()]]);
    a.load(menu,'dos',{name:'menu.zip',overclock:100});
    const step=(keys,n)=>{for(let i=0;i<n;i++)a.run(0,0,true,[{...emptyDosInput(),keys},emptyDosInput()]);};
    step([],60);step([13],3);step([],60);
    assert.equal(a.module._rr_peek(0x90008)|a.module._rr_peek(0x90009)<<8,0xffff,'physical Enter launches the selected DOS program');
    // Original tiny COM fixture: program PIT channel 2, enable PC speaker,
    // then loop. No third-party game/audio content is used.
    const tone=new Uint8Array([0xb0,0xb6,0xe6,0x43,0xb0,0x98,0xe6,0x42,0xb0,0x0a,0xe6,0x42,0xe4,0x61,0x0c,0x03,0xe6,0x61,0xeb,0xfe]);
    a.load(tone,'dos',{name:'tone.com',overclock:100});peak=0;
    for(let i=0;i<90;i++)a.run(0,0);
    assert.ok(peak>0.01,'native DOS PC-speaker audio reaches the frontend');
  } finally { a.destroy();b.destroy(); }
});
test('DOS loader, Wasm, corresponding source and retained notices are matched', async () => {
  const meta=JSON.parse(await readFile(new URL('../web/assets/dos-build.json',import.meta.url)));
  for(const [file,hash] of [['assets/dos-core.mjs',meta.loaderSha256],['assets/dos-core.wasm',meta.wasmSha256],['assets/'+meta.sourceArchive,meta.sourceSha256],['DOS-NOTICES.txt',meta.noticesSha256]])assert.equal(sha256(await readFile(new URL('../web/'+file,import.meta.url))),hash);
  assert.equal(meta.upstreamLicense,'GPL-2.0-or-later');assert.ok(meta.sourceFiles>250);
});
