import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDemoRom } from '../scripts/demo-rom.js';
import { makeSnesFixture } from './snes-fixture.js';
import { romHash } from '../web/src/emulator.js';
import { createGameConfig, validateGameConfig, verifyLocalRom, peerMessage } from '../web/src/protocol.js';

test('game configuration carries only metadata, never the local ROM or a download URL', async () => {
  const bytes=makeDemoRom();
  const config=createGameConfig({bytes,hash:await romHash(bytes),system:'nes',name:'Room Rally',demo:true,overclock:200,
    url:'https://example.com/game.nes',base64:'not allowed'});
  const wire=peerMessage('control',{...config,bytes,data:[...bytes]});
  assert.deepEqual(Object.keys(wire).sort(),['type','version','name','system','size','hash','demo','overclock'].sort());
  assert.ok(JSON.stringify(wire).length<512);assert.equal(wire.overclock,200);
  for(const type of ['begin','complete','rom','file','chunk']) assert.throws(()=>peerMessage('control',{type,bytes}));
  assert.throws(()=>peerMessage('rom',config));
});

for(const system of ['nes','snes']) test(`${system}: guest must supply identical local bytes, including region/hack changes`, async () => {
  const bytes=system==='nes'?makeDemoRom():makeSnesFixture();
  const config=createGameConfig({bytes,hash:await romHash(bytes),system,name:'Host title',demo:false,overclock:200});
  assert.equal((await verifyLocalRom(bytes.slice(),config)).name,'Host title');
  const other=bytes.slice();other[100]^=1;
  await assert.rejects(verifyLocalRom(other,config),/komt niet overeen/);
  await assert.rejects(verifyLocalRom(bytes.subarray(1),config),/komt niet overeen/);
  assert.throws(()=>validateGameConfig({...config,version:'old-rom-transfer-version'}),/verschillende spelversies/);
  assert.throws(()=>validateGameConfig({...config,overclock:999}));
  assert.throws(()=>validateGameConfig({...config,size:32*1024*1024}));
});
