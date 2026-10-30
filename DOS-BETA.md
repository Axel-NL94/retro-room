# DOS in RetroRoom — beta

Toegevoegd op 30 oktober 2026: DOSBox Pure, naast NES/SNES.

## Beschikbaar

- DOS-tegel bij solo spelen en een kamer maken.
- Lokale DOSBox Pure-browseremulatie, complete game-ZIP/DOSZ of losse COM/EXE/BAT,
  maximaal 32 MB. Een losse EXE zonder de bijbehorende bestanden is niet genoeg.
- De originele DOS Duo-demo, met twee spelers op één virtuele pc.
- Lokale toetsenbord-/controllerprofielen voor DOS, per speler opgeslagen in de browser.
- Online beeld/geluid via WebRTC, met besturing van speler 2 terug naar de host.
- CPU-budget 100–500%, schermvullend spelen en handmatig pauzeren.
- Volledige notices en overeenkomstige broncode op de licentiepagina.

## Nog niet beschikbaar of niet vastgesteld

- **DOS samen emuleren met ieder een eigen bestand:** uitgeschakeld. Twee
  instanties leverden nog geen gelijke toestandcontrolesommen op. Rollback is
  nog niet exact reproduceerbaar; snapshots van de demo zijn circa 28,8 MB.
- **DOS-savestates en save-export/import:** niet vrijgegeven. Native snapshots
  werkten voor een al gestart COM-programma, maar een verse ZIP-start kan in een
  ander menu/programma zitten. Voortgang blijft tijdelijk en gaat verloren bij sluiten.
- **Volledig toetsenbord, muis en vrije DOS-toetstoewijzing:** niet aanwezig.
  Fysieke toetsen en gamepadknoppen zijn wel instelbaar. DOS-toetsen zijn voorlopig:
  P1 pijltjes, Ctrl/Alt, spatie/Tab, Q/E; P2 WASD, F/G, H/R, T/Y; beide Enter/Esc.
  Gebruik zo nodig het instellingenmenu van de game om die toetsen te kiezen.
- **3dfx, MT-32/SC-55, bootbare Windows-installaties en grote CD-images:** niet
  aangeboden/getest in deze browserintegratie. De normale interpreter is trager
  dan desktop-DOSBox met dynamische recompilatie; zware late DOS-games kunnen traag zijn.
- **Brede gamecompatibiliteit:** alleen originele fixtures getest. Dit is geen
  belofte dat iedere DOS-game of iedere browser/netwerkcombinatie werkt.
- **Relay voor DOS:** geen Itty. Video/audio heeft een directe WebRTC-verbinding
  nodig; een echte firewall/NAT-blokkade wordt niet door de timingfix opgelost.

## WebRTC-timingfix

Verbindingsopbouw heeft een eigen deadline van 45 seconden. Zodra het transport
verbonden is, krijgt de gast nog 30 seconden voor het eerste beeld en geluid.
Een tijdelijke mediaonderbreking krijgt 12 seconden hersteltijd; een definitief
`failed` of `closed` beëindigt de stream. De melding onderscheidt het opzetten
van de verbinding van ontbrekend beeld op een al verbonden mediaverbinding.
Geblokkeerd afspelen vraagt om een klik op het gamescherm. Deze wijziging lost
timinggevoeligheden op, maar bewijst niet de oorzaak van een eerdere mislukte test.
