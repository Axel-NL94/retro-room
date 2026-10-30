# RetroRoom licensing and source availability

Reviewed: 2026-10-29. The public entry point is `web/licenses.html`.

## Scope of the grants

The combined Mesen-based browser program is distributed under GNU GPL **version 3**.
MesenCE's own README grants GPL-3.0-or-later, as does the RetroRoom native bridge.
The compiled source set also includes xBRZ, whose header specifies GPLv3 with a
MAME-specific additional permission, without an express later-version grant.
We therefore select GPLv3 for the combined distribution. The MAME permission is
preserved verbatim; RetroRoom does not claim it as a general linking exception.
GPL-2.0-or-later components may likewise be used under GPLv3.

Original RetroRoom source, original SVG artwork and the Room Rally demo also
retain the separate MIT grant in `LICENSE`. The MIT text is not a replacement
license for Mesen, its linked code or other dependencies. Permissive component
licenses and their notices remain in force. The LGPL source and complete
rebuild instructions are included; users are not prohibited from modifying,
debugging or rebuilding/relinking those components.

`web/THIRD-PARTY-NOTICES.txt` contains complete GPLv3, LGPLv2.1, Apache-2.0,
LLVM-exception, MIT, BSD, OFL and other required upstream notices and disclaimers.
`web/assets/license-manifest.json` records reviewed packages, provenance and hashes.
Mesen source headers retain the individual copyright statements. Original Mesen
credit: Copyright (C) 2014-2026 Sour, 2026 contributors. RetroRoom modifications:
Copyright (c) 2026 RetroRoom contributors; see `native/CHANGES.md`.

## Corresponding source on the same website

The production build creates `dist/assets/retro-room-source.tar.gz`, containing
this version's unmodified website sources, build scripts, lockfile, native files,
notices and tests. It includes the matching Mesen source archive and the official
PeerJS v1.5.5 source archive, including upstream's build configuration and lockfile.
It also retains the exact PeerJS minified bundle, source map and all 37 original
source contents represented by that bundle. The tag's version.ts placeholder is
replaced by upstream's build:version step with package.json's version 1.5.5.
The distribution does not rely solely on a moving GitHub branch or an upstream link.

`web/assets/mesen-source.tar.gz` contains every file under the Core, Utilities,
SevenZip, Lua and Libretro trees used by the native compile recipe, upstream
LICENSE/README, all RetroRoom patches, native bridge, notices and build scripts.
Unrelated desktop UI/platform trees are omitted; none is required by this build.
`native/CHANGES.md` and prominent dated comments identify the changed upstream files.
The archive may contain support code for systems not exposed by the website.
Only NES/SNES are presented as playable. No commercial game ROM or proprietary
console BIOS is packaged. Core/Gameboy/GbBootRom.h does contain MIT/Expat-licensed
open-source replacement boot code by LIJI32 (Lior Halphon), including Mesen's
documented SGB timing alteration. Its attribution and full license are included.
These embedded replacement byte arrays are preserved in the Mesen source.

The already built Wasm and generated loader remain in the full application source
download for convenience. Their hashes and the matching native-source hash are
verified by the build. No executable native code changes were made during the
licensing audit; the source changes add comments and packaging documentation.
General-purpose unmodified tools and compiler system libraries are separately
obtainable from the pinned Emscripten 4.0.19 / Node.js / pnpm distributions; their
relevant runtime notices are included. A hash-identical native rebuild is not a
condition claimed by this audit. The source must remain sufficient to rebuild.

The public licenses page and the in-app About dialog link directly to these
free downloads, without account, request, fee or click-through agreement.
Keep each source package accessible whenever distributing its matching binary.
Preserve source links and notices when creating another hosted build or ZIP.

## Npm dependencies and embedded bundle versions

All eight installed production packages are reviewed. `package.json` lists jsnes
2.1.0 (Apache-2.0), peerjs 1.5.5 (MIT), and ws 8.22.0 (MIT). PeerJS dependencies in
RetroRoom's pnpm lock also include @msgpack/msgpack 2.8.0 (ISC), EventEmitter3 4.0.7
(MIT), BinaryPack 2.1.0 (MIT), WebRTC adapter 9.0.6 (BSD-3-Clause), and SDP 3.2.2
(MIT). JSNES is used for old regression checks; ws is a development-server dependency.

The official **prebuilt** peerjs.min.js 1.5.5 was built with WebRTC adapter **9.0.1**
and SDP **3.2.0**, as recorded in its own source release's package-lock.json.
Its own original TypeScript and dependency sources are retained in the full source
download. Installed dependency versions must not be presented as proof of the
versions embedded in a prebuilt bundle. The bundle and source-map hashes are pinned.
@msgpack/msgpack is used by an alternate serializer, not this default browser bundle.

The build fails on unreviewed direct dependency versions, changed installed license
texts, changed reviewed source/bundle hashes, missing notices or missing source-map
contents. This is a regression check, not an automated legal opinion. A dependency
or asset update needs a renewed human review, not simply a regenerated hash.

## Assets, ROMs and services

DM Sans and Space Grotesk are loaded remotely via Google Fonts under OFL-1.1.
Their unmodified license/copyright notices are included. No logo, screenshot,
commercial game ROM or proprietary console BIOS from a vendor is shipped.
The multi-system core does include the separately credited open-source SameBoy
replacement boot code described above. Room Rally is an
original demo built by `scripts/demo-rom.js`; the controller SVGs/favicon are
original project artwork. Console and emulator names identify compatibility;
there is no claim of endorsement or affiliation.

Software licensing is separate from the rights to games, BIOSes, copied cartridges,
ROM hacks, audiovisual output and streaming. Two users selecting their own ROMs,
or transmitting only video and input, does **not** establish that every use is lawful
or eliminate operator liability. This review is not a full copyright, privacy,
consumer-law, trademark, patent or external-service-terms assessment. Refer legal
questions about those uses to a qualified adviser in the applicable jurisdiction.

Primary references: [GNU GPLv3](https://www.gnu.org/licenses/gpl-3.0.html),
[GNU source/binary FAQ](https://www.gnu.org/licenses/gpl-faq.html#SourceAndBinaryOnDifferentSites),
[MesenCE pinned source](https://github.com/libretro/MesenCE/tree/4c4e069f16a8ad6ed79e046046c56d51558c7daf),
[PeerJS v1.5.5 MIT](https://github.com/peers/peerjs/blob/v1.5.5/LICENSE),
[WebRTC adapter BSD](https://github.com/webrtcHacks/adapter/blob/v9.0.1/LICENSE.md),
[Emscripten](https://github.com/emscripten-core/emscripten/blob/4.0.19/LICENSE).
# DOSBox Pure browser addition (2026-10-30)

DOSBox Pure at `d9c1356a6376fc35bd9a900b46c4666b3f4500e6` is GPL-2.0-or-later.
This distribution selects GPLv3; the RetroRoom native DOS bridge and cooperative
thread adapter are GPL-3.0-or-later. Separate upstream grants are preserved.
`web/DOS-NOTICES.txt` retains upstream authors, GPLv2 and 54 distinct source notice
blocks, including TinySoundFont/stb MIT, Nuked OPL3 LGPL-2.1-or-later, Libretro MIT,
MAME sound BSD-3-Clause, miniz public domain and optional/platform source notices.
The existing compiler/runtime notices and full GPLv3/LGPL texts remain in
`web/THIRD-PARTY-NOTICES.txt`.

`web/assets/dos-source.tar.gz` contains the complete matching source trees,
patched files, bridge and build scripts. `native/DOSBOX.md` explains the pinned
Emscripten toolchain, modifications and disabled features. `dos-build.json` pins
loader/Wasm/archive/notice hashes, checked by ordinary builds. No commercial DOS
game, MS-DOS/Windows installation or proprietary MIDI/BIOS image is supplied.
The original DOS Duo fixture is MIT-licensed; its complete editable source is
`scripts/demo-dos.js`. Running a user's DOS program is separate from licensing
the emulator and confers no additional game/software rights.



## Tailcat fallback (30 oktober 2026)

De browserfallback gebruikt ongewijzigde Tailcat-broncode van Tailscale Inc & contributors,
commit `52fbad323e9d352f1febb623e0975368e9a8cbdd`, onder BSD-3-Clause.
De geselecteerde Go-afhankelijkheden behouden hun afzonderlijke BSD/MIT/Apache-2.0-
en andere vermeldingen; de volledige teksten staan in `web/TAILCAT-NOTICES.txt`.
Go 1.27.3 levert de ongewijzigde `wasm_exec.js`-runtime onder de Go-licentie (BSD).
De browserworker en RetroRoom-transportintegratie zijn eigen RetroRoom-code, onder de
bestaande projectlicenties. De voorwaarden van de publieke DERP-dienst staan los van
de softwarelicenties. Zie `native/TAILCAT.md` en `web/assets/tailcat-build.json`.
Het downloadbare `tailcat-source.tar.gz` bevat upstream, alle daadwerkelijk meegebouwde
afhankelijkheidsbronnen/embedded assets, behouden notices en een offline bouwinstructie.
De bouwstap controleert dat deze bronnen exact dezelfde Wasm produceren.
