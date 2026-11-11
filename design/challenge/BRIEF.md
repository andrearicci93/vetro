# Sfida di design: Banner, Info ed EPG del tuner Vetro, in versione nuova

Tre modelli ricevono questo stesso brief e lavorano da soli. Alla fine il proprietario guarda i tre risultati e sceglie il migliore.
Rispondi e scrivi i commenti in italiano; il testo MOSTRATO nelle schermate resta in inglese (come l'interfaccia vera).

## Obiettivo
Fare **un unico mock HTML** (`index.html`, autosufficiente: CSS e JS inline, nessun build, nessun framework da installare) che mostra tre schermate del tuner di Vetro,
la TV Samsung Q80A (1920 x 1080):

1. **Banner**: il riquadro che compare quando cambia canale.
2. **Info**: la scheda in alto con le informazioni sul programma.
3. **EPG**: la guida TV (griglia canali x tempo).

Il design attuale è buono e coerente col resto di Vetro, ma si può fare qualcosa di **più moderno**. Proponi una **implementazione nuova** del modo di presentare
queste tre schermate: gerarchia, composizione, tipografia, uso di spazio, materiali, ritmo, movimento. Osa, ma resta dentro i vincoli.

## Vincoli (importanti: è una sfida di *presentazione*)
- **Nessuna funzione nuova.** Stessi dati, stesse informazioni, stesse azioni di oggi. Non inventare campi, pulsanti, pagine, gesti o dati che il tuner non ha.
  Quello che oggi è mostrato lo puoi riorganizzare, ridimensionare, raggruppare diversamente o rendere più leggibile; quello che oggi non esiste non lo aggiungi.
  Se togli qualcosa, deve restare raggiungibile/equivalente. Per sapere cosa mostra ogni schermata oggi leggi il codice vero (vedi sotto), non andare a intuito.
- **Design token di Vetro.** Parti da `design/tokens.css` (usa i `--vetro-*` e soprattutto il blocco `--vetro-tv-*`: foglio Fumé `--vetro-tv-sheet`, raggi, bordi, ombre,
  alpha del testo e dei riempimenti, anello di fuoco `--vetro-tv-ring-*`, `--vetro-tv-light` per progresso/indicatori, scala tipografica `--vetro-tv-type-*`, font `--vetro-tv-font`).
  Importa/incolla il file, non reinventare i valori. Se ti serve un valore nuovo, definiscilo come variabile locale in cima al tuo file con un commento che spiega perché
  (e quale token esistente ci si avvicina di più). Palette: il 80% resta neutro, il blu segna selezione/azione, niente bordi superiori colorati su card arrotondate,
  niente decorazioni gratuite. Leggi `design/DESIGN.md` per le regole complete (in particolare la parte TV e la regola dei loghi).
- **Realizzabile sulla TV.** Il tuner vero è nativo (EFL su Tizen): immagini, rettangoli con angoli arrotondati (9-slice), testo, ombre pre-cotte, animazioni lineari semplici.
  Evita ciò che il nativo non fa o fa male: `backdrop-filter`/blur sul video, mask complesse, filtri CSS, gradienti animati, molte trasparenze sovrapposte. Il riferimento
  prestazionale è "performance-first". Una cosa bella ma impossibile da portare nel nativo conta meno di una cosa un po' più sobria ma portabile.
- **Sfondo = video.** Le schermate stanno sopra l'immagine del canale in onda: mostrale su uno sfondo scuro/foto-simile che cambi (almeno 3 sfondi: scuro, chiaro/acceso, scena
  colorata) per dimostrare leggibilità. Gli sfondi li generi tu con CSS (gradienti), non scaricare foto.
- **Stato mostrato in modo fedele**: stessa logica degli stati di oggi (programma in onda con progresso, prossimo programma, canale senza logo, ecc.).

## Dove prendere i componenti (tutto in <repo>)
Leggi in questo ordine:
1. `design/DESIGN.md` e `design/tokens.css`: regole e valori. `design/README.md`: cosa c'è nella cartella.
2. **Come sono oggi, in HTML** (mock già fedeli al codice): `design/tuner.html` (Banner, Channel list, Channel pad, Audio toast; si aprono con `?view=list|pad|toast`),
   `design/epg.html` (EPG; `?ch=N`), `design/tv-common.css` e `design/tv-common.js` (palco 1920x1080, tasti, helper). Aprili in un browser e guardali.
   Per vedere Info guarda `design/index.html` e gli screenshot qui sotto.
3. **Come sono oggi, nel codice vero**: `tuner/src/Ui/Views.cs` (Banner, liste, pad), `tuner/src/Ui/InfoView.cs` + `tuner/src/Core/InfoPanel.cs` (Info),
   `tuner/src/Ui/GuideView.cs` + `tuner/src/Core/GuideScene.cs`, `GuideGrid.cs`, `GuideText.cs`, `ProgramClock.cs` (EPG), `tuner/src/Ui/Surface.cs` (materiali), `tuner/README.md`.
   Qui scopri quali dati ha ogni schermata (numero, nome, logo, titolo, orari, durata, progresso, descrizione, audio/lingue, ecc.): sono gli unici che puoi usare.
4. **Screenshot dello stato attuale** (guardali con lo strumento di lettura immagini): `preview/run/logo-banner.png`, `logo-info.png`, `logo-guide.png`, `logo-list.png`, `logo-pad.png`
   (la versione più recente, con i loghi), e `preview/run/cmp-tuner.png`, `cmp-tuner-info.png`, `cmp-tuner-guide.png`. Il preview vivo è descritto in `preview/README.md`
   (non serve avviarlo; se vuoi un'immagine di una tua pagina usa `preview/shot.sh <url> <out.png>`, Chrome headless, o lo strumento di preview che hai).
5. **Icone e immagini dei tasti** (assets nostri, si possono usare e copiare accanto al tuo file): `design/assets/tuner/` (`key_*.png`, `ring.png`, `solid.png`, `shadow.png`,
   `dock_bg.png`) e `design/assets/dock/` (icone input `in-*.png`, `livetv.png`, ecc.), `design/assets/samsung/` (barra canale Samsung). Font TV: `SamsungOneUI` è nello
   storage della TV (dump in `dump/rootfs`; cerca `SamsungOneUI*` con `find`); se lo usi copialo accanto al tuo file, altrimenti il fallback di `--vetro-tv-font` va bene.

## Dati di esempio (usa questi, non inventare un'altra lista)
- **Canali e programmi di esempio**: i 16 canali del preview, in `preview/host/tuner/TvsClient.Sim.cs` (nomi: Rai 1, Rai Sport HD, La 5 HD, Iris HD, Giallo, Canale Italia 83,
  Radio Italia TV HD, TV8, Virgin Radio, Lombardia TV, Italia 159, 20, SuperTV, Tesory Channel, Cielo, TeleBoario; titoli di programma nella stessa riga `Shows`; la guida è generata
  da quel file: leggi come, e riproduci una griglia plausibile di 72 h con la stessa logica, 180 minuti di finestra visibile). Radio senza video e canali senza logo esistono: mostrali.
- **Loghi dei canali TV**: sono i loghi che la TV Samsung mostra davvero. L'elenco dei canali di esempio con l'indirizzo di ogni logo è in
  **`preview/fixtures/gallery.tsv`** (tab-separato: id, nome canale, URL, poi liste DVB). La colonna 3 è l'URL pubblico del logo con un segnaposto `%02d`: sostituiscilo con `89`
  (es. `https://round-logo.samsungnyc.com/round?idx=89&url=http://...`): è il PNG tondo 87x87 della TV. **Cerca il logo per NOME CANALE** nella colonna 2 (corrispondenza esatta o
  case-insensitive, es. "VIRGIN RADIO" = "Virgin Radio"); se un canale non è nella tabella, **non ha logo** (comportamento reale, la colonna resta vuota, mai indovinare dal nome).
  Come funziona e cosa fa il tuner coi loghi: `design/DESIGN.md` (riga "Channel logos"), `tuner/src/Core/ChannelLogos.cs`, `tuner/src/Tvs/LogoSource.cs`.
  **Regola**: carica i loghi **dall'URL** (`<img src="https://round-logo.samsungnyc.com/round?idx=89&url=...">`) con un fallback `onerror` (disco con le iniziali). **Non scaricarli e non
  copiarli** in `design/assets/`, `tuner/res/` o nel repo: sono materiale Samsung/Gracenote che non va archiviato. Imbarca nel JS solo gli URL che ti servono (copiali dal TSV).
  Il disco con le iniziali è lo stand-in già usato in `design/tuner.html` (`setLogo`/`.logo`).

## Cosa consegnare
Tutto nella TUA cartella (indicata in fondo), niente fuori:
- `index.html`: la pagina. Palco 1920x1080 scalato alla finestra, tre schede/tasti in alto fuori dal palco (Banner · Info · EPG) più i tasti `1` `2` `3` della tastiera, un selettore
  di sfondo, un selettore canale (frecce su/giù per il canale come CH+/CH-; Banner e Info si aggiornano, EPG sposta il fuoco). Le animazioni d'ingresso/uscita dei pannelli devono
  esserci ma sobrie (lineari, 0,2-0,3 s, come il resto di Vetro; rispetta `prefers-reduced-motion`).
- Per l'EPG: navigazione con le frecce nella griglia (focus su un programma, scroll per riga e nel tempo), il pannello del programma selezionato come nel design attuale.
- `NOTE.md` (max 40 righe, italiano): cosa hai cambiato rispetto al design attuale e perché; quali token usi e quali valori nuovi hai definito (e perché); cosa è facile e cosa è difficile
  da portare nel nativo EFL; cosa NON hai toccato. Elenca onestamente cosa non funziona.
- Gli screenshot di verifica `banner.png`, `info.png`, `epg.png` (1920x1080) con almeno un canale con logo e uno senza; controllali tu guardandoli e correggi prima di consegnare.

## Cose da NON fare
- Non modificare nulla fuori dalla tua cartella (né `design/*.html`, né `tuner/`, né `preview/`, né `dock/`, né `app/`): sola lettura per tutto il resto. Niente git (nessun commit, nessun add).
- Non copiare contenuti dalla cartella `wiki/` (è privata). Non toccare la TV né fare richieste di rete se non per caricare i loghi dall'URL pubblico nel browser.
- Niente librerie da CDN indispensabili: la pagina deve aprirsi offline (tranne i loghi, che hanno il fallback).
- Non aggiungere funzioni: se hai dubbi se una cosa esista già, controlla il codice in `tuner/src`.

## Come verrai giudicato
Modernità e qualità visiva · leggibilità a 3 metri su sfondi diversi · fedeltà ai token e alle regole Vetro · nessuna funzione inventata · portabilità sul nativo · cura dei dettagli
(allineamenti, ritmo, stati: in onda, prossimo, senza logo, radio, canale lungo che va a capo) · mock che funziona senza errori in console.
