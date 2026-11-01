// Original RetroRoom solo checkpoint container. Network snapshots use the native
// format separately; this bundle never enters a multiplayer data channel.
export const DOS_SOLO_STATE_LIMIT=97*1024*1024;
const MAX_NATIVE=64*1024*1024,MAX_DISK=32*1024*1024,MAX_HEADER=128*1024,MAX_FILES=512;
const magic=new TextEncoder().encode('RRDOS001'),encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const bad=()=>new Error('Deze DOS-savestate is beschadigd of heeft een onbekend formaat.');
function validPath(name){
  return typeof name==='string'&&name.length<=240&&!/[\\\x00-\x1f\x7f]/.test(name)&&name.split('/').every(part=>part&&part!=='.'&&part!=='..');
}
function validate(manifest){
  if(!manifest||manifest.version!==1||!Number.isSafeInteger(manifest.nativeSize)||manifest.nativeSize<16||manifest.nativeSize>MAX_NATIVE||
     !['zip','dosz','exe','com','bat'].includes(manifest.extension)||typeof manifest.program!=='string'||encoder.encode(manifest.program).length>1024||
     /[\x00-\x1f\x7f]/.test(manifest.program)||!Array.isArray(manifest.files)||manifest.files.length>MAX_FILES)throw bad();
  const names=new Set();let size=0;
  for(const file of manifest.files){
    if(!file||!validPath(file.name)||names.has(file.name)||!Number.isSafeInteger(file.size)||file.size<0)throw bad();
    names.add(file.name);size+=file.size;if(size>MAX_DISK)throw new Error('De tijdelijke DOS-schijf is te groot voor een savestate (maximaal 32 MB).');
  }
  for(const name of names){const parts=name.split('/');while(parts.length>1){parts.pop();if(names.has(parts.join('/')))throw bad();}}
  return size;
}
export function encodeDosSoloState(native,files,program,extension){
  if(!(native instanceof Uint8Array))throw bad();
  const manifest={version:1,nativeSize:native.length,program,extension,files:files.map(file=>({name:file.name,size:file.bytes.length}))};
  const diskSize=validate(manifest),header=encoder.encode(JSON.stringify(manifest));
  if(header.length>MAX_HEADER)throw bad();
  const bytes=new Uint8Array(12+header.length+native.length+diskSize);bytes.set(magic);
  new DataView(bytes.buffer).setUint32(8,header.length,true);bytes.set(header,12);bytes.set(native,12+header.length);
  let at=12+header.length+native.length;
  for(const file of files){if(!(file.bytes instanceof Uint8Array))throw bad();bytes.set(file.bytes,at);at+=file.bytes.length;}
  return bytes;
}
export function decodeDosSoloState(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<12||bytes.length>DOS_SOLO_STATE_LIMIT||!magic.every((b,i)=>bytes[i]===b))throw bad();
  const size=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(8,true);
  if(!size||size>MAX_HEADER||12+size>=bytes.length)throw bad();
  let manifest;try{manifest=JSON.parse(decoder.decode(bytes.subarray(12,12+size)));}catch{throw bad();}
  const diskSize=validate(manifest);if(12+size+manifest.nativeSize+diskSize!==bytes.length)throw bad();
  let at=12+size;const native=bytes.subarray(at,at+=manifest.nativeSize);
  const files=manifest.files.map(file=>({name:file.name,bytes:bytes.subarray(at,at+=file.size)}));
  return {native,files,program:manifest.program,extension:manifest.extension};
}
export function readDosSaveFiles(FS){
  const files=[];let total=0;
  function read(folder,depth=0){
    if(depth>8)throw bad();
    for(const name of FS.readdir('/saves'+(folder?'/'+folder:''))){
      if(name==='.'||name==='..')continue;
      const relative=folder?folder+'/'+name:name,path='/saves/'+relative,stat=FS.lstat(path);
      if(FS.isDir(stat.mode)){read(relative,depth+1);continue;}
      if(!FS.isFile(stat.mode)||!validPath(relative))throw bad();
      total+=stat.size;
      if(total>MAX_DISK)throw new Error('De tijdelijke DOS-schijf is te groot voor een savestate (maximaal 32 MB).');
      if(files.length>=MAX_FILES)throw bad();
      files.push({name:relative,bytes:FS.readFile(path)});
    }
  }
  read('');return files.sort((a,b)=>a.name.localeCompare(b.name,'en'));
}
export function writeDosSaveFiles(FS,files){
  for(const file of files){
    const parts=file.name.split('/');parts.pop();let path='/saves';
    for(const part of parts){path+='/'+part;if(!FS.analyzePath(path).exists)FS.mkdir(path);}
    FS.writeFile('/saves/'+file.name,file.bytes);FS.utime('/saves/'+file.name,1704067200000,1704067200000);
  }
}
