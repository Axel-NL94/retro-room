# DOS-invoer en experimentele WebRTC-netplay

DOS heeft drie speelwijzen: solo, WebRTC-beeld/geluid vanaf één host, en
experimenteel samen emuleren. Streamen blijft de standaard voor DOS. Kies bij
het tandwiel expliciet **Samen emuleren** om de invoerbuffer te proberen.

Bij samen emuleren heeft ieder exact dezelfde eigen gamebestanden en dezelfde
core/CPU-instelling nodig. De host en gast besturen één gedeelde virtuele DOS-pc:
keyboard en muis worden gecombineerd, joysticks hebben aparte poorten. Dit maakt
alleen de lokale multiplayer van de gekozen game op afstand beschikbaar; het
voegt geen multiplayer toe aan een spel voor één speler.

## Werking

- WebRTC verstuurt gevalideerde invoer via een betrouwbaar, geordend datakanaal.
  Geen gamebestanden of emulator-snapshots worden gedeeld.
- Beide emulatoren gebruiken dezelfde invoer voor hetzelfde frame. Een vaste
  buffer van 6 frames is circa 100 ms bij 60 fps, plus eventuele wachttijd.
- Ontbreekt de invoer, dan wacht de emulator. Er is geen voorspelling of rollback.
- Elke 120 frames wordt lokaal een snapshot gehasht. Alleen de controlehash gaat
  over het netwerk; een verschil stopt de sessie. Dit is een controle, geen
  automatische reparatie. Snapshot en hashing kunnen een korte hapering geven.
- DOS vereist rechtstreeks WebRTC. Er is geen Tailcat-fallback voor DOS.

## Reproduceerbare proeven van 30 oktober 2026

`scripts/probe-dos-sync.js` start twee onafhankelijke Wasm-cores met de originele
DOS Duo-fixture. Het vergelijkt volledige snapshots, beeld en geluid, met een
vast invoerpatroon. Er worden geen commerciële games gebruikt.

```sh
node scripts/probe-dos-sync.js /tmp/dos-100.json 3000 100
node scripts/probe-dos-sync.js /tmp/dos-500.json 3000 500
```

Bij 100% en 500% CPU waren alle 51 checkpoints in 3.000 frames identiek,
inclusief snapshot, beeld en geluid. De BIOS-klok gebruikt nu ook voor
`gettimeofday` de virtuele emulator-tijd. Eerder veroorzaakten fracties van de
werkelijke klok een verschil tussen onafhankelijke instanties.

Save/replay doorstaat de controle nog niet: in de langste proeven verschilde
joystickstatus na terugzetten en opnieuw afspelen. Rollback en DOS-save-import
blijven daarom uitgeschakeld. Gelijke oorspronkelijke fixtures bewijzen geen
algemene compatibiliteit met andere games, ZIP-opstartmenu's, browsers of
apparaten. Zie [DOS-BETA.md](DOS-BETA.md) voor de overige beperkingen.

De geautomatiseerde suite bevat 95 geslaagde controles, waaronder native BIOS-
invoer, menu-Enter, joystick, transportvalidatie en lockstep met vertraagde pakketten.
In twee Chromium-browsertabs zijn starten met eigen DOS Duo, direct WebRTC,
spelen, pauzeren/hervatten en opnieuw starten gecontroleerd. Ook de streamstand
ontving het spelbeeld en stuurde een gasttoets terug naar de host. De browserproef
controleerde fysieke letters, Shift, F1, muisklik en opgeslagen controllerkeuzes.
Een echte USB/Bluetooth-controller en verschillende fysieke netwerken/apparaten
zijn in deze ronde niet beschikbaar geweest voor een praktijktest.
