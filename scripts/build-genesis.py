#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Build an independent Genesis Plus GX WASM. Emscripten 4.0.19, no make needed."""
import argparse, concurrent.futures, hashlib, json, os, pathlib, subprocess

PIN = 'f27655b592ef43f317272d79883bcaa10d3ac8ad'
p = argparse.ArgumentParser()
p.add_argument('--source', required=True); p.add_argument('--emsdk', required=True); p.add_argument('--jobs', type=int, default=4)
a = p.parse_args()
root = pathlib.Path(__file__).resolve().parents[1]
src = pathlib.Path(a.source).resolve(); sdk = pathlib.Path(a.emsdk).resolve()
if (src / '.git').exists() and subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=src, text=True).strip() != PIN:
    raise SystemExit('Unexpected Genesis Plus GX revision')
port = src / 'libretro/libretro.c'
code = port.read_text()
if '#define SOUND_FREQUENCY 44100' in code:
    port.write_text('// RetroRoom modification, 2026-11-01: 48 kHz browser audio.\n' + code.replace('#define SOUND_FREQUENCY 44100', '#define SOUND_FREQUENCY 48000'))
pad_file = src / 'core/input_hw/gamepad.c'
pad_code = pad_file.read_text()
if 'rr_gx_pad_snapshot' not in pad_code:
    pad_file.write_text(pad_code + '''
/* RetroRoom addition, 2026-11-01: preserve 6-button TH handshakes for rollback.
 * Original notices and non-commercial terms above remain in force. */
unsigned rr_gx_pad_snapshot(unsigned char *buffer, int restore)
{
  unsigned offset = 0;
#define RR_PAD_PART(part) \\
  if (buffer) { if (restore) memcpy(&(part), buffer + offset, sizeof(part)); \\
  else memcpy(buffer + offset, &(part), sizeof(part)); } offset += sizeof(part)
  RR_PAD_PART(gamepad);
  RR_PAD_PART(flipflop);
  RR_PAD_PART(latch);
#undef RR_PAD_PART
  return offset;
}
''')
dirs = ['core', 'core/z80', 'core/m68k', 'core/ntsc', 'core/sound', 'core/sound/minimp3', 'core/input_hw', 'core/cd_hw', 'core/cart_hw', 'core/cart_hw/svp', 'core/sound/tremor']
common = src / 'libretro/libretro-common'
files = [f for d in dirs for f in sorted((src / d).glob('*.c'))]
files += [common / f for f in ['streams/file_stream.c', 'streams/file_stream_transforms.c', 'compat/fopen_utf8.c', 'compat/compat_snprintf.c', 'compat/compat_strl.c', 'compat/compat_strcasestr.c', 'compat/compat_posix_string.c', 'encodings/encoding_utf.c', 'file/file_path.c', 'file/retro_dirent.c', 'lists/string_list.c', 'lists/dir_list.c', 'memmap/memalign.c', 'string/stdstring.c', 'vfs/vfs_implementation.c']]
files += [src / 'libretro/deps/zlib-1.2.11' / f for f in ['adler32.c', 'crc32.c', 'inffast.c', 'inflate.c', 'inftrees.c', 'zutil.c']]
files += [root / 'native/genesis-web.c']
# No GPL core/frontend is linked. Nuked OPN2 is optional and not selected;
# retain its license in the source kit, but compile the standard YM2612 path.
flags = ['-O2', '-DNDEBUG', '-D__LIBRETRO__', '-DUSE_LIBRETRO_VFS', '-DUSE_LIBTREMOR', '-DUSE_16BPP_RENDERING', '-DFRONTEND_SUPPORTS_RGB565', '-DLSB_FIRST', '-DALIGN_LONG', '-DBYTE_ORDER=LITTLE_ENDIAN', '-DM68K_OVERCLOCK_SHIFT=20', '-DZ80_OVERCLOCK_SHIFT=20', '-DMAXROMSIZE=8388608', '-DINLINE=static inline']
flags += ['-I' + str(src / d) for d in dirs + ['libretro', 'libretro/libretro-common/include', 'libretro/deps/zlib-1.2.11']]
flags += ['-I' + str(src)]
env = os.environ.copy()
env.update(EMSDK=str(sdk), EMSDK_NODE=str(sdk / 'node/22.16.0_64bit/bin/node'), EM_CONFIG=str(sdk / '.emscripten'))
obj = src / 'web-obj'; obj.mkdir(exist_ok=True)
def compile_file(f):
    o = obj / (hashlib.sha256(str(f).encode()).hexdigest()[:16] + '.o')
    newest = max(f.stat().st_mtime, port.stat().st_mtime if f.name == 'genesis-web.c' else 0)
    if o.exists() and o.stat().st_mtime > newest: return o
    r = subprocess.run([str(sdk / 'upstream/emscripten/emcc'), *flags, '-c', str(f), '-o', str(o)], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if r.returncode: raise RuntimeError(str(f) + '\n' + r.stdout[-6000:])
    return o
with concurrent.futures.ThreadPoolExecutor(max_workers=a.jobs) as pool:
    objects = list(pool.map(compile_file, files))
out = root / 'web/assets/genesis-core.mjs'
out.parent.mkdir(parents=True, exist_ok=True)
exports = ['_malloc','_free'] + ['_rr_' + n for n in ['init','load','frame','save','state_ptr','restore','video_ptr','video_width','video_height','audio_ptr','audio_count','frame_rate','error_ptr','ram_ptr','destroy']]
subprocess.check_call([str(sdk / 'upstream/emscripten/emcc'), *map(str, objects), '-O2', '--no-entry', '-lm', '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sEXPORT_NAME=createGenesis', '-sENVIRONMENT=web,node', '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=67108864', '-sMAXIMUM_MEMORY=268435456', '-sSTACK_SIZE=2097152', '-sEXPORTED_FUNCTIONS=' + json.dumps(exports), '-sEXPORTED_RUNTIME_METHODS=' + json.dumps(['FS','UTF8ToString','HEAPU8']), '-o', str(out)], env=env)
print('Built', out, 'from', len(files), 'translation units', flush=True)
