# MesenCE browser core

RetroRoom builds the modern, multi-system MesenCE Libretro core at revision
`4c4e069f16a8ad6ed79e046046c56d51558c7daf` with Emscripten **4.0.19**.
The website currently exposes NES and SNES; other compiled systems are not
advertised as playable.

`mesen-web.cpp` is the GPL-3.0-or-later browser frontend. It supplies Libretro
callbacks, two controller ports, RGBA video, 48 kHz stereo PCM and uncompressed
core snapshots. ROMs live in Emscripten MEMFS only. In local-ROM mode each player has a separate
WebAssembly instance; streaming mode runs only the host instance. No native server or desktop emulator is required by players.

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

## CPU overclock

The host selects 100%, 200%, 300%, 400% or 500% before the guest connects. Mesen adds
extra scanlines before NMI to give the CPU more work time within each video
frame; this is an approximate CPU-time percentage, not a literal MHz multiplier.
NTSC uses 262 base scanlines and PAL/Dendy 312. Video cadence and audio retain
their normal speed. SNES enhancement-chip clocks are unchanged.

Both peers receive and validate the same setting before ROM loading and starting.
The setting is locked while a guest is connecting or connected; changes otherwise
restart the emulated machine. Rollback snapshots exclude settings, so the selected
value must be applied again on every ROM load/reset. The versioned netplay protocol rejects
older clients. Overclocking can break timing-sensitive games and uses more CPU.

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

MesenCE upstream and this frontend have GPL-3.0-or-later grants. The combined
emulator distribution selects GPL version 3, including the xBRZ code whose
header specifies GPLv3 with a MAME-specific exception. See `MESEN-LICENSE.txt`,
`../LICENSING.md` and the preserved upstream notices; an MIT license for the
website's own code does not replace these terms.

The complete corresponding source trees used by the native build (Core,
Utilities, SevenZip, Lua and Libretro), applied patches, browser frontend,
`CHANGES.md`, third-party notices and build scripts accompany the binary in
`web/assets/mesen-source.tar.gz`. Unrelated desktop UI/platform trees are omitted.
`web/assets/mesen-build.json` records the source revision, toolchain and SHA-256
checksums, including the generated loader hash. No commercial game ROM or proprietary BIOS is included in that source archive.
The compiled multi-system source does include credited MIT/Expat-licensed
replacement Game Boy boot code from LIJI32/SameBoy; see `../LICENSING.md`.

Local savestate files use the uncompressed core snapshot with a versioned RetroRoom
header, ROM SHA-256, CPU setting and payload SHA-256. They contain no ROM. Imported
states are restored on a separate emulator instance before replacing a solo game.
The current upstream Libretro save-RAM accessors return null/zero; battery-save
export is therefore not exposed.


## Updating only source packaging or notices

For documentation/comment-only changes, preserve the executable binary and run:

```sh
python3 scripts/package-mesen-source.py --source /path/to/the-matching-patched-mesen-src
```

This updates the source archive and metadata, not the Wasm or generated loader.
Never use this command to pair a modified native implementation with an old binary.
After executable source changes, rebuild with `build-mesen.py` instead. The ordinary
website build checks all three hashes. Keep source downloads accessible beside
all versions of the binary being distributed.
