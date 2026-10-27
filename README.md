# RetroRoom

**Oude games. Samen opnieuw.** NES-games samen spelen in de browser, voorlopig
alleen via **uitnodigingslinks**. De site staat op
https://axel-nl94.github.io/retro-room/ en de bron op
https://github.com/Axel-NL94/retro-room.

De host kiest een lokale ROM. De gast ontvangt die rechtstreeks via WebRTC en
speelt in dezelfde emulator op het eigen apparaat. Tijdens het spelen worden
controllerinvoer en controlehashes uitgewisseld. ROMs worden niet door een
spelserver opgeslagen of doorgestuurd. De demo **Room Rally** is origineel en
vrij meegeleverd; er zitten geen commerciële ROMs in het project.

## Samen spelen

1. Kies **Maak een kamer** en selecteer een NES-ROM of de demo.
2. Deel de uitnodigingslink met je vriend en houd de kamer open.
3. De gast opent de link, vult een naam in en kiest **Speel mee**.
4. Na automatische ROM-overdracht en SHA-256-controle kiest de gast **Ik ben klaar**.
5. De host kiest **Start samen**.

Er is plek voor twee spelers. De kamer verschijnt nergens in een openbare lijst.
Wie de link heeft, kan proberen mee te doen. De link vervalt zodra de host de
kamer verlaat, de pagina vernieuwt of de browser sluit. Een nieuwe kamer krijgt
een nieuwe willekeurige UUID-link.

Er is **geen eigen server of account nodig**. PeerJS Cloud verzorgt de signalering;
Google STUN helpt de browsers een directe verbinding te vinden. TURN is expliciet
uitgeschakeld: er is dus geen relay-databundel, maar sommige netwerken kunnen
niet rechtstreeks verbinden. Probeer dan een ander netwerk. Beschikbaarheid en
onbeperkt gratis gebruik van externe diensten zijn niet gegarandeerd. Zie
[GRATIS-HOSTING.md](GRATIS-HOSTING.md) voor de opzet en officiële bronnen.

## Wat deze alpha bevat

- Vastgezette JSNES 2.1.0 voor echte NES-emulatie en PeerJS 1.5.5 voor signalering.
- Privékamers, uitnodigingslinks en automatische ROM-overdracht in blokken van 16 KiB.
- iNES- en NES 2.0-bestanden met ondersteunde mappers. NES 2.0-headers blijven
  intact; de controle leest ook uitgebreide ROM-groottes en eventuele trainerdata.
- Lokale emulatie met 2 frames invoervertraging, maximaal 12 voorspellingsframes
  en rollback bij vertraagde invoer.
- Controles op afwijkende toestanden, samen pauzeren en hervatten door de host.
- Toetsenbord, standaardgamepads, aanraakknoppen, geluid en volledig scherm.
- Werkelijke ping, verbindingsroute, fps en rollback-teller.
- GitHub Actions voor tests, build en Pages-publicatie.

NES-compatibiliteit verschilt per game en mapper. De alpha gebruikt NTSC-timing
(60 fps). Er zijn nog geen blijvende saves, accounts, wachtwoorden, toeschouwers
of sessieherstel na verbindingsverlies. Alleen onze eigen demo is tot nu toe als
game getest. Power Blade (NES 2.0, mapper 4) is aanvullend lokaal getest op
opstarten en deterministisch toestandsherstel, niet op volledige gamecompatibiliteit.
Twee browservensters zijn samen getest; verschillende huishoudens
moeten nog in de praktijk worden getest.

SNES, Sega en PlayStation staan op de roadmap. Iedere console vereist een eigen
deterministische emulatorintegratie en hersteltests. PS1 vereist ook ondersteuning
voor grotere gamebestanden en eventuele BIOS-invoer. Een openbare lobby kan later
worden toegevoegd; de huidige versie werkt uitsluitend via uitnodigingen.

## Bediening

| Actie | Eigen speler | Speler 2 lokaal, bij solo |
|---|---|---|
| Richtingen | Pijltjestoetsen | WASD |
| A / B | X / Z | G / F |
| Start / Select | Enter / Shift | T / R |

In Room Rally tik je herhaaldelijk op A om naar de finish te racen. Start reset
de race. Beide controllerpoorten werken ook bij solo op hetzelfde toetsenbord.
Een standaardgamepad wordt automatisch opgepikt; daadwerkelijke ondersteuning
hangt af van de combinatie van controller en browser.

## Lokaal ontwikkelen

Installeer Node.js 24 en pnpm 10.20.0:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm dev
```

Open `http://localhost:4173`. De lokale server is alleen nodig als ontwikkelpreview;
spelers gebruiken de GitHub Pages-site. Signaalverbindingen gaan ook in de preview
via PeerJS Cloud. Bouw opnieuw na bronwijzigingen. Solo werkt zonder PeerJS,
maar voor uitnodigingen is een internetverbinding nodig.

## GitHub Pages

De bestaande workflow **Test and deploy GitHub Pages** publiceert iedere push naar
`main`. Kies onder **Settings → Pages → Source** voor **GitHub Actions**. Er hoeven
geen serveradres, API-sleutels of geheimen voor de uitnodigingsversie te worden ingesteld.
De eerdere variabele `RETROROOM_SERVER_URL` wordt niet door de frontend gebruikt.

Alle module- en assetpaden zijn relatief, zodat de site onder `/retro-room/` werkt.
Buildversies krijgen cachemarkeringen om gemengde versies te voorkomen. De enige
opgeslagen gebruikersinstelling is de naam in localStorage. ROM-bytes en gamesessies
worden alleen in het geheugen geladen.

## Technische indeling

```text
web/                    Statische frontend voor GitHub Pages
  src/connection.js     PeerJS-uitnodigingen, WebRTC-kanalen, ROM-overdracht
  src/app.js            Kamerinterface, invoer en spelverloop
  src/emulator.js       NES-adapter en exacte toestandsherstel
  src/rollback.js       Invoer per frame, voorspelling en rollback
  src/audio*.js         Web Audio; replay-audio wordt gedempt
scripts/demo-rom.js     Broncode van de originele Room Rally-ROM
scripts/build.js        Statische build, vendorlicenties en cachemarkeringen
test/                   Uitnodigings-, emulatie- en oudere servertests
server/index.js         Lokale preview en eerdere lobbyimplementatie
```

De Node-lobbyserver en Render/Docker-bestanden zijn bewaard als voorbereidend werk
voor een latere uitbreiding. De huidige frontend gebruikt geen `/ws`, publieke
kamerlijst of serverconfiguratie. Uitrollen van die oudere server is niet nodig.

PeerJS beheert de initiële betrouwbare JSON-controlverbinding. Twee extra native
RTCDataChannels voor ROM en ongeordende betrouwbare inputs gebruiken dezelfde
RTCPeerConnection. Er wordt dus maar één directe verbinding per spelerspaar opgezet.
De gast start pas na een kamerhandshake die bij de uitnodiging past; de host
reserveert maar één gastplek. De ICE-configuratie bevat uitsluitend STUN.

De upstream JSON-savefunctie van JSNES bewaart niet alle tijdelijke toestand die
rollback nodig heeft. De adapter bewaart daarom de volledige interne objectgraaf,
inclusief typed arrays en verwijzingen tussen mapper- en tile-objecten. Herstel
gebeurt in dezelfde objecten, zodat bankverwijzingen intact blijven. Dit is bewust
gekoppeld aan JSNES 2.1.0; een emulatorupdate vereist opnieuw determinismetests.

Inputs lopen over een betrouwbaar, ongeordend datakanaal; ROM-overdracht en
sessiecommando's hebben aparte kanalen. De ROM wordt vóór het starten overgedragen.
Na maximaal 12 onbevestigde frames wacht de game op invoer. Iedere 120 frames is
een toestand beschikbaar voor controle; de host verstuurt ongeveer iedere twee
seconden een bevestigde controlehash. Bij afwijkingen stopt de game met een melding.
Er is nog geen automatische hersynchronisatie. Hashes zijn controles, geen
anti-cheatmechanisme.

## Valideren

```sh
pnpm check
pnpm test
pnpm build
```

De tests controleren iNES/NES 2.0-lengtes, uitgebreide en exponentiële ROM-groottes,
trainerdata, onvolledige bestanden, uitnodigingsvalidatie, gastcapaciteit, verlopen kamers,
hergebruik na een mislukte uitnodiging, echte emulatie, beide controllerpoorten,
exact herstel en convergentie na vertraagde/anders geordende invoer. De eerdere
WebSocket-lobbytests blijven als regressietests voor de bewaarde servercode.
De browsercontrole test ook de echte PeerJS-dienst en WebRTC-datakanalen.

## Licenties

Eigen projectcode en de originele demo: MIT, zie `LICENSE`.
JSNES: Apache-2.0. PeerJS en ws: MIT. De build neemt de JSNES- en PeerJS-licenties
op onder `dist/vendor/`. Google Fonts zijn optioneel, met systeemfonts als terugval.
