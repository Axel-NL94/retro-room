// Original RetroRoom DOS Duo demo, copyright 2026 RetroRoom contributors, MIT.
// Tiny 8086 .COM program. BIOS keyboard input; two squares on one VGA screen.
// The emitter is also the complete editable source; no assembler is required.
export function makeDosDemo() {
  const out=[], labels=new Map(), refs=[];
  const emit=(...bytes)=>out.push(...bytes);
  const word=n=>emit(n&255,(n>>8)&255);
  const label=name=>labels.set(name,out.length);
  const address=name=>{refs.push({at:out.length,name,relative:false});word(0);};
  const jump=(name,op=0xe9)=>{emit(op);refs.push({at:out.length,name,relative:true});word(0);};
  const equal=name=>{emit(0x75,3);jump(name);};
  const loadPos=name=>{emit(0x8b,0x3e);address(name);}; // mov di,[position]
  emit(0xb8,0x13,0,0xcd,0x10,0xb8,0,0xa0,0x8e,0xc0); // VGA 13h; ES=A000
  emit(0xbe);address('text');
  label('print');emit(0xac,0x84,0xc0);equal('draw');emit(0xb4,0x0e,0xbb,0x0f,0,0xcd,0x10);jump('print');
  label('main');emit(0xb4,1,0xcd,0x16);equal('main');emit(0x30,0xe4,0xcd,0x16,0x50);
  loadPos('p1');emit(0x30,0xc0);jump('rect',0xe8);
  loadPos('p2');emit(0x30,0xc0);jump('rect',0xe8);emit(0x58);
  const keys=[['u1',0x80,0xfc,0x48,'p1',-320],['d1',0x80,0xfc,0x50,'p1',320],
    ['l1',0x80,0xfc,0x4b,'p1',-1],['r1',0x80,0xfc,0x4d,'p1',1],
    ['u2',0x3c,null,119,'p2',-320],['d2',0x3c,null,115,'p2',320],
    ['l2',0x3c,null,97,'p2',-1],['r2',0x3c,null,100,'p2',1]];
  for(const [name,op,mod,key] of keys){emit(op);if(mod!==null)emit(mod);emit(key);equal(name);}
  jump('draw');
  for(const [name,,, ,pos,delta] of keys){label(name);emit(0x81,0x06);address(pos);word(delta);jump('draw');}
  label('draw');loadPos('p1');emit(0xb0,12);jump('rect',0xe8);loadPos('p2');emit(0xb0,10);jump('rect',0xe8);jump('main');
  label('rect');emit(0x57,0x51,0x53,0xbb,8,0);
  label('row');emit(0xb9,8,0,0xf3,0xaa,0x81,0xc7,0x38,1,0x4b);emit(0x74,3);jump('row');emit(0x5b,0x59,0x5f,0xc3);
  label('p1');word(320*60+50);label('p2');word(320*120+50);
  label('text');emit(...new TextEncoder().encode('RETRO ROOM - DOS DUO\r\nRED: ARROWS   GREEN: WASD\r\n'),0);
  for(const {at,name,relative} of refs){const target=labels.get(name);if(target===undefined)throw new Error('Unknown label '+name);const n=relative?target-at-2:target+0x100;out[at]=n&255;out[at+1]=(n>>8)&255;}
  return new Uint8Array(out);
}
