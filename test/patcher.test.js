import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {crc32 as referenceCrc} from 'node:zlib';
import {applyIpsPatch,applyBpsPatch,applyGamePatch,inspectPatchSource,preparePatchSource,crc32,crc32Hex,sha256Hex,patchedFilename,PATCH_LIMITS} from '../web/src/patcher-core.js';
import {bytes,ips,bps,bpsNumber,command,signed} from './patcher-fixtures.js';
import {makeDemoRom} from '../scripts/demo-rom.js';
import {makeDosDemo} from '../scripts/demo-dos.js';
const text=b=>new TextDecoder().decode(b),sha=b=>createHash('sha256').update(b).digest('hex');
const json=value=>bytes(JSON.stringify(value));
async function dosPatch(source=bytes('abcd'),target=bytes('aBCd')){
  return {format:'RetroRoomBinaryPatch',version:1,source:{size:source.length,sha256:sha(source)},target:{sha256:sha(target)},patches:[{offset:1,before:'62 63',after:'42 43'}]};
}
test('fingerprints match standard vectors and independent CRC implementation',async()=>{
  assert.equal(crc32Hex(bytes('123456789')),'CBF43926');assert.equal(crc32(bytes('')),0);
  const source=makeDemoRom();assert.equal(crc32(source),referenceCrc(source));assert.equal(await sha256Hex(source),sha(source));
});
test('IPS literals, RLE, zero expansion and later overlapping records preserve original',()=>{
  const source=bytes('abcdefgh'),original=source.slice();
  const patch=ips([{at:1,data:bytes('XY')},{at:2,count:3,value:90},{at:10,data:bytes('!')}]);
  assert.deepEqual([...applyIpsPatch(source,patch)],[97,88,90,90,90,102,103,104,0,0,33]);assert.deepEqual(source,original);
  assert.deepEqual(applyIpsPatch(source,ips()),source);assert.notEqual(applyIpsPatch(source,ips()),source);
});
test('IPS optional truncate clips records and never expands just from truncate size',()=>{
  assert.equal(text(applyIpsPatch(bytes('abcdef'),ips([{at:2,data:bytes('WXYZ')}],4))),'abWX');
  assert.equal(text(applyIpsPatch(bytes('ab'),ips([],50))),'ab');
  assert.equal(text(applyIpsPatch(bytes('abc'),ips([{at:10,count:5,value:5}],2))),'ab');
});
test('IPS rejects malformed, empty, truncated and oversized results',()=>{
  const source=bytes('abc');for(const patch of [bytes('IPS32EOF'),bytes('PATCH'),bytes('PATCH\0\0\x01\0\x05xEOF'),bytes('PATCH\0\0\x01\0\0\0\0xEOF'),bytes('PATCHEOFx'),bytes('PATCH\0\0\x01\0\x01x')])assert.throws(()=>applyIpsPatch(source,patch));
  assert.throws(()=>applyIpsPatch(source,ips([],0)),/tussen 1 byte/);
  assert.throws(()=>applyIpsPatch(source,ips([{at:8,data:bytes('x')}]),8),/tussen 1 byte/);
});
test('BPS supports all actions, metadata and negative source-relative offsets',()=>{
  const source=bytes('ABCDEFGH'),target=bytes('ABxyEFABABxy');
  const commands=[...command(0,2),...command(1,2),...bytes('xy'),...command(2,2),...signed(4),...command(2,2),...signed(-6),...command(3,4),...signed(0)];
  assert.deepEqual(applyBpsPatch(source,bps(source,target,commands,{metadata:bytes('<script>ignored metadata</script>')})),target);
  assert.equal(text(source),'ABCDEFGH');
});
test('BPS overlapping TargetCopy, negative target-relative offsets and multi-byte varints',()=>{
  const source=bytes('unused'),target=bytes('abcabcabcabcab');
  const commands=[...command(1,3),...bytes('abc'),...command(3,9),...signed(0),...command(3,2),...signed(-9)];
  assert.deepEqual(applyBpsPatch(source,bps(source,target,commands)),target);
  const large=new Uint8Array(32768).fill(7);assert.deepEqual(applyBpsPatch(large,bps(large,large,command(0,large.length),{metadata:new Uint8Array(129)})),large);
  assert.ok(bpsNumber(32768).length>1);
});
test('BPS rejects wrong source, corrupt patch and wrong target checksum',()=>{
  const source=bytes('abcd'),target=bytes('abXd'),patch=bps(source,target,[...command(0,2),...command(1,2),...bytes('Xd')]);
  assert.deepEqual(applyBpsPatch(source,patch),target);
  assert.throws(()=>applyBpsPatch(bytes('abce'),patch),/andere ROM/);assert.throws(()=>applyBpsPatch(bytes('abc'),patch),/andere ROM/);
  const corrupt=patch.slice();corrupt[8]^=1;assert.throws(()=>applyBpsPatch(source,corrupt),/patchcontrole/);
  assert.throws(()=>applyBpsPatch(source,bps(source,target,[...command(1,4),...target],{targetCrc:0})),/resultaatcontrole/);
});
test('BPS rejects out-of-bounds reads, forward copies, missing/trailing commands and huge sizes',()=>{
  const source=bytes('ab'),target=bytes('xxxx');
  for(const commands of [command(0,4),[...command(2,4),...signed(-1)],[...command(2,4),...signed(1)],[...command(3,4),...signed(0)],[...command(1,4),1],[...command(1,5),1,2,3,4,5]])assert.throws(()=>applyBpsPatch(source,bps(source,target,commands)));
  assert.throws(()=>applyBpsPatch(source,bps(source,bytes('ab'),[...command(0,2),128])),/ongebruikte/);
  assert.throws(()=>applyBpsPatch(source,bps(source,target,[],{targetSize:PATCH_LIMITS.dos+1})),/tussen 1 byte/);
  assert.throws(()=>applyBpsPatch(source,bps(source,target,[],{targetSize:Number.MAX_SAFE_INTEGER})),/getal|tussen 1 byte/);
  assert.throws(()=>applyBpsPatch(source,bytes('BPS1bad')));
});
test('console validation and explicit SNES copier header handling',async()=>{
  const nes=makeDemoRom();assert.equal((await inspectPatchSource({system:'nes',source:nes})).sha256,sha(nes));
  assert.throws(()=>preparePatchSource('nes',bytes('not a ROM')),/NES-header/);assert.throws(()=>preparePatchSource('x',nes),/Kies eerst/);
  const snes=new Uint8Array(32768+512);snes[512]=42;
  assert.equal(preparePatchSource('snes',snes).length,33280);assert.equal(preparePatchSource('snes',snes,true)[0],42);
  assert.throws(()=>preparePatchSource('snes',new Uint8Array(32768),true),/geen herkenbare/);
  assert.throws(()=>preparePatchSource('snes',new Uint8Array(33000)),/uitgepakte/);assert.throws(()=>preparePatchSource('nes',nes,true),/Alleen SNES/);
  const headerless=snes.subarray(512),target=headerless.slice();target[2]=9;
  const patch=bps(headerless,target,[...command(1,3),...target.subarray(0,3),...command(0,target.length-3)]);
  await assert.rejects(()=>applyGamePatch({system:'snes',source:snes,patch,format:'bps'}),/andere ROM/);
  const result=await applyGamePatch({system:'snes',source:snes,patch,format:'bps',stripSnesHeader:true});assert.deepEqual(result.bytes,target);assert.equal(result.source.headerRemoved,true);
});
test('orchestration limits and formats, IPS result is explicitly unverified',async()=>{
  const source=makeDemoRom(),result=await applyGamePatch({system:'nes',source,patch:ips([{at:source.length-1,data:Uint8Array.of(7)}]),format:'ips'});
  assert.equal(result.verified,false);assert.equal(result.bytes.at(-1),7);assert.equal(result.sha256,sha(result.bytes));
  await assert.rejects(()=>applyGamePatch({system:'nes',source,patch:bytes('{}'),format:'json'}),/IPS- of BPS/);
  assert.throws(()=>preparePatchSource('dos',new Uint8Array(PATCH_LIMITS.dos+1)),/te groot/);
  assert.throws(()=>preparePatchSource('dos',new Uint8Array()),/leeg/);
});
test('DOS JSON patches validate source/target hashes and bytes without mutating source',async()=>{
  const source=bytes('abcd'),patch=await dosPatch();patch.source.sha256=patch.source.sha256.toUpperCase();
  const result=await applyGamePatch({system:'dos',source,patch:json(patch),format:'json'});
  assert.equal(text(result.bytes),'aBCd');assert.equal(text(source),'abcd');assert.equal(result.verified,true);
  patch.description='<script>never executed</script>';assert.equal(text((await applyGamePatch({system:'dos',source,patch:json(patch),format:'json'})).bytes),'aBCd');
});
test('DOS JSON rejects invalid metadata, unsupported edits, wrong base and corrupt results',async()=>{
  const base=await dosPatch(),source=bytes('abcd');
  const variants=[null,{}, {...base,version:2},{...base,source:{...base.source,size:9}}, {...base,source:{...base.source,sha256:'a'.repeat(64)}},{...base,target:{sha256:'a'.repeat(64)}},{...base,patches:[]}, {...base,patches:[{offset:-1,before:'62',after:'42'}]}, {...base,patches:[{offset:1.5,before:'62',after:'42'}]}, {...base,patches:[{offset:4,before:'62',after:'42'}]}, {...base,patches:[{offset:1,before:'61',after:'42'}]}, {...base,patches:[{offset:1,before:'62',after:'4243'}]}, {...base,patches:[{offset:1,before:'zz',after:'42'}]}, {...base,patches:[{offset:1,before:'',after:''}]}, {...base,patches:[...base.patches,...base.patches]}];
  for(const patch of variants)await assert.rejects(()=>applyGamePatch({system:'dos',source,patch:json(patch),format:'json'}));
  await assert.rejects(()=>applyGamePatch({system:'dos',source,patch:bytes('{bad'),format:'json'}),/geldig UTF-8 JSON/);
  await assert.rejects(()=>applyGamePatch({system:'dos',source,patch:ips(),format:'ips'}),/JSON-patch/);
});
test('shipped DOS example matches the actual original demo and changes its title',async()=>{
  const source=makeDosDemo(),patch=new Uint8Array(await readFile(new URL('../web/assets/dos-duo-example-patch.json',import.meta.url)));
  const result=await applyGamePatch({system:'dos',source,patch,format:'json'});
  assert.ok(text(result.bytes).includes('RETRO ROOM - DOS MOD'));assert.ok(text(source).includes('RETRO ROOM - DOS DUO'));
});
test('download filenames remain local, named copies with the correct extension',()=>{
  assert.equal(patchedFilename('game.nes','nes'),'game-patched.nes');assert.equal(patchedFilename('game.smc','snes',true),'game-patched.sfc');
  assert.equal(patchedFilename('GAME.EXE','dos'),'GAME-patched.EXE');assert.equal(patchedFilename('a/../b.nes','nes'),'a_.._b-patched.nes');
});
