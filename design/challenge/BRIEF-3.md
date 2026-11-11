# Sfida di design, terzo round: senza limiti EFL

Leggi PRIMA `BRIEF.md` (stessa cartella): resta valido (obiettivo, tre schermate Banner/Info/EPG, dati di esempio e loghi, dove prendere i componenti, consegne, divieti).
**Ignora** `BRIEF-2.md` e il suo vincolo EFL: in questo round il vincolo è tolto.

## La domanda
*Cosa faresti se non avessi i limiti di EFL?* Immagina Banner, Info ed EPG per una TV con un motore grafico moderno (come il web di oggi, un'app di streaming di fascia alta,
un sistema operativo recente): blur e vetro smerigliato sul video, trasparenze sovrapposte, gradienti, maschere, filtri, ombre vere, tipografia variabile, curve di easing, movimento
coreografato, transizioni fluide tra le tre schermate (ad esempio il Banner che diventa Info che diventa EPG), profondità, parallasse leggero, colore estratto dal video, ecc.
Pensa a quello che farebbe davvero la differenza per chi guarda a 3 metri, non a effetti gratuiti. Qualità e gusto contano più della quantità di effetti.

## Vincoli che restano
- **Nessuna funzione nuova della TV.** Stessi dati, stesse informazioni, stesse azioni di oggi (vedi `BRIEF.md` e il codice in `tuner/src`). Cambia solo come le cose si presentano e si muovono.
  Non inventare campi, pulsanti, pagine, gesti, suggerimenti, raccomandazioni, anteprime video, ricerca o altro che il tuner non ha.
- **Resta Vetro, ma i token si possono evolvere.** `design/tokens.css` è il punto di partenza (palette, Fumé, ghiaccio, blu per la selezione, font SamsungOneUI, 80% neutro, regole di `DESIGN.md`)
  e **in questo round puoi iterarci sopra**: ritoccare valori (colori, raggi, alpha, scala tipografica, durate, ombre), aggiungerne di nuovi, proporre una famiglia diversa per il blocco `--vetro-tv-*`.
  Ogni modifica va in un blocco `:root` in cima al tuo file, con un commento (cosa cambia, perché, token originale). Nel NOTE.md una tabella "token originali → token proposti" che io possa
  riportare in `tokens.css` se la direzione piace. L'identità deve restare riconoscibile come Vetro (la famiglia blu/ghiaccio/Fumé, il carattere sobrio): evolvere, non sostituire. Leggibilità a 3 metri su sfondi diversi (almeno 3: scuro, chiaro, scena colorata).
- Gli stati restano fedeli (in onda con progresso, prossimo, canale senza logo, radio, nome lungo, dati assenti). Rispetta `prefers-reduced-motion`.
- Loghi: dall'URL come nel brief base, con fallback; mai archiviati.

## Cosa NON serve
La compatibilità con EFL e la tabella degli oggetti. Nel NOTE.md, invece, una sezione onesta "Cosa servirebbe per averlo davvero sulla TV": quali effetti richiedono un compositore/GPU
diverso, quali si potrebbero approssimare in EFL (e come), quali sono impossibili sul Q80A. Non è un giudizio sul tuo lavoro: serve a scegliere cosa portare.

## Il tentativo precedente
I tuoi round 1 e 2 sono nelle cartelle `<nome>/` e `<nome>2/`: **non ripeterli**. Il proprietario vuole una terza idea, visibilmente diversa da entrambe e ambiziosa.

## Consegna
Solo nella tua cartella `<nome>3/`: `index.html` (autosufficiente, stesse schede/tasti `1` `2` `3`, sfondi, selettore canale, EPG navigabile con le frecce, e le transizioni tra le schermate),
`NOTE.md` (max 45 righe, italiano: idea, scelte elemento per elemento, token usati/nuovi, sezione sulla realizzabilità, limiti onesti), `banner.png`, `info.png`, `epg.png` (1920x1080,
controllati da te a occhio) e, se utile, una breve registrazione o sequenza di fotogrammi `transizione-*.png` per mostrare il movimento. Script di lavoro in `_work/`. Niente git; nulla fuori dalla tua cartella.
