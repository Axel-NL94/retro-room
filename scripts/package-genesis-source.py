#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Publish full matching GX source, independent bridge and retained notices."""
import argparse, gzip, hashlib, io, json, pathlib, re, subprocess, tarfile
p=argparse.ArgumentParser();p.add_argument('--source',required=True);a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[1];src=pathlib.Path(a.source).resolve()
pin='f27655b592ef43f317272d79883bcaa10d3ac8ad'
if (src/'.git').exists() and subprocess.check_output(['git','rev-parse','HEAD'],cwd=src,text=True).strip()!=pin:raise SystemExit('Unexpected Genesis Plus GX revision')
files={}
for folder in ['core','libretro']:
 for f in sorted((src/folder).rglob('*')):
  if f.is_file():files['genesis-plus-gx/'+str(f.relative_to(src))]=f.read_bytes()
for name in ['LICENSE.txt','README.md','HISTORY.txt','Makefile.libretro']:
 files['genesis-plus-gx/'+name]=(src/name).read_bytes()
decode=lambda b:b.decode('utf-8',errors='replace')
blocks={}
for name,data in files.items():
 if not re.search(r'\.(c|cpp|h|hpp|inl)$',name):continue
 for block in re.findall(r'/\*[\s\S]*?\*/|(?m:(?:^[ \t]*//[^\n]*\n?)+)',decode(data)):
  if re.search(r'copyright|permission is hereby|redistribution and use|public domain|SPDX-License',block,re.I):blocks.setdefault(block.strip(),[]).append(name)
notice=['Genesis Plus GX — independent RetroRoom browser program, 2026-11-01',
 'Upstream: https://github.com/libretro/Genesis-Plus-GX\nRevision: '+pin,
 'Copyright Charles MacDonald, Eke-Eke, Nicola Salmoria/MAME team and the individual authors below.\n'
 'Genesis Plus GX has its own NON-COMMERCIAL license; it is NOT covered by the GPL/MIT grants for other RetroRoom programs.\n'
 'Complete matching source, modifications and rebuild/relink instructions: assets/genesis-source.tar.gz; native/GENESIS.md.\n'
 'The newly written native/genesis-web.c bridge and Mega Duo demo are MIT, copyright 2026 RetroRoom contributors.\n'
 'No Mesen, DOSBox or RetroArch GPL core/frontend code is linked into this independent Wasm. Libretro-common files used here have individual permissive grants, retained below.\n'
 'The blip_buf library is LGPL-2.1-or-later. Complete library and work-using-library source and rebuild recipes are supplied for modification/relinking; reverse engineering for debugging those modifications is permitted.\n'
 'The entire source collection is retained, including optional code not compiled by this recipe. No commercial game ROM or proprietary BIOS is supplied.\n'
 'Full Emscripten/musl/LLVM/runtime notices accompany the distribution in THIRD-PARTY-NOTICES.txt.',decode((src/'LICENSE.txt').read_bytes())]
for block,names in blocks.items():notice.append('FILES: '+', '.join(names)+'\n'+block)
# Complete LGPL text and the GPLv2 text it incorporates, also supplied by upstream.
for file in ['core/sound/tremor/COPYING','core/sound/tremor/COPYING.Xiph']:
 if (src/file).is_file():notice.append(file+'\n'+decode((src/file).read_bytes()))
base=(root/'web/THIRD-PARTY-NOTICES.txt').read_text()
marker='\nlgpl-2.1 — '
start=base.index(marker);start=base.index('='*76+'\n\n',start)+78
end=base.find('\n\n'+'='*76+'\n',start)
lgpl=base[start:end if end>=0 else len(base)].strip()
notice.append(lgpl)
notice.append((root/'native/GPL-2.0.txt').read_text())
license_text='\n\n'+'\n\n'.join(notice)+'\n'
(root/'web/GENESIS-NOTICES.txt').write_text(license_text)
for name in ['native/genesis-web.c','native/GPL-2.0.txt','native/GENESIS.md','scripts/build-genesis.py','scripts/package-genesis-source.py','scripts/demo-genesis.js','web/src/genesis.js','web/src/genesis-rom.js','web/GENESIS-NOTICES.txt','web/THIRD-PARTY-NOTICES.txt','test/genesis.test.js','LICENSE','LICENSING.md']:
 files['retro-room/'+name]=(root/name).read_bytes()
stream=io.BytesIO()
with tarfile.open(fileobj=stream,mode='w',format=tarfile.PAX_FORMAT)as tar:
 for name,data in sorted(files.items()):
  i=tarfile.TarInfo(name);i.size=len(data);i.mode=0o644;i.mtime=0;tar.addfile(i,io.BytesIO(data))
archive=gzip.compress(stream.getvalue(),mtime=0);(root/'web/assets/genesis-source.tar.gz').write_bytes(archive)
sha=lambda b:hashlib.sha256(b).hexdigest()
meta={'engine':'Genesis Plus GX','revision':pin,'upstream':'https://github.com/libretro/Genesis-Plus-GX','build':'genesis-plus-gx-f27655b-web-1','emscripten':'4.0.19','license':'LicenseRef-Genesis-Plus-GX-NonCommercial','bridgeLicense':'MIT','separateProgram':True,'sourceArchive':'genesis-source.tar.gz','wasmSha256':sha((root/'web/assets/genesis-core.wasm').read_bytes()),'loaderSha256':sha((root/'web/assets/genesis-core.mjs').read_bytes()),'sourceSha256':sha(archive),'noticesSha256':sha(license_text.encode()),'sourceFiles':len(files),'sourceLicenseBlocks':len(blocks),'modifiedUpstreamFiles':['libretro/libretro.c','core/input_hw/gamepad.c']}
(root/'web/assets/genesis-build.json').write_text(json.dumps(meta,indent=2)+'\n')
print('Genesis source:',len(files),'files,',len(blocks),'retained notice blocks,',len(archive),'bytes')
