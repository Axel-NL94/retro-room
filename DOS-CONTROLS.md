# DOS-besturing en toetsenbord delen

DOS gebruikt het fysieke toetsenbord, de muis en instelbare controllers. De
consoleknoppen A/B/X/Y/L/R, Select en Start worden bij DOS verborgen. NES/SNES
houden hun eigen bediening. Ook het DOS-startmenu leidt de controllerbediening
af van de toegestane invoer. Klik in het gamebeeld voor toetsenbordfocus.

## Samen bedienen (standaard)

Een nieuwe DOS-game begint altijd met **Samen bedienen**. Beide spelers bedienen
dezelfde virtuele pc; joysticks gebruiken hun eigen poort. Open **DOS-menu** of
**Toetsenbord verdelen en besturing** om het volledige toetsenbord te zien.

De host klikt op toetsen om ze voor speler 1 te reserveren. Ze worden groen;
speler 2 ziet ze rood en kan de verdeling niet wijzigen. Nogmaals klikken maakt
een toets weer gedeeld. **Alle toetsen weer delen** wist de reserveringen. Deze
keuze wordt in de browser van de host bewaard. Reserveren drukt geen toets in de
game in. De verdeling mag ook tijdens het spelen veranderen.

De blokkade wordt op de uiteindelijke DOS-invoer toegepast, ook bij
controllerkoppelingen. Een ingedrukte toets wordt losgelaten zodra de blokkade
ingaat; andere gedeelde toetsen mogen ingedrukt blijven. Muiswiel naar
Page Up/Down volgt dezelfde toetsblokkade. Toetsenbord en muis zijn gedeeld;
reserveringen maken geen aparte toetsenborden in de DOS-game.

## Om de beurt bedienen

De host kiest **Om de beurt bedienen**. Speler 1 begint. Met **Besturing aan
speler 2 geven** draagt speler 1 de gamebediening over. Speler 2 kan met
**Besturing teruggeven aan speler 1** teruggeven. Alleen de actieve speler
bestuurt toetsenbord, muis en controller; het websitemenu blijft voor beide
spelers bereikbaar. De actieve controller gebruikt de eerste DOS-joystickpoort.
De actieve speler heeft alle DOS-toetsen beschikbaar. De opgeslagen
reserveringen gelden weer zodra de host **Samen bedienen** kiest.

Bij een overdracht komt er een leeg invoerframe zodat ingedrukte toetsen,
muisknoppen en joystickknoppen losgelaten worden. De host kan altijd terug naar
Samen bedienen. Bij solo kan hetzelfde menu ook een tweede lokale controller
actief maken en teruggeven.

## Synchronisatie

Bij streamen past de host de regels toe op de eigen en ontvangen invoer.
Bij samen emuleren stuurt alleen de host de regels mee met zijn frame-invoer;
beide instanties passen dezelfde regels op hetzelfde frame toe. De bestaande
zes-frame-invoerbuffer blijft gelden. De status toont een wachtende wijziging.
De gast kan alleen de eigen actieve beurt teruggeven, met de actuele revisie en spelsessie;
een oud verzoek kan een latere beurt niet teruggeven. Spelbestanden worden niet
overgedragen. Beide spelers moeten deze versie laden en een nieuwe uitnodiging
gebruiken. DOS blijft rechtstreeks WebRTC vereisen.

## Escape en fullscreen

Onze eigen Escape-naar-fullscreen-afsluiten-handler is verwijderd. Bij DOS
fullscreen vragen we waar beschikbaar Keyboard Lock voor Escape. Een browser
kan toestemming vragen. In ondersteunend Chrome gaat kort Escape naar DOS en
blijft lang Escape (circa twee seconden) een uitweg uit de vergrendeling.
Ondersteuning en systeemtoetsen verschillen per browser.

Kies in het DOS-menu een **Vervangende toets voor DOS-Escape** als alternatief.
Die toets vervangt dan zijn gewone DOS-functie; standaard is er geen vervanger.
Deze instelling is lokaal per browser. **Escape naar DOS sturen** in het menu
stuurt een korte Escape, zolang jouw speler die toets mag bedienen.

In fullscreen blijft het beeld schermvullend. **Alt+Shift+M** opent het DOS-menu;
ook verschijnt bovenaan rechts tijdelijk een DOS-menu-knop als je de muis naar
de bovenrand beweegt. Het menu bevat **Volledig scherm verlaten**. Openen laat
een gevangen muis los. De game pauzeert alleen via de pauzeknop.

## Gerichte verificatie

37 gerichte automatische controles slagen voor onder meer toetsfilters, controllerkoppelingen, geblokkeerde modifiers/wiel, overdracht,
vertraagde frame-invoer, protocolvalidatie, Escape-alias en toegestane/geweigerde
Keyboard Lock zijn gericht getest. De browserproef gebruikt originele DOS Duo:
solo, toetsverdeling tijdens netplay, actieve/inactieve invoer, teruggeven en
streamen. Lange core-determinismeproeven, overclock, saves, rollback en
Tailcat-/firewallproeven worden voor deze interfacewijziging niet herhaald.
Een fysiek gamepad en echte browser-/OS-sneltoetsen vereisen aanvullende
praktijktests. De bestaande GitHub-controle blijft ongewijzigd.

Browserachtergrond: [Keyboard Lock](https://developer.chrome.com/docs/capabilities/web-apis/keyboard-lock) en [ondersteuning](https://developer.mozilla.org/en-US/docs/Web/API/Keyboard/lock).
