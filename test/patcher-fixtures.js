import {crc32} from 'node:zlib';
export const bytes=text=>new TextEncoder().encode(text);
export function ips(records=[],truncate=null){
  const out=[...bytes('PATCH')],be=(n,count)=>Array.from({length:count},(_,i)=>Math.floor(n/256**(count-1-i))%256);
  for(const r of records){out.push(...be(r.at,3));if(r.data)out.push(...be(r.data.length,2),...r.data);else out.push(0,0,...be(r.count,2),r.value);}
  out.push(...bytes('EOF'));if(truncate!==null)out.push(...be(truncate,3));return Uint8Array.from(out);
}
export function bpsNumber(value){
  const out=[];for(;;){const byte=value%128;value=Math.floor(value/128);if(!value){out.push(byte|128);return out;}out.push(byte);value--;}
}
export const signed=value=>bpsNumber(Math.abs(value)*2+(value<0?1:0));
export const command=(action,length)=>bpsNumber((length-1)*4+action);
export function bps(source,target,commands,{metadata=bytes(''),sourceSize=source.length,targetSize=target.length,sourceCrc=crc32(source),targetCrc=crc32(target)}={}){
  const footer=Buffer.alloc(8);footer.writeUInt32LE(sourceCrc,0);footer.writeUInt32LE(targetCrc,4);
  const body=Buffer.from([...bytes('BPS1'),...bpsNumber(sourceSize),...bpsNumber(targetSize),...bpsNumber(metadata.length),...metadata,...commands,...footer]);
  const tail=Buffer.alloc(4);tail.writeUInt32LE(crc32(body));return new Uint8Array(Buffer.concat([body,tail]));
}
