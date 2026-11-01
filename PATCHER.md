# Game patcher

Open **Game patcher** rechtsboven op RetroRoom. Kies eerst NES, SNES of MS-DOS,
daarna je eigen originele bestand en je eigen patch. Klik op **Patch toepassen**
en download de gepatchte kopie. Laad die daarna via **Speel solo** of in je kamer.
Bij samen emuleren maakt iedere speler dezelfde gepatchte kopie op zijn eigen apparaat.

Het patchen gebeurt lokaal in een aparte browserworker. Bestanden, patches en
hashes worden niet geüpload of naar de andere speler gestuurd door de patcher.
Het originele bestand wordt niet overschreven. Downloads worden alleen bewaard
wanneer je ze zelf opslaat. Sluiten, annuleren of andere bestanden kiezen beëindigt
de worker en verwijdert het aangeboden resultaat uit deze patchersessie.
De patcher start geen programma's en voert geen code uit een patchbestand uit.

## NES en SNES

- Uitgepakte `.nes` of `.sfc`/`.smc` met een `.ips`- of `.bps`-patch.
- Origineel en resultaat maximaal 8 MiB; voor een SNES-origineel mag daar een
  512-byte kopieerheader bovenop komen. Het downloadresultaat blijft maximaal 8 MiB.
  Patches maximaal 32 MiB. IPS32, UPS, xdelta en gecomprimeerde patches worden niet ondersteund.
- **BPS** controleert de grootte en CRC32 van het origineel, de patch-CRC32 en
  de CRC32 van het resultaat. Bij een fout wordt geen download aangeboden.
- **IPS** bevat geen controle van de originele ROM-versie of van het resultaat.
  Een technisch geldige patch kan daardoor op de verkeerde regio/revisie worden
  toegepast en een onbruikbare hack opleveren. Vergelijk vóór het patchen de
  getoonde CRC32/SHA-256 met de informatie van de patchmaker.
- SNES: kies expliciet **512-byte SNES-kopieerheader verwijderen** als de patch
  een headerloze ROM vereist. Die optie is alleen beschikbaar als de bestandsgrootte
  op een kopieerheader wijst. De controles en patchposities gelden vervolgens voor
  de headerloze bytes. Het resultaat krijgt `.sfc`. Er wordt nooit automatisch
  een header verwijderd, toegevoegd of teruggezet.
- Uitbreidingen, verkleiningen, gewone IPS-records en IPS-RLE worden ondersteund.
  BPS ondersteunt alle vier acties, metadata en overlappende TargetCopy-acties.
  Patches wijzigen bytes; ze garanderen geen compatibiliteit met onze emulator.

De parser is een originele RetroRoom-implementatie; er is geen patchbibliotheek
van derden gebundeld. Formaatreferenties: [BPS-specificatie (public domain)](https://github.com/Sir-Walrus/Flips/blob/master/bps_spec.md)
en de [IPS-referentie-implementatie](https://github.com/Sir-Walrus/Flips/blob/master/libips.cpp).
CRC32 is een controle tegen verkeerde/beschadigde bestanden, geen bewijs dat een
patch veilig of betrouwbaar is.

## MS-DOS: JSON-patches

Deze eerste versie patcht **één los bestand**, bijvoorbeeld `GAME.EXE`, `GAME.COM`
of een databestand. Ondersteund: **RetroRoomBinaryPatch v1** en
**hocus-coop-copy-patch-1** (onder andere `coop-v0.3.json`). JSON is een verpakking;
andere JSON-patchformaten, zoals RFC 6902, worden niet automatisch ondersteund.
ZIP/DOSZ/7z/RAR worden niet in de patcher uitgepakt of opnieuw ingepakt.

Voor DOS controleert de patcher **niet** of de patch bij de gekozen gameversie
hoort. `source.size`, `source.sha256` en `target.sha256` worden niet afgedwongen;
oorspronkelijke bytes worden niet met `before` vergeleken. Deze metadata mag ook
ontbreken. De getoonde CRC32/SHA-256 zijn alleen vingerafdrukken, geen bevestiging
van compatibiliteit. Het resultaat krijgt geen melding dat inhoud of versie is
geverifieerd. De patcher controleert wel de structuur, geldige bytes, lees- en
schrijfgrenzen en de limiet van 32 MiB voor het resultaat.

1. Pak je eigen volledige DOS-game uit.
2. Selecteer het losse bestand waar de patch bij hoort (maximaal 32 MiB).
3. Selecteer de JSON-patch (maximaal 4 MiB) en patch het bestand.
4. Zet de gedownloade kopie onder de **oorspronkelijke bestandsnaam** terug in
   je uitgepakte game. Bewaar zelf een back-up van het origineel.
5. Maak opnieuw een ZIP met alle benodigde gamebestanden en laad die in DOSBox Pure.

Een werkend voorbeeld voor onze originele demo staat in
[`web/assets/dos-duo-example-patch.json`](web/assets/dos-duo-example-patch.json).
Download in de patcher **DOS Duo** plus **Voorbeeldpatch**. Het voorbeeld vervangt
alleen de titel `RETRO ROOM - DOS DUO` door `RETRO ROOM - DOS MOD`.
De complete oorspronkelijke demo wordt uit [`scripts/demo-dos.js`](scripts/demo-dos.js)
gebouwd en bevat geen commerciële spelbestanden.

### RetroRoomBinaryPatch v1: bytevervangingen

Dit voorbeeld vervangt twee bytes op positie 16. Het is een schema-voorbeeld;
het werkt alleen voor bestanden die lang genoeg zijn en een game heeft andere
wijzigingen nodig om een werkende hack te maken.

```json
{
  "format": "RetroRoomBinaryPatch",
  "version": 1,
  "patches": [
    {"offset": 16, "before": "B8 00 00", "after": "B8 01 00"}
  ]
}
```

- `offset` is een geheel byteadres vanaf **0**, in decimale JSON-notatie.
- `before` en `after` zijn hexbytes, met optionele witruimte. Ze moeten niet leeg
  zijn en evenveel bytes bevatten. Versie 1 ondersteunt geen invoegen, verwijderen
  of bestandsgrootte wijzigen.
- `before` geeft de lengte van de vervanging aan; de inhoud wordt niet met het
  gekozen bestand vergeleken. Maximaal 10.000 wijzigingen; wijzigingen mogen niet overlappen of buiten het
  bestand vallen. De volgorde van de JSON-items maakt niet uit.
- Alle wijzigingen moeten een geldige structuur hebben. Alleen een kopie wordt
  aangepast; het originele bestand blijft intact.
- Een optionele `description` is alleen toelichting; onbekende velden worden
  genegeerd. Scripts, opdrachten en URL's in JSON worden nooit uitgevoerd.

### hocus-coop-copy-patch-1: kopieerblokken en Base64

Dit formaat bouwt de uitvoer op in de volgorde van `operations` en ondersteunt
ook grotere of kleinere bestanden. `version`, bijvoorbeeld `"0.3"`, is de
patchrevisie; de formaatkeuze komt uit `format`.

```json
{
  "format": "hocus-coop-copy-patch-1",
  "version": "0.3",
  "target": {"size": 5},
  "operations": [
    {"copy": [0, 3]},
    {"data": "ISE="}
  ]
}
```

- `copy: [positie, lengte]` voegt bytes uit het **origineel** toe aan de uitvoer.
  Positie begint bij 0; lengte is een positief geheel getal. Het bereik moet in
  het gekozen bestand liggen. Een blok kan meerdere keren worden gekopieerd.
- `data` voegt Base64-gecodeerde bytes toe. Gebruik standaard Base64 met de
  gebruikelijke `=`-opvulling, zonder witruimte. Er wordt geen code uitgevoerd.
- Elke bewerking bevat precies één van `copy` of `data`; maximaal 10.000
  bewerkingen. De totale uitvoer moet precies `target.size` bytes hebben.
  `target.size` is verplicht, tussen 1 byte en 32 MiB.
- `source`, `target.sha256`, `description` en `assembly_sha256` zijn geen
  controles die deze browserpatcher afdwingt. Assemblagebestanden zijn niet nodig.
- Met origineel `abc` produceert het voorbeeld `abc!!`. De oorspronkelijke
  `coop-v0.3.json` kan zonder omzetting worden gekozen. De site bundelt die
  gebruikerspatch of het originele spelbestand niet.

Gebruik alleen gamebestanden en patches die je mag gebruiken en delen. De patcher
levert geen commerciële ROMs, BIOS-bestanden, DOS-games of patches daarvoor.
