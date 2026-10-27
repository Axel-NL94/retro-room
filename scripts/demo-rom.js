// An original, distributable NROM homebrew: tap A to race. No commercial assets.
// This tiny assembler is deliberately limited to the instructions used below.
export function makeDemoRom() {
  const font = {
    A:[14,17,17,31,17,17,17], C:[14,17,16,16,16,17,14], E:[31,16,16,30,16,16,31],
    F:[31,16,16,30,16,16,16], H:[17,17,17,31,17,17,17], I:[14,4,4,4,4,4,14],
    L:[16,16,16,16,16,16,31], M:[17,27,21,21,17,17,17], N:[17,25,25,21,19,19,17],
    O:[14,17,17,17,17,17,14], P:[30,17,17,30,16,16,16], R:[30,17,17,30,20,18,17],
    S:[15,16,16,14,1,1,30], T:[31,4,4,4,4,4,4], Y:[17,17,10,4,4,4,4],
    '1':[4,12,4,4,4,4,14], '2':[14,17,1,2,4,8,31],
  };
  const letters = Object.keys(font);
  const prg = new Uint8Array(16384).fill(0xea);
  const labels = new Map();
  const fixes = [];
  let pc = 0;
  const label = name => labels.set(name, 0xc000 + pc);
  const emit = (...bytes) => { for (const b of bytes) prg[pc++] = b; };
  const jump = (op, name) => { emit(op); fixes.push({ pos: pc, name }); emit(0, 0); };
  const branch = (op, name) => { emit(op); fixes.push({ pos: pc, name, relative: true }); emit(0); };
  const imm = (op, n) => emit(op, n);
  const abs = (op, n) => emit(op, n & 255, n >> 8);
  label('reset');
  emit(0x78, 0xd8); imm(0xa2, 0xff); emit(0x9a, 0xe8); // SEI CLD LDX TXS INX
  abs(0x8e, 0x2000); abs(0x8e, 0x2001); abs(0x8e, 0x4010);
  label('vblank1'); abs(0x2c, 0x2002); branch(0x10, 'vblank1');
  imm(0xa9, 0); imm(0xa2, 0);
  label('clear');
  for (const page of [0, 0x100, 0x300, 0x400, 0x500, 0x600, 0x700]) abs(0x9d, page);
  emit(0xe8); branch(0xd0, 'clear');
  imm(0xa9, 0xff); imm(0xa2, 0);
  label('hide'); abs(0x9d, 0x200); emit(0xe8); branch(0xd0, 'hide');
  label('vblank2'); abs(0x2c, 0x2002); branch(0x10, 'vblank2');
  abs(0x2c, 0x2002); imm(0xa9, 0x3f); abs(0x8d, 0x2006); imm(0xa9, 0); abs(0x8d, 0x2006);
  imm(0xa2, 0);
  label('palette'); jump(0xbd, 'colors'); abs(0x8d, 0x2007); emit(0xe8); imm(0xe0, 32); branch(0xd0, 'palette');
  imm(0xa9, 0x20); abs(0x8d, 0x2006); imm(0xa9, 0); abs(0x8d, 0x2006);
  imm(0xa9, 0); imm(0xa2, 4); imm(0xa0, 0);
  label('background'); abs(0x8d, 0x2007); emit(0xc8); branch(0xd0, 'background'); emit(0xca); branch(0xd0, 'background');
  // Track lane separators.
  for (const address of [0x2160, 0x21e0, 0x2260]) {
    imm(0xa9, address >> 8); abs(0x8d, 0x2006); imm(0xa9, address & 255); abs(0x8d, 0x2006);
    imm(0xa2, 32); imm(0xa9, 1);
    const name = `line${address}`; label(name); abs(0x8d, 0x2007); emit(0xca); branch(0xd0, name);
  }
  // Checkered finish column, rows 12 through 17.
  for (let row = 12; row < 19; row++) {
    const address = 0x2000 + row * 32 + 28;
    imm(0xa9, address >> 8); abs(0x8d, 0x2006); imm(0xa9, address & 255); abs(0x8d, 0x2006);
    imm(0xa9, 2); abs(0x8d, 0x2007);
  }
  for (const [row, col, text] of [[5,11,'ROOM RALLY'],[8,9,'TAP A TO RACE'],[13,1,'P1'],[17,1,'P2'],[22,9,'START TO RESET']]) {
    const address = 0x2000 + row * 32 + col;
    imm(0xa9, address >> 8); abs(0x8d, 0x2006); imm(0xa9, address & 255); abs(0x8d, 0x2006);
    for (const char of text) { imm(0xa9, char === ' ' ? 0 : 8 + letters.indexOf(char)); abs(0x8d, 0x2007); }
  }
  jump(0x20, 'restart');
  imm(0xa9, 0x80); abs(0x8d, 0x2000); imm(0xa9, 0x1e); abs(0x8d, 0x2001);
  label('forever'); jump(0x4c, 'forever');

  label('restart'); imm(0xa9, 24); emit(0x85, 0, 0x85, 1); imm(0xa9, 0); emit(0x85, 6); emit(0x60);

  label('nmi'); emit(0x48, 0x8a, 0x48, 0x98, 0x48);
  imm(0xa9, 1); abs(0x8d, 0x4016); imm(0xa9, 0); abs(0x8d, 0x4016);
  emit(0x85, 2, 0x85, 3); imm(0xa2, 8);
  label('read'); abs(0xad, 0x4016); imm(0x29, 1); emit(0x4a, 0x26, 2);
  abs(0xad, 0x4017); imm(0x29, 1); emit(0x4a, 0x26, 3); emit(0xca); branch(0xd0, 'read');
  emit(0xa5, 2, 0x05, 3); imm(0x29, 0x10); branch(0xf0, 'noreset'); jump(0x20, 'restart');
  label('noreset'); emit(0xa5, 6); branch(0xd0, 'render');
  for (let p = 0; p < 2; p++) {
    emit(0xa5, 2 + p, 0x45, 4 + p, 0x25, 2 + p); imm(0x29, 0x80); branch(0xf0, `next${p}`);
    emit(0xa5, p, 0x18); imm(0x69, 4); emit(0x85, p); imm(0xc9, 224); branch(0x90, `next${p}`);
    imm(0xa9, p + 1); emit(0x85, 6);
    label(`next${p}`);
  }
  label('render'); emit(0xa5, 2, 0x85, 4, 0xa5, 3, 0x85, 5);
  for (let p = 0; p < 2; p++) {
    for (let half = 0; half < 2; half++) {
      const base = 0x200 + p * 8 + half * 4;
      imm(0xa9, 105 + p * 32); abs(0x8d, base);
      imm(0xa9, 3 + half); abs(0x8d, base + 1);
      imm(0xa9, p); abs(0x8d, base + 2);
      emit(0xa5, p, 0x18); imm(0x69, half * 8); abs(0x8d, base + 3);
    }
  }
  imm(0xa9, 0); abs(0x8d, 0x2003); imm(0xa9, 2); abs(0x8d, 0x4014);
  // Winner changes the backdrop to the winning car's color.
  abs(0x2c, 0x2002); imm(0xa9, 0x3f); abs(0x8d, 0x2006); imm(0xa9, 0); abs(0x8d, 0x2006);
  emit(0xa6, 6); jump(0xbd, 'winnerColors'); abs(0x8d, 0x2007);
  imm(0xa9, 0x80); abs(0x8d, 0x2000);
  imm(0xa9, 0); abs(0x8d, 0x2005); abs(0x8d, 0x2005);
  emit(0x68, 0xa8, 0x68, 0xaa, 0x68, 0x40);
  label('irq'); emit(0x40);
  label('colors');
  emit(0x0f, 0x00, 0x10, 0x30, 0x0f, 0x00, 0x10, 0x30, 0x0f, 0x00, 0x10, 0x30, 0x0f, 0x00, 0x10, 0x30,
       0x0f, 0x16, 0x27, 0x30, 0x0f, 0x19, 0x2a, 0x30, 0x0f, 0x00, 0x10, 0x30, 0x0f, 0x00, 0x10, 0x30);
  label('winnerColors'); emit(0x0f, 0x06, 0x09);
  for (const fix of fixes) {
    const address = labels.get(fix.name);
    if (address === undefined) throw new Error(`Unknown label ${fix.name}`);
    if (fix.relative) {
      const delta = address - (0xc000 + fix.pos + 1);
      if (delta < -128 || delta > 127) throw new Error(`Branch too long: ${fix.name}`);
      prg[fix.pos] = delta & 255;
    } else { prg[fix.pos] = address & 255; prg[fix.pos + 1] = address >> 8; }
  }
  for (const [offset, name] of [[0x3ffa, 'nmi'], [0x3ffc, 'reset'], [0x3ffe, 'irq']]) {
    prg[offset] = labels.get(name) & 255; prg[offset + 1] = labels.get(name) >> 8;
  }
  const chr = new Uint8Array(8192);
  const tile = (index, low, high = low) => { chr.set(low, index * 16); chr.set(high, index * 16 + 8); };
  tile(1, [0, 0, 0, 0xcc, 0xcc, 0, 0, 0]);
  tile(2, [0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55]);
  tile(3, [0x18, 0x7f, 0x7f, 0x3f, 0x3f, 0x7f, 0x7f, 0x18], [0, 0, 0, 0x0f, 0x0f, 0, 0, 0]);
  tile(4, [0x18, 0xfe, 0xfe, 0xfc, 0xfc, 0xfe, 0xfe, 0x18], [0, 0, 0, 0xc0, 0xc0, 0, 0, 0]);
  for (const [index, char] of letters.entries()) tile(index + 8, [...font[char].map(row => row << 2), 0]);
  const rom = new Uint8Array(16 + prg.length + chr.length);
  rom.set([0x4e, 0x45, 0x53, 0x1a, 1, 1, 1]); rom.set(prg, 16); rom.set(chr, 16 + prg.length);
  return rom;
}
