import test from 'node:test';
import assert from 'node:assert/strict';
import {applyGamePatch,PATCH_LIMITS} from '../web/src/patcher-core.js';
import {translate} from '../web/src/i18n.js';
import {readFileSync} from 'node:fs';

const bytes=text=>new TextEncoder().encode(text),text=bytes=>new TextDecoder().decode(bytes);
const recipe=(operations=[{copy:[0,3]},{data:'ISE='}],size=5)=>({format:'hocus-coop-copy-patch-1',version:'0.3',target:{size},operations});
const apply=(patch,source=bytes('abcdef'))=>applyGamePatch({system:'dos',source,patch:bytes(JSON.stringify(patch)),format:'json'});

test('copy/literal DOS patches grow, shrink, reorder and repeat original bytes',async()=>{
  const source=bytes('abcdef'),original=source.slice();
  assert.equal(text((await apply(recipe(),source)).bytes),'abc!!');
  const patch=recipe([{copy:[3,3]},{data:'ISE='},{copy:[0,3]},{copy:[0,3]}],11);
  const result=await apply(patch,source);assert.equal(text(result.bytes),'def!!abcabc');
  assert.equal(result.verified,false);assert.deepEqual(source,original);
  assert.equal(text((await apply(recipe([{data:'IQ=='},{data:''}],1))).bytes),'!');
});
test('DOS copy patches do not compare source size, SHA-256 or target hash',async()=>{
  const patch=recipe();patch.source={size:1000,sha256:'not the selected file'};patch.target.sha256='not the result';
  assert.equal(text((await apply(patch)).bytes),'abc!!');
  patch.source=null;patch.target.sha256=null;
  assert.equal(text((await apply(patch,bytes('XYZ'))).bytes),'XYZ!!');
});
test('copy patch boundaries and integer validation remain enforced without version matching',async()=>{
  for(const copy of [[-1,1],[0,0],[1,-1],[0,1.5],[0,true],[true,1],[0,'2'],[Number.MAX_SAFE_INTEGER+1,1],[7,1],[5,2],[0,1,2],{},null]){
    await assert.rejects(()=>apply(recipe([{copy}],1)),/kopieerbewerking/);
  }
  await assert.rejects(()=>apply(recipe([{copy:[0,6]}],5)),/meer bytes/);
  await assert.rejects(()=>apply(recipe([{copy:[0,1]}],5)),/minder bytes/);
  await assert.rejects(()=>apply(recipe([{copy:[0,3]}],3),bytes('ab')),/buiten het gekozen bestand/);
});
test('malformed operations, Base64 and unbounded sizes cannot produce a download',async()=>{
  for(const operation of [null,[],{},'copy',{copy:[0,1],data:'IQ=='},{data:'IQ==',extra:1},{command:'run'}])await assert.rejects(()=>apply(recipe([operation],1)),/dubbelzinnige/);
  for(const data of ['?===','I Q==','IQ','I===','===','IQ===',12,null])await assert.rejects(()=>apply(recipe([{data}],1)),/Base64/);
  await assert.rejects(()=>apply(recipe([{data:'ISE='}],1)),/meer bytes/);
  for(const size of [0,-1,1.5,'5',null,PATCH_LIMITS.dos+1])await assert.rejects(()=>apply(recipe(undefined,size)),/tussen 1 byte/);
  for(const operations of [[],null,{},new Array(10001).fill({data:''})])await assert.rejects(()=>apply(recipe(operations)),/lijst met bewerkingen/);
});
test('large literal blocks are processed without regex stack overflow',async()=>{
  const literal=Buffer.alloc(256*1024,0xab);
  const result=await apply(recipe([{data:literal.toString('base64')}],literal.length));
  assert.deepEqual(result.bytes,new Uint8Array(literal));
});
test('all newly introduced DOS patch errors and status messages have English translations',()=>{
  const files=['patcher-core.js','patcher.js'];
  for(const file of files){
    const source=readFileSync(new URL('../web/src/'+file,import.meta.url),'utf8');
    const errors=[...source.matchAll(/throw new Error\('([^']+)'\)/g)].map(m=>m[1]).filter(message=>/DOS|JSON/.test(message));
    for(const message of errors)assert.notEqual(translate(message),message,'Missing translation: '+message);
  }
  assert.equal(translate('Klaar. Er is geen controle uitgevoerd op de DOS-bestandsversie of inhoud.'),'Done. The DOS file version and contents have not been verified.');
  assert.equal(translate('JSON · maximaal 4 MB'),'JSON · 4 MB max');
});
