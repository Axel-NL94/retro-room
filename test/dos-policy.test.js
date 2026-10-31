import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultDosPolicy,validateDosPolicy,nextDosPolicy,filterDosInput,DosPolicyFilter,canPassDosControl,validDosReturn} from '../web/src/dos-policy.js';
import {emptyDosInput,dosPadInput,dosMenuButtons} from '../web/src/dos-input.js';
import {defaultProfile} from '../web/src/input.js';
import {DosLockstepSession} from '../web/src/dos-lockstep.js';
import {StreamInput} from '../web/src/stream-protocol.js';
import {peerMessage} from '../web/src/protocol.js';
const input=(keys=[])=>({...emptyDosInput(),keys});

test('DOS defaults to shared control; reservations block physical, mapped, modifier and wheel input only for guest',()=>{
  const policy=defaultDosPolicy([97,306,280]);
  const state={...input([97,98,306]),modifiers:2,mouse:{x:5,y:2,wheel:-1,buttons:1}};
  assert.equal(policy.mode,'shared');assert.deepEqual(filterDosInput(state,policy,0),state);
  const guest=filterDosInput(state,policy,1);assert.deepEqual(guest.keys,[98]);assert.equal(guest.modifiers&2,0);assert.equal(guest.mouse.wheel,0);assert.equal(guest.mouse.buttons,1);
  const profile=defaultProfile('dos',0);profile.dosOutputs[0]='KeyA';assert.deepEqual(filterDosInput(dosPadInput(1,profile),policy,1).keys,[]);
  assert.deepEqual(filterDosInput(state,defaultDosPolicy(),1).keys,state.keys);
  const filter=new DosPolicyFilter(),next=nextDosPolicy(filter.policy,{blocked:[97]});assert.deepEqual(filter.apply([input([98]),input([97,98])],next).map(s=>s.keys),[[98],[98]],'reserving A keeps unrelated held B down');
});
test('DOS turn handoffs release held keyboard/mouse/joystick, disable inactive player and route active controller to joystick one',()=>{
  const filter=new DosPolicyFilter(),held={...input([97]),mouse:{x:8,y:2,wheel:0,buttons:3},joy:{enabled:true,x:.5,y:1,buttons:3}};
  const turns=nextDosPolicy(filter.policy,{mode:'turns',owner:1,blocked:[98]});
  assert.deepEqual(filter.apply([held,held],turns),[emptyDosInput(),emptyDosInput()]);
  assert.deepEqual(filter.apply([held,input([98])],turns),[input([98]),emptyDosInput()],'active person has full keyboard, even reserved keys');
  const active=filter.apply([input([99]),held],turns);assert.deepEqual(active[0],held);assert.deepEqual(active[1],emptyDosInput());
  assert.equal(canPassDosControl(turns,0),false);assert.equal(canPassDosControl(turns,1),true);
  const back=nextDosPolicy(turns,{owner:0});assert.deepEqual(filter.apply([held,held],back),[emptyDosInput(),emptyDosInput()]);
  assert.deepEqual(filter.apply([held,held],back),[held,emptyDosInput()]);
  assert.throws(()=>filter.apply([held,held],turns),/Verouderde/);
});
test('DOS filters already queued stream transitions when a key is blocked during play',()=>{
  let now=0;const stream=new StreamInput('session',{now:()=>now}),filter=new DosPolicyFilter();
  for(const [sequence,keys] of [[0,[97]],[1,[]],[2,[97]]])stream.receive({epoch:'session',sequence,buttons:1,dos:input(keys)});
  assert.deepEqual(filter.apply([emptyDosInput(),stream.dosCurrent()],filter.policy)[1].keys,[97]);
  const blocked=nextDosPolicy(filter.policy,{blocked:[97]});
  assert.deepEqual(filter.apply([emptyDosInput(),stream.dosCurrent()],blocked)[1].keys,[]);
  assert.deepEqual(filter.apply([emptyDosInput(),stream.dosCurrent()],blocked)[1].keys,[],'older queued keydown cannot bypass a new rule');
  now=300;assert.deepEqual(stream.dosCurrent(),emptyDosInput());
});
test('DOS control protocol is bounded and strips files and unknown properties',()=>{
  const policy=defaultDosPolicy([97]);const message=peerMessage('control',{type:'dos-policy',room:'room-id',policy:{...policy,rom:'private'},rom:'private'});
  assert.deepEqual(message,{type:'dos-policy',room:'room-id',policy});
  assert.deepEqual(peerMessage('control',{type:'dos-pass',room:'room-id',revision:2,epoch:'current',owner:1}),{type:'dos-pass',room:'room-id',revision:2,epoch:'current'});
  for(const bad of [{...policy,owner:2},{...policy,blocked:[999]},{...policy,blocked:[97,97]},{...policy,revision:-1}])assert.throws(()=>validateDosPolicy(bad));
  assert.throws(()=>peerMessage('control',{type:'dos-pass',room:'',revision:1}));
});
test('live DOS rule changes apply at the same emulated frame despite unequal packet delays; guest cannot author policies',async()=>{
  const cores=[0,1].map(()=>({frames:[],run(a,b,r,states){this.frames.push(states);},save(){return new Uint8Array([1]);}}));
  const queues=[[],[]],sessions=[],changes=[[],[]];let time=0,policy=defaultDosPolicy();
  for(let player=0;player<2;player++)sessions.push(new DosLockstepSession({core:cores[player],player,getPolicy:()=>policy,onPolicy:p=>changes[player].push([sessions[player].frame,p.revision]),send:p=>queues[1-player].push({at:time+(p.frame%5),...p}),hash:async()=> '12345678'}));
  for(time=0;time<180;time++){
    if(time===25)policy=nextDosPolicy(policy,{blocked:[97]});
    if(time===60)policy=nextDosPolicy(policy,{mode:'turns',owner:1});
    if(time===100)policy=nextDosPolicy(policy,{owner:0});
    if(time===130)policy=nextDosPolicy(policy,{mode:'shared'});
    for(let player=0;player<2;player++){
      for(const p of queues[player].filter(p=>p.at<=time).reverse())sessions[player].receive(p.frame,p.dos,p.policy);
      queues[player]=queues[player].filter(p=>p.at>time);
      sessions[player].tick(()=>input([player?97:98]));
    }
  }
  const length=Math.min(...cores.map(c=>c.frames.length));assert.ok(length>100);
  assert.deepEqual(cores[0].frames.slice(0,length),cores[1].frames.slice(0,length));assert.deepEqual(changes[0],changes[1]);
  assert.equal(changes[0].length,4);for(const [frame] of changes[0].slice(1))assert.deepEqual(cores[0].frames[frame],[emptyDosInput(),emptyDosInput()]);
  assert.throws(()=>sessions[0].receive(sessions[0].frame+6,input(),policy),/Alleen de host/);
  await Promise.all(sessions.map(s=>s.hashPending));sessions.forEach(s=>s.close());
});

test('a guest can only return its current turn in the current game epoch',()=>{
 const policy={...defaultDosPolicy(),mode:'turns',owner:1,revision:4};
 assert.equal(validDosReturn(policy,{revision:4,epoch:'current'},'current'),true);
 assert.equal(validDosReturn(policy,{revision:3,epoch:'current'},'current'),false);
 assert.equal(validDosReturn(policy,{revision:4,epoch:'old-game'},'current'),false);
 assert.equal(validDosReturn({...policy,owner:0},{revision:4,epoch:'current'},'current'),false);
 assert.equal(validDosReturn({...policy,mode:'shared'},{revision:4,epoch:'current'},'current'),false);
});

test('DOS launch menu derives controller/navigation input from filtered state, including true joystick mode',()=>{
 const policy=defaultDosPolicy([273,13,306]),held=input([273,13,306]);
 assert.equal(dosMenuButtons(filterDosInput(held,policy,1)),0);assert.ok(dosMenuButtons(filterDosInput(held,policy,0))&17);
 const pad={...input(),joy:{enabled:true,x:1,y:-1,buttons:1}};assert.equal(dosMenuButtons(pad),145);
 const inactive=filterDosInput(pad,{...policy,mode:'turns',owner:0},1);assert.equal(dosMenuButtons(inactive),0);
});
