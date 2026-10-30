import test from 'node:test';import assert from 'node:assert/strict';
import {DosLockstepSession} from '../web/src/dos-lockstep.js';import {emptyDosInput} from '../web/src/dos-input.js';import {peerMessage} from '../web/src/protocol.js';
const core=()=>({frames:[],run(a,b,replay,inputs){this.frames.push(JSON.stringify(inputs));},save(){return new Uint8Array([this.frames.length%256]);}});
test('DOS lockstep waits for missing input and captures movement only once while waiting',async()=>{
 const c=core(),sent=[];let captured=0;const s=new DosLockstepSession({core:c,player:0,delay:2,hashEvery:2,hash:async()=> '12345678',send:m=>sent.push(m)});
 const source=()=>{captured++;return emptyDosInput()};assert.equal(s.tick(source),true);assert.equal(s.tick(source),true);assert.equal(s.tick(source),false);assert.equal(s.tick(source),false);assert.equal(captured,3);assert.equal(sent.length,3);
 s.receive(2,emptyDosInput());assert.equal(s.tick(source),true);await s.hashPending;assert.deepEqual(s.confirmedState(),{frame:2,hash:'12345678'});assert.equal(s.hashAt(2),'12345678');s.close();assert.equal(s.tick(source),false);
});
test('two DOS peers remain identical through delayed and reordered delivery without snapshots on every frame',async()=>{
 const a=core(),b=core(),queues=[[],[]],sessions=[];let tick=0;
 for(let player=0;player<2;player++)sessions.push(new DosLockstepSession({core:player?b:a,player,delay:6,hashEvery:120,send:p=>queues[1-player].push({at:tick+(p.frame%5),...p})}));
 for(tick=0;tick<500;tick++){
  for(let i=0;i<2;i++){for(const p of queues[i].filter(p=>p.at<=tick).reverse())sessions[i].receive(p.frame,p.dos);queues[i]=queues[i].filter(p=>p.at>tick);sessions[i].tick(()=>({...emptyDosInput(),keys:[97+i],mouse:{x:sessions[i].frame%3,y:0,wheel:0,buttons:0}}));}
 }
 const same=Math.min(a.frames.length,b.frames.length);assert.ok(same>200);assert.deepEqual(a.frames.slice(0,same),b.frames.slice(0,same));assert.ok(sessions.every(s=>s.rollbacks===0));await Promise.all(sessions.map(s=>s.hashPending));sessions.forEach(s=>s.close());
});
test('DOS lockstep protocol strips files and bounds frame windows and input',()=>{
 const s=new DosLockstepSession({core:core(),player:0,send(){}});assert.throws(()=>s.receive(181,emptyDosInput()),/vooruit/);s.receive(8,emptyDosInput());assert.throws(()=>s.receive(8,{...emptyDosInput(),keys:[97]}),/Tegenstrijdige/);
 const message=peerMessage('input',{type:'dos-input',frame:6,epoch:'session',dos:{...emptyDosInput(),rom:new Uint8Array(20)},rom:new Uint8Array(20)});assert.equal(message.rom,undefined);assert.equal(message.dos.rom,undefined);s.close();
});
