// Physical keyboard -> libretro/SDL key codes. DOS receives key events, not text.
export const DOS_KEYS = {
  Backspace:8,Tab:9,Enter:13,Pause:19,Escape:27,Space:32,Quote:39,Comma:44,Minus:45,Period:46,Slash:47,
  Semicolon:59,Equal:61,BracketLeft:91,Backslash:92,BracketRight:93,Backquote:96,Delete:127,
  NumpadDecimal:266,NumpadDivide:267,NumpadMultiply:268,NumpadSubtract:269,NumpadAdd:270,NumpadEnter:271,NumpadEqual:272,
  ArrowUp:273,ArrowDown:274,ArrowRight:275,ArrowLeft:276,Insert:277,Home:278,End:279,PageUp:280,PageDown:281,
  NumLock:300,CapsLock:301,ScrollLock:302,ShiftRight:303,ShiftLeft:304,ControlRight:305,ControlLeft:306,AltRight:307,AltLeft:308,
  MetaRight:309,MetaLeft:310,PrintScreen:316,ContextMenu:319,IntlBackslash:323
};
for(let i=0;i<26;i++)DOS_KEYS['Key'+String.fromCharCode(65+i)]=97+i;
for(let i=0;i<10;i++){DOS_KEYS['Digit'+i]=48+i;DOS_KEYS['Numpad'+i]=256+i;}
for(let i=1;i<=15;i++)DOS_KEYS['F'+i]=281+i;
export const DOS_KEY_IDS = new Set(Object.values(DOS_KEYS));
export const DOS_OUTPUTS = {...DOS_KEYS,MouseLeft:400,MouseRight:401,MouseMiddle:402};
export const DOS_DEFAULT_OUTPUTS = [
 ['ControlLeft','AltLeft','Escape','Enter','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','Tab','KeyQ','KeyE'],
 ['KeyF','KeyG','Escape','Enter','KeyW','KeyS','KeyA','KeyD','KeyH','KeyR','KeyT','KeyY']
];
export const emptyDosInput = () => ({keys:[],modifiers:0,mouse:{x:0,y:0,wheel:0,buttons:0},joy:{enabled:false,x:0,y:0,buttons:0}});
export function validateDosInput(input) {
  const m=input?.mouse,j=input?.joy;
  if(!Array.isArray(input?.keys)||input.keys.length>128||input.keys.some(k=>!DOS_KEY_IDS.has(k))||new Set(input.keys).size!==input.keys.length||
    !Number.isInteger(input.modifiers)||input.modifiers<0||input.modifiers>127||!m||!['x','y','wheel'].every(k=>Number.isSafeInteger(m[k])&&Math.abs(m[k])<=1e9)||
    !Number.isInteger(m.buttons)||m.buttons<0||m.buttons>7||!j||typeof j.enabled!=='boolean'||!['x','y'].every(k=>Number.isFinite(j[k])&&Math.abs(j[k])<=1)||!Number.isInteger(j.buttons)||j.buttons<0||j.buttons>3)throw new Error('Ongeldige DOS-besturing.');
  return {keys:[...input.keys],modifiers:input.modifiers,mouse:{x:m.x,y:m.y,wheel:m.wheel,buttons:m.buttons},joy:{enabled:j.enabled,x:j.x,y:j.y,buttons:j.buttons}};
}
// Transmitted mouse positions are cumulative: loss/reordering does not replay or
// multiply relative movement. Native snapshots use per-frame relative deltas.
export class DosInputAccumulator {
  constructor(){this.reset();}
  reset(){this.state=emptyDosInput();this.last={x:0,y:0,wheel:0};this.delta={x:0,y:0,wheel:0};this.queue=[];this.delivered=emptyDosInput();this.signature=JSON.stringify([[],0,0,false,0]);}
  receive(value){
    const state=validateDosInput(value);
    for(const k of ['x','y','wheel']){this.delta[k]=Math.max(-32767,Math.min(32767,this.delta[k]+state.mouse[k]-this.last[k]));this.last[k]=state.mouse[k];}
    const signature=JSON.stringify([state.keys,state.modifiers,state.mouse.buttons,state.joy.enabled,state.joy.buttons]);
    if(signature!==this.signature){if(this.queue.length>=128)throw new Error('DOS-invoer loopt te ver achter. Verbind opnieuw.');this.queue.push(state);this.signature=signature;}
    this.state=state;
  }
  take(){if(this.queue.length)this.delivered=this.queue.shift();const event=this.delivered;const frame={keys:[...event.keys],modifiers:event.modifiers,mouse:{...this.delta,buttons:event.mouse.buttons},joy:{...this.state.joy,enabled:event.joy.enabled,buttons:event.joy.buttons}};this.delta={x:0,y:0,wheel:0};return frame;}
  release(){this.state=emptyDosInput();this.delivered=emptyDosInput();this.queue=[];this.signature=JSON.stringify([[],0,0,false,0]);this.delta={x:0,y:0,wheel:0};}
}
export function dosPadInput(bits,profile,axes={x:0,y:0},player=0) {
  const out=emptyDosInput(),outputs=profile?.dosOutputs||DOS_DEFAULT_OUTPUTS[player],mode=profile?.dosMode||'keyboard';
  const x=axes.x||((bits&128?1:0)-(bits&64?1:0)),y=axes.y||((bits&32?1:0)-(bits&16?1:0));
  if(mode==='joystick')out.joy={enabled:true,x,y,buttons:bits&3};
  else if(mode==='mouse'){out.mouse.x=Math.round(x*8);out.mouse.y=Math.round(y*8);out.mouse.buttons=bits&3;}
  for(let bit=0;bit<12;bit++){
    if(!(bits&(1<<bit))||(mode!=='keyboard'&&(bit<2||bit>=4&&bit<=7)))continue;
    const key=DOS_OUTPUTS[outputs[bit]];
    if(key>=400)out.mouse.buttons|=1<<(key-400);
    else if(key)out.keys.push(key);
  }
  out.keys=[...new Set(out.keys)];return out;
}

// The DOS launch menu consumes RetroPad input. Derive it from the filtered DOS
// state, never from the original controller mask (which could bypass a rule).
export function dosMenuButtons(state) {
  const keys=new Set(state.keys),joy=state.joy,mouse=state.mouse;
  let bits=0;
  if(keys.has(273)||joy.enabled&&joy.y<-.5)bits|=16;
  if(keys.has(274)||joy.enabled&&joy.y>.5)bits|=32;
  if(keys.has(276)||joy.enabled&&joy.x<-.5)bits|=64;
  if(keys.has(275)||joy.enabled&&joy.x>.5)bits|=128;
  if([13,271,305,306].some(k=>keys.has(k))||joy.enabled&&(joy.buttons&1)||mouse.buttons&1)bits|=1;
  if([27,307,308].some(k=>keys.has(k))||joy.enabled&&(joy.buttons&2)||mouse.buttons&2)bits|=2;
  return bits;
}
