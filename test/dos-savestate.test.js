import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DosCore,DOS_BUILD} from '../web/src/dos.js';
import {encodeSavestate,decodeSavestate} from '../web/src/savestate.js';
import {decodeDosSoloState} from '../web/src/dos-savestate.js';
import {stageSavestate} from '../web/src/solo-savestate.js';
import {emptyDosInput} from '../web/src/dos-input.js';
import {romHash} from '../web/src/emulator.js';
import {makeDosDemo} from '../scripts/demo-dos.js';
import {dosZip,dosDiskFixture} from './dos-state-fixtures.js';
const wasmBinary=await readFile(new URL('../web/assets/dos-core.wasm',import.meta.url));
const create=options=>DosCore.create({wasmBinary,...options});
const factory={create};
const step=(core,keys=[],count=3)=>{for(let i=0;i<count;i++)core.run(0,0,false,[{...emptyDosInput(),keys},emptyDosInput()]);};
const tap=(core,key)=>{step(core,[key]);step(core);};
const peek=(core,offset)=>core.module._rr_peek(0x90000+offset)|core.module._rr_peek(0x90001+offset)<<8;
function red(frame){return frame.findIndex(c=>(c&255)>150&&((c>>8)&255)<110);}

for(const overclock of [100,500])test(`DOS solo: COM state restores progress on a fresh ${overclock}% instance`,async()=>{
  const bytes=makeDosDemo(),game={bytes,name:'demo.com',system:'dos',overclock,hash:await romHash(bytes)};let frame;
  const a=await create({onFrame:f=>{frame=f.slice();}});let b;
  try{
    a.load(bytes,'dos',game);step(a,[],60);tap(a,275);const position=red(frame);assert.equal(position,19251);
    const file=await encodeSavestate(a.saveSolo(),game,DOS_BUILD),{state}=await decodeSavestate(file,game,DOS_BUILD);
    a.destroy();
    const restored=await stageSavestate({CoreClass:factory,game,state});b=restored.candidate;
    assert.equal(red(restored.preview.frame),position);b.onFrame=f=>{frame=f.slice();};tap(b,275);assert.equal(red(frame),position+1);
    assert.equal(decodeDosSoloState(b.saveSolo()).extension,'com');
  }finally{if(!b)a.destroy();b?.destroy();}
});
test('DOS solo: a ZIP start-menu selection restores without asking the user to select it again',async()=>{
  const bytes=dosZip([['A.COM',dosDiskFixture()],['SUB/DUO.COM',makeDosDemo()]]),game={bytes,name:'menu.zip',system:'dos',overclock:100,hash:await romHash(bytes)};let frame;
  const a=await create({onFrame:f=>{frame=f.slice();}});let b;
  try{
    a.load(bytes,'dos',game);step(a,[],60);assert.throws(()=>a.saveSolo(),/Start eerst/);
    tap(a,274);tap(a,13);step(a,[],60);assert.equal(red(frame),19250);
    tap(a,275);const state=a.saveSolo();assert.match(decodeDosSoloState(state).program,/DUO\.COM/i);
    const restored=await stageSavestate({CoreClass:factory,game,state});b=restored.candidate;assert.equal(red(restored.preview.frame),19251);
    // A second exported state must retain its launch path after importing.
    assert.match(decodeDosSoloState(b.saveSolo()).program,/DUO\.COM/i);
  }finally{a.destroy();b?.destroy();}
});
test('DOS solo: pending writes and open-file seek position survive fresh ZIP restoration',async()=>{
  const bytes=dosZip([['FILE.COM',dosDiskFixture()],['DOSBOX.BAT',new TextEncoder().encode('@FILE.COM\r\n')]]);
  const game={bytes,name:'disk.zip',system:'dos',overclock:100,hash:await romHash(bytes)};
  const a=await create();let b;
  try{
    a.load(bytes,'dos',game);step(a,[],60);tap(a,119);assert.equal(peek(a,0),1);
    const state=a.saveSolo(),saved=decodeDosSoloState(state);assert.ok(saved.files.some(f=>f.name.endsWith('.pure.zip')));
    tap(a,97);assert.equal(peek(a,0),2);
    const restored=await stageSavestate({CoreClass:factory,game,state});b=restored.candidate;
    assert.equal(peek(b,0),1);tap(b,114);assert.equal(peek(b,2),1);
    tap(b,97);assert.equal(peek(b,0),2);tap(b,114);assert.equal(peek(b,2),1);assert.equal(peek(b,4),2,'saved file handle appends at its restored offset');
  }finally{a.destroy();b?.destroy();}
});
