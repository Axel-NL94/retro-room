// SPDX-License-Identifier: MIT
// Original RetroRoom Mega Drive homebrew, 2026. No external game/BIOS/assets.
// Complete 68000 machine-code emitter, graphics and PSG tone source.
export function makeGenesisDemo({pal=false,busy=false,sram=false}={}){
  const rom=new Uint8Array(65536),view=new DataView(rom.buffer),labels=new Map(),fixes=[];
  let pc=0x200;
  const word=(...values)=>{for(const v of values){view.setUint16(pc,v);pc+=2;}};
  const long=n=>{view.setUint32(pc,n>>>0);pc+=4;};
  const label=n=>labels.set(n,pc);
  const branch=(op,n)=>{word(op);fixes.push({at:pc,n});word(0);};
  const byteWrite=(n,address)=>{word(0x13fc,n);long(address);};
  const data=n=>word(0x32bc,n); // move.w #n,(a1)
  const control=n=>{word(0x20bc);long(n);}; // move.l #n,(a0)
  const vram=address=>control(0x40000000|((address&0x3fff)<<16)|(address>>>14));
  view.setUint32(0,0x00ffff00);view.setUint32(4,0x200);
  for(let vector=2;vector<64;vector++)view.setUint32(vector*4,0x200);
  const text=(at,value,length)=>rom.set(new TextEncoder().encode(value.padEnd(length).slice(0,length)),at);
  text(0x100,'SEGA MEGA DRIVE',16);text(0x110,'(C)RETRO 2026',16);
  text(0x120,'RETRO ROOM - MEGA DUO',48);text(0x150,'RETRO ROOM - MEGA DUO',48);
  text(0x180,'GM 00000000-00',14);text(0x190,'J6',16);text(0x1f0,pal?'E':'U',16);
  view.setUint32(0x1a4,rom.length-1);view.setUint32(0x1a8,0xff0000);view.setUint32(0x1ac,0xffffff);
  if(sram){text(0x1b0,'RA',2);view.setUint16(0x1b2,0xf820);view.setUint32(0x1b4,0x200001);view.setUint32(0x1b8,0x203fff);}
  word(0x46fc,0x2700); // disable interrupts
  word(0x41f9);long(0xc00004);word(0x43f9);long(0xc00000);
  for(const r of [0x8004,0x8104,0x8230,0x832c,0x8407,0x857c,0x8700,0x8b00,0x8c81,0x8d3f,0x8f02,0x9001])word(0x30bc,r);
  vram(0);word(0x7000,0x323c,32767);label('clear');word(0x3280);branch(0x51c9,'clear'); // dbra d1
  control(0xc0000000);for(const color of [0x0000,0x0eee,0x004e,0x00e4,0x0e80])data(color);
  const font={A:[14,17,17,31,17,17,17],B:[30,17,17,30,17,17,30],C:[14,17,16,16,16,17,14],D:[30,17,17,17,17,17,30],E:[31,16,16,30,16,16,31],G:[14,17,16,23,17,17,15],I:[14,4,4,4,4,4,14],L:[16,16,16,16,16,16,31],M:[17,27,21,21,17,17,17],N:[17,25,25,21,19,19,17],O:[14,17,17,17,17,17,14],P:[30,17,17,30,16,16,16],R:[30,17,17,30,20,18,17],S:[15,16,16,14,1,1,30],T:[31,4,4,4,4,4,4],U:[17,17,17,17,17,17,14],X:[17,17,10,4,10,17,17],Y:[17,17,10,4,4,4,4],V:[17,17,17,17,17,10,4],W:[17,17,17,21,21,21,10],Z:[31,1,2,4,8,16,31],'1':[4,12,4,4,4,4,14],'2':[14,17,1,2,4,8,31],'-':[0,0,0,31,0,0,0]};
  vram(32); // tile 1: white square; tile 2: red; tile 3: green
  for(const c of [1,2,3])for(let i=0;i<16;i++)data(c*0x1111);
  const letters=Object.keys(font);
  for(const char of letters){
    for(const row of [...font[char],0]){
      let line=0;for(let x=0;x<8;x++)line=(line<<4)|(x>=1&&x<=5&&(row&(1<<(5-x)))?1:0);
      data(line>>>16);data(line&0xffff);
    }
  }
  for(const [row,col,str] of [[3,6,'RETRO ROOM - MEGA DUO'],[6,9,'MEGA DRIVE DEMO'],[12,5,'PLAYER 1'],[12,22,'PLAYER 2'],[22,7,'PRESS A B C OR X Y Z'],[24,10,'ARROWS AND START']]){
    vram(0xc000+row*128+col*2);
    for(const ch of str)data(ch===' '?0:4+letters.indexOf(ch));
  }
  for(const [address,tile] of [[0xc000+15*128+8*2,2],[0xc000+15*128+25*2,3]]){vram(address);data(tile);data(tile);vram(address+128);data(tile);data(tile);}
  for(const port of [0,1]){byteWrite(0x40,0xa10009+port*2);byteWrite(0x40,0xa10003+port*2);}
  // PSG channel 0 square wave, other channels muted; deterministic 48 kHz output.
  for(const n of [0x85,0x15,0x94,0xbf,0xdf,0xff])byteWrite(n,0xc00011);
  word(0x30bc,0x8144);
  label('loop');
  if(!busy){label('blankEnd');word(0x3010,0x0240,8);branch(0x6600,'blankEnd');label('blankStart');word(0x3010,0x0240,8);branch(0x6700,'blankStart');}
  for(let p=0;p<2;p++){
    const port=0xa10003+p*2;
    const read=(offset,mask)=>{word(0x1039);long(port);word(0x4600,0x0240,mask,0x13c0);long(0xff0000+p*4+offset);};
    byteWrite(0x40,port);read(0,0x3f);
    byteWrite(0,port);read(1,0x30);
    for(const level of [0x40,0,0x40,0,0x40])byteWrite(level,port);
    read(2,0x0f);
    // held-input counter and a CRAM color change provide visible feedback.
    word(0x1039);long(0xff0000+p*4);word(0x8039);long(0xff0001+p*4);word(0x8039);long(0xff0002+p*4);
    branch(0x6700,'idle'+p);word(0x5279);long(0xff0010+p*2);
    control(0xc0040000+p*0x20000);data(p?0x0ee0:0x0e0e);branch(0x6000,'next'+p);
    label('idle'+p);control(0xc0040000+p*0x20000);data(p?0x00e4:0x004e);
    label('next'+p);
  }
  if(sram){word(0x5239);long(0x200001);word(0x13f9);long(0x200001);long(0xff0018);}
  word(0x52b9);long(0xff0020);branch(0x6000,'loop');
  for(const f of fixes){const delta=labels.get(f.n)-f.at;if(!Number.isInteger(delta)||delta < -32768||delta > 32767)throw new Error('Invalid branch '+f.n);view.setInt16(f.at,delta);}
  let sum=0;for(let n=0x200;n<rom.length;n+=2)sum=(sum+view.getUint16(n))&0xffff;view.setUint16(0x18e,sum);
  return rom;
}
