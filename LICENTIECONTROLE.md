# Licentiecontrole RetroRoom

Controle uitgevoerd op 29 oktober 2026. Reikwijdte: de gepubliceerde NES/SNES-browserapp,
Mesen-build en overeenkomstige broncode, PeerJS-bundel, npm-lockfile, eigen beelden/demo,
webfonts, bouw-/bronpakketten en zichtbare licentiedocumentatie.

## Bevindingen en correcties

| Onderwerp | Bevinding vóór deze controle | Correctie |
|---|---|---|
| Mesen-licentie en broncode | GPLv3-tekst zat in het native bronpakket; bronlink stond alleen bij Over deze alpha. | Zichtbare pagina **Licenties en broncode** vanuit footer en About, met auteurs, rechten, garantievermelding en volledige teksten. |
| Licentie van de combinatie | Mesen zelf geeft GPL-3.0-or-later; de root-MIT-vermelding maakte de reikwijdte onvoldoende duidelijk. xBRZ noemt specifiek GPLv3 met MAME-uitzondering. | GNU GPL versie 3 voor de gecombineerde distributie. Upstream- en afzonderlijke MIT-/andere grants blijven behouden. Root LICENSE, metadata, README en publieke pagina verduidelijkt; MAME-uitzondering niet als algemene uitzondering gebruikt. |
| Mesen-bibliotheken | Veel notices stonden alleen in bronheaders; onder meer LGPL-tekst en losse MIT/BSD-vermeldingen ontbraken als leesbare distributiedocumentatie. | Centrale notices met 43 componenten/groepen, oorspronkelijke auteurs en volledige GPL/LGPL/Apache/LLVM/MIT/BSD/OFL-teksten en overige voorwaarden. |
| PeerJS | Alleen PeerJS' eigen MIT-tekst werd apart gekopieerd. Ook adapter/BinaryPack/EventEmitter/SDP hebben eigen voorwaarden. | Alle relevante teksten toegevoegd; officiële bronrelease, exacte bronkaart en de 37 oorspronkelijke gebundelde broninhouden beschikbaar. |
| Vooraf gebouwde bundel | Geïnstalleerde dependencyversies bewijzen niet welke versies in peerjs.min.js zitten. | Onderscheid gedocumenteerd: adapter 9.0.1 / SDP 3.2.0 in de officiële bundel; adapter 9.0.6 / SDP 3.2.2 in onze pnpm-installatie. Bundle-/bronkaarthashes vastgezet. |
| Wijzigingsvermeldingen | Browserpatches waren beschreven, maar aangepaste upstreambestanden hadden geen duidelijke gedateerde wijzigingskop. | Gedateerde bronkoppen en native/CHANGES.md toegevoegd. Geen executable-codewijziging. |
| Complete broncode van deze website | GitHub was beschikbaar, naast alleen de native download. | Iedere build maakt een volledig eigen bronpakket op dezelfde site met frontend, native bronpakket, lockfiles, recepten, notices en gebruikte PeerJS-bronnen. Geen account of aanvraag nodig. |
| Native bronpakket | Bevatte ook niet-gebruikte desktop-UI/platformbestanden en kleine binaire Satellaview-datasjablonen. | Pakket beperkt tot alle bron-/headertrees die de native compileeropdracht gebruikt, met buildrecepten en notices. Onnodige desktopassets niet verder meegenomen; geen uitspraak dat deze kleine datasjablonen commerciële BIOS-dumps zijn. |
| Publicatiecontrole | Native Wasm en bronarchief werden op hash gecontroleerd; loader en licentie-updates niet. | Loaderhash, dependency-/noticescontrole, bronkaartcontrole en tests voor volledige bronarchieven toegevoegd aan de gewone build. |
| Fonts/eigen demo/beelden | Eigen MIT-code en remote fonts, maar beperkte inventaris. | Fontnamen, OFL-teksten en herkomst toegevoegd; eigen Room Rally/SVGs onderscheiden van commerciële games en merken. |

## Technische verificatie

- Alle 1.398 bestanden uit de native compileertrees zijn byte voor byte vergeleken
  met het eerder gepubliceerde bronpakket. Alleen drie nieuwe commentaarregels zijn
  weggelaten in de vergelijking; de resterende inhoud is identiek.
- De Wasm blijft ongewijzigd, met SHA-256
  `c79ce4580a28a83328bdc4f7edc654c3bfa906d2151e10145775977d8c91ffbe`.
- De oorspronkelijke PeerJS-TypeScriptbronnen komen overeen met release v1.5.5;
  alleen de upstream-versieplaceholder wordt tijdens de officiële build vervangen
  door versie 1.5.5. De exacte gepubliceerde bronkaart is eveneens opgenomen.
- Bronpakkettests controleren geldige tar-controlesommen, volledige bestandsinhoud,
  ongewijzigde buildrecepten, native bron-/loader-/Wasm-controlesommen en alle 37
  oorspronkelijke PeerJS-bronnen. De volledige regressiesuite en productiebuild
  moeten slagen vóór publicatie.
- De nieuwe downloadlinks en zichtbare notices worden lokaal en na publicatie
  gecontroleerd. De publicatiestatus staat bij de bijbehorende GitHub pull request.

## Wat deze controle niet vaststelt

Dit is een technische licentie-audit van de onderzochte versie, geen bindend oordeel
of garantie dat in iedere situatie aan alle wetgeving is voldaan. Rechten op ROMs,
BIOSes, ROM-hacks, opgenomen/gestreamde gamebeelden en merken staan los van de
softwarelicenties. Ieder een eigen ROM gebruiken of alleen video verzenden maakt
niet automatisch ieder gebruik rechtmatig en sluit aansprakelijkheid niet uit.
Privacy-/consumentenrecht, eventuele gegevensverwerkersrollen, externe
servicevoorwaarden, patenten en de specifieke gebruikssituatie vallen buiten deze
licentiecontrole. Voor een volledige juridische beoordeling is een deskundige nodig.

Een eerdere onvolledige licentievermelding wordt niet met terugwerkende kracht
ongedaan gemaakt door nieuwe documentatie. Oude versies in de openbare Git-historie
blijven historische distributies; eventuele rechtenkwesties daarover moeten apart
worden beoordeeld. De broncode hoort beschikbaar te blijven zolang de bijbehorende
binary wordt aangeboden. Bewaar deze bestanden en voer bij iedere nieuwe core,
afhankelijkheid, font of extern beeld opnieuw een licentiecontrole uit.

## Primaire bronnen

- [GNU GPLv3, met name §§ 0, 1, 4–6 en 14](https://www.gnu.org/licenses/gpl-3.0.html)
- [GNU FAQ: overeenkomstige broncode bij binaries](https://www.gnu.org/licenses/gpl-faq.html#SourceAndBinaryOnDifferentSites)
- [Gepinde MesenCE-broncode en README/LICENSE](https://github.com/libretro/MesenCE/tree/4c4e069f16a8ad6ed79e046046c56d51558c7daf)
- [PeerJS 1.5.5-licentie](https://github.com/peers/peerjs/blob/v1.5.5/LICENSE)
- [WebRTC-adapter BSD-licentie](https://github.com/webrtcHacks/adapter/blob/v9.0.1/LICENSE.md)
- [Emscripten 4.0.19-licenties](https://github.com/emscripten-core/emscripten/blob/4.0.19/LICENSE)
- [DM Sans OFL](https://github.com/google/fonts/blob/main/ofl/dmsans/OFL.txt)
- [Space Grotesk OFL](https://github.com/google/fonts/blob/main/ofl/spacegrotesk/OFL.txt)

De volledige concrete teksten en bestand-/componentherkomst staan in
`web/THIRD-PARTY-NOTICES.txt` en `web/assets/license-manifest.json`.
