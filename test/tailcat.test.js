import test from 'node:test';
import assert from 'node:assert/strict';
import { TailcatTransport, validTailcatAddress } from '../web/src/tailcat-transport.js';
const address = () => {
  const data = Uint8Array.from([0xa3,0x61,0x70,0x58,32,...new Uint8Array(32).fill(1),0x61,0x71,0x58,32,...new Uint8Array(32).fill(2),0x61,0x69,1]);
  return 'tc'+Buffer.from(data).toString('base64url');
};
class Worker {
  static instances=[];
  constructor(url, options) { this.url=String(url); this.options=options; this.messages=[]; Worker.instances.push(this); }
  postMessage(data) { this.messages.push(data); }
  emit(data) { this.onmessage({data}); }
  terminate() { this.terminated=true; }
}
test('Tailcat accepts only compact public-region capabilities, never embedded arbitrary relays', () => {
  assert.equal(validTailcatAddress(address()),true);
  for(const value of ['',null,'wss://attacker.test', 'tc'+Buffer.from([0xa3,0x61,0x72,0x80]).toString('base64url'),address()+'AA',address().slice(0,-3)]) assert.equal(validTailcatAddress(value),false);
  const wire=Buffer.from(address().slice(2),'base64url'); wire[wire.length-1]=0;
  assert.equal(validTailcatAddress('tc'+wire.toString('base64url')),false);
});
test('Tailcat worker is lazy, preserves frame boundaries, caps backlog and terminates on close', async () => {
  const t=new TailcatTransport({WorkerClass:Worker}); const before=Worker.instances.length;
  assert.equal(Worker.instances.length,before); const opened=t.open({host:true});const w=t.worker;
  assert.equal(w.options.type,'module');assert.match(w.url,/tailcat-worker.js/);
  w.emit({type:'ready',address:address()}); assert.equal(await opened,address());
  const packets=[];t.addEventListener('packet',e=>packets.push(e.detail));
  w.emit({type:'packet',uid:'guest',data:'ciphertext'}); w.emit({type:'packet',uid:'guest',data:'a'.repeat(8193)});
  assert.equal(packets.length,1); t.send('abc','guest');assert.equal(t.bufferedAmount,3);
  w.emit({type:'written',bytes:3});assert.equal(t.bufferedAmount,0);
  t.bufferedAmount=128*1024;assert.throws(()=>t.send('a','guest'),/achter/);assert.equal(w.terminated,true);
  t.close();assert.throws(()=>t.send('abc'),/niet verbonden/);
});
test('leaving during Tailcat startup rejects the pending open and releases the worker',async()=>{
  const t=new TailcatTransport({WorkerClass:Worker});const pending=t.open({host:true});const failed=assert.rejects(pending,/Tailcat/);
  t.close(); await failed;assert.equal(t.worker.terminated,true);
  const invalid=new TailcatTransport({WorkerClass:Worker});await assert.rejects(invalid.open({host:false,address:'bad'}),/Tailcat-adres/);assert.equal(invalid.worker,undefined);
});
