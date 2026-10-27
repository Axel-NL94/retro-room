#!/usr/bin/env python3
"""Build the pinned MesenCE browser core. Requires Emscripten 4.0.19, no make."""
import argparse, concurrent.futures, hashlib, os, pathlib, subprocess, sys
p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--emsdk',required=True);p.add_argument('--jobs',type=int,default=4);a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[1];src=pathlib.Path(a.source).resolve();sdk=pathlib.Path(a.emsdk).resolve()
PIN='4c4e069f16a8ad6ed79e046046c56d51558c7daf'
# The full corresponding source archive also works without Git metadata.
if (src/'.git').exists() and subprocess.check_output(['git','rev-parse','HEAD'],cwd=src,text=True).strip()!=PIN:raise SystemExit('Unexpected MesenCE revision')
def patch(file,before,after):
 path=src/file;s=path.read_text()
 if after in s:return
 if s.count(before)!=1:raise SystemExit('Patch did not match '+file)
 path.write_text(s.replace(before,after))
patch('Libretro/libretro.cpp','_emu->Initialize();','_emu->Initialize(false);')
patch('Libretro/libretro.cpp','static int32_t _audioSampleRate = 44100;','static int32_t _audioSampleRate = 48000;')
for f,signature in [('Core/Shared/Video/VideoDecoder.cpp','void VideoDecoder::StartThread()'),('Core/Shared/Video/VideoRenderer.cpp','void VideoRenderer::StartThread()'),('Core/Shared/Video/VideoDecoder.cpp','void VideoDecoder::UpdateFrame(RenderedFrame frame, bool sync, bool forRewind)')]:
 patch(f,signature+'\n{',signature+'\n{\n#ifdef RETROROOM_WEB\n\treturn; // Browser frontend steps frames and converts the PPU buffer synchronously.\n#endif')
obj=src/'web-obj';obj.mkdir(exist_ok=True)
flags=['-O2','-DLIBRETRO','-DRETROROOM_WEB','-DSPNG_DISABLE_OPT','-fexceptions','-I'+str(src),'-I'+str(src/'Core'),'-I'+str(src/'Utilities')]
files=[]
for folder in ['Core','Utilities','SevenZip','Lua']:
 files.extend(sorted((src/folder).rglob('*.cpp')));files.extend(sorted((src/folder).rglob('*.c')))
files=[f for f in files if f.name not in ['unix.c','unixdgram.c','unixstream.c','serial.c']]
files.extend([src/'Libretro/VfsFile.cpp',root/'native/mesen-web.cpp'])
env=os.environ.copy();env['EMSDK']=str(sdk);env['EMSDK_NODE']=str(sdk/'node/22.16.0_64bit/bin/node');env['EM_CONFIG']=str(sdk/'.emscripten')
def compile(f):
 key=hashlib.sha256(str(f).encode()).hexdigest()[:16];o=obj/(key+'.o')
 if o.exists() and o.stat().st_mtime>f.stat().st_mtime:return o
 tool=sdk/'upstream/emscripten'/('em++' if f.suffix=='.cpp' else 'emcc')
 command=[str(tool),*flags,*(['-std=c++17'] if f.suffix=='.cpp' else []),'-c',str(f),'-o',str(o)]
 r=subprocess.run(command,cwd=src,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 if r.returncode:raise RuntimeError(str(f)+'\n'+r.stdout[-10000:])
 return o
objects=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=a.jobs) as pool:
 for i,o in enumerate(pool.map(compile,files),1):
  objects.append(o)
  if i%25==0:print(f'Compiled {i}/{len(files)}',flush=True)
out=root/'web/assets/mesen-core.mjs'
out.parent.mkdir(parents=True,exist_ok=True)
exports=['_malloc','_free','_rr_init','_rr_load','_rr_frame','_rr_save','_rr_state_ptr','_rr_restore','_rr_video_ptr','_rr_video_width','_rr_video_height','_rr_audio_ptr','_rr_audio_count','_rr_frame_rate','_rr_error_ptr','_rr_ram_ptr']
import json
command=[str(sdk/'upstream/emscripten/em++'),*map(str,objects),'-O2','-fexceptions','--no-entry','-sMODULARIZE=1','-sEXPORT_ES6=1','-sEXPORT_NAME=createMesen','-sENVIRONMENT=web,node','-sALLOW_MEMORY_GROWTH=1','-sINITIAL_MEMORY=100663296','-sMAXIMUM_MEMORY=536870912','-sSTACK_SIZE=4194304','-sEXPORTED_FUNCTIONS='+json.dumps(exports),'-sEXPORTED_RUNTIME_METHODS='+json.dumps(['FS','UTF8ToString','HEAPU8','HEAPU32','HEAP16']),'-o',str(out)]
result=subprocess.run(command,cwd=src,env=env)
if result.returncode:raise SystemExit(result.returncode)
print('Built',out,flush=True)
# Ship the complete corresponding source with the binary, not only a URL to it.
import tarfile
archive=out.parent/'mesen-source.tar.gz'
def stable(info):
 info.uid=info.gid=0;info.uname=info.gname='';info.mtime=0;return info
with tarfile.open(archive,'w:gz',compresslevel=9) as tar:
 for f in sorted(src.rglob('*')):
  rel=f.relative_to(src)
  if not f.is_file() or '.git' in rel.parts or 'web-obj' in rel.parts:continue
  tar.add(f,arcname=pathlib.Path('mesen-src')/rel,recursive=False,filter=stable)
 for name in ['native/mesen-web.cpp','native/MESEN-LICENSE.txt','native/README.md','scripts/build-mesen.py']:
  tar.add(root/name,arcname=pathlib.Path('retro-room')/name,filter=stable)
meta={'engine':'MesenCE','revision':PIN,'toolchain':'Emscripten 4.0.19','bridge':'retroroom-web-2','wasmSha256':hashlib.sha256(out.with_suffix('.wasm').read_bytes()).hexdigest(),'sourceArchive':archive.name,'sourceSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'license':'GPL-3.0-or-later'}
(out.parent/'mesen-build.json').write_text(json.dumps(meta,indent=2)+'\n')
print('Packaged complete source and build checksums.',flush=True)
