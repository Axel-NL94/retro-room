// Original MIT 8086 COM diagnostic. BIOS keyboard input and INT 33h mouse state
// are copied into conventional RAM at 9000:0000 for independent input tests.
export function makeDosInputFixture(){
  const b=[],labels=new Map(),fix=[];
  const emit=(...x)=>b.push(...x),word=x=>emit(x&255,x>>8),label=n=>labels.set(n,b.length),jump=(op,n)=>{emit(op);fix.push([b.length,n]);emit(0);};
  emit(0xb8,0x13,0,0xcd,0x10); // VGA mode 13h
  emit(0xb8,0,0x90,0x8e,0xc0); // ES=9000
  emit(0x31,0xc0,0xcd,0x33); // mouse reset
  emit(0x26,0xa3);word(8); // presence
  label('loop');emit(0xb8,3,0,0xcd,0x33); // mouse buttons/position
  emit(0x26,0x89,0x1e);word(2);emit(0x26,0x89,0x0e);word(4);emit(0x26,0x89,0x16);word(6);
  emit(0xb4,1,0xcd,0x16);jump(0x74,'loop'); // no key
  emit(0x30,0xe4,0xcd,0x16); // read key
  emit(0x26,0xa3);word(0); // AL=ASCII, AH=scan
  jump(0xeb,'loop');
  for(const [at,n]of fix){const d=labels.get(n)-at-1;if(d< -128||d>127)throw new Error('Fixture branch');b[at]=d&255;}
  return new Uint8Array(b);
}
