import { romHash } from './emulator.js';
import { validateOverclock } from './protocol.js';

const magic = new TextEncoder().encode('RRSTATE1');
const MAX_STATE = 16 * 1024 * 1024, MAX_HEADER = 4096;
export const MAX_SAVESTATE_FILE = magic.length + 4 + MAX_HEADER + MAX_STATE;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const hashPattern = /^[a-f0-9]{64}$/;

export async function encodeSavestate(state, game, build) {
  if (!(state instanceof Uint8Array) || !state.length || state.length > MAX_STATE) throw new Error('Ongeldige speltoestand.');
  const header = encoder.encode(JSON.stringify({ format: 'RetroRoom', version: 1, build,
    system: game.system, romHash: game.hash, overclock: validateOverclock(game.overclock),
    name: String(game.name).slice(0, 80), createdAt: new Date().toISOString(),
    stateSize: state.length, stateHash: await romHash(state) }));
  if (header.length > MAX_HEADER) throw new Error('Savestategegevens te groot.');
  const file = new Uint8Array(magic.length + 4 + header.length + state.length);
  file.set(magic); new DataView(file.buffer).setUint32(magic.length, header.length, true);
  file.set(header, magic.length + 4); file.set(state, magic.length + 4 + header.length);
  return file;
}

export async function decodeSavestate(bytes, game, build) {
  if (!(bytes instanceof Uint8Array) || bytes.length < magic.length + 4 || bytes.length > MAX_SAVESTATE_FILE ||
      !magic.every((value, index) => bytes[index] === value)) throw new Error('Kies een RetroRoom-savestate (.rrstate).');
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(magic.length, true);
  if (!size || size > MAX_HEADER || magic.length + 4 + size >= bytes.length) throw new Error('Deze savestate is beschadigd of onvolledig.');
  let manifest;
  try { manifest = JSON.parse(decoder.decode(bytes.subarray(magic.length + 4, magic.length + 4 + size))); }
  catch { throw new Error('De savestategegevens zijn niet leesbaar.'); }
  if (!manifest || manifest.format !== 'RetroRoom' || manifest.version !== 1 ||
      typeof manifest.build !== 'string' || !['nes', 'snes'].includes(manifest.system) ||
      !hashPattern.test(manifest.romHash) || !hashPattern.test(manifest.stateHash) ||
      !Number.isSafeInteger(manifest.stateSize) || manifest.stateSize < 1 || manifest.stateSize > MAX_STATE) {
    throw new Error('Ongeldig savestateformaat.');
  }
  validateOverclock(manifest.overclock);
  if (manifest.build !== build) throw new Error('Deze savestate hoort bij een andere emulatorversie.');
  if (manifest.system !== game.system || manifest.romHash !== game.hash) throw new Error('Deze savestate hoort bij een andere ROM. Laad exact dezelfde game, regio en ROM-hack.');
  if (manifest.overclock !== game.overclock) throw new Error(`Deze savestate gebruikt ${manifest.overclock}% CPU. Kies eerst dezelfde overclockinstelling.`);
  const state = bytes.slice(magic.length + 4 + size);
  if (state.length !== manifest.stateSize || await romHash(state) !== manifest.stateHash) throw new Error('Deze savestate is beschadigd of onvolledig.');
  return { state, manifest };
}

export function savestateFilename(name) {
  const stem = String(name).replace(/[^\p{L}\p{N} _.-]/gu, '').replace(/^\.+/, '').trim().slice(0, 60) || 'RetroRoom';
  return `${stem}-${new Date().toISOString().replace(/[:.]/g, '-')}.rrstate`;
}
