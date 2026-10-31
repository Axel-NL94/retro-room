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

## MS-DOS: RetroRoomBinaryPatch JSON v1

Deze eerste versie patcht **één los bestand**, bijvoorbeeld `GAME.EXE`, `GAME.COM`
of een databestand. Het is een eigen beschreven JSON-formaat voor binaire
bytevervangingen; het is geen RFC 6902 JSON Patch en ook geen algemeen formaat
voor bestaande DOS-patches. Een patchmaker moet een passend bestand maken.
ZIP/DOSZ/7z/RAR worden niet in de patcher uitgepakt of opnieuw ingepakt.

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

Schema (de hashwaarden hieronder zijn placeholders, geen werkende patch):

```json
{
  "format": "RetroRoomBinaryPatch",
  "version": 1,
  "source": {"size": 1234, "sha256": "64 hextekens van het volledige origineel"},
  "target": {"sha256": "64 hextekens van het volledige resultaat"},
  "patches": [
    {"offset": 16, "before": "B8 00 00", "after": "B8 01 00"}
  ]
}
```

- `source.size` is de exacte bestandsgrootte in bytes. Beide SHA-256-waarden
  zijn verplicht en hebben 64 hextekens (hoofdletters of kleine letters).
- `offset` is een geheel byteadres vanaf **0**, in decimale JSON-notatie.
- `before` en `after` zijn hexbytes, met optionele witruimte. Ze moeten niet leeg
  zijn en evenveel bytes bevatten. Versie 1 ondersteunt geen invoegen, verwijderen
  of bestandsgrootte wijzigen.
- Alle `before`-bytes moeten overeenkomen met het oorspronkelijke bestand.
  Maximaal 10.000 wijzigingen; wijzigingen mogen niet overlappen of buiten het
  bestand vallen. De volgorde van de JSON-items maakt niet uit.
- Eerst worden het origineel en alle wijzigingen gecontroleerd; pas daarna wordt
  een kopie aangepast. De SHA-256 van het resultaat moet kloppen vóór de download.
- Een optionele `description` is alleen toelichting; onbekende velden worden
  genegeerd. Scripts, opdrachten en URL's in JSON worden nooit uitgevoerd.

Gebruik alleen gamebestanden en patches die je mag gebruiken en delen. De patcher
levert geen commerciële ROMs, BIOS-bestanden, DOS-games of patches daarvoor.
