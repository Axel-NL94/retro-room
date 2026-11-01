// SPDX-License-Identifier: MIT
export const MAX_GENESIS_ROM = 8 * 1024 * 1024;
// Support ordinary big-endian cartridge dumps only. SMD interleaving, CD/32X,
// archives and BIOS images are outside this integration's tested scope.
export function validateGenesisRom(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<512||bytes.length>MAX_GENESIS_ROM||bytes.length%2)throw new Error('Kies een uitgepakte Mega Drive-ROM (.md, .bin of .gen) van maximaal 8 MB.');
  if(new TextDecoder().decode(bytes.subarray(0x100,0x104))!=='SEGA')throw new Error('Geen geldige Mega Drive-header. Gebruik een gewone .md-, .bin- of .gen-ROM; geen SMD, 32X of Mega-CD.');
  if(new TextDecoder().decode(bytes.subarray(0x100,0x110)).includes('32X'))throw new Error('Deze Mega Drive-emulator ondersteunt nog geen 32X-ROMs.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),pc=view.getUint32(4);
  if(pc<8||pc>=bytes.length||pc%2)throw new Error('Het startadres van deze Mega Drive-ROM is ongeldig.');
  return bytes;
}
