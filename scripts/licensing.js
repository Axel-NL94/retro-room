import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const sha256 = data => createHash('sha256').update(data).digest('hex');
export async function checkLicensing(root) {
  const manifest = JSON.parse(await readFile(path.join(root, 'web/assets/license-manifest.json'), 'utf8'));
  const notices = await readFile(path.join(root, 'web/THIRD-PARTY-NOTICES.txt'), 'utf8');
  const project = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  for (const [name, version] of Object.entries(project.dependencies)) {
    if (!manifest.npm.some(item => item.name === name && item.version === version)) throw new Error('Licentiecontrole ontbreekt voor ' + name + '@' + version);
  }
  for (const item of manifest.npm) {
    let folder;
    try { folder = await realpath(path.join(root, 'node_modules', item.name)); }
    catch { folder = await realpath(path.join(root, 'node_modules/.pnpm/node_modules', item.name)); }
    const pkg = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'));
    const text = await readFile(path.join(folder, item.licenseFile), 'utf8');
    if (pkg.name !== item.name || pkg.version !== item.version || pkg.license !== item.license || sha256(text) !== item.noticeSha256 || !notices.includes(text.trim())) {
      throw new Error('Afhankelijkheid of licentietekst gewijzigd; opnieuw beoordelen: ' + item.name);
    }
  }
  for (const item of manifest.components) {
    const marker = '\n' + item.id + ' — ' + item.name + '\n';
    const start = notices.indexOf(marker);
    if (start < 0) throw new Error('Ontbrekende auteursvermelding: ' + item.id);
    const bodyStart = notices.indexOf('='.repeat(76) + '\n\n', start) + 78;
    let end = notices.indexOf('\n\n' + '='.repeat(76) + '\n', bodyStart);
    if (end < 0) end = notices.length;
    const body = notices.slice(bodyStart, end).replace(/\n+$/, '');
    if (sha256(body) !== item.noticeSha256) throw new Error('Licentietekst gewijzigd: ' + item.id);
  }
  for (const [file, hash] of [
    ['web/assets/peerjs-source.tar.gz', manifest.peerjsSourceSha256],
    ['node_modules/peerjs/dist/peerjs.min.js', manifest.peerjsBundleSha256],
    ['node_modules/peerjs/dist/peerjs.min.js.map', manifest.peerjsSourceMapSha256]
  ]) {
    if (sha256(await readFile(path.join(root, file))) !== hash) throw new Error('Niet beoordeelde PeerJS-bron/bundel: ' + file);
  }
  const map = JSON.parse(await readFile(path.join(root, 'node_modules/peerjs/dist/peerjs.min.js.map'), 'utf8'));
  if (map.sources.length !== map.sourcesContent.length || map.sourcesContent.some(source => typeof source !== 'string')) {
    throw new Error('De oorspronkelijke PeerJS-bronbestanden ontbreken in de sourcemap.');
  }
  const dos = JSON.parse(await readFile(path.join(root, 'web/assets/dos-build.json'), 'utf8'));
  if (dos.license !== 'GPL-3.0-only' || dos.upstreamLicense !== 'GPL-2.0-or-later') throw new Error('Controleer de DOS-licentie opnieuw.');
  for (const [file, hash] of [['assets/dos-core.wasm', dos.wasmSha256], ['assets/dos-core.mjs', dos.loaderSha256], ['assets/' + dos.sourceArchive, dos.sourceSha256], ['DOS-NOTICES.txt', dos.noticesSha256]]) {
    if (sha256(await readFile(path.join(root, 'web', file))) !== hash) throw new Error('DOS-build, notices en broncode komen niet overeen: ' + file);
  }
  return manifest;
}
