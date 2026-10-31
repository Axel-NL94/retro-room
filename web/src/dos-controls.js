import {DOS_KEYS,emptyDosInput,DosInputAccumulator} from './dos-input.js';
export function createDosControls({enabled,targets,padInput,requestFocus,escapeKey=()=>'',openMenu=()=>{}}) {
  const held=new Map(),taps=new Set(),mouseTaps=new Set(),accumulator=new DosInputAccumulator();
  let modifiers=0,buttons=0,x=0,y=0,wheel=0;
  const active=()=>enabled()&&!document.hidden&&!document.querySelector('dialog[open]');
  const owns=target=>targets().includes(target);
  const focused=()=>active()&&(owns(document.activeElement)||owns(document.pointerLockElement));
  function release(){held.clear();taps.clear();mouseTaps.clear();buttons=0;modifiers=0;accumulator.release();}
  function unlock(){if(owns(document.pointerLockElement))document.exitPointerLock();}
  for(const target of targets()){
    target.addEventListener('blur',release);
    target.addEventListener('contextmenu',e=>{if(active())e.preventDefault();});
    target.addEventListener('mousedown',e=>{if(!active()||e.button>2)return;target.focus();e.preventDefault();const b=[1,4,2][e.button];buttons|=b;mouseTaps.add(b);});
    target.addEventListener('mousemove',e=>{if(!focused())return;x+=Math.max(-2048,Math.min(2048,Math.round(e.movementX||0)));y+=Math.max(-2048,Math.min(2048,Math.round(e.movementY||0)));});
    target.addEventListener('wheel',e=>{if(!focused())return;e.preventDefault();wheel+=Math.sign(e.deltaY);},{passive:false});
  }
  window.addEventListener('mouseup',e=>{if(e.button<=2)buttons&=~[1,4,2][e.button];});
  document.addEventListener('keydown',e=>{
    if(!focused())return;
    if(e.altKey&&e.shiftKey&&e.code==='KeyM'){e.preventDefault();e.stopImmediatePropagation();openMenu();return;}
    if(!DOS_KEYS[e.code])return;
    const key=e.code===escapeKey()?27:DOS_KEYS[e.code];
    e.preventDefault();e.stopImmediatePropagation();held.set(e.code,key);if(!e.repeat)taps.add(key);
    modifiers=(e.shiftKey?1:0)|(e.ctrlKey?2:0)|(e.altKey?4:0)|(e.metaKey?8:0)|(e.getModifierState('NumLock')?16:0)|(e.getModifierState('CapsLock')?32:0)|(e.getModifierState('ScrollLock')?64:0);
  },true);
  document.addEventListener('keyup',e=>{held.delete(e.code);if(focused()&&DOS_KEYS[e.code]){e.preventDefault();e.stopImmediatePropagation();}},true);
  window.addEventListener('blur',release);document.addEventListener('visibilitychange',()=>{if(document.hidden)release();});
  document.addEventListener('pointerlockchange',()=>{if(!document.pointerLockElement)release();updatePointer();});
  const button=document.getElementById('dos-mouse-button');
  function updatePointer(){button.textContent=owns(document.pointerLockElement)?'Muis loslaten':'Muis vangen';button.setAttribute('aria-pressed',String(owns(document.pointerLockElement)));}
  button.onclick=async()=>{try{if(owns(document.pointerLockElement))unlock();else{requestFocus();await targets().find(t=>!t.hidden).requestPointerLock();}}catch{document.getElementById('game-hint').textContent='Muis vangen is niet beschikbaar. Klik in het beeld om de muis binnen het gamescherm te gebruiken.';}};
  function packet(player=0,bits=0){
    const pad=active()?padInput(player,bits):emptyDosInput();
    const keys=player===0&&focused()?[...new Set([...held.values(),...taps,...pad.keys])]:pad.keys;
    if(player===0){taps.clear();x+=pad.mouse.x;y+=pad.mouse.y;wheel+=pad.mouse.wheel;}
    const result={keys,modifiers:player===0?modifiers:0,mouse:{x:player===0?x:pad.mouse.x,y:player===0?y:pad.mouse.y,wheel:player===0?wheel:pad.mouse.wheel,buttons:pad.mouse.buttons|(player===0&&focused()?buttons|[...mouseTaps].reduce((a,b)=>a|b,0):0)},joy:pad.joy};
    if(player===0)mouseTaps.clear();return result;
  }
  return {release,unlock,packet,tap(code){if(DOS_KEYS[code]){requestFocus();taps.add(DOS_KEYS[code]);}},reset(){release();x=y=wheel=0;accumulator.reset();},frame(player,bits){const p=packet(player,bits);if(player===0){accumulator.receive(p);return accumulator.take();}return p;}};
}
