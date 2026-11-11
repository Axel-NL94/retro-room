import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { directDeadline } from '../web/src/direct-deadline.js';
function clock() {
  let now = 0, id = 0; const timers = new Map();
  return { setTimer(fn, ms) { const key = ++id; timers.set(key, { fn, at: now + ms }); return key; },
    clearTimer(key) { timers.delete(key); },
    tick(ms) { const end = now + ms; for (;;) { const entry = [...timers].sort((a,b)=>a[1].at-b[1].at)[0]; if (!entry || entry[1].at > end) break;
      now = entry[1].at; timers.delete(entry[0]); entry[1].fn(); } now = end; }, count: () => timers.size };
}
function fixture() { const c = new EventEmitter(); c.peerConnection = new EventTarget(); c.peerConnection.iceConnectionState = 'new'; return c; }
test('advancing ICE can exceed the former 10-second cutoff; duplicate events do not prolong the deadline', () => {
  const c=fixture(), time=clock(); let expired=0;
  directDeadline(c,{...time,timeout:()=>expired++});
  time.tick(10000); assert.equal(expired,0);
  c.peerConnection.iceConnectionState='checking';c.peerConnection.dispatchEvent(new Event('iceconnectionstatechange'));
  time.tick(10000);assert.equal(expired,0);
  c.peerConnection.dispatchEvent(new Event('iceconnectionstatechange'));
  time.tick(5000);assert.equal(expired,1);assert.equal(time.count(),0);
});
test('continuing progress is bounded by the hard maximum; cancellation removes all timers', () => {
  const c=fixture(), time=clock();let expired=0;
  directDeadline(c,{...time,idle:15,maximum:45,timeout:()=>expired++});
  for(let i=0;i<4;i++){time.tick(10);c.peerConnection.signalingState=String(i);c.peerConnection.dispatchEvent(new Event('signalingstatechange'));}
  time.tick(5);assert.equal(expired,1);
  const cancel=directDeadline(c,{...time,timeout:()=>expired++});cancel();time.tick(100000);assert.equal(expired,1);assert.equal(time.count(),0);
});
test('an actual ICE failure can fall back immediately', () => {
  const c=fixture(),time=clock();let expired=0;directDeadline(c,{...time,timeout:()=>expired++});
  c.peerConnection.iceConnectionState='failed';c.peerConnection.dispatchEvent(new Event('iceconnectionstatechange'));
  assert.equal(expired,1);assert.equal(time.count(),0);
});

test('new ICE candidates count as progress, but repeats cannot postpone the idle deadline',()=>{
  const c=fixture(),time=clock();let expired=0;directDeadline(c,{...time,idle:15,maximum:45,timeout:()=>expired++});
  time.tick(10);const candidate=new Event('icecandidate');candidate.candidate={candidate:'candidate:1 1 udp 1 192.0.2.1 1234 typ host'};
  c.peerConnection.dispatchEvent(candidate);time.tick(10);assert.equal(expired,0);
  c.peerConnection.dispatchEvent(candidate);time.tick(5);assert.equal(expired,1);
});
