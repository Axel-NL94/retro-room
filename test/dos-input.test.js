import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {DOS_KEYS,DOS_KEY_IDS,DosInputAccumulator,emptyDosInput,validateDosInput,dosPadInput} from '../web/src/dos-input.js';
import {defaultProfile,normalizeSettings,defaultSettings} from '../web/src/input.js';
import {STREAM_VERSION,StreamInput,streamMessage} from '../web/src/stream-protocol.js';
import {DosCore} from '../web/src/dos.js';import {makeDosInputFixture} from '../scripts/dos-input-fixture.js';
const token='44444444-4444-4444-8444-444444444444';
test('complete DOS keyboard, arbitrary controller outputs, joystick and mouse modes persist',()=>{
  for(const key of ['KeyZ','Digit0','F12','ControlLeft','AltRight','NumpadEnter','Numpad0','IntlBackslash','PrintScreen','ScrollLock'])assert.ok(DOS_KEYS[key]);
  assert.ok(DOS_KEY_IDS.size>100);const profile=defaultProfile('dos',0);profile.dosOutputs[0]='F10';profile.dosOutputs[1]='MouseRight';
  assert.deepEqual(dosPadInput(3,profile).keys,[291]);assert.equal(dosPadInput(3,profile).mouse.buttons,2);
  profile.dosMode='joystick';assert.deepEqual(dosPadInput(3,profile,{x:.5,y:-1}).joy,{enabled:true,x:.5,y:-1,buttons:3});
  profile.dosMode='mouse';assert.equal(dosPadInput(3,profile,{x:1,y:-1}).mouse.x,8);
  const settings=defaultSettings();settings.dos[0]=profile;assert.equal(normalizeSettings(JSON.parse(JSON.stringify(settings))).dos[0].dosMode,'mouse');
});
test('DOS wire input is bounded, copied, ordered and cumulative mouse deltas are consumed once',()=>{
  const value=emptyDosInput();value.keys=[97,306];value.mouse.x=10;const parsed=validateDosInput({...value,rom:new Uint8Array(10)});assert.equal(parsed.rom,undefined);
  const accumulator=new DosInputAccumulator();accumulator.receive(parsed);value.mouse.x=25;accumulator.receive(value);assert.equal(accumulator.take().mouse.x,25);assert.equal(accumulator.take().mouse.x,0);
  for(const bad of [{...value,keys:[999]},{...value,keys:[97,97]},{...value,mouse:{...value.mouse,x:Infinity}}])assert.throws(()=>validateDosInput(bad));
  let now=0;const stream=new StreamInput(token,{now:()=>now});const packet={type:'stream-input',token,epoch:token,sequence:1,buttons:0,dos:value};
  stream.receive(streamMessage('input',packet));stream.receive({...packet,sequence:0,dos:{...value,keys:[98]}});assert.deepEqual(stream.dosCurrent().keys,[97,306]);assert.equal(stream.dosCurrent().mouse.x,0);
  stream.receive({...packet,sequence:2,dos:emptyDosInput()});stream.receive({...packet,sequence:3,dos:{...emptyDosInput(),keys:[98]}});assert.deepEqual(stream.dosCurrent().keys,[]);assert.deepEqual(stream.dosCurrent().keys,[98]);
  now=251;assert.deepEqual(stream.dosCurrent().keys,[]);assert.equal(stream.dosCurrent().mouse.buttons,0);
});
test('native DOS BIOS receives literal keys, modifiers, function keys, mouse buttons/motion and joysticks',async()=>{
  const core=await DosCore.create({wasmBinary:await readFile(new URL('../web/assets/dos-core.wasm',import.meta.url))});
  const run=(state,n=3)=>{for(let i=0;i<n;i++)core.run(0,0,true,[state,emptyDosInput()]);};const peek=n=>core.module._rr_peek(0x90000+n);
  try{
    core.load(makeDosInputFixture(),'dos',{name:'input.com',overclock:100});run(emptyDosInput(),45);
    assert.equal(peek(8)|peek(9)<<8,0xffff,'DOS mouse driver installed');
    run({...emptyDosInput(),keys:[97]});assert.equal(peek(0),97,'literal A becomes a, not controller Ctrl');run(emptyDosInput());
    run({...emptyDosInput(),keys:[304,98],modifiers:1});assert.equal(peek(0),66,'Shift+B');run(emptyDosInput());
    run({...emptyDosInput(),keys:[282]});assert.equal(peek(1),59,'BIOS F1 scan code');run(emptyDosInput());
    run({...emptyDosInput(),keys:[306,99],modifiers:2});assert.equal(peek(0),3,'Ctrl+C');run(emptyDosInput());
    run({...emptyDosInput(),mouse:{x:20,y:10,wheel:0,buttons:3}});assert.equal(peek(2)&3,3);assert.ok((peek(4)|peek(5)<<8)>0,'mouse moved');
    run(emptyDosInput());assert.equal(peek(2)&3,0,'mouse release');
    run({...emptyDosInput(),joy:{enabled:true,x:.5,y:-.5,buttons:3}});assert.equal(core.module._rr_joystick(0,0),1);assert.equal(core.module._rr_joystick(0,3),1);assert.equal(core.module._rr_joystick(0,4),1);
    run(emptyDosInput());assert.equal(core.module._rr_joystick(0,0),0);assert.equal(core.module._rr_key_down(306),0);
  }finally{core.destroy();}
});
