# RetroRoom

**Oude games. Samen opnieuw.** NES en SNES samen spelen in de browser via
uitnodigingslinks. De site wordt handmatig gepubliceerd op https://axel-nl94.github.io/retro-room/. De bron staat op https://github.com/Axel-NL94/retro-room.

De emulator is **MesenCE**, een moderne Mesen-core die naar WebAssembly is
gecompileerd. NES is beschikbaar; SNES is een eerste **beta**. De host kiest bij
het tandwiel één speelwijze per kamer:

- **Samen emuleren** (standaard): beide spelers laden dezelfde eigen ROM. Een lokale
  SHA-256-controle vergelijkt de bestanden. Alleen knoppen en synchronisatiegegevens
  gaan over het netwerk; bij geblokkeerd P2P is Itty Sockets een fallback.
- **Beeld en geluid streamen**: alleen de host laadt de ROM en draait Mesen. De gast
  ontvangt canvasvideo en gesynthetiseerd gamegeluid via WebRTC en stuurt de eigen
  knoppen terug. De gast laadt geen ROM en start geen emulatorinstantie. Deze modus
  kan meer invoervertraging en dataverbruik geven. Er is geen video-/audiofallback
  via Itty en geen TURN-server ingesteld; een blokkerend netwerk kan streamen verhinderen.

In beide modi worden ROM-bestanden niet tussen spelers verstuurd. Camera,
microfoon en schermdeling worden niet aangevraagd. Er zijn geen commerciële
ROMs of BIOS-bestanden inbegrepen.

## Samen spelen

1. Kies **Maak een kamer**. Gebruik het **tandwiel** om de speelwijze te kiezen,
   kies NES of SNES en selecteer je ROM, of gebruik de NES-demo.
2. Deel de uitnodigingslink en houd de kamer open. De speelwijze staat nu vast.
3. De gast opent de link, vult een naam in en kiest **Speel mee**.
4. Bij samen emuleren kiest de gast hetzelfde lokale bestand onder **Jouw ROM**.
   Een afwijkende versie, regio of hack wordt geweigerd. Bij streamen wacht de gast
   op het gamebeeld; er is geen ROM-keuze. De gast kiest **Ik ben klaar** om geluid
   en controller te activeren (of gebruikt daarna de geluidsknop als autoplay geblokkeerd is).
5. De host kiest **Start samen**. Beide spelers kunnen pauzeren; de host hervat.

Een kamer heeft plek voor twee spelers en staat niet in een openbare lijst.
Wie de link heeft, kan proberen mee te doen. De link vervalt zodra de host de
kamer verlaat, de pagina vernieuwt of de browser sluit. Een nieuwe kamer krijgt
een nieuwe willekeurige link.

Er is geen eigen server of gebruikersaccount nodig. PeerJS Cloud verzorgt de
signalering; Google STUN helpt een directe verbinding vinden. Bij samen emuleren is P2P de eerste keuze.
Lukt dat niet binnen ongeveer 10 seconden, dan schakelen beide spelers automatisch
over op Itty Sockets via WebSockets over TLS. Er is geen TURN-account of betaalde databundel. Externe diensten hebben geen garantie
op beschikbaarheid of onbeperkt gratis gebruik. Zie [GRATIS-HOSTING.md](GRATIS-HOSTING.md).

## Emulator en mogelijkheden

- Moderne MesenCE-core, vastgezet op `4c4e069f16a8ad6ed79e046046c56d51558c7daf`.
- NES met iNES/NES 2.0 en SNES met `.sfc`/`.smc`; maximaal 8 MB per ROM.
- Bij samen emuleren laadt iedere speler eigen gamebytes in tijdelijk WebAssembly-geheugen;
  bij streamen doet alleen de host dit.
  ROM-bytes worden niet verstuurd naar een andere speler of een spelserver.
  Alleen een expliciete set kleine protocolberichten mag het netwerk op.
  Er bestaat geen ROM-datakanaal, bestandszender of bestandsontvanger.
- Samen emuleren: twee lokale emulatorinstanties, 2 frames invoervertraging en maximaal 12
  voorspellingsframes. Vertraagde invoer leidt tot rollback.
- Bij samen emuleren: native Mesen-snapshots; controlehashes stoppen de game als de toestanden afwijken.
- Bij samen emuleren: dezelfde startinstellingen bij beide spelers, waaronder deterministische NES/SNES-RAM.
- Toetsenbord, gamepads, aanraakknoppen, geluid, volledig scherm en samen pauzeren.
  Kies boven het beeld **Beeldformaat → Originele verhouding** (hele beeld met eventuele
  randen) of **Schermvullend · uitrekken** (hele scherm, zonder afsnijden). De keuze wordt
  lokaal bewaard en geldt voor fullscreen. Schermvullend toont uitsluitend de game,
  ook bij muisbeweging of pauzeren; verlaat die stand met Escape of de browserbediening.
  Bij originele verhouding verschijnt de bediening bij muisbeweging, aanraken of toetsenbordfocus.
- **Speel solo** en **Maak een kamer** beginnen met NES- en SNES-consoletegels.
  Kies daarna je eigen ROM en CPU-instelling. Alleen NES heeft een meegeleverde demo.
- In solo kun je een savestate downloaden als `.rrstate` en later importeren.
  Gebruik daarvoor dezelfde ROM, coreversie en CPU-instelling. Importeren controleert
  bestandsgrootte, metadata en checksum en test de snapshot op een aparte emulatorinstantie.
  Savestates bevatten geen ROM en worden niet via het netwerk gedeeld. Tijdens online
  spelen zijn export en import uitgeschakeld om desynchronisatie te voorkomen.
- Speltiming volgt de FPS van de geladen Mesen-core.
- Fullscreen, wisselen van tabblad en minimaliseren zetten solo of multiplayer
  niet automatisch op pauze. Gebruik de pauzeknop; online pauzeren beide spelers.
  Verborgen pagina's gebruiken een workerklok omdat schermverversing daar stopt.
  Losgelaten focus wist de invoer; verborgen spelers sturen neutrale knoppen.
  De browser of het besturingssysteem kan een achtergrondpagina nog vertragen,
  bevriezen of sluiten, vooral op mobiel of in energiebesparing. Continu doorspelen
  kan daarom niet op ieder apparaat worden gegarandeerd. Een handmatige pauze
  blijft bij terugkeren actief; gemiste tijd wordt niet versneld ingehaald.
- De originele, vrij meegeleverde NES-homebrew **Room Rally**, die beide spelers zelf vanuit de site kunnen laden. Geen commerciële ROMs
  of BIOS-bestanden worden meegeleverd.

De eerste emulator-download is ongeveer 5,8 MB. Mesen begint met 96 MiB Wasm-geheugen
per browser en kan groeien. Prestaties op telefoons en oudere apparaten moeten
in de praktijk worden getest. Losse batterij-/SRAM-savebestanden zijn nog niet beschikbaar;
de gebruikte upstream-API levert hiervoor geen data. Er zijn nog geen accounts,
wachtwoorden, toeschouwers, automatisch sessieherstel of automatische hersynchronisatie.

De browser- en automatische tests gebruiken eigen NES- en SNES-homebrew. Power Blade
is aanvullend lokaal getest op opstarten, beeld, geluid, invoer en toestandsherstel;
volledige gamecompatibiliteit is daarmee niet bewezen. SNES is beperkt getest en
blijft beta. Andere Mesen-systemen zijn niet in de website ontsloten. Sega Mega Drive
of PlayStation vereisen later andere emulatorcores.

## Bediening

| Actie | Eigen speler | Tweede speler lokaal bij solo |
|---|---|---|
| Richtingen | Pijlen | IJKL |
| A / B | A / S | N / M |
| Start / Select | Enter / Shift | T / R |
| SNES X / Y | D / F | U / O |
| SNES L / R | Q / W | Y / H |

Via **Besturing** op de startpagina of het tandwiel bij de game kun je iedere
knop opnieuw koppelen aan een toets, controllerknop of stickrichting. Instellingen
worden per console en lokaal profiel opgeslagen in `localStorage`. Online gebruikt
ook speler 2 het profiel **Jouw besturing** op zijn eigen apparaat. Het tweede
profiel is voor een extra speler op hetzelfde apparaat tijdens solo.

Kies een controller per profiel, stel de stick-deadzone in en controleer de
lampjes. Automatisch gebruikt profiel 1 controllerindex 0 en profiel 2 index 1;
bij loskoppelen verschuift de toewijzing niet. Je kunt altijd expliciet een andere
controller kiezen. Een controller bestuurt maximaal één lokaal profiel; een
expliciete keuze gaat voor automatisch, bij dezelfde expliciete keuze gaat
profiel 1 voor. Koppelen aan een al gebruikte toets of controllerinvoer verplaatst
die koppeling binnen het profiel. Escape annuleert het koppelen; **Koppeling
wissen** maakt een actie vrij. Tijdens dit venster krijgt jouw speler neutrale
invoer, terwijl de game doorloopt. Na sluiten moet een ingedrukte controllerknop
eerst worden losgelaten.

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
web/src/game-stream.js  WebRTC-canvasvideo, gameaudio en media-levensduur
web/src/stream-protocol.js Streammetadata, speelwijze en veilige controllerstatus
web/src/protocol.js     Kleine netwerkberichten en vergelijking van lokale ROMs
web/src/savestate.js    Lokaal savestateformaat, compatibiliteit en checksum
web/src/playback-*.js   Voorgrond-/achtergrondklok, onafhankelijk van pauzeren
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

In de ROM-modus beheert PeerJS het betrouwbare JSON-controlkanaal. Daarnaast bestaat een
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

De solospeler of host kan bij het laden en onder **Emulator** 100%, 200%, 300%,
400% of 500% kiezen. 100% is standaard. Mesen geeft de virtuele CPU extra tijd
per beeldframe; de game en audio blijven op normale snelheid. Het percentage is
een benadering van de beschikbare CPU-tijd, geen exacte MHz-vermenigvuldiging.
Speler 2 neemt dezelfde waarde over. Zodra een gast verbindt staat de instelling
vast; aanpassen zonder gast begint de game opnieuw. Niet iedere ROM-hack is
compatibel en hogere waarden vragen meer rekenkracht. SNES-coprocessors zoals
Super FX worden hiermee niet afzonderlijk overclockt.

## WebRTC-streammodus

De host stuurt via het controlkanaal een gamenaam, console, overclock en een
willekeurig streamtoken; geen ROM-hash, bestandsgrootte, ROM-bytes of downloadadres.
PeerJS maakt een aparte eenrichtings-mediaverbinding. De gast accepteert alleen de
verwachte host met het token uit de huidige dataverbinding. Hij antwoordt zonder
lokale media. Ongevraagde of tweede mediaverbindingen worden gesloten.

De videobron is uitsluitend de emulatorcanvas. De audiobron is een aparte
MediaStreamAudioDestinationNode vóór de lokale volumeregelaar: lokaal dempen bij
de host laat het geluid van de gast intact. Bij afsluiten worden de capturetracks
en de mediaverbinding gestopt. Een stille preview wordt ververst zodat de gast
vóór de start kan zien of de stream werkt. De gast verstuurt alleen de recentste
controllerstatus, met sessie en volgnummer. Verouderde of verkeerd geordende invoer
wordt genegeerd; zonder heartbeat worden ingedrukte knoppen na 250 ms losgelaten.
Pauze en opnieuw starten worden door de host gesynchroniseerd, zonder savestate-
of ROM-overdracht. Online savestate-import/export blijft uitgeschakeld.

Streamkamers openen geen Itty-wachtverbinding. Een mislukte directe verbinding
of media-time-out toont een fout en biedt geen schijnbare werkende stream.
Canvas-capture en WebRTC moeten door de browser worden ondersteund. Mobiele
browsers en energiebesparing kunnen achtergrondvideo alsnog onderbreken.

## Itty Sockets als fallback

In de ROM-modus opent de host bij het maken van een kamer een wachtverbinding naar de vaste dienst
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
