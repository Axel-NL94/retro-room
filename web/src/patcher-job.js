// Each job gets an isolated worker. Cancellation discards its buffers and results.
export function startPatchJob(data,{WorkerClass=Worker,timeoutMs=30000}={}) {
  let worker,timer,settled=false,rejectJob;
  const finish=(error,result)=>{
    if(settled)return;settled=true;clearTimeout(timer);worker?.terminate();
    if(error)rejectJob(error);else resolveJob(result);
  };
  let resolveJob;
  const promise=new Promise((resolve,reject)=>{resolveJob=resolve;rejectJob=reject;});
  try{
    worker=new WorkerClass(new URL('./patcher-worker.js',import.meta.url),{type:'module'});
    worker.onmessage=({data:reply})=>finish(reply.error?new Error(reply.error):null,reply.result);
    worker.onerror=()=>finish(new Error('De patcher kon niet starten. Vernieuw de pagina en probeer opnieuw.'));
    worker.onmessageerror=()=>finish(new Error('Het patchresultaat kon niet worden gelezen.'));
    timer=setTimeout(()=>finish(new Error('Het patchen duurde te lang. Controleer de bestanden en probeer opnieuw.')),timeoutMs);
    worker.postMessage(data,[data.source,...(data.patch?[data.patch]:[])]);
  }catch(error){finish(error);}
  return {promise,cancel(){finish(new DOMException('Geannuleerd','AbortError'));}};
}
