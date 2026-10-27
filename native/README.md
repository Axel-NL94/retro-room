# MesenCE browser core

RetroRoom builds the modern, multi-system MesenCE Libretro core at revision
`4c4e069f16a8ad6ed79e046046c56d51558c7daf` with Emscripten **4.0.19**.
The website currently exposes NES and SNES; other compiled systems are not
advertised as playable.

`mesen-web.cpp` is the GPL-3.0-or-later browser frontend. It supplies Libretro
callbacks, two controller ports, RGBA video, 48 kHz stereo PCM and uncompressed
core snapshots. ROMs live in Emscripten MEMFS only. Each player has a separate
WebAssembly instance. No native server or desktop emulator is required by players.

The build script applies these small upstream changes:

- Disable desktop shortcut handling during initialization.
- Disable desktop video worker threads. Frames are stepped and converted by the
  Libretro frontend synchronously; SharedArrayBuffer and special HTTP headers
  are not required.
- Initialize the audio output at 48 kHz. The frontend also selects the matching
  Libretro audio option.

The browser frontend configures deterministic power-on memory for NES/SNES.
This is necessary for independent online instances to start with identical state.
Snapshots exclude fixed settings, ROMs and the host audio output queue. Audio
produced while replaying speculative frames is not sent to Web Audio.

## Build

The normal website build uses the checked-in WebAssembly binary. To rebuild:

1. Download the complete corresponding source archive at
   `web/assets/mesen-source.tar.gz` and extract it, or check out the pinned upstream
   revision from https://github.com/libretro/MesenCE.
2. Install and activate Emscripten 4.0.19 from the official emsdk repository.
3. Run from the RetroRoom project:

```sh
python3 scripts/build-mesen.py --source /path/to/mesen-src --emsdk /path/to/emsdk --jobs 4
```

The build uses Python's parallel compiler runner, so GNU Make is not required.
A full rebuild should use a clean source directory without `web-obj/`.
The output is `web/assets/mesen-core.mjs` and `web/assets/mesen-core.wasm`.
The build also packages the complete corresponding source archive and records
the `mesen-build.json` checksums. The static build verifies those checksums.

The initial Wasm memory allocation is 96 MiB and may grow up to 512 MiB. This
is substantially heavier than a small JavaScript-only emulator. Slow devices
need performance testing; the frontend does not require multithreading.

## Source and licensing

MesenCE and this linked frontend are GPL-3.0-or-later; see `MESEN-LICENSE.txt`
and upstream source headers for third-party notices. The complete corresponding
upstream sources (including dependencies), applied patches, browser frontend
and build script accompany the binary in `web/assets/mesen-source.tar.gz`.
`web/assets/mesen-build.json` records the source revision, toolchain and SHA-256
checksums. No game ROM or BIOS is included in that source archive.
