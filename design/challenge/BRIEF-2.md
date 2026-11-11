# Sfida di design, secondo round: variante radicale per Sol

Leggi PRIMA `BRIEF.md` (stessa cartella): resta valido in tutto (obiettivo, tre schermate Banner/Info/EPG, dati e loghi, dove prendere i componenti, consegne, divieti,
nessuna funzione nuova). Questo file lo **modifica** così:

## Cosa cambia
- Il tuo primo tentativo è in `design/challenge/sol/` (e quelli degli altri in `opus/`, `deepseek/`, se esistono). **Non ripeterlo.** Puoi guardarlo (anche solo i PNG) per sapere
  cosa NON rifare: stesso impianto, stessa composizione, stessi pannelli a scheda stondata = scartato. Il proprietario vuole **una cosa diversa**, più innovativa.
- **Pensa da zero ai singoli elementi** (senza aggiungere funzioni né dati): come si presenta il numero di canale, il logo, il nome, il programma in onda e il prossimo, il progresso,
  l'orario, la descrizione, le tracce audio/lingue, la griglia dell'EPG, il fuoco. Libero di cambiare gerarchia, griglia, scala, allineamento, direzione di lettura, ritmo, densità,
  posizione sullo schermo, perfino quanto del video resta libero. Idee (non obblighi): tipografia grande e protagonista, composizione a bordo schermo invece di una scheda
  centrata, fasce piene o filetti sottili al posto di riquadri, griglie senza celle chiuse con solo linee e riempimenti piatti, evidenza del fuoco con una barra o un'inversione
  invece di un anello arrotondato, informazioni in colonne allineate su una base comune, progresso come linea sottile, orari come asse.
- **Se vuoi, niente box stondati**: angoli vivi, rettangoli piatti, linee, tipografia e spazio negativo. Puoi usare o no i raggi: la regola è che il risultato sia chiaramente
  un'altra famiglia visiva rispetto al tentativo precedente, ma ancora riconoscibile come Vetro (token, Fumé, ghiaccio, font SamsungOneUI, 80% neutro, blu per selezione).
  Se ti scosti da un valore dei token (es. raggio 0 invece di 16) definisci una variabile locale con un commento e spiega nel NOTE.md perché.

## Compatibilità EFL (ora è un vincolo duro, non un "meglio se")
Il tuner vero è nativo Tizen/EFL e disegna solo con: rettangoli pieni (colore + alpha), immagini PNG (anche 9-slice), testo (un font, una dimensione per oggetto, ombra morbida
precotta), clip rettangolare, spostamento/ridimensionamento/alpha animati in modo lineare, timer. NON usare nel mock niente che non sia riproducibile così:
nessun `backdrop-filter`/blur, `filter`, `mix-blend-mode`, `mask`, `clip-path` non rettangolare, gradienti animati, `box-shadow` multipli o enormi (un'ombra = un'immagine
precotta: se la vuoi, usa un gradiente di sfondo statico su un rettangolo, descritto nel NOTE come "immagine da cuocere"), testo con effetti, rotazioni, scale non lineari,
`text-overflow` elaborati (il nativo tronca a mano), animazioni con `cubic-bezier` (usa `linear`), transizioni su più di ~20 oggetti insieme.
Gradienti **statici** su un rettangolo sono ammessi solo se li dichiari come "immagine da cuocere" (una PNG di cui dai le dimensioni). Preferisci piatto e alpha.
Ogni oggetto del mock deve poter diventare un `evas_object` semplice. Nel NOTE.md metti una tabella: per ogni schermata, quanti oggetti (rect/immagini/testi) e quali animazioni.

## Consegna
Nella cartella `design/challenge/sol2/` (l'unica in cui puoi scrivere): `index.html` (con le stesse schede/tasti `1` `2` `3`, sfondi, selettore canale, EPG navigabile),
`NOTE.md` (max 45 righe, italiano: cosa hai ripensato elemento per elemento, perché è diverso dal primo tentativo, token usati/nuovi, tabella oggetti EFL, limiti onesti),
`banner.png`, `info.png`, `epg.png` (1920x1080, controllati a occhio da te prima di consegnare). Niente file di lavoro sparsi: se hai script di build/verifica mettili in `sol2/_work/`.
Niente git; nulla fuori da `sol2/`.
