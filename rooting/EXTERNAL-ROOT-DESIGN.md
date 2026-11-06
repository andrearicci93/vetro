# Collegamento a root esterno: proposta per Vetro

Bozza ragionata del 2 novembre 2026, sulla worktree `release-0.5.0` dopo `7dec1ca`. Questo documento propone il percorso; non implementa un adapter e non stabilisce compatibilità hardware. Riferimenti: [revisione tiz0wn](TIZ0WN-CODE-REVIEW.md), [evidenze hardware](TIZ0WN-EVIDENCE-REVIEW.md), [interfaccia esistente](../app/PLATFORM.md).

## Decisione di prodotto proposta

Distribuire un solo pacchetto di integrazione Vetro con la stessa dashboard. Il collegamento privilegiato è un dettaglio interno. L'utente vede se il TV è pronto, se richiede una configurazione iniziale specifica o se il modello non è ancora verificato. Non deve scegliere un protocollo, impostare una porta del broker o distinguere code e DLL.

Sui dispositivi già supportati continua il percorso corrente. Sui profili vecchi verificati la configurazione iniziale può includere Remote PC o un root ottenuto separatamente. Dopo un'associazione riuscita e una prova di persistenza, l'uso quotidiano deve funzionare senza computer. Una procedura che deve essere ripetuta a ogni accensione è una modalità sperimentale da descrivere esplicitamente, non l'esperienza finale prevista.

Il singolo pacchetto è un obiettivo di packaging da verificare sui runtime più vecchi. La separazione app-only esistente resta utile allo sviluppo. Un secondo pacchetto pubblico specifico per generazione TV sarebbe un ripiego per incompatibilità reali di packaging, non la prima scelta.

## Due percorsi iniziali distinti

**Prima iterazione: TV già rootato.** L'utente ha predisposto un ingresso root compatibile. Una procedura esplicita associa il modulo privilegiato a Vetro. Vetro controlla identità, autenticazione e capacità effettive; poi espone le funzioni confermate. Non promette di ottenere root su altri modelli.

**Iterazione successiva: configurazione guidata completa.** Su profili verificati si integra la guida per ottenere il root e predisporre l'avvio, riducendo i passaggi manuali. Le azioni di firmware/persistenza vengono descritte e confermate come operazioni proprie. La presenza di una TV con Tizen 5.5 non autorizza né giustifica automaticamente una patch costruita per un altro firmware.

La prima iterazione permette di sviluppare e provare il collegamento Vetro senza trasformare contemporaneamente il progetto in un installer universale di root. La seconda è necessaria per rendere accessibile la funzione a utenti non tecnici: il solo adapter non elimina la complessità iniziale.

## Flusso previsto per l'utente

1. Installazione e prima apertura di Vetro, come oggi.
2. Rilevamento delle informazioni accessibili: modello, firmware/build, runtime e stato del collegamento. I dati mancanti restano sconosciuti; il solo anno o numero Tizen non determina la compatibilità.
3. Se il percorso corrente funziona, si prosegue direttamente. Se esiste un'associazione esterna già configurata, Vetro prova quel collegamento. Se nessuna strada è pronta, mostra un motivo e la procedura specifica disponibile; non alterna tentativi di root diversi senza scelta dell'utente.
4. La configurazione esterna richiede una sola associazione esplicita con il modulo privilegiato. Passaggi, indirizzo del computer temporaneo ed eventuale interazione Remote PC appartengono alla guida iniziale, non alle preferenze quotidiane.
5. Vetro verifica una richiesta autenticata e capacità di lettura. Le funzioni prive di capacità verificate indicano la limitazione precisa, per esempio launcher non disponibile su quel runtime.
6. Si prova un riavvio completo. Il collegamento ristabilito viene distinto dalla persistenza ancora non verificata. La prova senza computer e dopo rimozione dell'alimentazione è separata dal semplice riavvio del processo.

Messaggi da progettare attorno al risultato: «Pronto», «Configurazione iniziale richiesta», «Riconnessione in corso», «Collegamento da ripristinare», «Modello non ancora verificato». I dettagli SDB/broker/runtime rimangono nella diagnostica avanzata.

## Interfaccia e seam

L'applicazione continua ad attraversare la seam di `service/platform.js`. La sua interface resta `start`, `stop`, `status`, `execute`, `install` e `setApplicationsEnabled`, comprese le garanzie di autenticazione, timeout e assenza di retry automatico delle modifiche. Un adapter soddisfa quell'interface usando l'archive-root attuale; l'altro usa un modulo privilegiato esterno.

Non introdurre un registro di plugin per metodi di root, un protocollo pubblico per ogni trasporto o condizioni Tizen nei moduli delle singole funzioni. La selezione e la riconnessione appartengono al modulo di piattaforma. Il backend configurato è persistente; una sua indisponibilità non attiva implicitamente una nuova procedura di acquisizione root.

`install` deve restituire indisponibilità se il nuovo percorso non ha un metodo di installazione verificato. Collegare il broker non deve far apparire l'updater compatibile per deduzione. Ugualmente, shell root disponibile non certifica il launcher o il filtro del telecomando.

## Ipotesi tecnica da verificare per prima

Il crash riportato riguarda il percorso di avvio processi del Node Samsung; non dimostra che rete, file I/O e HMAC siano inutilizzabili. Per questo la prima prova sul dispositivo dovrebbe verificare se la shell root può avviare il **Node di sistema firmato**, mantenendo identità e autorizzazioni necessarie.

Se funziona, un broker compatibile Node 4 può occuparsi di rete, HMAC e file I/O senza usare `child_process`. Una shell worker, avviata dal bootstrap privilegiato, esegue i job attraverso una coda privata. Questo eviterebbe sia di installare un Node nuovo sia di richiedere .NET al solo trasporto dei comandi. La variante .NET 3.0 del launcher resterebbe un problema indipendente.

Questa è un'ipotesi progettuale, non un risultato hardware. La prova deve controllare UID/EUID/GID, SMACK, capacità, accesso ai percorsi necessari e capacità di aprire il canale locale; la sola esecuzione di `node --version` non basta. Se l'host perde i privilegi necessari o l'isolamento non è realizzabile, si riconsidera il broker a partire dal codice del port #95 e dai runtime firmati realmente disponibili. Non sostituire il Node di sistema per aggirare la prova.

Lato Vetro conviene riutilizzare, quando compatibile, l'attuale protocollo autenticato e il formato dei risultati. L'assenza di RSA in Node 4 riguarda la preparazione dell'archive-root; non deve essere una condizione di rifiuto del broker esterno, che usa un'altra implementation.

## Identità e associazione

Il modulo privilegiato viene avviato da un ingresso già root e predispone un'identità di associazione dedicata a Vetro. La consegna iniziale del segreto richiede un canale fidato: non basta trovare in una directory condivisa un file che dichiara UID 0. Il backend non si collega automaticamente alla coda aperta `0777` dell'agente tiz0wn originale.

L'associazione dura oltre il riavvio della web app; ogni connessione usa una nuova sessione/nonce e controlli anti-replay. Questo evita di dover riassociare il TV dopo ogni normale restart, senza conservare indiscriminatamente una copia del token consumabile dell'archive-root. Vetro può revocare e rifare l'associazione.

Il protocollo attuale accetta un segreto fornito al costruttore e usa nonce per connessione: è un punto di riuso possibile, non la prova che il provisioning sia già risolto. Il rendezvous deve permettere al broker persistente di ritrovare la web app dopo un restart, con dati limitati e autenticati; una porta effimera del processo precedente non è un indirizzo persistente. Il meccanismo preciso va scelto dopo aver misurato i percorsi e le autorizzazioni DAC/SMACK accessibili sul TV. Non esporre una nuova porta di controllo sulla LAN per semplificarlo.

## Garanzie del modulo privilegiato

- Directory e canali con proprietari/permessi verificati; gestione esplicita di symlink, file sostituiti e isolamento dagli altri pacchetti. Il solo UID condiviso da più app potrebbe non bastare: vanno provate anche le regole SMACK reali.
- Sessioni e worker identificati per boot e generazione, senza affidarsi soltanto a un numero PID o a una directory temporanea che il firmware può pulire.
- Accettazione del job autenticata, claim atomico, output separati, limiti di byte/coda, timeout della singola richiesta e terminazione dei discendenti quando supportata.
- Risultato strutturato autenticato e pubblicato come completo. In caso di perdita della connessione, l'esito di una modifica già accettata può essere sconosciuto; la richiesta non viene inviata di nuovo automaticamente.
- Idempotenza dell'avvio e della riconnessione. `stop()` chiude il collegamento Vetro e impedisce nuovi job; non elimina per implicazione il root installato esternamente.
- Stato di salute ottenuto da un round trip autentico. Un marker sul disco dimostra al massimo un evento passato, non che il worker sia pronto adesso.

## Arresto, rimozione e aggiornamenti

«Rimuovi Vetro» deve revocare la sua associazione e togliere solo dati e moduli installati da Vetro. Non deve ripristinare firmware o account di un root esterno, né spegnere un broker condiviso da altri programmi. L'eventuale rimozione del bootstrap root ha procedura separata e profilo firmware proprio.

Per gli aggiornamenti servono compatibilità di protocollo dichiarata, procedura di riconnessione e rollback dell'app verificati. Un aggiornamento della web app non deve generare job duplicati, sostituire la persistenza esterna o perdere il modo di ritrovare il broker. Per la prima prova hardware si può disabilitare l'aggiornamento integrato su questo backend finché il percorso di installazione non è verificato.

## Ordine di lavoro proposto

1. Ottenere dal port #95 il diff riutilizzabile per broker, associazione, boot e launcher, con target e commit identificati. In parallelo si può già predisporre la seam usando l'interface esistente, senza includere exploit di firmware.
2. Prova minima sul modello esatto: Node firmato da shell root, nessuno spawn dal Node, HMAC/rete/file I/O e conservazione dei privilegi necessari. Se fallisce, documentare la capacità mancante prima di scegliere un altro runtime.
3. Fixture locale del modulo: errori, timeout, output e replay, restart della web app, perdita del worker, PID riutilizzati, job dall'esito ignoto e revoca.
4. Primo adapter sul TV: letture innocue, inventario; poi una modifica reversibile con readback e restore. Verificare separatamente arresto dell'app e riconnessione.
5. Boot senza computer e dopo alimentazione scollegata. Registrare build, boot ID e risultato di salute, conservando separatamente le osservazioni a schermo.
6. Launcher 3.0 e input come traguardi successivi; packaging e guida iniziale solo dopo avere una combinazione ripetibile.

Non fissare una data o dichiarare «supporto Tizen 5.5» prima di queste prove. Il primo risultato pubblicabile è un elenco di combinazioni esatte verificate. Il modulo per root esterno potrebbe servire anche al port Tizen 5.0, ma l'ingresso USB e il launcher 2.1 rimangono distinti. Nessuna prova analizzata stabilisce che la catena Remote PC funzioni su Tizen 10.

## Esito atteso per l'utente

Una configurazione iniziale eventualmente diversa, poi la stessa esperienza Vetro con capacità dichiarate sul suo TV. La complessità resta nell'implementation degli adapter e nel bootstrap iniziale; l'utente non deve gestire manualmente daemon, token, code, porte o tentativi di recupero durante l'uso normale.
