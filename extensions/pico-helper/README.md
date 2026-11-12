# RetroRoom PICO-8 Cartridge Helper 0.1.0

Independent original MIT code; copyright 2026 RetroRoom contributors. No game
cartridges, emulator cores, private Pixel-M8 sources or third-party code included.

Chrome/Edge desktop, Manifest V3. Unzip to a permanent folder. Open
chrome://extensions (Edge: edge://extensions), enable Developer mode, choose Load
unpacked and select the folder containing manifest.json. Keep this folder.
For an already-open game, click this extension's toolbar/menu action on RetroRoom,
then choose Check extension again in the game. No emulator reload is needed.
Automatic content-script detection applies on subsequent visits.

Only https://axel-nl94.github.io/retro-room/ is accepted. Content-script messages
are restricted to the top frame, the expected extension ID, a valid BBS ID and a
per-request UUID. The background worker constructs URLs itself. It never accepts
arbitrary URLs, reads invitation fragments or executes remote scripts. Lexaloffle
redirects are rejected. Metadata is limited to 512 KiB, PNG downloads to 4 MiB;
total download time is limited to 25 seconds. Maximum two active downloads, one
per tab, and twelve attempts per minute per tab. Leaving/cancelling aborts work.

Permissions: host access only to the two Lexaloffle HTTPS hostnames; declarative
content script only on the official RetroRoom path. activeTab+scripting allow
explicit toolbar activation on an existing game after installation. No cookies,
all-sites access, downloads permission, microphone/camera, account or local server.
Chrome may display hostname-level permission text. The code additionally enforces
exact allowed paths and cartridge IDs. Only public cartridge GETs are made with
credentials omitted; destination servers still see the user's IP address.

The website owns its bounded IndexedDB cache. Uninstalling the extension does
not clear the website cache; clearing RetroRoom site data does. Cached IDs remain
pinned to their downloaded bytes until site data is cleared or the item is evicted.
No automatic game/extension update service. Reinstall a newly downloaded ZIP to
update the helper; updating RetroRoom's website does not update an unpacked copy.

Build ZIP: install the repository's pinned dependencies, run `node scripts/build.js`.
The deterministic source-only ZIP is written to dist/downloads/ and the exact
website source archive includes this extension's source. Online downloads depend
on Lexaloffle availability and cannot guarantee every cartridge's compatibility.
