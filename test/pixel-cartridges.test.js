import test from 'node:test';
import assert from 'node:assert/strict';
import {mergePixelCartridges,readPixelCartridges,findPixelCartridge} from '../web/src/pixel-cartridges.js';
import {streamMessage,STREAM_VERSION} from '../web/src/stream-protocol.js';
import {makePixelDemo} from '../scripts/demo-pixel-m8.js';
const bytes=makePixelDemo(),file=name=>({name,bytes});

test('cartridge collection rejects traversal, conflicting duplicates and path collisions before changing a collection',()=>{
  const current=[file('start.p8')];
  assert.equal(mergePixelCartridges(current,[file('start.p8')]).length,1);
  for(const name of ['../other.p8','/other.p8','c:\\other.p8','dir//other.p8','dir/./other.p8','bad\0.p8','data.exe'])assert.throws(()=>mergePixelCartridges(current,[file(name)]));
  const changed=bytes.slice();changed[changed.length-2]^=1;
  assert.throws(()=>mergePixelCartridges(current,[{name:'start.p8',bytes:changed}]),/dezelfde bestandsnaam/);
  assert.throws(()=>mergePixelCartridges(current,[file('start.p8/part2.p8')]),/mapnaam/);
  assert.equal(current.length,1);assert.equal(current[0].bytes,bytes);
});
test('cartridge count, individual size and combined size remain bounded across repeated imports',()=>{
  assert.throws(()=>mergePixelCartridges([],Array.from({length:129},(_,i)=>file(i+'.p8'))),/128/);
  const large=new Uint8Array(8*1024*1024);large.set(bytes.subarray(0,64));
  const collection=Array.from({length:8},(_,i)=>({name:i+'.p8',bytes:large}));
  assert.equal(mergePixelCartridges([],collection).length,8);
  assert.throws(()=>mergePixelCartridges(collection,[file('next.p8')]),/64 MB/);
  assert.throws(()=>mergePixelCartridges([],[{name:'large.p8',bytes:new Uint8Array(8*1024*1024+1)}]),/8 MB/);
});
test('BBS matching is case-insensitive and literal, prefers exact names, then highest numbered PNG version',()=>{
  const set=['dir/Test-2.p8.png','test-12.p8.png','test-3.p8.png','test_other.p8','tester.p8','test-999999999.p8.png'].map(file);
  assert.equal(findPixelCartridge(set,'#TEST').name,'test-12.p8.png');
  assert.equal(findPixelCartridge([...set,file('test.p8')],'#test').name,'test.p8');
  assert.equal(findPixelCartridge([...set,file('test.p8'),file('test.p8.png')],'#test').name,'test.p8.png');
  for(const id of ['#../test','#test.*','https://example.com/test.p8','#none'])assert.equal(findPixelCartridge(set,id),null);
});
test('local file reader preserves directory names and validates the whole selection',async()=>{
  const local=(name,size=bytes.length)=>({name,size,async arrayBuffer(){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}});
  assert.equal((await readPixelCartridges([{...local('part.p8'),webkitRelativePath:'level/part.p8'}]))[0].name,'level/part.p8');
  await assert.rejects(readPixelCartridges([local('part.p8',9*1024*1024)]),/8 MB/);
  await assert.rejects(readPixelCartridges([local('../part.p8')]),/relatieve/);
});
test('stream cartridge notices are epoch-bound metadata and cannot transmit files, paths or URLs',()=>{
  const token=crypto.randomUUID(),epoch=crypto.randomUUID(),message={type:'stream-cartridge',token,epoch,request:'#part2'};
  assert.deepEqual(streamMessage('control',{...message,bytes,files:[file('part2.p8')]}),message);
  assert.equal(streamMessage('control',{...message,request:''}).request,'');
  for(const bad of [{request:'../part.p8'},{request:'https://example.com/cart'},{request:'#'+'x'.repeat(65)},{epoch:'old'}])assert.throws(()=>streamMessage('control',{...message,...bad}));
  assert.throws(()=>streamMessage('input',message));assert.ok(STREAM_VERSION);
});
