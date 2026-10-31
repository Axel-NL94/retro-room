// Original RetroRoom implementation of the published IPS/BPS formats and
// RetroRoomBinaryPatch v1. No executable patch code is evaluated.
export const PATCH_LIMITS = Object.freeze({nes: 8*1024*1024, snes: 8*1024*1024, dos: 32*1024*1024});
export const MAX_PATCH_BYTES = 32*1024*1024;
export const MAX_JSON_PATCH_BYTES = 4*1024*1024;
const crcTable = Uint32Array.from({length:256},(_,i)=>{
  let value=i;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);return value>>>0;
});
export function crc32(bytes) {
  let crc=0xffffffff;for(const byte of bytes)crc=(crc>>>8)^crcTable[(crc^byte)&255];return (crc^0xffffffff)>>>0;
}
export const crc32Hex = bytes => crc32(bytes).toString(16).padStart(8,'0').toUpperCase();
export async function sha256Hex(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
function byteArray(bytes, limit, description) {
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>limit)throw new Error(`${description} is leeg of te groot (maximaal ${limit/1024/1024} MB).`);
}
function outputSize(size,limit) {
  if(!Number.isSafeInteger(size)||size<1||size>limit)throw new Error(`Het gepatchte bestand moet tussen 1 byte en ${limit/1024/1024} MB blijven.`);
}
function magic(bytes,text) {return [...text].every((char,i)=>bytes[i]===char.charCodeAt(0));}
function little32(bytes,at) {return (bytes[at]|bytes[at+1]<<8|bytes[at+2]<<16|bytes[at+3]<<24)>>>0;}

// Two passes avoid retaining a potentially enormous list of tiny IPS records.
function walkIps(patch,write=()=>{}) {
  if(patch.length<8||!magic(patch,'PATCH'))throw new Error('Dit is geen geldig IPS-bestand. Kies .ips of .bps, geen IPS32.');
  let at=5,extent=0;
  const need=count=>{if(at+count>patch.length)throw new Error('De IPS-patch is afgebroken of beschadigd.');};
  const number=count=>{need(count);let value=0;while(count--)value=value*256+patch[at++];return value;};
  while(true){
    const offset=number(3);
    if(offset===0x454f46){
      const remaining=patch.length-at;
      if(remaining!==0&&remaining!==3)throw new Error('Ongeldige gegevens na het IPS-einde.');
      return {extent,truncate:remaining?number(3):null};
    }
    let length=number(2),dataAt=-1,value=0;
    if(length){need(length);dataAt=at;at+=length;}
    else {length=number(2);if(!length)throw new Error('Een IPS-herhaalblok mag niet leeg zijn.');value=number(1);}
    extent=Math.max(extent,offset+length);write(offset,length,dataAt,value);
  }
}
export function applyIpsPatch(source,patch,limit=PATCH_LIMITS.dos) {
  byteArray(patch,MAX_PATCH_BYTES,'De patch');
  const {extent,truncate}=walkIps(patch);
  let size=Math.max(source.length,extent);if(truncate!==null)size=Math.min(size,truncate);
  outputSize(size,limit);
  const output=new Uint8Array(size);output.set(source.subarray(0,size));
  walkIps(patch,(offset,length,dataAt,value)=>{
    if(offset>=size)return;length=Math.min(length,size-offset);
    if(dataAt<0)output.fill(value,offset,offset+length);else output.set(patch.subarray(dataAt,dataAt+length),offset);
  });
  return output;
}
export function applyBpsPatch(source,patch,limit=PATCH_LIMITS.dos) {
  byteArray(patch,MAX_PATCH_BYTES,'De patch');
  if(patch.length<19||!magic(patch,'BPS1'))throw new Error('Dit is geen geldig BPS-bestand.');
  const end=patch.length-12;
  if(crc32(patch.subarray(0,patch.length-4))!==little32(patch,patch.length-4))throw new Error('De BPS-patch is beschadigd: de patchcontrole klopt niet.');
  let at=4;
  const need=count=>{if(!Number.isSafeInteger(count)||count<0||at+count>end)throw new Error('De BPS-patch is afgebroken of beschadigd.');};
  const number=()=>{
    let value=0,shift=1;
    for(;;){
      need(1);const byte=patch[at++];value+=(byte&127)*shift;
      if(!Number.isSafeInteger(value))throw new Error('Ongeldig getal in de BPS-patch.');
      if(byte&128)return value;
      shift*=128;value+=shift;
      if(!Number.isSafeInteger(value)||!Number.isSafeInteger(shift))throw new Error('Ongeldig getal in de BPS-patch.');
    }
  };
  const sourceSize=number(),size=number(),metadata=number();
  outputSize(size,limit);need(metadata);at+=metadata;
  if(sourceSize!==source.length||crc32(source)!==little32(patch,end))throw new Error('Deze BPS-patch hoort bij een andere ROM-versie. Controleer regio, revisie en bij SNES de 512-byte kopieerheader.');
  const output=new Uint8Array(size);let written=0,sourcePosition=0,targetPosition=0;
  while(written<size){
    const command=number(),action=command%4,length=Math.floor(command/4)+1;
    if(length>size-written)throw new Error('Een BPS-blok schrijft buiten het resultaat.');
    if(action===0){
      if(written+length>source.length)throw new Error('Een BPS-blok leest buiten de originele ROM.');
      output.set(source.subarray(written,written+length),written);written+=length;
    }else if(action===1){
      need(length);output.set(patch.subarray(at,at+length),written);at+=length;written+=length;
    }else if(action===2){
      const relative=number();sourcePosition+=(relative%2?-1:1)*Math.floor(relative/2);
      if(!Number.isSafeInteger(sourcePosition)||sourcePosition<0||sourcePosition+length>source.length)throw new Error('Een BPS-kopie leest buiten de originele ROM.');
      output.set(source.subarray(sourcePosition,sourcePosition+length),written);sourcePosition+=length;written+=length;
    }else{
      const relative=number();targetPosition+=(relative%2?-1:1)*Math.floor(relative/2);
      if(!Number.isSafeInteger(targetPosition)||targetPosition<0||targetPosition>=written)throw new Error('Een BPS-kopie verwijst naar nog niet geschreven gegevens.');
      // Overlap is part of BPS TargetCopy: do not replace with slice/set.
      for(let i=0;i<length;i++)output[written++]=output[targetPosition++];
    }
  }
  if(at!==end)throw new Error('De BPS-patch bevat ongebruikte of ongeldige blokken.');
  if(crc32(output)!==little32(patch,end+4))throw new Error('De BPS-resultaatcontrole klopt niet. Er wordt geen bestand aangeboden.');
  return output;
}
function hexBytes(value) {
  if(typeof value!=='string')throw new Error('DOS-patchbytes moeten als hexadecimale tekst worden opgegeven.');
  const hex=value.replace(/\s+/g,'');
  if(!hex.length||hex.length%2||!/^[0-9a-f]+$/i.test(hex))throw new Error('Ongeldige hexadecimale bytes in de DOS-patch.');
  return Uint8Array.from(hex.match(/../g),byte=>parseInt(byte,16));
}
function digest(value) {return typeof value==='string'&&/^[0-9a-f]{64}$/i.test(value)?value.toLowerCase():null;}
function applyDosJson(source,patch,sourceHash) {
  byteArray(patch,MAX_JSON_PATCH_BYTES,'De JSON-patch');
  let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(patch));}
  catch{throw new Error('De JSON-patch is geen geldig UTF-8 JSON-bestand.');}
  if(!value||value.format!=='RetroRoomBinaryPatch'||value.version!==1||!digest(value.source?.sha256)||!digest(value.target?.sha256)||
     !Number.isSafeInteger(value.source?.size)||!Array.isArray(value.patches)||!value.patches.length||value.patches.length>10000) {
    throw new Error('Gebruik het RetroRoomBinaryPatch JSON-formaat versie 1. Bekijk het DOS-voorbeeld.');
  }
  if(value.source.size!==source.length||digest(value.source.sha256)!==sourceHash)throw new Error('Deze DOS-patch hoort bij een ander origineel bestand. De grootte of SHA-256 komt niet overeen.');
  const edits=value.patches.map(edit=>{
    if(!edit||!Number.isSafeInteger(edit.offset)||edit.offset<0)throw new Error('Een DOS-patchpositie moet een positief geheel byteadres zijn, beginnend bij 0.');
    const before=hexBytes(edit.before),after=hexBytes(edit.after);
    if(before.length!==after.length||edit.offset+before.length>source.length)throw new Error('DOS-wijzigingen moeten evenveel bytes vervangen en binnen het originele bestand blijven.');
    return {offset:edit.offset,before,after};
  }).sort((a,b)=>a.offset-b.offset);
  let previousEnd=0;
  for(const edit of edits){
    if(edit.offset<previousEnd)throw new Error('DOS-patchwijzigingen mogen elkaar niet overlappen.');
    previousEnd=edit.offset+edit.before.length;
    if(edit.before.some((byte,index)=>source[edit.offset+index]!==byte))throw new Error(`De oorspronkelijke DOS-bytes op positie ${edit.offset} komen niet overeen.`);
  }
  const bytes=source.slice();for(const edit of edits)bytes.set(edit.after,edit.offset);
  return {bytes,targetHash:digest(value.target.sha256)};
}
export function preparePatchSource(system,source,stripSnesHeader=false) {
  const limit=PATCH_LIMITS[system];if(!limit)throw new Error('Kies eerst NES, SNES of MS-DOS.');
  byteArray(source,limit+(system==='snes'?512:0),'Het originele bestand');
  if(system==='nes'&&(source.length<16||!magic(source,'NES\x1a')))throw new Error('Kies een NES-ROM met een geldige NES-header.');
  if(system==='snes'){
    if(source.length<32768||![0,512].includes(source.length%1024))throw new Error('Kies een uitgepakte SNES-ROM (.sfc of .smc).');
    if(stripSnesHeader){
      if(source.length%1024!==512)throw new Error('Deze SNES-ROM heeft geen herkenbare 512-byte kopieerheader.');
      return source.subarray(512);
    }
  }else if(stripSnesHeader)throw new Error('Alleen SNES kan een kopieerheader hebben.');
  return source;
}
export async function inspectPatchSource({system,source,stripSnesHeader=false}) {
  const bytes=preparePatchSource(system,source,stripSnesHeader);
  return {size:bytes.length,sha256:await sha256Hex(bytes),crc32:crc32Hex(bytes),headerRemoved:stripSnesHeader};
}
export async function applyGamePatch({system,source,patch,format,stripSnesHeader=false}) {
  const bytes=preparePatchSource(system,source,stripSnesHeader),sourceInfo=await inspectPatchSource({system,source,stripSnesHeader});
  let output,expectedHash;
  if(system==='dos'){
    if(format!=='json')throw new Error('Kies voor MS-DOS een RetroRoom JSON-patch.');
    const result=applyDosJson(bytes,patch,sourceInfo.sha256);output=result.bytes;expectedHash=result.targetHash;
  }else if(format==='ips')output=applyIpsPatch(bytes,patch,PATCH_LIMITS[system]);
  else if(format==='bps')output=applyBpsPatch(bytes,patch,PATCH_LIMITS[system]);
  else throw new Error('Kies voor NES/SNES een IPS- of BPS-patch.');
  const sha256=await sha256Hex(output);
  if(expectedHash&&sha256!==expectedHash)throw new Error('De DOS-resultaatcontrole klopt niet. Controleer het JSON-patchbestand.');
  return {bytes:output,source:sourceInfo,size:output.length,sha256,crc32:crc32Hex(output),format,verified:format!=='ips'};
}
export function patchedFilename(name,system,stripSnesHeader=false) {
  const clean=String(name).replace(/[\x00-\x1f<>:"/\\|?*]/g,'_').slice(0,160);
  const dot=clean.lastIndexOf('.'),base=(dot>0?clean.slice(0,dot):clean)||'game';
  const ext=system==='nes'?'.nes':system==='snes'&&stripSnesHeader?'.sfc':dot>0?clean.slice(dot):'.bin';
  return base+'-patched'+ext;
}
