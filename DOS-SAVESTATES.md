# DOS-savestates — alleen solo

1. Kies **Speel solo → DOS** en laad je eigen game of DOS Duo.
2. Start de game; kies bij een ZIP zo nodig het programma in het DOS-startmenu.
3. Klik bij **Bewaar je plek** op **Savestate downloaden** en bewaar de `.rrstate`.
4. Open later dezelfde gamebestanden, stel dezelfde CPU-overclock in en kies
   **Savestate importeren**. De emulatorversie moet ook overeenkomen.
5. Tijdens een lopend solospel gaat DOS na opslaan of herstellen automatisch
   verder. Was het spel al gepauzeerd of nog niet gestart, kies **Verder spelen**.

De download bevat de native speltoestand en de tijdelijke DOS-schijfwijzigingen.
Daardoor kunnen ook bestanden die de game tijdens het spelen heeft geschreven
terugkomen na een nieuwe browsersessie. Het programma dat in het ZIP-startmenu
werd gekozen wordt bij herstel automatisch voorbereid in een aparte instantie.
De game hoeft daarvoor niet opnieuw handmatig in het menu te worden gekozen.
Bij een mislukte import blijft de huidige spelinstantie behouden.

De oorspronkelijke game blijft nodig. Bestanden worden niet geüpload of naar een
andere speler gestuurd. Een savestate kan gamecode uit het emulatiegeheugen en
gewijzigde DOS-bestanden bevatten; het is geen losse kopie van de oorspronkelijke
ROM/ZIP. De download bevat geen zelfstandig meegeleverde gamebibliotheek.

## Grenzen

- Alleen solo, ook bij handmatig gepauzeerd solospel. In een aangemaakte kamer,
  bij samen emuleren en bij streamen blijven export en import uitgeschakeld.
- Export kan pas als een DOS-programma draait. Het DOS-startmenu zelf, bootbare
  Windows-/OS-installaties en DOS-rollback worden hiermee niet vrijgegeven.
- Een andere game/ZIP, andere emulatorbuild, CPU-instelling of beschadigde
  download wordt vóór native herstel geweigerd. De keuze om DOS-patches zonder
  versiecontrole toe te passen staat los van deze savestatecontrole.
- Circa 29 MiB voor de eigen DOS Duo-fixture; de grootte hangt af van game en
  schijfwijzigingen. Maximaal 64 MiB native state plus 32 MiB DOS-schijfbestanden,
  512 bestanden en maximaal 97 MiB voor het DOS-containerdeel van de download.
- Losse in-game savebestanden selecteren/exporteren is nog een aparte, niet
  aangeboden functie. Een in-game save telt pas mee zodra je een nieuwe savestate
  downloadt. Er is geen automatische opslag of herstel na het sluiten van de site.
- Getest met eigen COM- en ZIP-fixtures, bij 100% en 500% CPU, een gekozen
  submap-programma en open schijfbestanden. Dit bewijst geen compatibiliteit met
  alle DOS-games, speciale launchers of schijfwissels.

Techniek en bijbehorende bron: [native/DOSBOX.md](native/DOSBOX.md).
