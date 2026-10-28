import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MesenCore, validateOverclock } from '../web/src/mesen.js';
import { makeDemoRom } from '../scripts/demo-rom.js';
import { makeSnesFixture } from './snes-fixture.js';
import { RollbackSession, stateHash } from '../web/src/rollback.js';
const wasmBinary = new Uint8Array(await readFile(new URL('../web/assets/mesen-core.wasm', import.meta.url)));
const create = options => MesenCore.create({ wasmBinary, ...options });

test('modern Mesen runs the original NES demo with both controllers and video/audio', async () => {
  let frames = 0, samples = 0;
  const core = await create({ onFrame: (frame,w,h) => { assert.equal(frame.length,w*h); frames++; }, onAudio: () => samples++ });
  core.load(makeDemoRom());
  for (let f=0;f<30;f++) core.run(0,0);
  const ram = () => core.module.HEAPU8.subarray(core.module._rr_ram_ptr(),core.module._rr_ram_ptr()+2);
  assert.deepEqual([...ram()],[24,24]);
  core.run(1,0); core.run(0,0); core.run(0,1); core.run(0,0);
  assert.deepEqual([...ram()],[28,28]);
  assert.equal(frames,34); assert.ok(samples>0);
  assert.ok(core.fps>59 && core.fps<61);
});

test('Mesen state restores and replays exactly, including the rendered output', async () => {
  let pixels;
  const core = await create({ onFrame: frame => { pixels=frame.slice(); } });
  const rom=makeDemoRom(); rom[7]|=8; core.load(rom);
  for(let f=0;f<40;f++) core.run(f%3===0?1:0,f%7===0?1:0);
  const saved=core.save();
  for(let f=0;f<30;f++) core.run(f%2,(f+1)%2);
  const expected=stateHash(core.save()), frame=stateHash(new Uint8Array(pixels.buffer));
  core.restore(saved);
  for(let f=0;f<30;f++) core.run(f%2,(f+1)%2);
  assert.equal(stateHash(core.save()),expected);
  assert.equal(stateHash(new Uint8Array(pixels.buffer)),frame);
});

test('two independent Mesen instances converge with delayed and reordered netplay inputs', async () => {
  const a=await create(),b=await create(); a.load(makeDemoRom(),'nes',{overclock:200});b.load(makeDemoRom(),'nes',{overclock:200});
  const queue=[];let clock=0,left,right;
  left=new RollbackSession(a,{player:1,send:m=>queue.push({to:right,m,at:clock+1+m.frame%5})});
  right=new RollbackSession(b,{player:2,send:m=>queue.push({to:left,m,at:clock+1+m.frame%7})});
  while(left.frame<140 || right.frame<140) {
    for(let i=queue.length-1;i>=0;i--) if(queue[i].at<=clock) { const q=queue.splice(i,1)[0];q.to.receive(q.m.frame,q.m.buttons); }
    if(left.frame<140) left.tick(left.frame%3===0?1:0);
    if(right.frame<140) right.tick(right.frame%5===0?1:0);
    assert.ok(++clock<1000);
  }
  for(const q of queue) q.to.receive(q.m.frame,q.m.buttons);
  left.reconcile();right.reconcile();
  assert.ok(left.rollbacks>0 && right.rollbacks>0);
  assert.equal(stateHash(a.save()),stateHash(b.save()));
  assert.equal(left.hashAt(120),right.hashAt(120));
});

test('the same modern Mesen core runs an original SNES ROM and both input ports', async () => {
  let color;
  const core=await create({onFrame:frame=>{color=frame[Math.floor(frame.length/2)];}});
  core.load(makeSnesFixture(),'snes');
  for(let f=0;f<20;f++)core.run(0,0); const neutral=color;
  for(let f=0;f<4;f++)core.run(2,0); const p1=color;
  for(let f=0;f<4;f++)core.run(0,2); const p2=color;
  assert.notEqual(p1,neutral);assert.notEqual(p2,neutral);assert.notEqual(p1,p2);
  const saved=core.save();for(let f=0;f<8;f++)core.run(0,0);const expected=stateHash(core.save());
  core.restore(saved);for(let f=0;f<8;f++)core.run(0,0);assert.equal(stateHash(core.save()),expected);
});

test('Mesen overclock retains a nonzero audio signal at the normal sample rate', async () => {
  let peak=0,samples=0;
  const core=await create({onAudio:(l,r)=>{samples++;peak=Math.max(peak,Math.abs(l),Math.abs(r));}});
  const rom=new Uint8Array(16+16384+8192);rom.set([78,69,83,26,1,1]);
  rom.set([0x78,0xa2,0xff,0x9a,0xa9,0x40,0x8d,0x17,0x40,0xa9,1,0x8d,0x15,0x40,0xa9,0xbf,0x8d,0,0x40,0xa9,0xfd,0x8d,2,0x40,0xa9,8,0x8d,3,0x40,0x4c,0x1d,0x80],16);
  rom[16+0x3ffc]=0;rom[16+0x3ffd]=0x80;core.load(rom,'nes',{overclock:200});
  for(let f=0;f<60;f++)core.run(0,0);
  assert.ok(peak>0.01);assert.ok(samples>47000 && samples<49000);
});

test('SNES netplay converges with delayed 12-button controller inputs', async () => {
  const a=await create(),b=await create();a.load(makeSnesFixture(),'snes',{overclock:200});b.load(makeSnesFixture(),'snes',{overclock:200});
  assert.equal(stateHash(a.save()),stateHash(b.save()),'both SNES machines must power on identically');
  const queue=[];let clock=0,left,right;
  left=new RollbackSession(a,{player:1,send:m=>queue.push({to:right,m,at:clock+1+m.frame%4})});
  right=new RollbackSession(b,{player:2,send:m=>queue.push({to:left,m,at:clock+1+m.frame%3})});
  while(left.frame<70 || right.frame<70) {
    for(let i=queue.length-1;i>=0;i--)if(queue[i].at<=clock){const q=queue.splice(i,1)[0];q.to.receive(q.m.frame,q.m.buttons);}
    if(left.frame<70)left.tick(left.frame%3===0?2|1024:0);
    if(right.frame<70)right.tick(right.frame%5===0?2|2048:0);
    assert.ok(++clock<500);
  }
  for(const q of queue)q.to.receive(q.m.frame,q.m.buttons);left.reconcile();right.reconcile();
  assert.ok(left.rollbacks && right.rollbacks);assert.equal(stateHash(a.save()),stateHash(b.save()));
});

test('CPU overclock rejects unsupported values before loading content', () => {
  for(const value of [0,99,101,125,150,301,501,Infinity,NaN,'200',null]) assert.throws(()=>validateOverclock(value));
});

// Original busy loops count CPU work in RAM independently of the UI or settings.
// Measuring their progress proves extra emulated work, rather than fast-forward.
for(const system of ['nes','snes']) test(`${system.toUpperCase()} 200–500% adds CPU work per video frame and survives reset/rollback`, async () => {
  const rom=system==='nes'?new Uint8Array(16+16384+8192):makeSnesFixture();
  if(system==='nes') {
    rom.set([78,69,83,26,1,1]);
    rom.set([0x78,0xa2,0xff,0x9a,0xe6,0,0xd0,0xfc,0xe6,1,0x4c,4,0x80],16);
    rom[16+0x3ffc]=0;rom[16+0x3ffd]=0x80;
  } else {
    rom.set([0x78,0x18,0xfb,0xc2,0x30,0xa2,0xff,0x1f,0x9a,0x9c,0,0,0xee,0,0,0x80,0xfb]);
  }
  const core=await create();
  const count=()=>{const p=core.module._rr_ram_ptr();assert.ok(p);return core.module.HEAPU8[p]|core.module.HEAPU8[p+1]<<8;};
  const measure=()=>{for(let f=0;f<5;f++)core.run(0,0);const before=count();core.run(0,0);return(count()-before+65536)%65536;};
  core.load(rom,system);const normal=measure(),fps=core.fps;
  core.load(rom,system,{overclock:200});const faster=measure();
  assert.ok(normal>100);assert.ok(faster/normal>1.9&&faster/normal<2.1,`${faster}/${normal} must be about 2x`);
  assert.equal(core.fps,fps,'video cadence must stay unchanged');
  for (const overclock of [300,400,500]) {
    core.load(rom,system,{overclock}); const work=measure();
    assert.ok(Math.abs(work/normal-overclock/100)<0.15,`${overclock}%: ${work}/${normal}`);
    assert.equal(core.fps,fps,'higher CPU work must not fast-forward video');
  }
  for (const invalid of [0,99,125,550]) assert.equal(core.module._rr_load(0,0,0,invalid),0,'native bridge enforces the same choices');
  const saved=core.save();for(let f=0;f<6;f++)core.run(0,0);const expected=stateHash(core.save());
  core.restore(saved);for(let f=0;f<6;f++)core.run(0,0);assert.equal(stateHash(core.save()),expected);
  core.load(rom,system);assert.equal(measure(),normal,'returning to 100% removes overclock');
});
