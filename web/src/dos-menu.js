import {DOS_KEYS} from './dos-input.js';
import {keyLabel} from './input.js';
import {canPassDosControl} from './dos-policy.js';

const rows = [
 ['Escape','F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12','PrintScreen','ScrollLock','Pause'],
 ['Backquote',...Array.from({length:9},(_,i)=>'Digit'+(i+1)),'Digit0','Minus','Equal','Backspace'],
 ['Tab','KeyQ','KeyW','KeyE','KeyR','KeyT','KeyY','KeyU','KeyI','KeyO','KeyP','BracketLeft','BracketRight','Backslash'],
 ['CapsLock','KeyA','KeyS','KeyD','KeyF','KeyG','KeyH','KeyJ','KeyK','KeyL','Semicolon','Quote','Enter'],
 ['ShiftLeft','IntlBackslash','KeyZ','KeyX','KeyC','KeyV','KeyB','KeyN','KeyM','Comma','Period','Slash','ShiftRight'],
 ['ControlLeft','MetaLeft','AltLeft','Space','AltRight','MetaRight','ContextMenu','ControlRight'],
 ['Insert','Home','PageUp','Delete','End','PageDown','ArrowLeft','ArrowDown','ArrowUp','ArrowRight','F13','F14','F15'],
 ['NumLock','NumpadDivide','NumpadMultiply','NumpadSubtract','Numpad7','Numpad8','Numpad9','NumpadAdd','Numpad4','Numpad5','Numpad6','Numpad1','Numpad2','Numpad3','NumpadEnter','Numpad0','NumpadDecimal','NumpadEqual']
];
const label = code => code==='IntlBackslash'?'\\':keyLabel(code);
export function createDosMenu({context,change,pass,release,escape,exitFullscreen,escapeKey,setEscapeKey}) {
  const $=id=>document.getElementById(id),dialog=$('dos-menu-dialog'),keys=[];
  for(const codes of rows){
    const row=document.createElement('div');row.className='dos-key-row';
    for(const code of codes){
      const button=document.createElement('button');button.type='button';button.className='dos-key';button.dataset.dosKey=code;button.textContent=label(code);
      button.onclick=()=>{const {policy,host}=context();if(!host||policy.mode!=='shared')return;const blocked=new Set(policy.blocked),key=DOS_KEYS[code];blocked.has(key)?blocked.delete(key):blocked.add(key);change({blocked:[...blocked]});};
      row.append(button);keys.push(button);
    }
    $('dos-keyboard').append(row);
  }
  $('dos-escape-key').append(new Option('Geen vervangende toets',''));
  for(const code of Object.keys(DOS_KEYS).filter(code=>code!=='Escape'&&!/^(Shift|Control|Alt|Meta|CapsLock|NumLock|ScrollLock)/.test(code)))$('dos-escape-key').append(new Option(label(code)+' → DOS-Escape',code));
  $('dos-escape-key').value=escapeKey();
  $('dos-escape-key').onchange=e=>{release();setEscapeKey(e.target.value);};
  $('dos-sharing-mode').onchange=e=>change({mode:e.target.value,owner:0});
  $('dos-clear-keys').onclick=()=>change({blocked:[]});
  $('dos-pass-button').onclick=pass;
  $('dos-send-escape').onclick=()=>{dialog.close();escape();};
  $('dos-exit-fullscreen').onclick=()=>{dialog.close();exitFullscreen();};
  function update(){
    const {policy,applied,host,solo,connected,playing}=context(),player=host?0:1;
    const status=policy.mode==='shared'?'Samen bedienen':`Speler ${policy.owner+1} heeft de besturing`;
    const pending=applied.revision<policy.revision&&playing;
    $('dos-control-status').textContent=(pending?'Wijziging wordt toegepast… · ':'')+status;
    $('dos-menu-status').textContent=pending?'Wordt op hetzelfde invoerframe bij beide spelers toegepast.':status;
    $('dos-sharing-mode').value=policy.mode;$('dos-sharing-mode').disabled=!host;
    $('dos-pass-button').hidden=policy.mode!=='turns';
    $('dos-pass-button').textContent=policy.owner===0?'Besturing aan speler 2 geven':'Besturing teruggeven aan speler 1';
    $('dos-pass-button').disabled=!(solo||canPassDosControl(policy,player))||!solo&&(!connected||!playing)||pending;
    $('dos-clear-keys').disabled=!host||policy.mode!=='shared';
    $('dos-keyboard-note').textContent=policy.mode==='turns'?'Alleen de actieve speler bedient toetsenbord, muis en controller. De toetsverdeling geldt weer zodra de host Samen bedienen kiest.':host?'Klik op toetsen om ze voor speler 1 te reserveren of weer te delen. Dit kan tijdens het spelen; klikken hier drukt geen gametoets in.':'Rode toetsen zijn gereserveerd voor speler 1. Je kunt deze ook niet via controllerkoppelingen gebruiken. Alleen de host wijzigt de verdeling.';
    for(const button of keys){const blocked=policy.blocked.includes(DOS_KEYS[button.dataset.dosKey]);button.classList.toggle('reserved',blocked);button.classList.toggle('guest-key',!host);button.setAttribute('aria-pressed',String(blocked));button.setAttribute('aria-label',label(button.dataset.dosKey)+': '+(blocked?(host?'gereserveerd voor speler 1':'geblokkeerd voor speler 2'):'gedeeld'));button.disabled=!host||policy.mode!=='shared';}
    $('dos-send-escape').disabled=policy.mode==='turns'&&policy.owner!==player||policy.mode==='shared'&&!host&&policy.blocked.includes(27);
    $('dos-exit-fullscreen').hidden=!document.fullscreenElement;
  }
  function open(){if(!['dos'].includes(context().system))return;release();update();dialog.showModal();dialog.scrollTop=0;}
  for(const button of document.querySelectorAll('[data-dos-menu]'))button.onclick=open;
  dialog.addEventListener('close',release);
  return {update,open};
}
