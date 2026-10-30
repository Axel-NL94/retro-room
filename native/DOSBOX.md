# DOSBox Pure browser integration

Upstream: https://codeberg.org/schelling/dosbox-pure, pinned revision
`d9c1356a6376fc35bd9a900b46c4666b3f4500e6`. The original DOSBox and DOSBox Pure
are GPL-2.0-or-later. This combined RetroRoom distribution uses GPL version 3;
the browser bridge/cooperative-thread adapter are GPL-3.0-or-later. Original
grants and all source notices remain intact. See `web/DOS-NOTICES.txt` for DOS
authors, original license text and retained bundled-component notices, and
`web/THIRD-PARTY-NOTICES.txt` for GPLv3/LGPLv2.1 and compiler-runtime texts.

## Build and source

Install unmodified Emscripten 4.0.19 from its official emsdk repository. Extract
`web/assets/dos-source.tar.gz`, or check out the revision above, then run:

```sh
python3 scripts/build-dos.py --source /path/to/dosbox-pure --emsdk /path/to/emsdk --jobs 4
python3 scripts/package-dos-source.py --source /path/to/dosbox-pure
```

Use a clean source directory when changing compiler flags or upstream headers.
No proprietary BIOS, MS-DOS/Windows installation or commercial game is required
by, or supplied with, this build. No MIDI ROMs or soundfonts are bundled. The
source archive excludes repository metadata, screenshots and build intermediates;
it retains the complete C/C++ source/header trees, upstream Makefile, data tables,
licenses, our patched files, complete bridge and scripts. `dos-build.json` pins
the loader, Wasm, source archive and notice checksums.

## Browser changes dated 2026-10-30

- `include/dbp_threads.h` selects our cooperative Emscripten-fiber adapter in
  `include/rr-dos-threads.h` instead of creating OS threads. Asyncify runs its
  trampoline synchronously; a separate last-result accessor preserves results
  across stack unwinding. No SharedArrayBuffer or special response headers.
- `include/config.h` omits optional 3dfx, MT-32 and SC-55 backends. `midi.cpp`
  omits checks for the removed MIDI handlers; `dosbox_pure_libretro.cpp` omits
  the unavailable optional 3dfx PCI option section. The bridge supplies inactive
  3dfx hooks; this changes the snapshot layout and is part of the build ID.
- Normal interpreter CPU; fixed cycles of 3000 times the selected percentage,
  fixed 60 Hz output and 48 kHz audio. Native time/date calls use a fixed epoch
  plus frontend-stepped time. Optional network and hardware-render interfaces
  are not supplied. The browser only provides MEMFS and ordinary joypad callbacks.
- During games, local gamepad/button input maps to DOS keys. P1 uses arrows,
  Ctrl/Alt, Escape/Enter, Space/Tab, Q/E. P2 uses WASD, F/G, Escape/Enter, H/R,
  T/Y. A key shared by ports stays down until both ports release it. In the
  DOSBox Pure launch menu the first player's controls act as a RetroPad.

## Released scope and known limits

DOS is beta. Solo and WebRTC streaming run one DOS instance. Only original DOS
Duo fixtures have been tested; arbitrary commercial-game compatibility is not
established. ZIP/DOSZ and direct COM/EXE/BAT content are accepted up to 32 MiB.
Programs needing extra files must be supplied as a complete ZIP. No general
text typing, mouse, custom DOS-side key remapping, 3dfx or booted Windows UI is
exposed. Physical keyboard/gamepad mappings are local browser profiles.

Independent-instance/rollback probes did not produce matching state hashes and
replay hashes. State buffers are around 28.8 MB for the original fixture. Local
DOS netplay is therefore disabled, and DOS rooms do not use Tailcat.
Native snapshot save/restore works for the running original COM fixture, but
import into a freshly booted ZIP menu needs reliable program/drive preparation.
DOS savestate UI is disabled pending that work. In-game progress remains in
temporary emulated storage and has no browser persistence/export in this version.

`scripts/demo-dos.js` is the full editable source of the original MIT-licensed
DOS Duo COM demo. It tests two sets of keys on a single virtual DOS PC; it is
not a commercial game and contains no third-party game assets.
