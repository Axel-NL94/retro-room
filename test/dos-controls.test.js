import test from 'node:test';import assert from 'node:assert/strict';
import {createDosControls} from '../web/src/dos-controls.js';import {emptyDosInput} from '../web/src/dos-input.js';
class Surface extends EventTarget {hidden=false;focus(){document.activeElement=this;}setAttribute(){} }
function setup(){
 const doc=new EventTarget(),win=new EventTarget(),screen=new Surface(),button=new Surface();
 doc.hidden=false;doc.activeElement=screen;doc.querySelector=()=>null;doc.getElementById=id=>id==='dos-mouse-button'?button:new Surface();
 const saved=[globalThis.document,globalThis.window];globalThis.document=doc;globalThis.window=win;
 let alias='F10',opened=0;
 const controls=createDosControls({enabled:()=>true,targets:()=>[screen],padInput:()=>emptyDosInput(),requestFocus:()=>screen.focus(),escapeKey:()=>alias,openMenu:()=>{opened++;controls.release();}});
 function key(type,code,options={}){const e=new Event(type,{cancelable:true});Object.assign(e,{code,repeat:false,getModifierState:()=>false,...options});doc.dispatchEvent(e);return e;}
 return {controls,key,setAlias:value=>alias=value,opened:()=>opened,cleanup(){[globalThis.document,globalThis.window]=saved;}};
}
test('DOS Escape alias replaces its normal key, preserves short taps and releases on keyup',()=>{
 const env=setup();try{
  env.key('keydown','F10');env.key('keyup','F10');assert.deepEqual(env.controls.frame(0,0).keys,[27]);assert.deepEqual(env.controls.frame(0,0).keys,[]);
  env.setAlias('');env.key('keydown','F10');assert.deepEqual(env.controls.frame(0,0).keys,[291]);env.key('keyup','F10');assert.deepEqual(env.controls.frame(0,0).keys,[]);
  env.controls.tap('Escape');assert.deepEqual(env.controls.frame(0,0).keys,[27]);assert.deepEqual(env.controls.frame(0,0).keys,[]);
 }finally{env.cleanup();}
});
test('DOS menu shortcut releases held input and remains available independently of game key reservations',()=>{
 const env=setup();try{
  env.key('keydown','KeyA');assert.deepEqual(env.controls.frame(0,0).keys,[97]);
  const event=env.key('keydown','KeyM',{altKey:true,shiftKey:true});assert.equal(event.defaultPrevented,true);assert.equal(env.opened(),1);assert.deepEqual(env.controls.frame(0,0).keys,[]);
 }finally{env.cleanup();}
});
