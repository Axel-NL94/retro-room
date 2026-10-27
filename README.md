# RetroRoom

**Oude games. Samen opnieuw.** Een eerste speelbare browserapp voor NES-multiplayer,
gemaakt voor GitHub Pages met een afzonderlijke Node-lobbyserver.

De host kiest een lokale ROM. De gast ontvangt die via WebRTC en draait dezelfde
emulator lokaal. Tijdens het spelen worden controllerinvoer en controlehashes
uitgewisseld. ROMs gaan niet door de lobbyserver en worden niet opgeslagen door
RetroRoom. Bij een TURN-verbinding loopt het versleutelde peer-verkeer via de relay.

## Snel starten

Installeer Node.js 24 en pnpm 10.20.0. Vanuit deze projectmap:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm dev
```

Open `http://localhost:4173`. Dezelfde server verzorgt lokaal de website en de
WebSocket-lobby op `/ws`. `pnpm build` moet na bronwijzigingen opnieuw draaien.

- Klik op **Probeer de demo** om Room Rally solo te spelen.
- Maak een kamer met de demo of een eigen `.nes`-bestand.
- Open de site in een andere browser, schuif aan via de lobby of gebruik de kamerlink.
- De gast klikt na de ROM-controle op **Ik ben klaar**. De host klikt op **Start samen**.

Een localhost-link werkt alleen op hetzelfde apparaat. Voor andere apparaten
zijn een bereikbaar serveradres en een veilige browsercontext nodig. Gebruik voor
internetgebruik GitHub Pages en een publieke HTTPS/WSS-lobbyserver.

## Wat deze alpha bevat

- Echte NES-emulatie met vastgezette JSNES 2.1.0.
- Een originele, vrij meegeleverde homebrew-ROM: **Room Rally**. De bron staat in
  `scripts/demo-rom.js`; er zijn geen commerciële ROMs meegeleverd.
- Openbare en privékamers voor twee spelers, live aanwezigheid en gametitel.
- Uitnodigingslinks, ROM-overdracht in blokken van 16 KiB en SHA-256-controle.
- Lokale emulatie met 2 frames invoervertraging en maximaal 12 voorspellingsframes.
- Rollback bij te laat ontvangen invoer, controles op afwijkende toestanden en
  gedeeld pauzeren. De host kan samen hervatten of opnieuw starten.
- Toetsenbord, standaardgamepads, aanraakknoppen, geluid en volledig scherm.
- Werkelijke ping, route (rechtstreeks/TURN), fps en rollback-teller.
- Kamers verdwijnen als de host vertrekt; dode verbindingen worden opgeruimd.
- GitHub Actions voor tests, build en GitHub Pages-publicatie.

NES-compatibiliteit verschilt per game en mapper. De alpha gebruikt NTSC-timing
(60 fps). Er zijn nog geen blijvende saves, sessieherstel na verbindingsverlies,
wachtwoorden, accounts, toeschouwers of andere consoles.

SNES volgt na meer praktijktests. Sega en PlayStation staan op de roadmap en zijn
niet als speelbaar voorgesteld. Iedere console heeft een eigen deterministische
emulatorintegratie, framebesturing en exacte toestandshersteltests nodig. Vooral
PS1 brengt veel grotere gamebestanden, geheugenverbruik en eventuele BIOS-invoer mee.

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

## GitHub Pages: Axel-NL94/retro-room

De repository en hosting zijn voorbereid, maar worden niet door een lokaal build-
commando aangemaakt. Publiceren vereist toegang tot het GitHub-account.

1. Maak een repository `retro-room` onder `Axel-NL94` en push deze bron naar `main`.
2. Kies bij **Settings → Pages → Build and deployment → Source**: **GitHub Actions**.
3. Deploy de lobbyserver zoals hieronder en noteer de openbare `wss://…/ws`-URL.
4. Zet onder **Settings → Secrets and variables → Actions → Variables** de publieke
   repositoryvariabele `RETROROOM_SERVER_URL` op die URL.
5. Start de workflow **Test and deploy GitHub Pages**. De workflow test, bouwt en
   publiceert de frontend. De verwachte project-URL is
   `https://axel-nl94.github.io/retro-room/`, zodra publicatie is geslaagd.

De frontend werkt onder een subpad; alle bestanden en module-imports zijn relatief.
Buildversies krijgen cachemarkeringen zodat nieuwe en oude modules niet door elkaar
worden geladen. Zonder ingestelde lobbyserver blijft solo spelen beschikbaar;
de interface geeft aan dat de lobby niet verbonden is.

Het serveradres kan voor tests ook via **Instellingen** worden ingevoerd. Namen en
dat adres worden lokaal bewaard; ROM-bytes en gamesessies niet. Wachtwoorden of
provider-API-sleutels horen niet in deze instellingen of in de repositoryvariabele.

## De externe lobbyserver

De dienst gebruikt gewone Node.js HTTP en WebSockets en bewaart kamers in het
geheugen. Eén instance is de ondersteunde opzet. Herstarten leegt de lobby.
Bij meerdere replicas zijn een gedeelde kamerregistratie en routering nodig.

Deploy de meegeleverde `Dockerfile` bij een containerhost die langdurige
WebSocket-verbindingen en HTTPS ondersteunt, of voer Node rechtstreeks uit.
De server heeft een gezondheidscontrole op `/health` en een WebSocket-route `/ws`.
Er is geen database nodig voor deze alpha.

Productie-instellingen:

```text
HOST=0.0.0.0
PORT=8080
ALLOWED_ORIGINS=https://axel-nl94.github.io
```

De host of reverse proxy moet TLS afhandelen en WebSocket-upgrades doorlaten.
De GitHub Pages-site gebruikt `wss://`, niet `ws://`. `.env.example` is een
voorbeeld; het Node-proces leest de instellingen uit de omgeving. Voor lokale
bestanden kun je Node starten met `node --env-file=.env server/index.js`.

### STUN en TURN

Standaard wordt `stun:stun.l.google.com:19302` gebruikt. Dat volstaat vaak lokaal
en bij eenvoudige netwerken, maar biedt geen garantie op internetverbindingen.
Voor betrouwbaar online spelen hoort een TURN-dienst bij de deployment.

Voor eigen coturn met REST-authenticatie:

```text
TURN_URLS=turn:turn.example:3478,turns:turn.example:5349
TURN_SECRET=<hetzelfde-geheim-als-in-coturn>
```

De Node-server maakt dan credentials met een geldigheid van één uur per nieuwe
verbinding. Het gedeelde geheim blijft op de server. Na een uur kan opnieuw
verbinden nodig zijn als een nieuwe ICE-verbinding moet worden opgezet.

Alternatief: configureer `ICE_SERVERS_JSON` met de STUN/TURN-serverlijst van je
provider. Deze lijst wordt aan de browsers verstrekt. Gebruik dus ICE-credentials
die daarvoor bestemd zijn, geen beheer-API-sleutel. Gebruik voor productie een
eigen of beheerde TURN-dienst. Er is geen publieke gratis TURN-relay hardgecodeerd.

TURN kan ook de ROM-overdracht doorsturen. Kosten en capaciteit hangen af van de
gekozen host/provider en het gebruik; dit project maakt geen betaald account aan.

## Technische indeling

```text
web/                    Statische frontend, gereed voor GitHub Pages
  src/emulator.js       NES-adapter en exacte snapshots van de objectgraaf
  src/rollback.js       Invoer per frame, voorspelling en rollback
  src/connection.js     WebRTC en ROM-overdracht met flow control
  src/app.js            Kamers, bediening en interface
  src/audio*.js         Web Audio-uitvoer; herhaalde rollback-audio wordt gedempt
server/index.js         Lobby, aanwezigheid, signalering en lokale webserver
scripts/demo-rom.js     Broncode van de originele Room Rally-ROM
scripts/build.js        Statische build, vendorlicentie en cachemarkeringen
test/                   Emulatietests en echte WebSocket-integratietests
dist/                   Gegenereerde website, niet de broncode
```

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

De tests controleren echte emulatie, beide controllerpoorten, exact herstel,
convergentie na vertraagde en anders geordende invoer, begrensde voorspelling,
ROM-validatie, openbare/privékamers, capaciteit, signalering, vertrek en origins.
Netwerken tussen verschillende huishoudens en TURN moeten na deployment apart
worden getest. Alleen de oorspronkelijke demo is als gamecompatibiliteit getest;
er wordt geen algemene NES/SNES/Sega/PS1-compatibiliteit geclaimd.

## Licenties

Eigen projectcode en de originele demo: MIT, zie `LICENSE`.
JSNES: Apache-2.0; de build neemt de oorspronkelijke licentie op in
`dist/vendor/JSNES-LICENSE.txt`. `ws`: MIT. Externe fonts zijn optioneel; de
interface valt terug op systeemfonts als Google Fonts niet bereikbaar is.
