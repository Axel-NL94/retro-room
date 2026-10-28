# RetroRoom: uitnodigingen met eigen ROMs

De site blijft voorlopig ongepubliceerd. Codewijzigingen voeren alleen tests uit.
GitHub Pages kan uitsluitend handmatig worden gepubliceerd via de Pages-workflow
(`workflow_dispatch`), nadat de eigenaar daar expliciet voor kiest.

## Spelen

1. De host maakt een kamer met een eigen NES- of SNES-ROM.
2. De host deelt de uitnodigingslink en houdt de pagina open.
3. Speler 2 opent de kamer en kiest zelf hetzelfde lokale ROM-bestand.
4. Beide browsers berekenen lokaal de SHA-256-hash. Bij een andere versie,
   regio of ROM-hack kan het spel niet starten.
5. Speler 2 kiest **Ik ben klaar** en de host **Start samen**.

ROM-bestanden worden nooit tussen spelers doorgestuurd. Er is geen bestandkanaal
of overdrachtsoptie in de netwerkcode. Alleen gamegegevens (naam, console,
bestandsgrootte, hash en overclock), controllerinvoer en synchronisatieberichten
worden uitgewisseld. De eigen originele Room Rally-demo kan op beide apparaten
vanuit de website worden geladen.

## Diensten

| Onderdeel | Dienst |
|---|---|
| Statische website, wanneer handmatig gepubliceerd | GitHub Pages |
| Uitnodigingen en signalering | Gedeelde PeerJS Cloud-dienst |
| Directe verbinding ontdekken | Google STUN |
| Spelinvoer en synchronisatie | Rechtstreeks via WebRTC |
| TURN of andere relay | Uitgeschakeld |

Er is geen betaalde relay of databundel geactiveerd. Sommige mobiele,
bedrijfsnetwerken en routers kunnen rechtstreeks verbinden blokkeren. Deze
versie heeft geen relay om daarop terug te vallen. Externe diensten geven geen
garantie op beschikbaarheid of onbeperkt gratis gebruik.

ROM-bytes blijven in tijdelijk geheugen op het apparaat dat ze lokaal kiest.
PeerJS ontvangt verbindingsmetadata; Google STUN ziet netwerkadressen. Er is
geen account, openbare lobby, opslag van ROMs of ROM-downloadservice.
