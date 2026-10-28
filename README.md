# RetroRoom

**Oude games. Samen opnieuw.** NES en SNES samen spelen in de browser via
uitnodigingslinks. De site wordt handmatig gepubliceerd op https://axel-nl94.github.io/retro-room/. De bron staat op https://github.com/Axel-NL94/retro-room.

De emulator is **MesenCE**, een moderne Mesen-core die naar WebAssembly is
gecompileerd. NES is beschikbaar; SNES is een eerste **beta**. De host kiest een
lokale ROM. De gast kiest zelf dezelfde ROM op het eigen apparaat. Een lokale
SHA-256-controle vergelijkt het bestand met de hash van de host. ROM-bestanden
worden niet tussen spelers verstuurd. Tijdens het spelen worden kleine
controllerberichten en controlehashes uitgewisseld.

## Samen spelen

1. Kies **Maak een kamer** en selecteer `.nes`, `.sfc` of `.smc`, of gebruik de demo.
2. Deel de uitnodigingslink en houd de kamer open.
3. De gast opent de link, vult een naam in en kiest **Speel mee**.
4. De gast kiest onder **Jouw ROM** hetzelfde lokale bestand en klikt na de
   SHA-256-controle op **Ik ben klaar**. Een afwijkende versie, regio of hack
   wordt geweigerd; er is geen overdrachtsfunctie of terugval naar downloaden.
5. De host kiest **Start samen**.

Een kamer heeft plek voor twee spelers en staat niet in een openbare lijst.
Wie de link heeft, kan proberen mee te doen. De link vervalt zodra de host de
kamer verlaat, de pagina vernieuwt of de browser sluit. Een nieuwe kamer krijgt
een nieuwe willekeurige link.

Er is geen eigen server of gebruikersaccount nodig. PeerJS Cloud verzorgt de
signalering; Google STUN helpt een directe verbinding vinden. P2P is altijd de eerste keuze.
Lukt dat niet binnen ongeveer 10 seconden, dan schakelen beide spelers automatisch
over op Itty Sockets via WebSockets over TLS. Er is geen TURN-account of betaalde databundel. Externe diensten hebben geen garantie
op beschikbaarheid of onbeperkt gratis gebruik. Zie [GRATIS-HOSTING.md](GRATIS-HOSTING.md).

## Emulator en mogelijkheden

- Moderne MesenCE-core, vastgezet op `4c4e069f16a8ad6ed79e046046c56d51558c7daf`.
- NES met iNES/NES 2.0 en SNES met `.sfc`/`.smc`; maximaal 8 MB per ROM.
- Iedere speler laadt eigen gamebytes in tijdelijk WebAssembly-geheugen.
  ROM-bytes worden niet verstuurd naar een andere speler of een spelserver.
  Alleen een expliciete set kleine protocolberichten mag het netwerk op.
  Er bestaat geen ROM-datakanaal, bestandszender of bestandsontvanger.
- Twee lokale emulatorinstanties, 2 frames invoervertraging en maximaal 12
  voorspellingsframes. Vertraagde invoer leidt tot rollback.
- Native Mesen-snapshots; controlehashes stoppen de game als de toestanden afwijken.
- Dezelfde startinstellingen bij beide spelers, waaronder deterministische NES/SNES-RAM.
- Toetsenbord, gamepads, aanraakknoppen, geluid, volledig scherm en samen pauzeren.
- Speltiming volgt de FPS van de geladen Mesen-core.
- De originele, vrij meegeleverde NES-homebrew **Room Rally**, die beide spelers zelf vanuit de site kunnen laden. Geen commerciële ROMs
  of BIOS-bestanden worden meegeleverd.

De eerste emulator-download is ongeveer 5,8 MB. Mesen begint met 96 MiB Wasm-geheugen
per browser en kan groeien. Prestaties op telefoons en oudere apparaten moeten
in de praktijk worden getest. Er zijn nog geen blijvende saves, accounts,
wachtwoorden, toeschouwers, automatisch sessieherstel of automatische hersynchronisatie.

De browser- en automatische tests gebruiken eigen NES- en SNES-homebrew. Power Blade
is aanvullend lokaal getest op opstarten, beeld, geluid, invoer en toestandsherstel;
volledige gamecompatibiliteit is daarmee niet bewezen. SNES is beperkt getest en
blijft beta. Andere Mesen-systemen zijn niet in de website ontsloten. Sega Mega Drive
of PlayStation vereisen later andere emulatorcores.

## Bediening

| Actie | Eigen speler | Tweede speler lokaal bij solo |
|---|---|---|
| Richtingen | Pijlen | WASD |
| A / B | X / Z | G / F |
| Start / Select | Enter / Shift | T / R |
| SNES X / Y | C / V | Y / H |
| SNES L / R | Q / E | 1 / 2 |

Bij een standaardgamepad gebruikt SNES de gebruikelijke fysieke posities:
B onder, A rechts, Y links en X boven. NES gebruikt de onderste knop voor A.
Werkelijke gamepadondersteuning hangt af van controller en browser. In Room Rally
tik je op A om te racen; Start reset de race. De game zelf moet multiplayer
ondersteunen om een tweede speler te kunnen gebruiken.

## Lokaal ontwikkelen en publiceren

Installeer Node.js 24 en pnpm 10.20.0:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm test
pnpm build
pnpm dev
```

Open `http://localhost:4173`. De server is een ontwikkelpreview; spelers gebruiken
GitHub Pages. Ook in de preview lopen uitnodigingen via PeerJS Cloud. Bouw opnieuw
na bronwijzigingen. Solo maakt geen PeerJS- of relayverbinding.

De workflow **Check project** test iedere pull request en push naar `main`.
De workflow **Test and deploy GitHub Pages** staat voor publicatie op
**alleen handmatig** via `workflow_dispatch`; een codewijziging zet de site niet
automatisch opnieuw online. Publiceren gebeurt uitsluitend op uitdrukkelijk verzoek van de eigenaar. Onder **Settings → Pages → Source** staat **GitHub Actions**. Er zijn geen
serveradressen, API-sleutels of geheimen nodig. Oude `RETROROOM_SERVER_URL`-instellingen
worden door deze frontend niet gebruikt. Alle paden werken onder `/retro-room/`.
Buildmarkeringen voorkomen gemengde gecachte versies. Beide spelers moeten na
een emulatorupdate de pagina vernieuwen; verschillende netplayversies worden geweigerd.

## Technische indeling

```text
web/src/mesen.js         WebAssembly-adapter, ROM-validatie en native snapshots
web/assets/mesen-*      Core, complete bijbehorende broncode en buildmetadata
native/mesen-web.cpp    Libretro-frontend voor framebesturing, video, audio en input
scripts/build-mesen.py  Native build met vastgezette Emscripten-toolchain
web/src/rollback.js     Invoer per frame, voorspelling, rollback en hashes
web/src/connection.js   Uitnodigingen, P2P eerst en automatische fallback
web/src/relay.js        Itty WebSocket-transport, versleuteling en invoerbundeling
web/src/protocol.js     Kleine netwerkberichten en vergelijking van lokale ROMs
web/src/app.js          Kamerinterface, invoer en spelverloop
web/src/audio*.js       Web Audio-uitvoer op 48 kHz
scripts/demo-rom.js     Originele Room Rally-ROM
server/index.js         Ontwikkelpreview en eerdere lobbyimplementatie
test/                   Native Mesen-, invoer-, formaat- en netwerktests
```

De normale websitebuild gebruikt de meegeleverde, gecontroleerde Wasm-binary.
Een native rebuild staat beschreven in [native/README.md](native/README.md).
De code vereist geen SharedArrayBuffer, desktopinstallatie of bijzondere
COOP/COEP-headers. Daardoor kan de statische frontend op GitHub Pages draaien.

PeerJS beheert het betrouwbare JSON-controlkanaal. Daarnaast bestaat alleen een
ongeordend betrouwbaar invoerkanaal op dezelfde RTCPeerConnection. Het protocol
stuurt een gamenaam, console, bestandsgrootte, SHA-256-hash en overclockinstelling;
geen bestandsinhoud, downloadadres of externe bestandspaden. De gast selecteert
zelf een lokaal bestand dat exact overeenkomt. De ingebouwde originele demo kan
op ieder apparaat vanuit de site worden geladen. Oudere clients met de functie
voor bestandsdeling worden al tijdens de uitnodigingshandshake geweigerd.
De gast start pas na een passende kamerhandshake.
Iedere 120 frames wordt een bevestigde snapshot beschikbaar voor hashcontrole.
De host verstuurt ongeveer iedere twee seconden een hash. Bij een afwijking stopt
de game; hashes zijn een synchronisatiecontrole, geen anti-cheatmechanisme.

De oudere JSNES-adapter en tests blijven beschikbaar voor regressiecontrole;
de website voert de game uit met Mesen. Ook de oudere Node-lobby en Render/Docker-
bestanden blijven bewaard voor mogelijke latere uitbreiding. Ze worden niet
gebruikt voor de huidige uitnodigingslinks en hoeven niet te worden uitgerold.

## Licenties

De MesenCE-core en de gekoppelde native browserfrontend zijn GPL-3.0-or-later.
De complete bijbehorende broncode, inclusief afhankelijkheden, patches, frontend
 en buildscript, staat naast de binary in `web/assets/mesen-source.tar.gz`.
Zie [native/MESEN-LICENSE.txt](native/MESEN-LICENSE.txt), de upstream bronheaders
en `web/assets/mesen-build.json` voor herkomst en checksums.

De overige eigen projectcode en de originele demo zijn MIT, zie `LICENSE`.
De bewaarde JSNES-afhankelijkheid is Apache-2.0; PeerJS en ws zijn MIT.
Google Fonts zijn optioneel met systeemfonts als terugval.

### CPU-overclock voor ROM-hacks

De host kan bij het maken van een kamer en onder **Emulator** 100–300% kiezen
(in stappen van 25%). 100% is standaard. Mesen geeft de virtuele CPU extra tijd
per beeldframe; de game en audio blijven op normale snelheid. Het percentage is
een benadering van de beschikbare CPU-tijd, geen exacte MHz-vermenigvuldiging.
Speler 2 neemt dezelfde waarde over. Zodra een gast verbindt staat de instelling
vast; aanpassen zonder gast begint de game opnieuw. Niet iedere ROM-hack is
compatibel en hogere waarden vragen meer rekenkracht. SNES-coprocessors zoals
Super FX worden hiermee niet afzonderlijk overclockt.

## Itty Sockets als fallback

De host opent bij het maken van een kamer een wachtverbinding naar de vaste dienst
`wss://itty.ws/c/retroroom-<kamer-id>?announce=true`. De gast probeert eerst PeerJS/WebRTC.
Bij een fout of een time-out van 10 seconden opent de gast de relay en vraagt om toelating.
Bij werkend P2P gaat geen spelinvoer, ROM-hash of gamemetadata via Itty. De wachtverbinding
is nodig om de host te bereiken als de P2P-handshake zelf geblokkeerd wordt.

De volledige uitnodigingslink bevat naast de kamer-id een willekeurige 256-bits sleutel
in het URL-fragment. Deze sleutel wordt niet naar GitHub Pages, PeerJS of Itty verstuurd.
Alle fallbackverzoeken en spelberichten zijn met AES-GCM versleuteld; de relay ziet nog wel
IP-adressen, kamer-id, berichtgroottes en timing. Wie de link heeft kan proberen mee te doen;
behandel hem als een privésleutel. De host accepteert één gast. Berichten zijn aan die
verbinding/sessie gebonden; oude clients en berichten worden geweigerd.

De netwerk-whitelist en lokale ROM-controle gelden voor beide routes. Invoer wordt op de
relay maximaal 32 ms gebundeld (tot 8 frames), om kleine WebSocket-berichten te combineren.
De bestaande rollback wacht zo nodig op vertraagde invoer. De relay kan hogere latency of
haperingen geven. Een lopende P2P-game verhuist niet stilzwijgend naar een nieuwe sessie;
bij uitval verlaat de gast de kamer en gebruikt dezelfde uitnodiging opnieuw. De nieuwe
verbinding probeert wederom eerst P2P. Er is geen automatisch sessieherstel.

De gratis communitydienst heeft geen beschikbaarheids- of leveringsgarantie en past
anti-misbruiklimieten toe. Ook WebSockets kunnen door een firewall worden geblokkeerd.
Er wordt dan een fout getoond; de UI claimt geen werkende verbinding.
Zie [Itty-documentatie](https://ittysockets.com/docs),
[prijzen](https://ittysockets.com/pricing) en [voorwaarden](https://ittysockets.com/terms).
