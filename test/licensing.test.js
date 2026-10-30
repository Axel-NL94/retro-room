import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { checkLicensing, sha256 } from '../scripts/licensing.js';
import { applicationSources, sourceTar } from '../scripts/source-archive.js';

const root = fileURLToPath(new URL('../', import.meta.url));
function unpack(bytes) {
  const buffer = gunzipSync(bytes), files = new Map(); let pax = null;
  const string = field => field.toString('utf8').split('\0')[0];
  for (let offset = 0; offset + 512 <= buffer.length;) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const length = parseInt(string(header.subarray(124, 136)), 8);
    assert.ok(Number.isSafeInteger(length) && length >= 0);
    const recordedChecksum = parseInt(string(header.subarray(148, 156)), 8);
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    assert.equal(checksum, recordedChecksum, 'valid independent tar checksum');
    const body = buffer.subarray(offset + 512, offset + 512 + length);
    assert.equal(body.length, length, 'complete file payload');
    if (header[156] === 120) {
      const match = body.toString().match(/\d+ path=([^\n]+)\n/); pax = match?.[1] || null;
    } else {
      const prefix = string(header.subarray(345, 500));
      const name = pax || (prefix ? prefix + '/' : '') + string(header.subarray(0, 100));
      assert.ok(!name.startsWith('/') && !name.split('/').includes('..'));
      assert.ok(!files.has(name), 'no shadowed source entries'); files.set(name, body); pax = null;
    }
    offset += 512 + Math.ceil(length / 512) * 512;
  }
  return files;
}

test('all reviewed installed packages retain their complete license texts and pinned bundle sources', async () => {
  const manifest = await checkLicensing(root);
  assert.equal(manifest.npm.length, 8);
  assert.equal(manifest.distributionLicense, 'GPL-3.0-only');
  for (const id of ['gpl-3.0', 'lgpl-2.1', 'libpng', 'xbrz', 'mesen', 'musl', 'libcxx', 'dm-sans', 'space-grotesk']) {
    assert.ok(manifest.components.some(component => component.id === id));
  }
});

test('complete download is valid tar and retains exact application, native and PeerJS sources', async () => {
  const files = unpack(sourceTar(await applicationSources(root)));
  for (const file of ['web/src/app.js', 'web/src/controls.js', 'web/src/mesen.js', 'native/mesen-web.cpp', 'scripts/build-mesen.py',
    'scripts/package-mesen-source.py', 'scripts/source-archive.js', 'package.json', 'pnpm-lock.yaml',
    'LICENSING.md', 'LICENSE', 'web/THIRD-PARTY-NOTICES.txt', 'web/assets/mesen-source.tar.gz', 'web/assets/peerjs-source.tar.gz']) {
    assert.deepEqual(files.get('retro-room/' + file), await readFile(root + file), file);
  }
  const map = JSON.parse(await readFile(root + 'node_modules/peerjs/dist/peerjs.min.js.map', 'utf8'));
  map.sources.forEach((file, index) => {
    const name = file === '<anon>' ? 'parcel-generated-wrapper.js' : file;
    assert.equal(files.get('retro-room/vendor-source/peerjs-1.5.5/bundled-sources/' + name).toString(), map.sourcesContent[index]);
  });
  assert.ok(![...files.keys()].some(name => /retro-room\/(?:dist|\.git|node_modules)\//.test(name)));
  assert.ok(!files.has('retro-room/web/assets/retro-room-source.tar.gz'), 'no recursive source archive');
  assert.throws(() => sourceTar(new Map([['../escape.txt', Buffer.from('bad')]])), /bronpad/);
});

test('native distribution has matched Wasm, loader, build recipes and dated modification notices', async () => {
  const meta = JSON.parse(await readFile(root + 'web/assets/mesen-build.json', 'utf8'));
  for (const [file, hash] of [['mesen-core.wasm', meta.wasmSha256], ['mesen-core.mjs', meta.loaderSha256], [meta.sourceArchive, meta.sourceSha256]]) {
    assert.equal(sha256(await readFile(root + 'web/assets/' + file)), hash);
  }
  const files = unpack(await readFile(root + 'web/assets/mesen-source.tar.gz'));
  for (const file of ['native/mesen-web.cpp', 'native/README.md', 'native/CHANGES.md', 'scripts/build-mesen.py', 'scripts/package-mesen-source.py', 'web/THIRD-PARTY-NOTICES.txt']) {
    assert.deepEqual(files.get('retro-room/' + file), await readFile(root + file));
  }
  for (const file of ['Libretro/libretro.cpp', 'Core/Shared/Video/VideoDecoder.cpp', 'Core/Shared/Video/VideoRenderer.cpp']) {
    assert.match(files.get('mesen-src/' + file).toString().split('\n')[0], /RetroRoom.*2026-10-29/);
  }
  for (const prefix of meta.sourceScope) assert.ok([...files.keys()].some(name => name.startsWith('mesen-src/' + prefix + '/')));
  assert.ok(![...files.keys()].some(name => name.startsWith('mesen-src/UI/')));
  assert.equal(meta.license, 'GPL-3.0-only');
});

test('DOS download preserves matching bridge, build recipe, notices and dated upstream patches', async () => {
  const files=unpack(await readFile(root+'web/assets/dos-source.tar.gz'));
  for(const file of ['native/dos-web.cpp','native/dos-threads.h','native/DOSBOX.md','scripts/build-dos.py','scripts/package-dos-source.py','web/DOS-NOTICES.txt','LICENSING.md']) {
    assert.deepEqual(files.get('retro-room/'+file),await readFile(root+file));
  }
  for(const file of ['include/dbp_threads.h','include/config.h','src/gui/midi.cpp','dosbox_pure_libretro.cpp']) {
    assert.match(files.get('dosbox-pure/'+file).toString().split('\n')[0],/RetroRoom.*2026-10-30/);
  }
  assert.ok(files.has('dosbox-pure/LICENSE'));
  assert.ok(files.has('dosbox-pure/Makefile'));
  assert.ok(![...files.keys()].some(name=>/(?:\.git|web-obj|images)\//.test(name)));
});


test('Tailcat source kit retains every declared module, complete notices, and offline build inputs', async () => {
  const meta=JSON.parse(await readFile(root+'web/assets/tailcat-build.json','utf8'));
  const files=unpack(await readFile(root+'web/assets/'+meta.sourceArchive));
  assert.equal(meta.offlineRebuildVerified,true);assert.equal(meta.modules.length,22);
  for(const name of ['tailcat/LICENSE','tailcat/go.mod','tailcat/go.sum','tailcat/web/main_js.go','tailcat/vendor/modules.txt','tailcat/BUILD-TAGS.txt','BUILD-SOURCE.txt'])assert.ok(files.has(name),name);
  assert.deepEqual(files.get('retro-room/scripts/build-tailcat.py'),await readFile(root+'scripts/build-tailcat.py'));
  assert.equal(sha256(gunzipSync(await readFile(root+'web/assets/tailcat.wasm.gz'))),meta.wasmSha256);
  assert.equal(files.get('tailcat/BUILD-TAGS.txt').toString().trim(),meta.tags);
  const notices=await readFile(root+'web/TAILCAT-NOTICES.txt','utf8');
  for(const m of meta.modules)assert.ok(notices.includes(m.path),m.path);
  assert.ok(files.has('tailcat/vendor/gvisor.dev/gvisor/LICENSE'));
  assert.ok(files.has('tailcat/vendor/github.com/tailscale/wireguard-go/LICENSE'));
});
