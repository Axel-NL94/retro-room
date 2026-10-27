# RetroRoom gratis testen

De frontend staat op <https://axel-nl94.github.io/retro-room/>.
De lobbycode is lokaal met twee browsers getest, maar een openbare lobbyserver en
TURN-account zijn nog niet geactiveerd. De site geeft dit aan; de demo werkt solo.

Een gratis startopzet voor een kleine groep:

| Onderdeel | Dienst | Gratis aanbod |
|---|---|---|
| Website | GitHub Pages | De huidige gepubliceerde projectsite |
| Lobby en signalering | Render Free | 750 instance-uren per workspace per maand |
| TURN-terugval | Metered Open Relay | 20 GB relayverkeer per maand |

Bronnen, gecontroleerd op 27 oktober 2026:

- <https://render.com/docs/free>
- <https://render.com/docs/websocket>
- <https://www.metered.ca/tools/openrelay/>
- <https://www.metered.ca/tools/openrelay/webrtc-signaling-server/>

## Render

`render.yaml` staat expliciet op `plan: free`, één webservice in Frankfurt,
zonder database of betaalde extra resources. De configuratie maakt op zichzelf
geen account of dienst aan. GitHub Pages blijft de frontend hosten.

1. Maak zelf een Render-account aan of log in. Bekijk en accepteer zelf eventuele
   accountvoorwaarden. De implementatie heeft nog geen Render-account gekoppeld.
2. Gebruik een Blueprint met deze repository en `render.yaml`, of maak een
   Docker Web Service van de openbare repository. Controleer dat het plan **Free** is.
3. Wacht op een geslaagde deployment en open de eigen `https://…onrender.com/health`.
   Die hoort JSON met `status: ok` terug te geven.
4. Zet de openbare `wss://…onrender.com/ws`-URL in de GitHub Actions-repositoryvariabele
   `RETROROOM_SERVER_URL` en start de Pages-workflow opnieuw.

Render Free slaapt na 15 minuten zonder inkomend verkeer. Opstarten kost ongeveer
een minuut. De huidige frontend probeert ongeveer tien seconden verbinding te
maken; bij een slapende gratis server kan een eerste poging daarom mislukken.
Open dan eerst `/health`, wacht tot die reageert en probeer opnieuw. Een aangepaste
opstart-/herverbindingsflow is een volgende verbetering zodra het echte serveradres
beschikbaar is. Automatische serverdeploys staan uit om actieve kamers niet bij
iedere bronwijziging te onderbreken.

De 750 gratis uren zijn gedeeld door je workspace. Render kan de gratis dienst
herstarten, waardoor actieve kamers verdwijnen. Bandbreedte en buildminuten
hebben ook limieten. Zonder betaalmethode schort Render diensten/bouwactiviteiten
bij bepaalde limieten op in plaats van extra gebruik af te rekenen; controleer
de actuele accountinstellingen. Dit is een hobby-/testopzet zonder uptimegarantie.

## Open Relay

Maak een gratis Metered/Open Relay-account aan. De aanbieder vermeldt 20 GB TURN-
verkeer per maand; voor de gratis signallingdienst vermeldt hij geen creditcard
en geen overagekosten. Controleer specifiek het gekozen TURN-plan en schakel geen
betaald plan of automatisch opwaarderen in als je uitsluitend gratis wilt testen.

Haal via het dashboard/de officiële API de eigen `iceServers`-lijst op en plaats
die als `ICE_SERVERS_JSON` in de Render-omgeving. Een beheer-API-sleutel hoort alleen
op de server; zet die niet in GitHub, de publieke Pages-configuratie of browser-
instellingen. De huidige server kan al een ICE-lijst aan de browsers verstrekken.
Automatische vernieuwing van providercredentials is nog geen geïmplementeerde feature.

Verbind daarna twee apparaten via verschillende netwerken. Test zowel een directe
verbinding als een geforceerde relayroute in een aparte ontwikkeltest. Laat de
productieconfiguratie automatisch tussen rechtstreeks en TURN kiezen. Een TURN-
test is pas geslaagd als werkelijk relayverkeer is waargenomen, niet alleen als
de configuratie is opgeslagen.

Omdat de game bij beide spelers lokaal draait, versturen we tijdens het spelen
vooral kleine invoerberichten. Dat maakt deze opzet veel zuiniger met relayverkeer
dan videostreaming. ROMs kosten ook relayverkeer wanneer TURN nodig is; grotere
PS1-bestanden vragen later om andere overdrachtslimieten en capaciteitskeuzes.

## Ander gratis alternatief

Cloudflare Realtime TURN heeft momenteel een gezamenlijke TURN/SFU-vrijstelling
van 1.000 GB per maand, maar rekent daarboven gebruik af. Dat is daarom niet
automatisch een opzet met een harde kostengrens van nul. Bron:
<https://developers.cloudflare.com/realtime/sfu/platform/pricing/>.
