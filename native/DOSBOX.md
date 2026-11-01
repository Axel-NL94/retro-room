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
  are not supplied. The browser provides MEMFS, keyboard, mouse, joystick and joypad callbacks.
- During games, the physical keyboard/mouse and configurable controller outputs
  feed the shared DOS PC. Controller presets provide P1 arrows/Ctrl/Alt and P2
  WASD/F/G; each output can be changed. Shared keys stay down until both ports
  release them. In the launch menu, controller input and physical arrows/Enter/Escape also act
  as a RetroPad.

## Released scope and known limits

DOS is beta. Solo and WebRTC streaming run one DOS instance. Only original DOS
Duo fixtures have been tested; arbitrary commercial-game compatibility is not
established. ZIP/DOSZ and direct COM/EXE/BAT content are accepted up to 32 MiB.
Programs needing extra files must be supplied as a complete ZIP. Physical keyboard, mouse and custom controller-to-DOS bindings are exposed.
3dfx and booted Windows UI remain outside the tested integration.

The original independent-instance mismatch was traced to BIOS gettimeofday
fractions and fixed by using the virtual clock. Independent-instance probes now
match; save/replay state checks still differ, so rollback remains disabled. State buffers are around 28.8 MB for the original fixture. Local
DOS netplay uses an experimental six-frame lockstep input buffer, waits when
remote input is missing, and stops on state-hash divergence. DOS rooms do not use Tailcat.
Solo-only checkpoint export/import is available in build
`dosbox-pure-d9c1356-web-solo-3`; see [DOS-SAVESTATES.md](../DOS-SAVESTATES.md).
Rollback and multiplayer state transfer remain disabled. Separate in-game save
file export is not provided.

`scripts/demo-dos.js` is the full editable source of the original MIT-licensed
DOS Duo COM demo. It tests two sets of keys on a single virtual DOS PC; it is
not a commercial game and contains no third-party game assets.


## Full input bridge (30 October 2026)

`rr_set_input` accepts bounded per-port keyboard snapshots, lock-key modifiers,
relative mouse motion/buttons/wheel and a two-axis/two-button DOS joystick. The
keyboard callback is accompanied by the keyboard polling callback so upstream's
sticky-key prevention does not release held physical keys. Modifier presses are
queued before ordinary keys; modifier releases after ordinary key releases.
Native BIOS tests cover Shift+B, Ctrl+C, F1, mouse and joystick state. Mouse wheel
steps are translated into Page Up/Down because the DOS mouse interface has no
standard scroll-wheel channel. The host combines both players' physical keyboard
and mouse states into the one shared virtual PC. Joysticks remain separate ports.

The browser captures keyboard only while the gamescreen owns focus, preserves
short taps for at least one input frame, and releases on blur/dialog/pause.
Pointer lock is requested only through the mouse button and released by Escape.
Controllers can emit configurable DOS keys/mouse buttons, steer the mouse, or
control a true DOS joystick. Profiles persist in local storage. No OS shortcuts
or privileged host input are synthesized. Reserved browser/OS keys, clipboard
paste, and IME text composition are outside the physical DOS key interface.

For stream guests, input includes bounded key/joystick state and cumulative
mouse counters. A reliable ordered data path preserves typing; the receiver
consumes motion once, rejects old epochs/sequences and releases stale input.
There is no game file or emulator state transfer.

## Determinism diagnostics

All frontend input history is included in local snapshots. The state writer has
a read-only diagnostic hook in `src/dbp_serialize.cpp` that records the byte
ranges of named serializer sections. `scripts/probe-dos-sync.js` compares two
independent instances and save/replay, including audio/video, without exporting
any user game data. `gettimeofday` joins `time` and `clock_gettime` on the virtual
clock; the BIOS previously used host wall-clock fractions during initialization.
These diagnostics do not enable DOS rollback automatically.

## Solo checkpoints (1 November 2026)

- The browser-only `unionDrive::FlushForSnapshot` hook writes the current writable
  overlay immediately, including bytes written through still-open handles. It
  cancels the completed delayed-write event. `rr_solo_flush` runs this while the
  cooperative DOS fiber is paused; a failed flush prevents checkpoint export.
- A bounded `RRDOS001` frontend container stores the native snapshot, `/saves`
  files, original content extension and the Pure-menu launch path. A fresh staging
  core receives those save files **before** mounting the original game. The
  checkpoint never modifies the original game bytes or the active core on failure.
- `rr_solo_prepare` supplies a one-shot program path. A small browser-only hook in
  `dosbox_pure_osd.h` consumes it inside PUREMENU on the emulation fiber and invokes
  the existing DOS batch launcher. It preserves the path for subsequent exports.
  Direct COM/EXE and DOSBOX.BAT start normally. Import waits for a running DOS
  program, bounded to 1,800 preparation frames, yielding to the browser every 20.
- A running DOS program is required for export; menu-only and booted OS states
  are not exported. Native `save()` remains separate for lockstep diagnostics;
  only solo UI calls `saveSolo()`/`restoreSolo()`. Two neutral preview frames refresh
  DOS's buffered video and release input after restoring; no rollback guarantee is made.
- Native state is bounded to 64 MiB, disk files to 32 MiB, container metadata to
  128 KiB and 512 safe relative file paths. The outer `.rrstate` format bounds DOS
  checkpoints to 97 MiB and checks game hash, emulator build, CPU setting and file
  integrity before any staging restore. Native CPU snapshots are interpreter/build
  specific. Unusual multi-stage launchers, disk swapping and arbitrary commercial
  game compatibility are outside the original-fixture test coverage.

Native tests cover COM restoration at 100%/500%, a nested executable selected in
a ZIP menu, checkpoint re-export after import, and pending file writes/open-handle
seek positions across a fresh complete-ZIP instance. Full matching native source,
including the modified drive/menu files, is packaged with the build.
