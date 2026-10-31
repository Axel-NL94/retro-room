import test from 'node:test';import assert from 'node:assert/strict';
import {createFullscreenKeyboard} from '../web/src/fullscreen-keyboard.js';
test('fullscreen Escape capture requests only Escape and unlocks on leaving',async()=>{
 let calls=[],locked=false;const manager=createFullscreenKeyboard({keyboard:{async lock(keys){calls.push(keys);},unlock(){calls.push('unlock');}},active:()=>true,onStatus:value=>locked=value});
 assert.equal(await manager.acquire(),true);assert.deepEqual(calls,[['Escape']]);assert.equal(locked,true);manager.release();assert.equal(locked,false);assert.equal(calls[1],'unlock');
});
test('unsupported, denied and late keyboard lock requests fail safely without forcing fullscreen or trapping Escape',async()=>{
 assert.equal(await createFullscreenKeyboard({active:()=>true}).acquire(),false);
 assert.equal(await createFullscreenKeyboard({keyboard:{lock:async()=>{throw new Error('denied');}},active:()=>true}).acquire(),false);
 let resolve,unlocks=0,active=true;const manager=createFullscreenKeyboard({keyboard:{lock:()=>new Promise(r=>resolve=r),unlock(){unlocks++;}},active:()=>active});
 const pending=manager.acquire();active=false;manager.release();resolve();assert.equal(await pending,false);assert.ok(unlocks>0);
});
