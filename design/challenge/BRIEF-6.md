# Round 6: rifinire `opus3-real` ed estendere il linguaggio a Dock, tastierino, volume

Parti da `design/challenge/opus3-real/` (leggi `NOTE.md`, `index.html`, gli screenshot, `assets/`, `_work/`) e da `BRIEF-5.md`: **tutti i vincoli EFL di BRIEF-5 restano validi**
(velo come PNG cotta, un elemento HTML = un evas_object, contatore oggetti, animazioni lineari, solo pesi di font realmente presenti, nessun blur/maschera/filtro, nessuna funzione nuova).
Scrivi solo in `design/challenge/opus6/` (copia da opus3-real quello che serve; script in `_work/`). Niente git, non toccare file di configurazione di strumenti. Il resto del repo è in sola lettura.

## Parte A: correzioni richieste dal proprietario (opus3-real gli piace, è "molto elegante")
1. **Banner**: non più a tutta larghezza. Deve essere **compatto, nell'angolo in basso a sinistra** (rispetta la zona sicura ~5%: 96 px laterali, 54 px sopra/sotto). Stessi dati di oggi
   (numero, nome, logo, programma, progresso con orari e "N min left"), stesso carattere (numero grande leggero, linea con testina, velo cotto). Il velo del Banner diventa una **forma contenuta
   nell'angolo** (es. PNG 9-slice o sfumatura radiale/diagonale cotta che si dissolve verso il video), non una fascia. Testi ≥ 26 px (secondari ≥ 22). Gestisci nome lungo, canale senza logo,
   "No programme information", radio sul nero. Occhio che meno spazio = meno oggetti: dichiara il conteggio.
2. **EPG a pieno schermo**: resta com'è (piace). Solo ritocchi necessari per coerenza con il nuovo Banner (la transizione Banner→EPG deve ancora essere un solo gesto: numero e nome atterrano nella loro riga).
3. **Info**: va **riadattata**. Ora che il Banner è piccolo in basso a sinistra, Info non può essere "il Banner che cresce" a tutta larghezza senza sembrare un'altra cosa. Ripensa la composizione
   (mantenendo gli stessi dati: occhiello numero·nome, titolo, linea, descrizione 3 righe, logo, ora, data, sintonizzatore, audio, riempimento in due tempi con "No programme information"). Proponi **una** soluzione
   convincente, es. lo stesso angolo del Banner che si espande verso l'alto e verso destra, oppure un velo laterale a sinistra a tutta altezza. Scegli e motiva in due righe; non coprire più video del necessario.
   Transizione Banner↔Info = un gesto continuo (il Banner si espande, gli elementi condivisi vanno al loro posto).

## Parte B: estendere lo stesso linguaggio agli altri elementi (stessa lingua: stesso velo cotto, stesso numero leggero, stessa linea/testina, stesso anello ghiaccio per il fuoco, gli stessi token evoluti)
Cosa esiste oggi: guarda `design/DESIGN.md`, `design/tv-system.html` e `design/dock.html`, `dock/src` e `app/design-system` (sola lettura) per dati, stati, tasti e dimensioni reali. Nessuna funzione nuova.
- **Dock** (la barra delle app; stati: icone, app a fuoco, app in esecuzione, etichetta; vedi `dock/src`).
- **Task manager** (lista app in esecuzione, Giù sul dock).
- **Volume bar** (il livello + muto).
- **Tastierino**: sia l'**osd 123** del launcher (cifre, Done, palette dei tasti colorati) sia il **Channel pad** del tuner (immissione numero canale, Destra). Se i due sono lo stesso gesto visivo, unificali nello stile; dì cosa hai fatto.
- Se ti avanza tempo: **Channel list** (OK) e **Audio toast**.
Ognuno su sfondo chiaro/scuro/colorato (i tre sfondi del mock) con gli stati veri. Stessa disciplina EFL: primitive piatte, contatore oggetti, PNG cotte (riusa quelle di opus3-real dove possibile, e dichiara le nuove).
Pensa a come stanno **insieme**: Volume e Banner possono comparire insieme in basso; Dock e Banner non devono scontrarsi; lo stesso velo non deve diventare tre materiali diversi.
Sono possibili ritocchi ai token (blocco `:root` commentato in cima a `index.html`, tabella originale→proposto in NOTE).

## Consegna
`index.html` autosufficiente con selettore di schermata (Banner, Info, EPG, Dock, Task manager, Volume, Tastierino 123, Channel pad, + eventuali) e tasti come in opus3-real, contatore oggetti, selettore sfondo/stato.
`NOTE.md` (max 50 righe, italiano): decisione su Banner/Info, tabella oggetti per schermata, PNG nuove (nome, px, 9-slice), cosa è cambiato rispetto a opus3-real, coerenza tra gli elementi, rischi sul Q80A.
Screenshot 1920x1080 controllati a occhio: `banner.png`, `info.png`, `epg.png`, `dock.png`, `taskmanager.png`, `volume.png`, `pad123.png`, `channelpad.png` (+ eventuali), e 3-4 fotogrammi `transizione-*.png`
(Banner→Info, Banner→EPG, e uno con Volume sopra al Banner). Non terminare finché questi file non esistono.
