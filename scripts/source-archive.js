import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

// Small deterministic USTAR writer: fixed source paths, ordinary files only, no shell/tool dependency.
export function sourceTar(entries) {
  const blocks = [];
  for (const [name, content] of [...entries].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    if (!name || name.startsWith('/') || name.split('/').includes('..') || /[\0\\]/.test(name)) throw new Error('Ongeldig bronpad: ' + name);
    const data = Buffer.from(content), header = Buffer.alloc(512);
    let base = name, prefix = '';
    if (Buffer.byteLength(base) > 100) {
      const index = name.lastIndexOf('/'); prefix = name.slice(0, index); base = name.slice(index + 1);
      if (Buffer.byteLength(prefix) > 155 || Buffer.byteLength(base) > 100) throw new Error('Te lang bronpad: ' + name);
    }
    header.write(base, 0, 100); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124); header.write('00000000000\0', 136);
    header.fill(32, 148, 156); header[156] = 48; header.write('ustar\0', 257); header.write('00', 263); header.write(prefix, 345, 155);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024)); return gzipSync(Buffer.concat(blocks), { level: 9 });
}

export async function applicationSources(root) {
  const entries = new Map();
  async function add(file) { entries.set('retro-room/' + file, await readFile(path.join(root, file))); }
  async function walk(folder) {
    for (const entry of await readdir(path.join(root, folder), { withFileTypes: true })) {
      const file = folder + '/' + entry.name;
      if (entry.isDirectory() && !['__pycache__', 'node_modules', '.git', 'dist'].includes(entry.name)) await walk(file);
      else if (entry.isFile() && file !== 'web/assets/retro-room-source.tar.gz') await add(file);
    }
  }
  for (const folder of ['web', 'native', 'scripts', 'server', 'test', '.github']) await walk(folder);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isFile() && (/\.md$/.test(entry.name) || ['LICENSE', 'package.json', 'pnpm-lock.yaml', 'Dockerfile', 'render.yaml', '.gitignore', '.dockerignore', '.env.example'].includes(entry.name))) await add(entry.name);
  }
  const prefix = 'retro-room/vendor-source/peerjs-1.5.5/';
  for (const file of ['package.json', 'LICENSE', 'dist/peerjs.min.js', 'dist/peerjs.min.js.map']) {
    entries.set(prefix + file, await readFile(path.join(root, 'node_modules/peerjs', file)));
  }
  const map = JSON.parse(entries.get(prefix + 'dist/peerjs.min.js.map'));
  map.sources.forEach((name, index) => {
    const file = name === '<anon>' ? 'parcel-generated-wrapper.js' : name;
    entries.set(prefix + 'bundled-sources/' + file, Buffer.from(map.sourcesContent[index]));
  });
  entries.set('retro-room/SOURCE-README.txt', Buffer.from(`RetroRoom corresponding source\n\nThis archive accompanies this exact website build. The combined Mesen-based\nprogram is distributed under GNU GPL version 3; separate MIT, BSD, LGPL, Apache\nand other upstream grants/notices remain intact. See LICENSING.md and\nweb/THIRD-PARTY-NOTICES.txt.\n\nWebsite: install Node.js 24 and pnpm 10.20.0, then run pnpm install\n--frozen-lockfile --ignore-scripts, pnpm build, pnpm dev.\n\nNative core: extract web/assets/mesen-source.tar.gz and follow native/README.md.\nThe pinned, already built Wasm and generated loader are also included.\nEmscripten 4.0.19 is an unmodified, separately obtainable free toolchain.\n\nPeerJS: web/assets/peerjs-source.tar.gz contains the official v1.5.5 source,\npackage-lock and build configuration. Its build:version step replaces the tag's\nlib/version.ts placeholder with package.json's 1.5.5. vendor-source/peerjs-1.5.5/\nalso preserves the exact published bundle, source map and all 37 original\nbundled source contents, including the embedded dependency code. These are\nseparate from the newer dependency versions resolved by RetroRoom's pnpm lock.\nRebuilding the upstream bundle uses its documented npm ci / npm run build steps.\n\nNo account, request or payment is required to obtain this source.\nNo commercial game ROMs or user files are included.\n`));
  return entries;
}
