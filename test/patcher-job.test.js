import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startPatchJob} from '../web/src/patcher-job.js';
class FakeWorker {
  static instances=[];
  constructor(url,options){this.url=url;this.options=options;FakeWorker.instances.push(this);}
  postMessage(data,transfer){this.data=data;this.transfer=transfer;}
  terminate(){this.stopped=true;}
}
const input=()=>({type:'patch',source:new ArrayBuffer(10),patch:new ArrayBuffer(3)});
test('worker jobs transfer buffers and terminate on success',async()=>{
  const data=input(),job=startPatchJob(data,{WorkerClass:FakeWorker});const worker=FakeWorker.instances.at(-1);
  assert.equal(worker.options.type,'module');assert.deepEqual(worker.transfer,[data.source,data.patch]);
  worker.onmessage({data:{result:{size:10}}});assert.deepEqual(await job.promise,{size:10});assert.equal(worker.stopped,true);job.cancel();
});
test('cancelled job rejects once, terminates, and late results cannot replace a newer result',async()=>{
  const old=startPatchJob(input(),{WorkerClass:FakeWorker}),oldWorker=FakeWorker.instances.at(-1);
  const rejected=assert.rejects(old.promise,{name:'AbortError'});old.cancel();await rejected;
  const next=startPatchJob(input(),{WorkerClass:FakeWorker}),nextWorker=FakeWorker.instances.at(-1);
  oldWorker.onmessage({data:{result:'stale'}});nextWorker.onmessage({data:{result:'current'}});
  assert.equal(await next.promise,'current');assert.equal(oldWorker.stopped,true);
});
test('worker validation errors, load errors, clone errors, timeout and constructor errors clean up',async()=>{
  for(const event of ['validation','load','clone','timeout']){
    const job=startPatchJob(input(),{WorkerClass:FakeWorker,timeoutMs:event==='timeout'?1:30000}),worker=FakeWorker.instances.at(-1);
    const rejected=assert.rejects(job.promise);
    if(event==='validation')worker.onmessage({data:{error:'invalid patch'}});else if(event==='load')worker.onerror();else if(event==='clone')worker.onmessageerror();
    await rejected;assert.equal(worker.stopped,true);
  }
  const job=startPatchJob(input(),{WorkerClass:class {constructor(){throw Error('blocked');}}});await assert.rejects(job.promise,/blocked/);
});
