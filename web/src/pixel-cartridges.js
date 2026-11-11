// SPDX-License-Identifier: MIT
export const MAX_PIXEL_CART = 8 * 1024 * 1024;
export const MAX_PIXEL_COLLECTION = 64 * 1024 * 1024;
export const MAX_PIXEL_FILES = 128;

export function pixelCartridgePath(name) {
  if (typeof name !== 'string' || !name || name.length > 512 || /[\x00-\x1f\x7f\\:]/.test(name) || name.startsWith('/') ||
      name.split('/').some(part => !part || part === '.' || part === '..' || part.length > 255) || !/\.p8(?:\.png)?$/i.test(name)) {
    throw new Error('Gebruik een relatieve cartridgenaam met .p8 of .p8.png, zonder bovenliggende mappen.');
  }
  return name;
}
export function validatePixelCart(bytes, name) {
  pixelCartridgePath(name);
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_PIXEL_CART) throw new Error('Kies een PICO-8-cartridge van maximaal 8 MB (.p8 of .p8.png).');
  const png = /\.p8\.png$/i.test(name);
  if (png ? ![137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)
    : !new TextDecoder().decode(bytes.subarray(0,64)).startsWith('pico-8 cartridge')) {
    throw new Error('Dit is geen geldige .p8- of .p8.png-cartridge.');
  }
}
export function mergePixelCartridges(current = [], incoming = []) {
  if (!Array.isArray(current) || !Array.isArray(incoming) || current.length + incoming.length > MAX_PIXEL_FILES * 2) throw new Error('Kies maximaal 128 cartridges, samen maximaal 64 MB.');
  const files = new Map(); let total = 0;
  for (const file of [...current, ...incoming]) {
    validatePixelCart(file?.bytes, file?.name);
    const previous = files.get(file.name);
    if (previous) {
      if (previous.bytes.length !== file.bytes.length || !previous.bytes.every((v,i) => v === file.bytes[i])) throw new Error('Er zijn verschillende cartridges met dezelfde bestandsnaam. Kies één versie per naam.');
      continue;
    }
    total += file.bytes.length;
    if (files.size >= MAX_PIXEL_FILES || total > MAX_PIXEL_COLLECTION) throw new Error('Kies maximaal 128 cartridges, samen maximaal 64 MB.');
    // A file cannot also serve as a directory, even when added in a later batch.
    for (const name of files.keys()) if (name.startsWith(file.name + '/') || file.name.startsWith(name + '/')) throw new Error('Een cartridgenaam botst met een mapnaam.');
    files.set(file.name, {name:file.name, bytes:file.bytes});
  }
  return [...files.values()];
}
export async function readPixelCartridges(fileList) {
  const files = Array.from(fileList);
  if (files.length > MAX_PIXEL_FILES || files.reduce((n,f) => n + f.size, 0) > MAX_PIXEL_COLLECTION) throw new Error('Kies maximaal 128 cartridges, samen maximaal 64 MB.');
  const result = [];
  for (const file of files) {
    const name = pixelCartridgePath(file.webkitRelativePath || file.name);
    if (file.size > MAX_PIXEL_CART) throw new Error('Kies een PICO-8-cartridge van maximaal 8 MB (.p8 of .p8.png).');
    result.push({name, bytes:new Uint8Array(await file.arrayBuffer())});
  }
  return mergePixelCartridges([], result);
}

// BBS IDs identify imported files; they are never converted into network URLs.
export function findPixelCartridge(files, request) {
  if (typeof request !== 'string' || !/^#[a-z0-9_-]{1,64}$/i.test(request)) return null;
  const id = request.slice(1).toLowerCase(), matches = [];
  for (const file of files) {
    const name = file.name.split('/').pop().toLowerCase();
    if (name === id + '.p8.png') matches.push({file, version:0, rank:0});
    else if (name === id + '.p8') matches.push({file, version:0, rank:1});
    else if (name.startsWith(id + '-') && /^\d{1,8}\.p8\.png$/.test(name.slice(id.length + 1))) matches.push({file, version:Number(name.slice(id.length + 1, -7)), rank:2});
  }
  // Mirror native lookup: exact names precede highest numbered PNG revisions.
  matches.sort((a,b) => a.rank - b.rank || b.version - a.version || a.file.name.localeCompare(b.file.name, 'en'));
  return matches[0]?.file || null;
}
