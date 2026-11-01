import {crc32} from 'node:zlib';
// Original uncompressed ZIP writer for DOS checkpoint tests, no game assets.
export function dosZip(entries){
  let offset=0;const parts=[],central=[];
  for(const [name,data] of entries){
    const path=Buffer.from(name),body=Buffer.from(data),crc=crc32(body),local=Buffer.alloc(30),entry=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(path.length,26);
    entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(body.length,20);entry.writeUInt32LE(body.length,24);entry.writeUInt16LE(path.length,28);entry.writeUInt32LE(offset,42);
    parts.push(local,path,body);central.push(entry,path);offset+=local.length+path.length+body.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return new Uint8Array(Buffer.concat([...parts,directory,end]));
}
// Original 8086 fixture. W creates SAVE.DAT, A appends using the still-open
// handle, and R rereads it. Counter/readback live at physical RAM 90000/2/4.
export function dosDiskFixture(){
  const out=[],labels=new Map(),refs=[];
  const emit=(...b)=>out.push(...b),word=n=>emit(n&255,n>>8&255),label=n=>labels.set(n,out.length);
  const address=n=>{refs.push({at:out.length,name:n,relative:false});word(0);};
  const jump=n=>{emit(0xe9);refs.push({at:out.length,name:n,relative:true});word(0);};
  const equal=n=>{emit(0x75,3);jump(n);};
  const dx=n=>{emit(0xba);address(n);},ax=n=>{emit(0xb8);word(n);},interrupt=()=>emit(0xcd,0x21);
  emit(0x0e,0x1f);ax(0x9000);emit(0x8e,0xc0);
  label('loop');emit(0xb4,1,0xcd,0x16,0x74,0xfa,0x30,0xe4,0xcd,0x16);
  emit(0x3c,119);equal('write');emit(0x3c,97);equal('append');emit(0x3c,114);equal('read');jump('loop');
  label('write');ax(0x3c00);emit(0x31,0xc9);dx('filename');interrupt();emit(0xa3);address('handle');jump('append');
  label('append');emit(0xff,0x06);address('value');emit(0xa1);address('value');emit(0x26,0xa3);word(0);
  emit(0x8b,0x1e);address('handle');dx('value');emit(0xb9,2,0,0xb4,0x40);interrupt();jump('loop');
  label('read');ax(0x3d00);dx('filename');interrupt();emit(0x89,0xc3);dx('buffer');emit(0xb9,4,0,0xb4,0x3f);interrupt();
  emit(0xb4,0x3e);interrupt();emit(0xa1);address('buffer');emit(0x26,0xa3);word(2);emit(0xa1);address('buffer2');emit(0x26,0xa3);word(4);jump('loop');
  label('handle');word(0);label('value');word(0);label('buffer');word(0);label('buffer2');word(0);label('filename');emit(...new TextEncoder().encode('SAVE.DAT'),0);
  for(const {at,name,relative} of refs){const n=relative?labels.get(name)-at-2:labels.get(name)+0x100;out[at]=n&255;out[at+1]=n>>8&255;}
  return new Uint8Array(out);
}
