# Pixel-M8 in RetroRoom

Integrated 2026-11-11 (adapter revision 2): existing Pico Core 0.11.9 web build 0.1.0, Emscripten
7.0.0. Artifacts were checked against the private repository source manifest;
`web/assets/pixel-m8-build.json` records their hashes and the manifest Git blob.
Only the unmodified loader/Wasm and complete license notices are redistributed.
Private source and source archives are intentionally excluded.

## Available

- PICO-8 tile in both solo and room selection, `.p8` / `.p8.png`, up to 8 MiB.
- 128×128 video, fixed 60 Hz host ticks (core handles 30/60 Hz cartridge updates).
- 22,050 Hz mono audio resampled continuously to RetroRoom's 48,000 Hz stereo.
- Two players: directions and O/X, browser-local remapping, touch and gamepads.
- Solo local two-player profiles, or WebRTC video/audio plus guest button input.
- Preselected local continuation `.p8`/`.p8.png` files (128 files maximum,
  8 MiB per file, 64 MiB total including the main cartridge). Keep filenames
  matching the game’s load/reload calls. Files can also be added through
  Cartridges in the game toolbar. Only the host reads cartridge files.
- Original Pixel Duo demo; no third-party cartridges or official PICO-8 runtime.
- In-game `cartdata`/`dset` saves copied from core MEMFS to per-ID localStorage
  entries once per second, before restart/dispose and on pagehide. No ROM bytes
  are transferred to player 2. Optional downloaded continuations are stored separately
  in bounded IndexedDB, not in this save namespace. Saves require games to use that API and storage to
  be allowed. Private mode, clearing site data, quotas and abrupt termination
  can prevent/remove persistence. This uses this origin's separate RetroRoom save
  namespace; it does not import the standalone Pixel-M8 player's IndexedDB saves.

## Current limits

No full VM save/restore API means no rollback/each-own-ROM online mode or full
savestate import/export. These options are disabled explicitly. CPU overclock
is unavailable; it stays at 100%. Streaming uses the existing direct WebRTC route,
without a Tailcat video fallback or a new relay service.

Local `load()` and `reload()` resolve files already imported into this instance.
Original root filenames are retained independently of the bounded room title.
For BBS-style `load("#id")`, exact local filenames are searched first, followed
by the highest numbered `id-N.p8.png` revision. A pending missing BBS request
first checks the local browser cache, then tries the optional extension. A missing
extension opens a host-only installation/download prompt in the cartridge dialog, keeps the stream connected with the
last image and no repeated audio, and resumes after the correct local file is
added. Shared memory, game parameters, cartdata and the original room survive
this switch. Cancelling declines that load request; it does not restart the VM.
Manual pause is preserved. A missing ordinary filename is returned as a failed
load by the existing core (no pending callback): preload these files or add them
before the game retries. Relative filename case must match the core's lookup.

No BBS download proxy or external cartridge-download service is deployed. The optional
MIT Chrome/Edge desktop extension downloads directly from Lexaloffle. Install/download:
`pico-helper.html`; complete source: `extensions/pico-helper/`. The source-only ZIP,
SHA-256 and installation instructions ship with each production build. Ordinary games
and streaming guests do not need the extension. An existing tab can be activated via
the extension toolbar action, then Check extension again, without resetting the VM.
The waiting host and streaming guest see a centered loading indicator, including
fullscreen. Download failures allow retry, cancellation or manual import. Manual pause
is preserved. Native parsing must succeed before bytes are persisted.

The separate IndexedDB cache is capped at 128 downloads/64 MiB, with oldest-first
eviction and SHA-256 integrity checks. Individual extension downloads are capped at
4 MiB and fixed public Lexaloffle endpoints; requests/time/concurrency are bounded.
No arbitrary URL API, credentialed requests, remote scripts or new third-party deps.
Cache failure does not interrupt the active game. Cached IDs stay pinned until evicted
or site data is cleared; this differs from desktop online revision refresh behavior.
Extension updates are manual, and mobile/in-app browser support is not promised.
PICO-8 mouse/full-keyboard/clipboard APIs, custom pause menus, `cstore` ROM-data
persistence and save backup import/export are not exposed in this first adapter.
Some cartridges may depend on these features or other core compatibility gaps.
Only cartdata/dset `.pcsave` files (268 bytes) are persisted; save files and game
code never go into signaling or stream metadata. Multiple tabs writing the same
save ID have normal last-write-wins behavior.

## Licensing

Pico Core: MIT, copyright 2026 Pico Core contributors. z8lua/Lua: MIT and WTFPL2;
compiler/runtime components retain their own permissive terms. Full original
texts are in `web/PIXEL-M8-NOTICES.txt`, linked from the public license page.
No private native sources or full upstream source archive are published. The
RetroRoom adapter, demo and tests are public MIT code in the application download.
