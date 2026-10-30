#!/usr/bin/env python3
"""Build a pinned, cooperative DOSBox Pure browser core with Emscripten 4.0.19."""
import argparse,concurrent.futures,hashlib,json,os,pathlib,re,subprocess,sys
p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--emsdk',required=True);p.add_argument('--jobs',type=int,default=4);a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[1];src=pathlib.Path(a.source).resolve();sdk=pathlib.Path(a.emsdk).resolve()
PIN='d9c1356a6376fc35bd9a900b46c4666b3f4500e6'
if (src/'.git').exists() and subprocess.check_output(['git','rev-parse','HEAD'],cwd=src,text=True).strip()!=PIN:raise SystemExit('Unexpected DOSBox Pure revision')
def patch(file,before,after):
 f=src/file;s=f.read_text()
 if after in s:return
 if s.count(before)!=1:raise SystemExit('Patch mismatch: '+file)
 f.write_text(s.replace(before,after))
patch('include/dbp_threads.h','#ifdef WIN32','#if defined(RETROROOM_WEB)\n// RetroRoom browser modification, 2026-10-30: cooperative fibers instead of OS threads.\n#include "rr-dos-threads.h"\n#elif defined(WIN32)')
config=src/'include/config.h';s=config.read_text()
for macro in ['C_DBP_SUPPORT_MIDI_MT32','C_DBP_SUPPORT_MIDI_SC55','C_DBP_ENABLE_VOODOO']:
 s=re.sub(r'(?m)^#define '+macro+r'\n','// RetroRoom browser modification, 2026-10-30: omit optional '+macro+'.\n//#define '+macro+'\n',s)
if config.read_text()!=s:config.write_text(s)
patch('src/gui/midi.cpp','midi.handler != &Midi_tsf && midi.handler != &Midi_mt32 && midi.handler != &Midi_sc55',
      '/* RetroRoom 2026-10-30: optional ROM-based MIDI backends omitted. */ midi.handler != &Midi_tsf')
patch('dosbox_pure_libretro.cpp',"if (active_mchar == 's')\n\t{", "if (false) // RetroRoom 2026-10-30: no optional 3dfx PCI section.\n\t{")
# Read-only serialization section diagnostics for deterministic-netplay research.
patch('src/dbp_serialize.cpp','void (*func)(DBPArchive& ar); //const char* func_name;', 'void (*func)(DBPArchive& ar); const char* func_name; // RetroRoom 2026-10-30: named state sections.')
patch('src/dbp_serialize.cpp','func = FUNC; //func_name = #FUNC','func = FUNC; func_name = #FUNC')
patch('src/dbp_serialize.cpp','\t\t//size_t old_off = ar.GetOffset();','\t\tsize_t old_off = ar.GetOffset();')
patch('src/dbp_serialize.cpp','\t\tfunc(ar);','\t\tfunc(ar);\n#ifdef RETROROOM_WEB\n\t\textern void rr_snapshot_section(const char*,size_t,size_t);\n\t\tif(ar.mode==DBPArchive::MODE_SAVE)rr_snapshot_section(func_name,old_off,ar.GetOffset());\n#endif')
thread_header=src/'include/rr-dos-threads.h';thread_bytes=(root/'native/dos-threads.h').read_bytes()
if not thread_header.exists() or thread_header.read_bytes()!=thread_bytes:thread_header.write_bytes(thread_bytes)
obj=src/'web-obj';obj.mkdir(exist_ok=True)
flags=['-O2','-DNDEBUG','-D__LIBRETRO__','-DRETROROOM_WEB','-DDISABLE_DYNAREC=1','-std=c++17','-fexceptions','-I'+str(src),'-I'+str(src/'include'),'-Wno-deprecated-declarations','-Wno-format','-Wno-switch','-Wno-address-of-packed-member']
files=sorted(src.glob('*.cpp'))+sorted((src/'src').rglob('*.cpp'))
files=[f for f in files if f.name!='dosbox_pure_libretro.cpp']+[root/'native/dos-web.cpp']
env=os.environ.copy();env.update(EMSDK=str(sdk),EM_CONFIG=str(sdk/'.emscripten'),EMSDK_NODE=str(sdk/'node/22.16.0_64bit/bin/node'))
def compile(f):
 o=obj/(hashlib.sha256(str(f).encode()).hexdigest()[:16]+'.o')
 changed=max(f.stat().st_mtime,config.stat().st_mtime,thread_header.stat().st_mtime)
 if f.name=='dos-web.cpp':changed=max(changed,(src/'dosbox_pure_libretro.cpp').stat().st_mtime)
 if o.exists() and o.stat().st_mtime>changed:return o
 r=subprocess.run([str(sdk/'upstream/emscripten/em++'),*flags,'-c',str(f),'-o',str(o)],cwd=src,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 if r.returncode:raise RuntimeError(str(f)+'\n'+r.stdout[-14000:])
 return o
objects=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=a.jobs) as pool:
 for i,o in enumerate(pool.map(compile,files),1):
  objects.append(o)
  if i%10==0:print(f'Compiled {i}/{len(files)}',flush=True)
out=root/'web/assets/dos-core.mjs'
exports=['_malloc','_free','_rr_init','_rr_load','_rr_frame','_rr_save','_rr_state_ptr','_rr_restore','_rr_video_ptr','_rr_video_width','_rr_video_height','_rr_audio_ptr','_rr_audio_count','_rr_frame_rate','_rr_sample_rate','_rr_error_ptr','_rr_destroy']
exports.extend(['_rr_last_result','_rr_set_input','_rr_key_down','_rr_joystick','_rr_peek','_rr_section_count','_rr_section_name','_rr_section_start','_rr_section_end'])
cmd=[str(sdk/'upstream/emscripten/em++'),*map(str,objects),'-O2','-fexceptions','--no-entry','-Wl,--wrap=time','-Wl,--wrap=clock_gettime','-Wl,--wrap=gettimeofday','-sASYNCIFY=1','-sASYNCIFY_STACK_SIZE=2097152','-sMODULARIZE=1','-sEXPORT_ES6=1','-sEXPORT_NAME=createDOS','-sENVIRONMENT=web,node','-sALLOW_MEMORY_GROWTH=1','-sINITIAL_MEMORY=134217728','-sMAXIMUM_MEMORY=536870912','-sSTACK_SIZE=4194304','-sEXPORTED_FUNCTIONS='+json.dumps(exports),'-sEXPORTED_RUNTIME_METHODS='+json.dumps(['FS','UTF8ToString','HEAPU8']),'-o',str(out)]
cmd.insert(1,'--profiling-funcs')
subprocess.check_call(cmd,cwd=src,env=env)
print('Built '+str(out),flush=True)
