# RetroRoom: uitnodigingen en verbindingen

Codewijzigingen voeren alleen tests uit. De eigenaar kan de site handmatig publiceren.
GitHub Pages kan uitsluitend handmatig worden gepubliceerd via de Pages-workflow
(`workflow_dispatch`), nadat de eigenaar daar expliciet voor kiest.

De host kiest bij het tandwiel een speelwijze. **Samen emuleren** gebruikt de
hieronder beschreven eigen ROMs en P2P/Itty-fallback. **Beeld en geluid streamen**
gebruikt alleen WebRTC: alleen de host laadt de ROM, de gast ontvangt gamevideo en
gameaudio en stuurt controllerinvoer terug. Streamkamers openen geen Itty-verbinding;
Itty kan de media niet overnemen. Er is geen TURN-server ingesteld. Bij blokkering
van WebRTC toont de streammodus een verbindingsfout.

## Spelen met eigen ROMs

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
| Spelinvoer en synchronisatie, eerste keuze | Rechtstreeks via WebRTC |
| Fallback als P2P niet lukt | Itty Sockets (WebSocket over TLS, AES-GCM-berichten) |
| TURN | Uitgeschakeld |

Er is geen betaalde relay of databundel geactiveerd. Sommige mobiele,
bedrijfsnetwerken en routers kunnen rechtstreeks verbinden blokkeren. Na ongeveer 10 seconden zonder werkende P2P-verbinding probeert de gast automatisch Itty Sockets. De host houdt daarvoor een wachtverbinding open; bij werkend P2P gaat er geen spelverkeer via Itty. Ook de relay kan door een firewall worden geblokkeerd en kan meer vertraging geven. Externe diensten geven geen
garantie op beschikbaarheid of onbeperkt gratis gebruik.

ROM-bytes blijven in tijdelijk geheugen op het apparaat dat ze lokaal kiest.
PeerJS ontvangt verbindingsmetadata; Google STUN ziet netwerkadressen. Er is
geen account, openbare lobby, opslag van ROMs of ROM-downloadservice.

De volledige uitnodigingslink bevat een willekeurige encryptiesleutel in het URL-fragment.
Deze sleutel wordt niet naar de relay verstuurd. De relay ontvangt versleutelde spelberichten,
maar ziet IP-adressen, de kamer-id en timing. Deel de link alleen met je medespeler.
Er worden ook via de fallback geen ROM-bestanden of emulator-snapshots doorgestuurd.
De gratis dienst heeft anti-misbruiklimieten en geen SLA:
https://ittysockets.com/pricing en https://ittysockets.com/terms.
