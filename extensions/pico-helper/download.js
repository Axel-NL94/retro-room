// SPDX-License-Identifier: MIT
export const MAX_DOWNLOAD = 4 * 1024 * 1024;
const ORIGIN = 'https://www.lexaloffle.com';
export function cartridgeId(value) {
  if (typeof value !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(value)) throw new Error('invalid-id');
  return value.toLowerCase();
}
export function allowedPage(value) {
  try { const url = new URL(value); return url.origin === 'https://axel-nl94.github.io' && url.pathname.startsWith('/retro-room/'); }
  catch { return false; }
}
export function cartridgeUrl(html, id) {
  id = cartridgeId(id); let fallback;
  // Data links only: never execute code from a cartridge-information page.
  for (const match of html.matchAll(/\bhref\s*=\s*(["'])(.*?)\1/gi)) {
    let url; try { url = new URL(match[2], ORIGIN); } catch { continue; }
    if (!['https://www.lexaloffle.com','https://lexaloffle.com'].includes(url.origin) || url.username || url.password || url.search || url.hash) continue;
    const path = /^\/bbs\/cposts\/[a-z0-9_-]{1,64}\/([a-z0-9_-]+)\.p8\.png$/i.exec(url.pathname);
    if (!path) continue;
    const name = path[1].toLowerCase();
    if (name === id || name.startsWith(id + '-') && /^\d+$/.test(name.slice(id.length + 1))) return url.href;
    if (/^\d+$/.test(id)) fallback ||= url.href;
  }
  if (fallback) return fallback;
  throw new Error('not-found');
}
export function png(bytes) {
  return bytes instanceof Uint8Array && bytes.length >= 33 && bytes.length <= MAX_DOWNLOAD &&
    [137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value) &&
    String.fromCharCode(...bytes.subarray(12,16)) === 'IHDR' &&
    new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(16) === 160 &&
    new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(20) === 205;
}
async function read(response, limit) {
  if (!response.ok || response.type === 'opaqueredirect') throw new Error('download-failed');
  if (Number(response.headers.get('content-length')) > limit) throw new Error('too-large');
  const reader = response.body?.getReader(); if (!reader) throw new Error('download-failed');
  const chunks = []; let size = 0;
  try {
    for (;;) { const {done,value} = await reader.read(); if (done) break;
      size += value.length; if (size > limit) { await reader.cancel(); throw new Error('too-large'); } chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  return bytes;
}
export async function downloadCartridge(value, {fetcher = fetch, signal} = {}) {
  const id = cartridgeId(value);
  const get = async (url,limit) => read(await fetcher(url,{signal,redirect:'error',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'}),limit);
  const metadata = await get(ORIGIN + '/bbs/cart_info.php?cid=' + encodeURIComponent(id),512 * 1024);
  const bytes = png(metadata) ? metadata : await get(cartridgeUrl(new TextDecoder().decode(metadata),id),MAX_DOWNLOAD);
  if (!png(bytes)) throw new Error('invalid-cartridge');
  return {id,bytes};
}
export function toBase64(bytes) {
  let text = ''; for (let i=0;i<bytes.length;i+=8192) text += String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(text);
}
