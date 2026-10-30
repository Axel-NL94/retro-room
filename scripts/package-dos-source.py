#!/usr/bin/env python3
"""Package matching DOSBox Pure source and retained notices; no compiled code changes."""
import argparse,gzip,hashlib,io,json,pathlib,re,tarfile
p=argparse.ArgumentParser();p.add_argument('--source',required=True);a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[1];src=pathlib.Path(a.source).resolve()
pin='d9c1356a6376fc35bd9a900b46c4666b3f4500e6'
def decode(data):
 try:return data.decode('utf-8')
 except UnicodeDecodeError:return data.decode('latin-1')
files={}
for name in ['include/dbp_threads.h','include/config.h','src/gui/midi.cpp','dosbox_pure_libretro.cpp']:
 file=src/name;header=b'// RetroRoom browser modifications, 2026-10-30; see native/DOSBOX.md in the accompanying source.\n'
 if not file.read_bytes().startswith(header):file.write_bytes(header+file.read_bytes())
for f in sorted(src.rglob('*')):
 if not f.is_file() or any(part in {'.git','web-obj','build','images','.codex','__pycache__'} for part in f.relative_to(src).parts):continue
 files['dosbox-pure/'+str(f.relative_to(src))]=f.read_bytes()
notices=[
 'DOSBox Pure browser distribution — RetroRoom, 2026-10-30',
 'Upstream: https://codeberg.org/schelling/dosbox-pure\nRevision: '+pin,
 'DOSBox and DOSBox Pure: GPL-2.0-or-later. This combined browser distribution selects GNU GPL version 3. Separate upstream grants remain intact.\n'
 'Copyright (C) DOSBox Team, Bernhard Schelling and individual authors below. RetroRoom bridge and cooperative browser changes: copyright 2026 RetroRoom contributors, GPL-3.0-or-later.\n'
 'Complete matching source, modified headers and build recipes: assets/dos-source.tar.gz. Full GPLv3, LGPLv2.1 and Emscripten/LLVM/runtime texts also accompany this distribution in THIRD-PARTY-NOTICES.txt.\n'
 'Original DOS Duo test program: copyright 2026 RetroRoom contributors, MIT (see LICENSE). No commercial game or proprietary operating-system/MIDI-ROM image is supplied.\n'
 'The source archive preserves optional and platform-specific code as well; inclusion in the source archive does not imply that those features are linked or available in the browser.',
 decode((src/'LICENSE').read_bytes()),decode((src/'DOSBOX-AUTHORS').read_bytes()),decode((src/'DOSBOX-THANKS').read_bytes()),
]
blocks={}
for name,content in files.items():
 if not re.search(r'\.(cpp|c|h|hpp|inl)$',name):continue
 text=decode(content)
 comments=re.findall(r'/\*[\s\S]*?\*/|(?m:(?:^[ \t]*//[^\n]*\n?)+)',text)
 for comment in comments:
  if re.search(r'copyright|permission is hereby|redistribution and use|public domain|license:|SPDX-License',comment,re.I):
   blocks.setdefault(comment.strip(),[]).append(name)
for block,names in blocks.items():notices.append('\nFILES: '+', '.join(names)+'\n'+block)
notices.append('''\nMAME sound components — BSD-3-Clause\nCopyright Juergen Buchmueller and Manuel Abadia (Philips SAA1099); Nicola Salmoria (SN76496).\nRedistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:\n1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.\n2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.\n3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.\n''')
notice=('\n\n'+'='*76+'\n\n').join(notices)+'\n'
(root/'web/DOS-NOTICES.txt').write_text(notice)
for file in ['native/dos-web.cpp','native/dos-threads.h','native/DOSBOX.md','scripts/build-dos.py','scripts/package-dos-source.py','web/DOS-NOTICES.txt','LICENSE','LICENSING.md']:
 files['retro-room/'+file]=(root/file).read_bytes()
out=io.BytesIO()
with tarfile.open(fileobj=out,mode='w',format=tarfile.PAX_FORMAT) as tar:
 for name,data in sorted(files.items()):
  info=tarfile.TarInfo(name);info.size=len(data);info.mode=0o644;info.mtime=0;tar.addfile(info,io.BytesIO(data))
archive=gzip.compress(out.getvalue(),mtime=0)
(root/'web/assets/dos-source.tar.gz').write_bytes(archive)
sha=lambda data:hashlib.sha256(data).hexdigest()
meta={'engine':'DOSBox Pure','revision':pin,'upstream':'https://codeberg.org/schelling/dosbox-pure','build':'dosbox-pure-d9c1356-web-1','emscripten':'4.0.19','license':'GPL-3.0-only','upstreamLicense':'GPL-2.0-or-later','sourceArchive':'dos-source.tar.gz','sourceSha256':sha(archive),'loaderSha256':sha((root/'web/assets/dos-core.mjs').read_bytes()),'wasmSha256':sha((root/'web/assets/dos-core.wasm').read_bytes()),'noticesSha256':sha(notice.encode()),'sourceFiles':len(files),'sourceLicenseBlocks':len(blocks)}
(root/'web/assets/dos-build.json').write_text(json.dumps(meta,indent=2)+'\n')
print('DOS source packaged:',len(files),'files;',len(blocks),'retained notice blocks;',len(archive),'bytes')
