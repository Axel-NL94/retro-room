import { cp, mkdir, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeDemoRom } from './demo-rom.js';
const root = fileURLToPath(new URL('../', import.meta.url));
await rm(root + 'dist', { recursive: true, force: true });
await cp(root + 'web', root + 'dist', { recursive: true });
await mkdir(root + 'dist/vendor', { recursive: true });
await cp(root + 'node_modules/jsnes/dist/jsnes.min.js', root + 'dist/vendor/jsnes.min.js');
await cp(root + 'node_modules/jsnes/LICENSE', root + 'dist/vendor/JSNES-LICENSE.txt');
await cp(root + 'node_modules/peerjs/dist/peerjs.min.js', root + 'dist/vendor/peerjs.min.js');
await cp(root + 'node_modules/peerjs/LICENSE', root + 'dist/vendor/PEERJS-LICENSE.txt');
await writeFile(root + 'dist/assets/room-rally.nes', makeDemoRom());
// Keep all ES modules on the same build when GitHub Pages/browser caches differ.
const sourceFiles = [];
async function files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = dir + '/' + entry.name;
    if (entry.isDirectory()) await files(file);
    else sourceFiles.push(file);
  }
}
await files(root + 'dist');
const hash = createHash('sha256');
for (const file of sourceFiles.sort()) hash.update(await readFile(file));
const buildId = hash.digest('hex').slice(0, 12);
for (const file of sourceFiles.filter(f => /\.(js|html)$/.test(f) && !f.includes('/vendor/'))) {
  const source = await readFile(file, 'utf8');
  await writeFile(file, source.replace(/((?:\.\/|\.\.\/)[^'"\s<>]+\.(?:js|css|nes|svg|json))(?=['"])/g, `$1?v=${buildId}`));
}
await writeFile(root + 'dist/.nojekyll', '');
console.log('GitHub Pages-build gereed in dist/');
