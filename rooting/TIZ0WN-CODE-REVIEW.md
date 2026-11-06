# tiz0wn: revisione del codice per un backend Vetro

Analisi del 2 novembre 2026. Upstream fissato a [`66d9b6453604cccacafe73c8515301a911756fd3`](https://github.com/sebastianspicker/tiz0wn/tree/66d9b6453604cccacafe73c8515301a911756fd3); confronto con Vetro `release-0.5.0`, commit locale `7dec1ca`. Fonti, licenze e ambito hardware sono approfonditi nel [rapporto sulle evidenze](TIZ0WN-EVIDENCE-REVIEW.md).

## Giudizio

Il progetto rende concreta una via alternativa all'archive-root per una specifica TV, ma non offre un adapter Vetro pronto. Il materiale più riutilizzabile è il principio di esecuzione tramite una shell privilegiata già avviata, con una coda file che evita il percorso spawn del Node Samsung. Il metodo di ingresso Remote PC/CIFS, il trasporto dei comandi, il port dei programmi .NET e la persistenza devono essere valutati separatamente.

Non importerei automaticamente installer, account patch e agent nel pacchetto standard. Proporrei un backend esplicitamente selezionato per un broker già predisposto, autenticato e verificato, conservando l'archive-root esistente come default. Questa è una raccomandazione progettuale: nessun backend è stato implementato durante l'analisi.

## Che cosa fa davvero il codice

La [disclosure](https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/docs/DISCLOSURE.md) traccia il percorso Remote PC → Shared Folder → credenziali SMB → helper CIFS privilegiato → shell UID 0. È necessaria l'interazione con la funzione Remote PC sul dispositivo; non è un exploit lanciabile dal solo servizio Node di Vetro.

Il [builder/serve.py](https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/exploits/tiz0wn-root/builder/serve.py#L90) prepara payload, manifest e uno script di setup servito dal computer. Il [setup](https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/exploits/tiz0wn-root/payload/setup.sh) verifica hash, salva blocchi e scrive direttamente la finestra di uno script del firmware. Installa poi boot hook e agente in storage scrivibile. Un [tool separato](https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/exploits/tiz0wn-root/payload/rootlogin) modifica l'account sdk; questa modifica non è necessaria per il backend Vetro suggerito.

L'[agente](https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/exploits/tiz0wn-root/payload/agent) esamina file `.sh` nella coda, ne legge il contenuto, lo esegue tramite shell e scrive un file risultato. UEP resta attivo nella configurazione Q60T descritta: usare binari firmati e passare script come contenuto permette questa particolare catena, ma non dimostra che qualsiasi host .NET o eseguibile Vetro possa funzionare.

## Problemi che impediscono un'importazione diretta

### 1. Il canale pubblico non autentica Vetro

L'agente imposta `cmd/in` a `0777` e dichiara esplicitamente che qualsiasi processo locale capace di scriverci ottiene esecuzione root. Non verifica HMAC, provenienza, identità del mittente o numero di sequenza. I marker usano il nome del job, non un segreto autenticato. È una scelta deliberata dell'upstream, ma non soddisfa il contratto Vetro di stato e canale autenticati. [agent, righe 11–15, 54–56 e 74–121](https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/exploits/tiz0wn-root/payload/agent#L11).

Un semplice client Node che scrive in questa directory continuerebbe a usare un ingresso root aperto agli altri processi locali; aggiungere un segreto solo al client o al livello HTTP non correggerebbe tale ingresso. Serve un broker privilegiato che verifichi le richieste prima dell'esecuzione, con provisioning del segreto attraverso un canale già fidato e controllo reale dei permessi DAC/SMACK sul TV. La presenza di una directory o di un pidfile non deve bastare per dichiarare `agent.connected=true`.

### 2. Il risultato non corrisponde a execute() di Vetro

L'agente unisce stderr a stdout, scrive il file risultato già all'inizio del job e lo termina con una riga testuale. Non pubblica un risultato completo per rename atomico, non limita i byte catturati, non espone un booleano `timed_out` e usa un timeout globale del worker invece del timeout della singola richiesta. Senza `setsid` termina solo il leader e non garantisce di fermare tutti i discendenti. [agent, righe 74–121](https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/exploits/tiz0wn-root/payload/agent#L74).

Vetro richiede `{exit_code, timed_out, stdout, stderr}`, timeout per comando, limiti di output e nessun retry automatico di un comando dall'esito ignoto. Questi vincoli sono nel [contratto locale](../app/PLATFORM.md) e nell'[implementazione esistente](service/root-agent.js). Una coda alternativa deve rispettarli, non limitarsi a restituire l'intero file come stdout.

### 3. Claim dei job e singola istanza non sono atomici

Il worker controlla il pidfile con `kill -0` e poi scrive il proprio PID. Un PID riutilizzato da un processo estraneo può impedirne l'avvio; due avvii possono superare il controllo prima della scrittura. L'analisi ha riprodotto il primo caso in una directory temporanea con il PID di un processo estraneo ancora vivo. [agent, righe 43–52](https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/exploits/tiz0wn-root/payload/agent#L43).

Il rename `.tmp` → `.sh` è responsabilità del produttore e impedisce unicamente la lettura del file incompleto. Non c'è un claim atomico del consumatore prima dell'esecuzione, né rifiuto esplicito di symlink o validazione proprietario. Il job viene rimosso dopo l'esecuzione: un crash prima della rimozione può lasciarlo disponibile al worker successivo. Un'integrazione deve distinguere richieste nuove, in esecuzione e di esito ignoto, evitando di ripetere automaticamente operazioni di modifica. Questi sono requisiti ulteriori rispetto alla coda distribuita; #95 dichiara già un claim atomico nel proprio port, il cui codice non è presente in questo repository.

### 4. Il boot hook non garantisce il comportamento descritto in tutti i suoi rami

Il controllo `enable` precede l'attesa dello storage che lo contiene: se `/opt` non è pronto, il processo esce prima di attendere. Anche la riga carrier condiziona l'invocazione all'esistenza di quel file: correggere soltanto l'ordine interno del boot hook non basterebbe. Il lock usa tmpfs e, dopo oltre 60 secondi dal marker, può essere rimosso nello stesso boot: non è una garanzia generale di una sola esecuzione per UUID di boot. Il contatore viene ripristinato prima di avviare e verificare l'agente, quindi non misura tre boot con agente realmente sano. [boot, righe 40–80 e 106–123](https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/exploits/tiz0wn-root/payload/boot#L40), [carrier:40](https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/exploits/tiz0wn-root/builder/carrier.py#L40).

Questi limiti non smentiscono il successo riportato sul Q60T. Impediscono però di generalizzare quelle protezioni a firmware con ordine di mount, cleanup temporaneo e startup differenti. La soluzione UUID/storage persistente della #95 va revisionata come contributo distinto.

### 5. La verifica dell'intera finestra è dichiarata, ma non applicata dal setup pubblico

`carrier.py` dichiara il controllo dell'intera finestra di blocchi e definisce `window_sha256()`. Tuttavia il manifest prodotto non contiene un hash atteso della finestra e la funzione non è chiamata dal percorso setup. Il device confronta `head -c CLEN`, cioè i soli byte del carrier, prima e dopo la scrittura; anche la verifica del backup usa quel prefisso. Il codice tenta di preservare la coda del blocco, ma non la confronta con un hash completo atteso dell'immagine. [carrier.py, righe 12–15, 273–295 e 319–322](https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/exploits/tiz0wn-root/builder/carrier.py#L273), [setup, righe 144–195](https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/exploits/tiz0wn-root/payload/setup.sh#L144).

È stato confermato offline che il manifest generato non contiene tale hash. Questo non dimostra una corruzione sul TV dell'autore; dimostra la differenza tra la protezione dichiarata e quella presente nel percorso distribuito. Per un eventuale installer servirebbero verifica completa della finestra e delle sue dimensioni, backup durevole e verificato prima della prima scrittura e controllo completo dopo la scrittura.

### 6. Rollback e account patch non sono pronti per una funzione di ripristino Vetro

Il rollback scrive un blocco per volta controllando l'esistenza di ogni backup immediatamente prima di scriverlo. Non pre-verifica tutti i backup e il loro hash prima della prima scrittura; rileva la mancata corrispondenza soltanto dopo. Un backup corrotto o un blocco successivo assente può quindi essere scoperto dopo aver modificato parte della finestra. [rollback, righe 40–68](https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/exploits/tiz0wn-root/payload/rollback#L40).

In `rootlogin`, passwd può essere già scritto prima della validazione shadow, mentre la copia dei backup in storage persistente arriva dopo; il cleanup elimina la directory di lavoro. Il codice shadow tronca esplicitamente la coda della finestra per inserire la nuova entry. Non è una modifica account neutra o una transazione con ripristino garantito. [rootlogin, righe 50–100 e 110–135](https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/exploits/tiz0wn-root/payload/rootlogin#L50).

Questo è lavoro di ricerca specifico del firmware, da tenere fuori dal backend generico e dalla funzione Remove/Restore di Vetro. La revisione non ha eseguito nessuna scrittura o procedura di rollback.

### 7. Ulteriori controlli dichiarati sono deboli o parziali

- `is_inert()` non verifica davvero che i comandi siano sotto una guardia PS1: il test locale con un comando fuori guardia e un commento contenente PS1 viene accettato. Il percorso `serve.py build-run` non chiama neppure questo controllo. [carrier.py:61](https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/exploits/tiz0wn-root/builder/carrier.py#L61), [serve.py:96](https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/exploits/tiz0wn-root/builder/serve.py#L96).
- Le trasformazioni del corpo vendor controllano il bilanciamento if/fi con euristiche testuali; non equivalgono a una verifica sintattica e semantica di shell per tutti i firmware. Per esempio la rimozione di `local` modifica lo scope delle variabili. [carrier.py:105 e 161](https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/exploits/tiz0wn-root/builder/carrier.py#L161).
- Il setup riscarica/verifica il tar, ma può riutilizzare una directory già estratta verificando solo `patch.bin`, senza ricontrollare `boot`, `agent` e `rollback` estratti. Il pin del tar non garantisce da solo l'integrità di quei file residui. [setup:91–119](https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/exploits/tiz0wn-root/payload/setup.sh#L91).
- L'S6 può registrare “agent did not start” e poi terminare con esito di setup positivo in S8. Per Vetro la salute del backend va verificata con una richiesta autenticata completa. [setup:226–270](https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/exploits/tiz0wn-root/payload/setup.sh#L226).
- `payload/probe` non è interamente di sola lettura: crea/rimuove file di prova, tenta di eseguire script temporanei e offre un reboot opzionale. La diagnostica ordinaria di Vetro non deve invocarlo automaticamente. [probe:36–41 e 64–108](https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/exploits/tiz0wn-root/payload/probe#L36).

## Integrazione consigliata

1. **Selezione esplicita del backend.** Il controllo RSA/Node 10.12 di `prepare()` appartiene all'archive-root; non deve bloccare un backend esterno che usa HMAC e file I/O disponibili su Node 4. Il backend alternativo deve avere uno stato proprio e preservare `start/stop/status/execute/install/setApplicationsEnabled`, indicando le operazioni che non può eseguire.
2. **Broker minimo e autenticato.** Root già acquisito avvia il broker con provisioning fidato, autenticazione delle richieste/risposte, isolamento dei file, contatori anti-replay, ID di sessione/boot, claim atomico, limiti di coda/output e timeout per richiesta. `stop()` deve interrompere il canale Vetro senza danneggiare il bootstrap esterno. Dopo una disconnessione, le richieste incerte non vengono reinviate.
3. **Prove sull'esatto host firmato.** Non installare un nuovo Node come prerequisito predefinito. Verificare separatamente la disponibilità del trasporto, le autorizzazioni filesystem/SMACK e l'esecuzione dell'host .NET della TV. L'agent esistente è compilato per .NET 3.1 e il launcher della #95 richiede una variante 3.0: cambiare solo il percorso da dotnet a dotnet-launcher non è un port completo.
4. **Primo traguardo limitato.** Dimostrare una richiesta autenticata innocua, il ritorno corretto di errore/timeout/output separati, inventario e arresto/riconnessione. Poi una sola modifica reversibile con readback/ripristino, quindi avvii a freddo. Launcher e Remapper richiedono prove e runtime propri; UID 0 non li certifica.
5. **Setup esterno e profili precisi.** La prima implementazione Vetro usa un broker già predisposto e non scrive il firmware o gli account. Un installer futuro richiede un progetto distinto con modello, build REL, immagine/hash, geometria e ripristino verificati per ciascun profilo.

Per Tizen 5.5 questo fornisce una base concreta da cui partire, da provare prima sul Q60T o TU7000 esatto. Per Tizen 5.0 è riutilizzabile il concetto del backend per root esterno, non il profilo Q60T. Per Tizen 10 non è stata trovata in queste fonti una validazione della catena: rimane necessaria la diagnosi del fallimento iniziale SDB e dell'eventuale disponibilità di un altro ingresso.

## Verifiche svolte e limiti

- Clone separato dello snapshot pubblico: 28 file tracciati, nessun codice eseguito sul TV.
- Parsing AST di 7 file Python e `sh -n` di 7 script: pass.
- Import delle sole funzioni pure del builder: patch sintetica di dimensione conservata; manifest privo di hash finestra; controesempio al controllo `is_inert` riprodotto.
- Esecuzione dell'agente come utente locale, in directory temporanea con variabile di test upstream: job sintetico terminato con rc 7 e stdout/stderr uniti; permesso input 0777 confermato. PID estraneo vivo nel pidfile: uscita senza avviare l'agente, riprodotta. Processi di test terminati e directory rimosse.
- Nessuna esecuzione di setup, boot hook, rootlogin, rollback, probe, server o scritture su block device. Nessun contatto con un TV, modifica account o acquisizione di privilegi.
- Shellcheck non disponibile; non eseguito `make check` né il loopback Docker upstream. Gli 81 test menzionati nel README non sono distribuiti. Le prove locali sopra sono controlli mirati dell'analisi, non gli 81 test e non prove VDFS/UEP/SMACK o di persistenza su hardware.
- I rilievi sulla persistenza sono deduzioni dal sorgente e verifiche pure del builder; non affermano che il TV dell'autore sia stato corrotto. Eventuali correzioni upstream successive richiedono riesame del nuovo commit.

Solo questo report e il rapporto documentale sono stati aggiunti alla worktree release. Nessuna modifica al prodotto, nessun commit/push o messaggio ai contributori.
