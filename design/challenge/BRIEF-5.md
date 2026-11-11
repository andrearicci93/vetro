# Opus 3 "Velo", versione realizzabile davvero su EFL: `opus3-real`

Il proprietario preferisce **opus3** (cartella `design/challenge/opus3/`, leggi `NOTE.md`, `index.html`, gli screenshot e i fotogrammi `transizione-*.png`) e vuole una versione
**che si possa davvero costruire sul tuner nativo** (EFL su Tizen, TV Samsung Q80A), tenendo l'idea e il carattere. Parti da opus3, non da zero: rifinisci e rendi portabile.
Tutto il resto del repo è in sola lettura; scrivi solo in `design/challenge/opus3-real/` (script in `_work/`). Niente git. Non toccare file di configurazione di strumenti.

## Cosa tenere (l'anima di opus3)
Un solo materiale "velo" che sale dal basso; Banner = velo basso, Info = stessa cosa più alta, EPG = velo pieno; numero grande leggero; titolo eroe; linea di progresso con testina;
orari agli estremi e "N min left" che segue la testina; transizioni che sembrano un solo gesto (gli elementi condivisi vanno al loro posto nuovo); logo tondo a destra, spazio vuoto se manca;
EPG a corsie con fuoco sollevato; stessi dati e stesse funzioni (nessuna funzione nuova: vedi `tuner/src` e BRIEF-4.md per l'elenco di cosa esiste). Puoi continuare a evolvere i token di Vetro.

## Cosa NON è disponibile sul TV (da eliminare dal mock, non da "approssimare a parole")
- **Nessun blur, saturazione o scurimento del video**: il video è un piano hardware sotto la finestra trasparente. Non si può sfocare, né leggere per campionarne il colore.
  → Il velo è **un'immagine cotta** (PNG, gradiente verticale statico con alpha, anche 9-slice/stirata) disegnata sopra il video. Un solo set di densità fisse, scelto una volta (non per quadro): deve restare
  leggibile su scuro, chiaro, e scena colorata/satura. Verifica sui tre sfondi del mock con la **tinta ambientale spenta**. Se serve più contrasto sui quadri chiari, usa un velo un po' più denso, o un'ombra del testo cotta, non un effetto sul video.
- **Il video non "recede"** (niente scala 1,07 / scurimento del video dietro l'EPG): sostituiscilo con un velo più denso (alpha) e basta.
- **Niente maschere** (ai bordi della griglia usa un taglio con clip rettangolare e, se vuoi, due piccole immagini di sfumatura cotte), **niente `backdrop-filter`, `filter`, `mix-blend-mode`, `clip-path`
  non rettangolare, gradienti animati, luccichii, curve cubic-bezier per frame**. Animazioni: spostamento, ridimensionamento e alpha **lineari** (o a passi), più `evas_map` per zoom/rotazione semplice
  di un oggetto; durate 0,2-0,4 s. Se vuoi un "ease", approssimalo con 2-3 segmenti lineari e dichiaralo.
- **Un testo ha un solo font, una sola dimensione e un solo colore**; nel nativo un cambio di peso o di dimensione dentro lo stesso oggetto non esiste. Lo "scambio" di elementi tra le schermate lo fai con
  **dissolvenza incrociata** (il vecchio testo sfuma, il nuovo entra già al suo posto) o con `evas_map` su un oggetto solo (spostamento + scala uniforme), non con un testo ridisegnato a ogni fotogramma.
- **Pesi del font**: i file `SamsungOneUI-*.ttf` che il TV ha davvero sono quelli che trovi nel dump (`dump/rootfs`, cerca `SamsungOneUI*`). Usa **solo i pesi realmente presenti** sul TV: se il 200 non c'è, scegli un
  peso che c'è e dillo. Niente grassetto o corsivo sintetici.
- **Ombre vere**: un'ombra è un'immagine cotta (`shadow.png`, 9-slice). Non box-shadow multipli.

## Come costruire il mock (così è portabile per costruzione)
Disegna ogni schermata come **lista di primitive** in stile `tuner/src/Core/GuideScene.cs` (`Prim`: Sheet/velo, Fill = rettangolo pieno con alpha, Ring, Text, Key, Logo; posizione, dimensioni, alpha,
dimensione del testo, larghezza massima, righe). Nel mock HTML ogni primitiva è **un solo elemento** (un `div` piatto con colore e alpha, un `img`, un testo senza effetti), senza nient'altro: niente
pseudo-elementi decorativi, niente CSS non banale. Così il numero di oggetti nel mock è il numero di `evas_object` sul TV. Mostra un contatore degli oggetti per schermata (overlay attivabile con un tasto).
- **Budget oggetti**: non più oggetti di oggi. Riferimento: `GuideScene` ha tetti di 140 fill, 260 testi, 7 loghi, 7 tasti nell'EPG; Banner e Info sono molto più piccoli. Meno è meglio: l'EPG di opus3 ne ha ~400 e va
  ridotto in modo netto (meno celle con testo, testi più corti, un solo livello di corsie, niente separatori ripetuti: usa pochi rettangoli lunghi). Dichiara i numeri per schermata (rect / immagini / testi / animati insieme).
- **Immagini da cuocere** (velo, ombra, sfumature, tratteggio "No information", pastiglia del fuoco): per ognuna dai nome file, dimensioni in pixel e se è 9-slice. Genera davvero quelle PNG in `opus3-real/assets/` (puoi usare
  uno script in `_work/`, che le disegna con canvas/PIL) e usale nel mock, così quello che vedi è quello che il TV avrebbe.

## Cosa deve restare riconoscibile e fedele
Leggibilità a 3 metri (testo di lettura ≥ 26 px, secondario ≥ 22 px, zona sicura ~5%), fuoco inequivocabile, i tre sfondi, stati (programma in onda con progresso, "No programme information", dati non ancora letti,
radio sul nero, nome lungo, canale senza logo, descrizione tagliata a 3/2 righe), reduced-motion, loghi dall'URL con fallback, dati e canali di `preview/host/tuner/TvsClient.Sim.cs` e `preview/fixtures/gallery.tsv`
(come in opus3). I tasti Banner/Info/EPG `1` `2` `3`, CH±, EPG navigabile, selettore sfondo e stato restano.

## Consegna
`index.html` (autosufficiente), `NOTE.md` (max 45 righe, italiano) con: cosa hai tolto o sostituito rispetto a opus3 e come (elenco "effetto web → soluzione EFL"); tabella oggetti per schermata (rect / immagini / testi /
animati); elenco delle PNG da cuocere (nome, px, 9-slice); animazioni (oggetto, proprietà, durata, linearità); pesi di font usati e verificati; cosa è ancora a rischio sul Q80A e come lo misureresti; confronto
onesto con opus3 (cosa si è perso). `banner.png`, `info.png`, `epg.png` (1920x1080, controllati a occhio) e, per il movimento, 3-4 fotogrammi `transizione-*.png`. Non terminare finché questi file non esistono.
