# DOS in RetroRoom — beta

Toegevoegd op 30 oktober 2026: DOSBox Pure, naast NES/SNES.

## Beschikbaar

- DOS-tegel bij solo spelen en een kamer maken.
- Lokale DOSBox Pure-browseremulatie, complete game-ZIP/DOSZ of losse COM/EXE/BAT,
  maximaal 32 MB. Een losse EXE zonder de bijbehorende bestanden is niet genoeg.
- De originele DOS Duo-demo, met twee spelers op één virtuele pc.
- Volledig fysiek toetsenbord, inclusief Ctrl/Alt/Shift, functietoetsen en numeriek blok.
- Relatieve muis, links/rechts/midden, muis vangen (pointer lock) en wiel naar Page Up/Down.
- Controllerprofielen met vrije DOS-toetsen/muisknoppen, muisstand of een DOS-joystick
  (twee assen en twee knoppen), per lokaal profiel opgeslagen in de browser.
- Dezelfde volledige invoer bij WebRTC-streamen; DOS-invoer gaat betrouwbaar en in
  volgorde over het datakanaal. Bij focusverlies of verouderde gastinvoer worden toetsen
  en muisknoppen losgelaten. De game zelf blijft doorlopen tenzij je handmatig pauzeert.
- Online beeld/geluid via WebRTC, met besturing van speler 2 terug naar de host.
- Experimentele DOS-lockstep via WebRTC, met identieke eigen gamebestanden en
  invoerbuffer; geen snapshots of gamebestanden over het netwerk.
- CPU-budget 100–500%, schermvullend spelen en handmatig pauzeren.
- Volledige notices en overeenkomstige broncode op de licentiepagina.

## Nog niet beschikbaar of niet vastgesteld

- **DOS samen emuleren is experimenteel:** ieder heeft identieke eigen gamebestanden
  nodig. WebRTC vervoert alleen volledige invoer en controlehashes. Een vaste buffer
  van 6 frames (circa 100 ms bij 60 fps) voorkomt speculatieve frames; het spel wacht
  als invoer ontbreekt. De oorspronkelijke BIOS-klokafwijking is hersteld. Bij
  uiteenlopende emulatorstatus stopt de sessie met een melding. Brede game- en
  browsercompatibiliteit is nog niet vastgesteld.
- **DOS-rollback:** niet ingeschakeld. Save/replay-toestanden verschillen nog (in de langste proef in de joystickstatus),
  ondanks gelijk beeld en geluid in de oorspronkelijke demo. Snapshots zijn circa 28,8 MB. De invoerbuffer gebruikt geen rollback.
- **DOS-savestates en save-export/import:** niet vrijgegeven. Native snapshots
  werkten voor een al gestart COM-programma, maar een verse ZIP-start kan in een
  ander menu/programma zitten. Voortgang blijft tijdelijk en gaat verloren bij sluiten.
- **Invoerbeperkingen:** het fysieke toetsenbord werkt met DOS-toetsposities, inclusief
  modifiers, F-toetsen en numeriek toetsenblok. Browser-/OS-sneltoetsen kunnen gereserveerd
  blijven; IME/compositie en plakken van tekst zijn geen DOS-toetsaanslagen. Kies zo nodig
  een toetsenbordindeling in DOS. Klik buiten het beeld om toetsenbordfocus vrij te geven;
  Escape maakt de gevangen muis vrij. De muis is gedeeld en het wiel bedient Page Up/Down.
- **3dfx, MT-32/SC-55, bootbare Windows-installaties en grote CD-images:** niet
  aangeboden/getest in deze browserintegratie. De normale interpreter is trager
  dan desktop-DOSBox met dynamische recompilatie; zware late DOS-games kunnen traag zijn.
- **Brede gamecompatibiliteit:** alleen originele fixtures getest. Dit is geen
  belofte dat iedere DOS-game of iedere browser/netwerkcombinatie werkt.
- **Relay voor DOS:** geen Tailcat. Video/audio heeft een directe WebRTC-verbinding
  nodig; een echte firewall/NAT-blokkade wordt niet door de timingfix opgelost.

## WebRTC-timingfix

Verbindingsopbouw heeft een eigen deadline van 45 seconden. Zodra het transport
verbonden is, krijgt de gast nog 30 seconden voor het eerste beeld en geluid.
Een tijdelijke mediaonderbreking krijgt 12 seconden hersteltijd; een definitief
`failed` of `closed` beëindigt de stream. De melding onderscheidt het opzetten
van de verbinding van ontbrekend beeld op een al verbonden mediaverbinding.
Geblokkeerd afspelen vraagt om een klik op het gamescherm. Deze wijziging lost
timinggevoeligheden op, maar bewijst niet de oorzaak van een eerdere mislukte test.

Zie [DOS-NETPLAY.md](DOS-NETPLAY.md) voor de synchronisatieproeven en testgrenzen.

## Toetsverdeling en beurten

Het DOS-menu heeft een volledig klikbaar toetsenbord. Samen bedienen is de
standaard; de host kan ook tijdens het spelen toetsen voor speler 2 blokkeren,
of de volledige bediening om de beurt doorgeven. Zie [DOS-CONTROLS.md](DOS-CONTROLS.md)
voor de bediening, synchronisatie en fullscreen-Escape.
