# RetroRoom native modifications

Author: RetroRoom contributors. Copyright (c) 2026 RetroRoom contributors.
Browser integration work: 2026-10-28–2026-10-29. Notices reviewed: 2026-10-29.
Upstream: MesenCE 4c4e069f16a8ad6ed79e046046c56d51558c7daf.

- `Libretro/libretro.cpp`: initialize without desktop shortcuts via
  `_emu->Initialize(false)`; set the default audio rate to 48,000 Hz.
- `Core/Shared/Video/VideoDecoder.cpp`: under `RETROROOM_WEB`, skip desktop
  decoder worker creation and the asynchronous frame update path. The Libretro
  frontend obtains/converts the PPU frame synchronously.
- `Core/Shared/Video/VideoRenderer.cpp`: under `RETROROOM_WEB`, skip desktop
  renderer worker creation.
- `native/mesen-web.cpp`: a new GPL-3.0-or-later Libretro browser frontend with
  two controller ports, synchronous frames, video/audio buffers, deterministic
  power-on options, 100–500% virtual CPU work-time selection, RAM access,
  snapshots and exported Emscripten entry points.
- `scripts/build-mesen.py`: compile the pinned source with Emscripten 4.0.19 and
  the documented defines, flags, exports and memory sizes.
- `scripts/package-mesen-source.py`: package all native source inputs and the
  frontend/build instructions, dated notices and third-party license texts.

The licensing review adds dated comments to the three changed upstream files,
updates documentation and source packaging, and records the generated loader
hash. Those comments do not change executable code. The Wasm remains byte-for-byte
unchanged. All original upstream copyright and license notices are preserved.
The xBRZ MAME exception is preserved and is not treated as a general exception.
