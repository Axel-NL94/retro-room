// SPDX-License-Identifier: MIT
import {readFile,readdir} from 'node:fs/promises';
// Deterministic, uncompressed ZIP: source-only extension, no package dependency.
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export async function extensionPackage(root){
  const folder=root+'extensions/pico-helper/',files=(await readdir(folder)).sort();
  const local=[],central=[];let offset=0;
  for(const file of files){
    if(!/^[a-zA-Z0-9_.-]+$/.test(file))throw new Error('Invalid extension filename');
    const name=Buffer.from(file),bytes=await readFile(folder+file),crc=crc32(bytes);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(33,12);
    header.writeUInt32LE(crc,14);header.writeUInt32LE(bytes.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(name.length,26);
    local.push(header,name,bytes);
    const item=Buffer.alloc(46);item.writeUInt32LE(0x02014b50);item.writeUInt16LE(20,4);item.writeUInt16LE(20,6);item.writeUInt16LE(0x800,8);item.writeUInt16LE(33,14);
    item.writeUInt32LE(crc,16);item.writeUInt32LE(bytes.length,20);item.writeUInt32LE(bytes.length,24);item.writeUInt16LE(name.length,28);item.writeUInt32LE(offset,42);
    central.push(item,name);offset+=header.length+name.length+bytes.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
