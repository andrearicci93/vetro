# opus6 (6b, dopo il giro del proprietario): Velo per Banner, Info ed EPG; il resto è il vecchio OSD, rifinito sul 123
Vincoli EFL di BRIEF-5 invariati (ogni primitiva = un evas_object, moto lineare, pesi 200/500/600). Contatore per finestra con **O**; `?selftest` 1582 passi, 0 errori.
Selettore: Banner, Info, EPG, Dock, Sources, Task manager, Volume, osd 123, Channel pad, Channel list, Audio toast. Interruttore **Today's OSD** (`?osd=today`) per il confronto con il TV di oggi.

**Banner e Info: il velo non è più una massa.** Sul chiaro, un velo abbastanza denso da leggere da solo un testo bianco diventa per forza un blocco scuro: il "pugno in un occhio" della versione 6. Ora il lavoro si divide:
- `veil_corner.png` (512×288, stirata, non 9-slice): un quarto d'ellisse con il centro nell'angolo in basso a sinistra, senza lati dritti. È piena fino al 40% del raggio, poi scende in modo che sul **bianco** la luminosità percepita (L\*) salga uniforme fino al video, senza la fascia grigia a metà. Ha un rumore di ±0,6 livelli cotto contro le bande. Alpha dell'oggetto .58 nel Banner (prima .84), .66 in Info, .94 nell'EPG. Banner, Info ed EPG sono lo stesso oggetto che si allarga dall'angolo (rx×ry 1700×600, 2500×1000, 6400×3400).
- il contrasto viene da un **alone scuro sotto le lettere**: un text filter program per testo (blur 10 nero .55 + ombra 1 px), che `DESIGN.md` dà misurato sulla Q80A (2,2 ms, "the cheapest way to make a label legible on video"). Il buio sta solo dove ci sono le lettere.
- variante scartata, ancora visibile con `?veil=spot` (`_work/shots/banner-variante-spot-snow.png`): una cupola centrata sul contenuto. Sulla neve si legge come una collina scura.
Composizione invariata rispetto alla 6 (angolo in basso a sinistra, Info che cresce in alto e a destra, Banner→EPG con numero e nome che volano nella loro riga), con due correzioni. **Linea di base comune**: il numero grande poggia sulla base della seconda riga (programma, oppure "No programme information"), o del nome se la seconda riga manca; in Info il numero sta sulla base del nome. **"N min left"** segue la testina; se arriva a meno di 28 px da un orario, l'orario cede il posto (alpha 0, stesso oggetto) e l'etichetta va fino al bordo della linea. Niente si sovrappone e niente si incolla (`_work/shots/banner-1-min-left-pitch.png`, `banner-29-min-left-snow.png`).

**Vecchio OSD: non ridisegnato a mano, ma registrato dal codice vero.** `_work/capture.py` guida la preview (dock/src e tuner/src su EFL simulato), salva la scena di ogni stato (oggetti, geometria, 9-slice, tinte, clip, ombra dei testi) e le PNG vere in `assets/old/`. Il mock la ridisegna oggetto per oggetto e, tra uno stato e l'altro, sposta in linea retta gli oggetti con lo stesso id, come fa il codice (Dock 0,30 s, Task manager 0,14 s, pad 0,12 s).

**Trasparenze, ombre, raggi: misurati e unificati sul 123** (come sono oggi → proposta, `refine()` in `_work/old-osd.js`)
| | oggi | proposta |
|---|---|---|
| fondo di Dock, Task manager, Channel pad, Channel list | `dock_bg` opaco, filo cotto | `pill_bg` ardesia #243448 **al 90%** + `pill_rim` bianco al 22% 2 px fuori: come 123 e Volume |
| ombra | `shadow.png` (sfocatura 50, 45%) sotto i pannelli; niente sotto 123 e Volume | **nessuna** in tutto l'OSD: −1 oggetto per pannello |
| raggio | pannelli 16; 123 e Volume capsula; tasti e fuoco del pad/lista ~16 | **40** per i pannelli (Dock, Sources, Task manager, Channel pad, Channel list): angoli molto stondati, concentrici a quelli delle icone del Dock (raggio 15 + margine 26 ≈ 40). **Capsula** per gli elementi da una riga (123, Volume, toast, chip, tasti, righe). Stessa PNG con `border_scale` = raggio/48 |
| fuoco | 4 modi: anello+alone (Dock), anello+vetro+alone grigio (Task manager, 3 oggetti), anello+riempimento (pad, lista), capsula ghiaccio piena (123) | **la capsula ghiaccio piena del 123** (`pill_cap`) con il testo in ardesia ovunque; il Dock tiene l'anello sulle icone |
| tasti del Channel pad a riposo | `solid` bianco al 20% | la stessa capsula, bianca al 14% |
| Audio toast | scheda rettangolare con ombra | **capsula ovale del 123**: filo + corpo + testo 32, 3 oggetti come oggi, in alto a destra |
| Channel pad / Channel list | in alto a destra (y 110) | a destra, **centrati in verticale come il Volume** a sinistra: pad 232-848, lista 164-916 |

**Allineamenti misurati** (`?check`: centro dell'inchiostro vero di ogni testo rispetto al suo contenitore) e corretti: barra di **Sources** 34 px a sinistra del centro (codice); testi della **Channel list** 3 px alti e numeri allineati a sinistra (ora a destra, "10" e "11" non toccano più il logo); cifre del **Channel pad** 3 px alte ("Delete" e "Go" 2); toast 1 px. Dopo: tutto entro 0,5 px, barre a 960, pannelli a 96 px dal bordo, fondo del Task manager sulla linea della barra del Dock (994).

**Oggetti per finestra** (contatore, clip del livello compreso; oggi → proposta): Dock 25 → 25 (−ombra, +filo) · Sources 14 · Task manager 42 → 40 · Channel pad 32 → 31 · Channel list 38 → 37 · osd 123 21 (invariato) · Volume 8 (invariato) · Audio toast 4 · Banner 11 · Info 16-17 · EPG 114.

**Stare insieme.** Volume (a sinistra, centrato) e Channel pad (a destra, centrato) sono speculari sulla stessa linea; il Volume sopra al Banner non si sovrappone più a nessun velo (`transizione-volume-banner-60.png`). Il Dock e il Banner non compaiono mai insieme: Home è in `SystemKeys` e chiama `Deactivate()` (`tuner/src/Program.cs`).

**Difetti trovati nel codice o nella preview (da verificare sul TV, non corretti nel repo)**
- **Task manager**: nella preview le righe partono una riga (76 px) sotto la pastiglia di selezione e il pannello è alto una riga di troppo (6 per 5 app). Nel mock il pannello si accorcia dall'alto. Da guardare in `TaskPanel` / `TaskLayout` / `TaskSource.Sim`. Sono del codice anche la barra di Sources fuori centro, i testi alti di pad e lista e il piè del Task manager a 21 px (< 22).
- **osd 123**: il numero digitato (68, bianco, senza ombra) sta sopra il video, fuori dalla capsula; sulla neve non si legge (`_work/shots/pad123-snow-typed-number.png`). Proposta: dargli l'ombra morbida dei testi del Dock, o metterlo in una `pill_chip` come Done.
- **osd 123 + Banner**: il 123 non nasconde il Banner. Il tuner legge già `/tmp/vetro-numpad.open` (`DockPadOpen()`), ma solo per ignorare i tasti.

**Rischi sul Q80A**: l'alone come filter program su 6-16 testi (tile di graphic-testing con il Banner sulla neve); le bande della coda lunga di `veil_corner` (foto del pannello); il muto con il trattino da 32 al 55% è sottile. Contrasto: il calcolo di `contrast.py` ignora l'alone, quindi i numeri sul chiaro sono più bassi di quello che si vede; il giudizio vale da foto del pannello. Non provato sulla Q80A.

**File**: le PNG di consegna sono qui (anche `sources.png`, `channellist.png`, `audiotoast.png` e 4 transizioni); gli stati e i confronti `oggi-*.png` in `_work/shots/`. Non più usati: `assets/veil9.png`, `veil.png`, `app_*`, `icon_ring.png`, `bar_v.png`, `progress_v.png`. Restano anche le prove `t-*`, `f-*`, `n-*`, `v-*`, `r-*` in `_work/shots/` (la cancellazione automatica è stata bloccata).
