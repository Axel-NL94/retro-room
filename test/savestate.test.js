import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { encodeSavestate, decodeSavestate, savestateFilename } from '../web/src/savestate.js';
import { MesenCore, MESEN_BUILD } from '../web/src/mesen.js';
import { romHash } from '../web/src/emulator.js';
import { makeDemoRom } from '../scripts/demo-rom.js';
import { makeSnesFixture } from './snes-fixture.js';
import { stateHash } from '../web/src/rollback.js';
const wasmBinary = new Uint8Array(await readFile(new URL('../web/assets/mesen-core.wasm',import.meta.url)));
const create = options => MesenCore.create({ wasmBinary, ...options });

for (const system of ['nes','snes']) test(`${system}: exported state restores identical future play on a new 500% emulator instance`, async () => {
  const rom = system==='nes' ? makeDemoRom() : makeSnesFixture();
  const game = { system,hash:await romHash(rom),overclock:500,name:'Own fixture' };
  let frameA,frameB;
  const a=await create({onFrame:frame=>{frameA=frame.slice();}});
  a.load(rom,system,game);
  for(let f=0;f<30;f++) a.run(f%3===0?1:0,f%5===0?2:0);
  const saved=a.save(), file=await encodeSavestate(saved,game,MESEN_BUILD);
  const b=await create({onFrame:frame=>{frameB=frame.slice();}});b.load(rom,system,game);
  const decoded=await decodeSavestate(file,game,MESEN_BUILD);b.restore(decoded.state);
  assert.equal(stateHash(b.save()),stateHash(saved));
  for(let f=0;f<20;f++){a.run(f%2,f%4===0?2:0);b.run(f%2,f%4===0?2:0);}
  assert.equal(stateHash(a.save()),stateHash(b.save()));
  assert.deepEqual(frameA,frameB);
  assert.equal(decoded.manifest.romHash,game.hash);assert.ok(!('rom' in decoded.manifest));
});

test('states reject another ROM, console, emulator build or CPU setting before native restore', async () => {
  const game={system:'nes',hash:await romHash(makeDemoRom()),overclock:200,name:'Demo'};
  const file=await encodeSavestate(new Uint8Array([1,2,3]),game,MESEN_BUILD);
  await assert.rejects(decodeSavestate(file,{...game,hash:'0'.repeat(64)},MESEN_BUILD),/andere ROM/);
  await assert.rejects(decodeSavestate(file,{...game,system:'snes'},MESEN_BUILD),/andere ROM/);
  await assert.rejects(decodeSavestate(file,game,'old-core'),/andere emulatorversie/);
  await assert.rejects(decodeSavestate(file,{...game,overclock:100},MESEN_BUILD),/200% CPU/);
});

test('truncated, changed, oversized and unrelated files cannot be imported as states', async () => {
  const game={system:'nes',hash:'a'.repeat(64),overclock:100,name:'Demo'};
  const file=await encodeSavestate(new Uint8Array([1,2,3]),game,MESEN_BUILD);
  const changed=file.slice();changed[changed.length-1]^=1;
  for(const bytes of [new Uint8Array(),makeDemoRom(),file.slice(0,10),file.slice(0,-1),changed,new Uint8Array(17*1024*1024)]) {
    await assert.rejects(decodeSavestate(bytes,game,MESEN_BUILD));
  }
  const badHeader=file.slice();new DataView(badHeader.buffer).setUint32(8,65535,true);
  await assert.rejects(decodeSavestate(badHeader,game,MESEN_BUILD));
});

test('invalid native snapshots restored on a staging instance preserve the existing game', async () => {
  const rom=makeDemoRom(),a=await create();a.load(rom);for(let f=0;f<20;f++)a.run(f%2,0);
  const before=stateHash(a.save()), candidate=await create();candidate.load(rom);
  assert.throws(()=>candidate.restore(new Uint8Array([1,2,3,4])),/niet herstellen/);
  assert.equal(stateHash(a.save()),before);
  assert.match(savestateFilename('../../test:bad/name'),/^testbadname-.*\.rrstate$/);
});
