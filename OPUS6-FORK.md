# OPUS6-FORK: il look "Velo" (opus6) nel codice vero, da provare

Worktree di prova `<fork>`, branch locale `explore/opus6-ui`, nato da `e48f3f4` (release-0.5.1) più una copia delle modifiche non committate della checkout principale (lavoro 0.5.1: loghi dei canali, tasti del telecomando, ecc.). **Niente è committato né pushato.** La checkout principale `<repo>` non è toccata, salvo `design/` e `preview/`, che non sono nel repository.
Design approvato: `<repo>/design/challenge/opus6/` (index.html, NOTE.md, PNG). Regole aggiornate: `<repo>/design/DESIGN.md`, `tokens.css`, mock-up `tuner.html`, `epg.html`, `dock.html`, `index.html`.

## Cosa è cambiato, per file

**Tuner** (`tuner/`)
- `src/Ui/Surface.cs`: in `Theme` i pesi del font (200, 500, 600), l'inchiostro ardesia, il ghiaccio e la linea di base calcolata con le metriche di SamsungOneUI. Nuovi elementi:
  - il `Veil` condiviso: `veil_corner.png` stirata dall'angolo in basso a sinistra; forme Banner 1700×600 a .58, Info 2500×1000 a .66, EPG 6400×3400 a .94; si anima da una forma all'altra;
  - testi con l'ombra morbida EVAS;
  - `ProgressView`, `Panel` (pill_rim + pill_bg, raggio 40), capsule, celle, tratteggio;
  - entrata e uscita in alpha.
- `src/Ui/Views.cs`: Banner nuovo (angolo, numero 200/128 sulla base della seconda riga, logo 72, riga di avanzamento). Channel list e Channel pad centrati in verticale a destra, con il materiale nuovo e il fuoco a capsula ghiaccio. Audio toast a capsula.
- `src/Ui/InfoView.cs`: Info nuova (lo stesso angolo allargato; colonna sinistra 96-936, colonna destra allineata a 1296).
- `src/Core/ProgressRow.cs` (nuovo): la regola di "N min left" (l'orario che verrebbe toccato cede il posto). È logica pura, con test.
- `src/Core/GuideScene.cs`, `src/Ui/GuideView.cs`, `src/Core/GuideGrid.cs`: EPG del mock.
  - Velo pieno, intestazione, asse delle mezz'ore, corsie di celle stondate (raggio 20) al 9/16/5/3,5% con il tratteggio dove mancano i dati, segno "adesso" in Luce, piè di pagina con i tasti disegnati.
  - Fuoco = cella ghiaccio piena con testo ardesia: stesso raggio delle celle, perché una capsula su una cella da 15 minuti diventerebbe un ovale.
  - Tetti rispettati: 140 celle, 260 testi, 7 loghi, 7 tasti; in più 21 tratteggi, 3 linee, 1 fuoco. Circa 111 oggetti visibili.
- `src/Core/Motion.cs` (nuovo), `src/Ui/Anim.cs` (nuovo): un solo animatore ecore, vivo solo mentre qualcosa si muove, con un timer di sicurezza.
  - Curva EASE a 3 segmenti lineari.
  - Banner↔Info: il velo si allarga, linea e orari scorrono, numero, nome e titolo con zoom `evas_map` della copia più grande.
  - Banner→EPG: il nome vola nella sua riga; il numero 200→500 si scambia in dissolvenza negli ultimi 80 ms.
  - Channel pad↔Banner: dissolvenza. EPG→Banner (OK) usa lo stesso motore.
  - Un tasto durante una transizione la chiude subito.
- `src/Program.cs`: collega le transizioni; aggiunge `--no-motion` (e la feature `motion` in `src/Core/Features.cs`) per togliere il moto; nasconde il Banner al primo tasto letto mentre l'osd 123 è aperto (`DockPadOpen()`).
- `src/Core/InfoPanel.cs`: l'intervallo è diviso in `Start` e `End`.
- `src/Native/Efl.cs`: aggiunte dichiarazioni EFL (stile e ombra del testo, border scale, lettura di posizione/colore/visibilità, riempimento a piastrelle, sei chiamate `evas_map`, animatore e orologio ecore).
- `res/`: nuove `veil_corner.png`, `progress.png`, `pill.png`, `hatch.png`, `pill_bg.png`, `pill_rim.png`, `pill_cap.png` (le ultime tre copiate da `dock/res`).
- `tests/`: `ProgressRowTests.cs` e `MotionTests.cs` nuovi; `GuideTests.cs`, `LogoTests.cs`, `Program.cs`, `Tuner.Tests.csproj` aggiornati. `README.md`: aspetto e moto.

**Dock** (`dock/`)
- `src/Core/Design.cs`: `PanelRadius = 40`, bordi delle capsule, alpha del fuoco. Le costanti Shell/Shadow restano solo per le PNG ritirate che i tool generano ancora.
- `src/Ui/Dock.cs`: barra e Sources fatte con pill_rim + pill_bg (ardesia .90, filo .22, raggio 40), senza ombra. Fuoco delle icone invariato.
- `src/Core/Layout.cs`, `src/Program.cs`: `DockLayout.Pages` dimensiona le due pagine insieme. **Corretto**: Sources stava 34 px a sinistra del centro, perché la finestra condivisa era calcolata senza il gruppo di Settings e Samsung Home.
- `src/Ui/TaskPanel.cs`, `src/Core/TaskPage.cs`: stesso materiale; una sola capsula ghiaccio di selezione (prima erano alone, vetro e anello); testi della riga a fuoco in ardesia; piè di pagina a 22 px.
- `src/Core/Tasks.cs`, `src/Program.cs`: **corretto**. Gli id doppi (Samsung TV Plus e Live TV condividono `org.tizen.tv-viewer`) facevano contare 6 righe e disegnarne 5; ora `ParseStatus` e `Tasks.UniqueById` tengono la prima occorrenza.
- `src/Ui/NumberPad.cs`: il numero digitato nell'osd 123 sta in un chip ardesia come "Done", a 36 px invece di 68. Con la sola ombra morbida, su un'immagine chiara restava sbiadito.
- `designer/chosen.json`: raggio 40, opacità .90, nessuna ombra. `app/tests/dock-design.test.cjs` ora confronta questi valori con `PanelRadius` e `VolumeAlpha`.
- `tests/Program.cs`: test per centratura di Sources, righe del Task manager, materiale, id doppi.
- `src/Native/Efl.cs`: la costante `EvasTextStylePlain`. `README.md`: il materiale.

**Altro**: `CHANGELOG.md` (sezione "Velo look (opus6, trial…)").

**Preview** (in `<repo>/preview`, non nel repository; dettagli in fondo al suo README)
- `/speed?f=` rallenta o ferma l'orologio, per catturare le transizioni fotogramma per fotogramma.
- `?stage=1` mostra la tela 1:1; `?bd=` sceglie lo sfondo.
- Il simulatore disegna `evas_map` e i riempimenti a piastrelle.
- Corretta la perdita del rilascio dei tasti.
- La lista finta delle app non ha più id doppi.

## Test (tutti a 0 errori, 2026-11-11)
- `cd tuner/tests && dotnet run` → `ok: 235 checks`
- `cd dock && dotnet run --project tests` → `5778 checks, 0 failures`
- `node app/tests/dock-design.test.cjs` → PASS; `node app/tests/tuner-ui.test.cjs` → PASS
- Build vere: `cd tuner && dotnet build Tuner.csproj -c Release -p:TvsDll=<dump>/opt/usr/dotnet/Tizen.TV.Broadcast.TVService/1.1.12/Tizen.TV.Broadcast.TVService.dll`; `cd dock && dotnet build -c Release Launcher.csproj`. Entrambe con 0 errori (solo l'avviso di fine supporto di netcoreapp3.1).

## Provarlo
- **Preview sul computer**: `cd <repo>/preview && ./start.sh --source <fork>`, poi http://127.0.0.1:8300/. Si torna alla checkout principale con `./start.sh`. Le build della preview (`preview/run/bin-*`) sono condivise e si ricostruiscono a ogni avvio.
- **Sulla TV**:
  - `sh tuner/build.sh <TVService.dll del dump>` e `sh dock/build.sh` dal fork copiano le DLL in `app/native/` (le copie in `app/native` del fork sono ancora quelle della 0.5.1 finché non le ricostruisci).
  - Le PNG nuove arrivano da `tuner/res` e `dock/res` quando si costruisce il pacchetto (`app/build.cjs`).
  - Per una prova veloce, la DLL del tuner va avviata a mano come in `tuner/README.md` ("Running it on the TV").

## Da misurare sulla Q80A (finora solo simulato)
- **Chiamate EFL nuove mai eseguite sul TV**: `evas_map` (zoom di 2-3 testi, rimappati a ogni fotogramma per 320 ms), riempimento a piastrelle (tratteggio dell'EPG), letture di geometria e colore. `DESIGN.md` dà lo zoom con map misurato in graphic-testing, ma non questo uso.
- **Ombra morbida sui testi** di Banner e Info: è nella classe di costo "with care" (10-16 ms per 12 copie da 4-8 testi), quindi va cronometrata. Va anche verificato se EFL la taglia mentre un testo è sotto map.
- **Linee di base**: calcolate con le metriche di SamsungOneUI (ascender 952, descender 276 su 1024). FreeType sul TV può spostarle di circa 1 px.
- **Velo stirato**: possibili bande nella coda lunga sul chiaro (serve una foto del pannello). Il velo dell'EPG è un oggetto molto grande (6400×3400), quasi tutto fuori schermo.
- **EPG in movimento**: circa 111 oggetti visibili e circa 441 creati; tempo di fotogramma durante lo scorrimento.
- **"Loading…" nell'EPG**: non raggiungibile in preview (il servizio finto risponde subito); coperto solo dai test.
- **"No programme information" nel Banner**: i dati di esempio non lo producono.
- **Banner nascosto dall'osd 123**: scatta al primo tasto letto, non all'apertura del pad.

## Cose note, non fatte
- `app/service/tuner-page.js` (l'anteprima del tuner nella dashboard) ricopia a mano il layout vecchio della guida: è da aggiornare.
- Il suggerimento "Back" sotto Sources (testo bianco con ombra) si legge male su sfondo chiaro, come prima.
- Il moto ridotto: `--no-motion` e la feature `motion` esistono nel tuner, ma la dashboard non li espone e il servizio non passa il flag.
- `design/tv-system.html`, `tv-screens.js` e le pagine di confronto vecchie disegnano ancora la lastra ritirata.

## Allineamento e pesi sulla TV (seconda installazione sulla Q80A, 2026-11-11)
La prima installazione era fluida, ma numero e titolo non erano allineati come nel mock, e tutti i pesi sembravano uguali. Le cause, misurate sugli screenshot veri:
- **Pesi**: i nomi "SamsungOneUI 200,Sans" (tuner e Dock) arrivano a fontconfig, tramite Evas 1.25, come un'unica famiglia che non esiste, quindi tutto veniva disegnato in SamsungOneUI 400. Ora si usa un solo nome per font: `tuner/src/Core/TextMetrics.cs`, e nel Dock `Dock.cs`, `NumberPad.cs`, `TaskPanel.cs`, `VolumePill.cs`.
- **Linee di base**: Evas mette la base a y + ascesa massima, presa da `head.yMax` (1047), non da hhea (952); in più l'ombra morbida sposta le lettere di 1 px a destra e in basso. Il numero a 128 px cadeva 13 px sotto, il titolo a 32 px 3 px sotto. Ora `TextMetrics` usa le metriche di Evas, e `Theme.MoveHalo` compensa il margine dell'ombra.
- **Channel list, Channel pad e toast**: al posto degli scarti misurati a mano, il centro dell'altezza delle maiuscole (724/1024) va al centro della riga, del tasto o della capsula.
- **Prima / dopo**, linee di base rispetto al mock:
  - numero del Banner 930 → 917 (mock 916,6);
  - titolo del Banner 920 → 917 (916,6);
  - orari 972 → 968 (967,6);
  - titolo di Info 741 → 733 (731,8);
  - ora di Info 858 → 850 (849);
  - data 904 → 900 (899,6);
  - EPG: titolo 124 (123,1), asse 312 (311,6), nome della riga 412 (411,6).
  Tutto entro 1 px, tranne il titolo di Info (1,2 px).
- **Test**: `tests/TextMetricsTests.cs`, con le 9 misure della TV come regressione. Tuner `ok: 252 checks`.
- **Preview**: ora disegna come la TV (ascesa da `head`, margine dell'ombra, nome con virgola = 400). Prima mostrava i testi circa 0,09 × corpo più in alto, e pesi che la TV non disegnava.
- **Da misurare**: alla prima apertura della guida, a 0,5 s il volo Banner→EPG era ancora in corso sulla TV (la costruzione della guida ritarda l'inizio); il Dock con i pesi veri (500/600) non è stato guardato sulla TV.
