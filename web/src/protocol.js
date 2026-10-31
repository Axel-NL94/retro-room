import {validateDosPolicy} from './dos-policy.js';
import {validateDosInput} from './dos-input.js';
import { romHash } from './emulator.js';
import { streamMessage } from './stream-protocol.js';

export const NETPLAY_VERSION = 'retroroom-mesence-4c4e069-dos-sharing-3-tailcat-9';
export const INVITE_VERSION = 9;
export const OVERCLOCK_VALUES = Object.freeze([100, 200, 300, 400, 500]);
export function validateOverclock(value) {
  if (!OVERCLOCK_VALUES.includes(value)) throw new Error('Kies een CPU-overclock van 100%, 200%, 300%, 400% of 500%.');
  return value;
}
export function validateGameConfig(value) {
  if (value?.version !== NETPLAY_VERSION) throw new Error('Jullie gebruiken verschillende spelversies. Vernieuw allebei de pagina.');
  if (!['nes', 'snes', 'dos'].includes(value.system) || typeof value.name !== 'string' || !value.name.length || value.name.length > 80 ||
      !Number.isSafeInteger(value.size) || value.size < (value.system === 'dos' ? 1 : 16) || value.size > (value.system === 'dos' ? 32 : 8) * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/.test(value.hash) || typeof value.demo !== 'boolean') throw new Error('Ongeldige gamegegevens van de host.');
  validateOverclock(value.overclock);
  // Explicit fields only: ROM bytes, paths, URLs and unknown properties cannot
  // be included in the configuration sent to another player.
  return { type: 'game', version: NETPLAY_VERSION, name: value.name, system: value.system,
    size: value.size, hash: value.hash, demo: value.demo, overclock: value.overclock };
}
export function createGameConfig(game) {
  return validateGameConfig({ version: NETPLAY_VERSION, name: game.name, system: game.system,
    size: game.bytes.byteLength, hash: game.hash, demo: game.demo, overclock: game.overclock });
}
export async function verifyLocalRom(bytes, config) {
  const expected = validateGameConfig(config);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== expected.size || await romHash(bytes) !== expected.hash) {
    throw new Error('Deze ROM komt niet overeen met die van de host. Kies dezelfde versie, regio en eventuele ROM-hack. Je bestand wordt niet verstuurd.');
  }
  return expected;
}

// The transport accepts only the small messages used by this protocol. There
// is deliberately no file channel, binary payload or generic bulk-send API.
export function peerMessage(channel, data) {
  if (!data || typeof data !== 'object' || ArrayBuffer.isView(data) || data instanceof ArrayBuffer) throw new Error('Ongeldig spelbericht.');
  if (typeof data.type === 'string' && data.type.startsWith('stream-')) return streamMessage(channel, data);
  const epoch = () => {
    if (typeof data.epoch !== 'string' || !data.epoch.length || data.epoch.length > 64) throw new Error('Ongeldige spelsessie.');
    return data.epoch;
  };
  if(channel==='input'&&data.type==='dos-input'&&Number.isSafeInteger(data.frame)&&data.frame>=0)return {type:'dos-input',frame:data.frame,dos:validateDosInput(data.dos),epoch:epoch(),...(data.policy?{policy:validateDosPolicy(data.policy)}:{})};
  if (channel === 'input' && data.type === 'input' && Number.isSafeInteger(data.frame) && data.frame >= 0 &&
      Number.isInteger(data.buttons) && data.buttons >= 0 && data.buttons <= 4095) {
    return { type: 'input', frame: data.frame, buttons: data.buttons, epoch: epoch() };
  }
  if (channel !== 'control') throw new Error('Onbekend spelkanaal.');
  if(data.type==='dos-policy'&&typeof data.room==='string'&&data.room.length>0&&data.room.length<=64)return {type:data.type,room:data.room,policy:validateDosPolicy(data.policy)};
  if(data.type==='dos-pass'&&typeof data.room==='string'&&data.room.length>0&&data.room.length<=64&&Number.isSafeInteger(data.revision)&&data.revision>=0&&data.revision<=1e9)return {type:data.type,room:data.room,revision:data.revision,epoch:epoch()};
  if (data.type === 'game') return validateGameConfig(data);
  if (['game-matched', 'ready', 'start'].includes(data.type)) {
    if (!/^[a-f0-9]{64}$/.test(data.hash)) throw new Error('Ongeldige ROM-controle.');
    const message = { type: data.type, hash: data.hash, overclock: validateOverclock(data.overclock) };
    if (data.type === 'start') {
      if (data.version !== NETPLAY_VERSION) throw new Error('De spelversies komen niet overeen.');
      message.epoch = epoch(); message.version = NETPLAY_VERSION;
    }
    return message;
  }
  if (['ping', 'pong'].includes(data.type) && Number.isFinite(data.time)) return { type: data.type, time: data.time };
  if (['pause', 'resume'].includes(data.type)) return { type: data.type, epoch: epoch() };
  if (data.type === 'hash' && Number.isSafeInteger(data.frame) && data.frame >= 0 && /^[a-f0-9]{8}$/.test(data.hash)) {
    return { type: 'hash', frame: data.frame, hash: data.hash, epoch: epoch() };
  }
  if (data.type === 'interrupted' && typeof data.message === 'string') {
    return { type: data.type, message: data.message.slice(0, 160), epoch: data.epoch === null ? null : epoch() };
  }
  throw new Error('Onbekend spelbericht. Vernieuw allebei de pagina.');
}
