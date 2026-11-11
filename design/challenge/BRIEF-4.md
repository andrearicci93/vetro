# Sfida di design, quarto round: foglio bianco, solo funzioni e contenuti

Questo round **sostituisce** i brief precedenti: non leggere BRIEF.md, BRIEF-2.md, BRIEF-3.md e non guardare i tuoi round passati né quelli degli altri.
Parti da zero, come se fossi un art director a cui si consegna solo un elenco di cosa la schermata deve fare e mostrare.

## Il compito
Progetta in HTML **tre schermate di una TV in diretta**: **Banner** (compare al cambio canale), **Info** (scheda con le informazioni sul programma, aperta dal tasto Info) ed **EPG**
(la guida TV). Schermo 1920 x 1080, visto da circa 3 metri, controllato solo con un telecomando.

- **Nessun design system da rispettare.** Non esistono token, colori, font, raggi o materiali di partenza: scegli tu l'identità visiva, la palette, la tipografia, il linguaggio
  (piatto, vetro, editoriale, brutalista, cinematografico, quello che vuoi). Non leggere `design/tokens.css` né `design/DESIGN.md`. Dai un nome alla tua idea.
- **Nessuna funzione extra.** Sotto c'è l'elenco completo di cosa esiste. Non aggiungere dati, azioni, pulsanti, pagine, suggerimenti, raccomandazioni, ricerca, anteprime video,
  preferiti, ecc. Puoi rimuovere, raggruppare, ridimensionare, spostare, rinominare l'etichetta, cambiare la gerarchia e il modo di muoversi. Il testo mostrato è in inglese.
- **Approccio creativo**, non la solita scheda stondata con ombra. Osa sulla composizione, sulla scala, sul ritmo, sul movimento, su come si mette in evidenza il fuoco. Ma...
- **...rispettando i limiti di una 10-foot UI** (obbligatori, sono il vero vincolo di design):
  - leggibilità a 3 metri: testo di lettura mai sotto ~26 px a 1080p, etichette secondarie mai sotto ~22 px, niente peso sottile su sfondo video, contrasto forte (verifica su almeno 3 sfondi:
    scuro, chiaro/acceso, scena colorata, generati con gradienti CSS; il video sta sempre dietro, a tutto schermo);
  - zona sicura: nessun elemento importante a meno di ~5% dal bordo (circa 96 px laterali, 54 px sopra e sotto);
  - solo tasti direzionali + OK + Back + CH+/CH-: nessun puntatore, nessun hover, nessuno scroll a ruota, nessun testo da digitare; il fuoco deve essere inequivocabile in ogni momento
    (si capisce a colpo d'occhio dove si è, da 3 metri), una sola cosa ha il fuoco;
  - densità bassa: poche cose per volta, bersagli grandi, niente dettagli sottili; le informazioni secondarie possono essere rese a un livello gerarchico basso ma devono restare leggibili;
  - tempo: Banner e Info spariscono da soli (Banner dopo ~4 s, Info dopo ~10 s), quindi il contenuto deve leggersi in un'occhiata, senza bisogno di azioni;
  - il video non va coperto più del necessario; il movimento è funzionale (indica dove si è e cosa cambia), breve (0,2-0,4 s), non decorativo, rispetta `prefers-reduced-motion`;
  - evita il burn-in: niente elementi chiari fissi enormi.
  Ti è permesso qualunque effetto che un browser moderno sa fare (blur, gradienti, maschere, ecc.), ma ogni effetto deve servire la leggibilità o l'orientamento, non la decorazione.

## Cosa deve fare e cosa si deve vedere (l'elenco completo; è tutto qui)

### Banner (al cambio canale, sparisce dopo ~4 s)
- Numero del canale e nome del canale; logo del canale se esiste (se non esiste lo spazio non si riempie con altro).
- Il programma in onda ora: titolo, ora di inizio e di fine, minuti che mancano, avanzamento come barra/progresso.
- Se il canale non ha informazioni (per esempio una radio): al posto del programma la scritta "No programme information".
- Mentre le informazioni non sono ancora arrivate le righe del programma restano vuote (poi si riempiono): il banner deve reggere questo stato.

### Info (scheda aperta dal tasto Info, sparisce dopo ~10 s o con qualsiasi tasto)
- Numero e nome del canale, logo se c'è.
- Il programma in onda: titolo, orario di inizio-fine, minuti che mancano, avanzamento.
- Descrizione del programma, fino a 3 righe (poi tagliata con "…"); può non esserci ancora (poi arriva).
- Ora attuale e data (esempio "Sunday 8 November"), fonte del sintonizzatore (Antenna / Cable / Satellite), traccia audio in uso (es. "Italian", oppure "Italian · track 2").
- Non esistono e non vanno aggiunti: risoluzione, formato audio, sottotitoli, televideo, genere.
- Se non c'è programma: "No programme information".

### EPG (la guida TV)
- Griglia: righe = canali (numero, nome, logo se c'è), colonne = tempo. Finestra visibile 180 minuti, scorre indietro/avanti nel tempo, orizzonte 72 ore. Asse con gli orari (ogni 30 min).
- Ogni programma è una cella lunga quanto dura: titolo e orario di inizio-fine (se la cella è abbastanza larga; sempre più corta = solo titolo o niente). Distinguere: programma in onda adesso
  (con l'ora attuale marcata), programma qualsiasi, nessuna informazione ("No information"), informazioni in arrivo ("Loading…").
- Sette righe di canali visibili circa; su e giù cambiano canale (con scorrimento delle righe), sinistra/destra cambiano programma/tempo, i tasti CH+/CH- cambiano pagina.
- Un solo programma ha il fuoco. Per quel programma si mostra in evidenza: titolo, orario inizio-fine, durata in minuti, nome del canale, descrizione (2 righe, se già letta), e la data del momento
  a cui si è (es. "Sun 8 Nov").
- Suggerimenti dei tasti, sempre visibili: OK = Watch (guarda il canale), Left/Right = Time, Up/Down = Channel, CH = Page, Back = Close. Le immagini dei tasti del telecomando sono in
  `design/assets/tuner/key_*.png` (ok, left, right, up, down, ch, back): usale oppure disegna tu i simboli.
- OK sul programma guarda quel canale. Back chiude la guida.

### Comportamento comune
- Su ognuna delle tre schermate: CH+ / CH- cambiano canale; mostra l'effetto sul Banner/Info.
- Canale senza logo: lo spazio del logo resta vuoto in modo che nomi e numeri restano allineati agli altri (nessun logo inventato).
- Canale radio: nessun video (sfondo scuro), ha comunque nome, numero e (può non avere) programma.
- Nome di canale lungo: va gestito (a capo o taglio con "…").

## Dati di esempio (usa questi)
- **Canali e programmi**: i 16 canali di `preview/host/tuner/TvsClient.Sim.cs` (Rai 1, Rai Sport HD, La 5 HD, Iris HD, Giallo, Canale Italia 83, Radio Italia TV HD, TV8, Virgin Radio,
  Lombardia TV, Italia 159, 20, SuperTV, Tesory Channel, Cielo, TeleBoario; titoli nella riga `Shows`; guida di 72 h generata da quel file: riproducine la logica; descrizioni di programma
  inventale brevi, in inglese). Virgin Radio e Radio Italia TV sono radio.
- **Loghi dei canali**: in `preview/fixtures/gallery.tsv` (tab: id, nome, URL, liste DVB). Colonna 3 = URL con `%02d`: sostituiscilo con `89`
  (`https://round-logo.samsungnyc.com/round?idx=89&url=...`): PNG tondo 87x87. Cerca per NOME canale (esatto, senza maiuscole). Se il canale non è nella tabella non ha logo (comportamento reale: mai
  indovinare). Carica il logo **dall'URL**, con un `onerror` che lascia lo spazio vuoto o mette un segnaposto neutro; **non scaricare né copiare** i PNG sul disco.
- Il logo del canale arriva già tondo con il proprio sfondo: trattalo come un'immagine opaca di cui non decidi i colori.

## Consegna
Solo nella tua cartella `<nome>4/` (sola scrittura; il resto del repo in sola lettura; niente git; niente rete oltre ai loghi):
- `index.html` autosufficiente (CSS e JS inline, nessun CDN indispensabile): palco 1920x1080 scalato alla finestra, tasti/schede `1` `2` `3` (Banner · Info · EPG), selettore sfondo (almeno 3),
  frecce su/giù per CH+/CH- su Banner e Info, EPG navigabile con le frecce (come descritto), animazioni di ingresso/uscita sobrie. Usa un font a tua scelta (di sistema o incorporato nella cartella).
- `NOTE.md` (max 35 righe, italiano): il concetto in 3 righe, come hai trattato ogni requisito 10-foot (con numeri: dimensioni minime del testo, margini, contrasto), che cosa hai rinunciato e perché,
  limiti onesti.
- `banner.png`, `info.png`, `epg.png` (1920x1080, con almeno un canale con logo e uno senza; controllali a occhio e correggi prima di consegnare).
Metodo: esplora poco (solo i due file dei dati di esempio qui sopra e le immagini dei tasti), scrivi presto una prima versione completa, verificala con Chrome headless (`preview/shot.sh` oppure
`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --window-size=1920,1080 --screenshot=...`), poi rifinisci. Non terminare finché index.html, NOTE.md e i tre PNG non esistono.
