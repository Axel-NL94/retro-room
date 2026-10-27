# Gratis spelen met uitnodigingslinks

De site staat op https://axel-nl94.github.io/retro-room/.
De huidige versie gebruikt Mesen-emulatie voor NES en SNES (beta), met **privékamers en uitnodigingslinks**.
Je hoeft geen eigen server te draaien en geen Render- of TURN-account aan te maken.

| Onderdeel | Huidige oplossing |
|---|---|
| Website | GitHub Pages |
| Browsers bij elkaar brengen | De gedeelde PeerJS Cloud-dienst |
| Directe verbinding vinden | Google STUN |
| ROM en controllerinvoer | Rechtstreeks via WebRTC tussen de spelers |
| TURN-relay | Uitgeschakeld |

Er is geen TURN-databundel in deze opzet: het spelverkeer gaat niet door een
relay. Dit is geen garantie op onbeperkt gratis gebruik van externe diensten.
PeerJS Cloud is een gedeelde dienst zonder beschikbaarheidsgarantie en adviseert
voor drukke toepassingen een eigen dienst. De website blijft ook onderhevig aan
de gebruikslimieten van GitHub Pages.

## Gebruik

1. Open de site en kies **Maak een kamer**.
2. Selecteer een NES- of SNES-ROM of de meegeleverde Room Rally-demo.
3. Kopieer de uitnodigingslink en deel die met je vriend. Houd je kamer open.
4. Je vriend opent de link, vult een naam in en klikt op **Speel mee**.
5. De ROM gaat automatisch naar de andere browser. De gast klikt op **Ik ben klaar**;
   daarna start de host met **Start samen**.

Een kamer heeft plek voor twee spelers. De link werkt totdat de host de kamer
verlaat, de pagina vernieuwt of de browser sluit. Een nieuwe kamer krijgt een
nieuwe willekeurige link. Iedereen die de link heeft kan proberen mee te doen;
deel hem dus alleen met je gewenste medespeler.

## Als verbinden niet lukt

Strenge routers, sommige mobiele verbindingen en bedrijfsnetwerken kunnen een
directe verbinding blokkeren. Zonder TURN is daar geen automatische omweg voor.
Probeer een ander netwerk, bijvoorbeeld een andere wifi-verbinding, en maak zo
nodig een nieuwe kamer. Een uitnodigingslink verandert deze netwerkbeperking niet.

De kleine PeerJS-dienst helpt alleen bij het opzetten van de verbinding. ROMs
en controllerinvoer lopen rechtstreeks tussen browsers. PeerJS verwerkt daarbij
verbindingsmetadata zoals peer-ID's en WebRTC-verbindingsgegevens. Google STUN
helpt het publieke netwerkadres bepalen. Er worden geen gebruikersaccounts gemaakt.

## Latere uitbreiding

De eerdere Node-lobbyserver, Dockerfile en `render.yaml` blijven beschikbaar als
voorbereidend werk voor een eventuele latere lobby. Ze worden door de huidige
uitnodigingsversie niet gebruikt en hoeven niet te worden uitgerold. De oude
`RETROROOM_SERVER_URL`-instelling is niet meer nodig. Een publieke kamerlijst en
TURN-terugval zijn nu geen onderdeel van de site.

Officiële bronnen, gecontroleerd op 27 oktober 2026:

- https://peerjs.com/server/cloud
- https://peerjs.com/client/getting-started
- https://peerjs.com/client/api/peer
- https://github.com/peers/peerjs-server
