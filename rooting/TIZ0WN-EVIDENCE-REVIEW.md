# tiz0wn: evidenze pubbliche e limiti per Vetro

Revisione documentale del 2 novembre 2026. Upstream esaminato: [`sebastianspicker/tiz0wn`, commit `66d9b6453604cccacafe73c8515301a911756fd3`](https://github.com/sebastianspicker/tiz0wn/commit/66d9b6453604cccacafe73c8515301a911756fd3). Destinazione: Vetro `release-0.5.0`, commit locale `7dec1ca1a10b427d1803cf44a42756f5d78402e3`.

## Esito e metodo

Le fonti pubbliche rendono esaminabili il codice della catena e un resoconto dettagliato di root persistente su **un Q60T e una build precisa**. Non dimostrano supporto generico Tizen 5.5, compatibilità Vetro stock o riproduzione indipendente dei risultati. Il TU7000 di Vetro #95 è un port locale distinto, con modifiche proprie al canale root, al servizio e al launcher; non è una prova che importare tiz0wn basti a far funzionare Vetro.

Sono stati letti snapshot locale, README, DISCLOSURE, LIVE-RUN, Makefile, NOTICE, LICENSE, SECURITY e riferimenti sorgente strettamente necessari a verificare cosa viene distribuito. Le API pubbliche GitHub sono state consultate in sola lettura mediante `gh`, inclusi #95 e il suo unico commento, #77 e la discussione upstream #1. Nessun exploit, setup, server, build, test o comando sul televisore è stato eseguito. Le verifiche dichiarate dagli autori restano **risultati riportati**, non verifiche effettuate da questa revisione. La revisione approfondita di shell agent, builder di persistenza, rootlogin e progetto dell'integrazione resta fuori ambito.

Il percorso storico `research/remotepc-cifs-root` restituisce HTTP 404 nell'API GitHub; il repository radice è accessibile. L'API conferma il pacchetto pubblico in [`exploits/tiz0wn-root/` al commit esaminato][package]. Il 404 del vecchio collegamento, ancora citato in #77, non significa che manchi tutto il sorgente.

## Ambito hardware, firmware e accesso

- **Unità upstream:** Samsung Q60T `GQ55Q60TGUXZG`, firmware `T-NKLDEUC-2743.0`; DISCLOSURE riporta `SWU-OU_T-NKLDEUC-02743-2026-07-02-Release`. L'analisi firmware identifica famiglia NikeL, kernel Linux 4.1.10 ARM e riscontro live ARMv7. Il documento iniziale descrive Tizen 5.5, ma è un checkpoint precedente: l'identità modello/build delle prove successive è più precisa di una versione OS generica. [README][readme], [DISCLOSURE][disclosure], [analisi firmware][firmware], [ricerca iniziale][research].
- **Provenienza immagine dichiarata:** archivio ufficiale Samsung `T-NKLDEUC.zip`, URL CDN riportato in F1, dimensione 1.349.064.478 byte e SHA-256 `cb717ed98daf9580eb5b84bccbad5adac82f75dd021ed028f1ee1bb6c4abde32`. Immagine, estrazioni e catena di custodia completa non sono distribuite. Non sono stati scaricati né verificati in questa revisione. [F1–F5][firmware].
- **Identificazione build:** il solo suffisso `2743.0` non identifica un'immagine condivisa tra modelli o regioni. Upstream chiede di registrare versione del pacchetto e stamp REL del sistema; la correzione di metaljay riguarda il Q90T, il cui identificatore più solido è `T-NKMDEUC-REL-202607031800`. Non sostituirlo al diverso identificatore Q60T. [DISCLOSURE][disclosure], [commento originale di metaljay](https://github.com/sebastianspicker/tiz0wn/issues/1#issuecomment-6311267427).
- **Ingresso:** il TV è client Remote PC/RDP. Nel flusso valutato servono interazione locale con UI, endpoint RDP e SMB sulla LAN, stato appropriato delle credenziali/condivisione e azione Shared Folder nella sessione. La sola connessione RDP non raggiunge il mount CIFS; il percorso VNC è escluso dalla traccia analizzata. Non è una dimostrazione di root remoto da Internet né di installazione senza interazione. [DISCLOSURE, Technical detail e Security impact][disclosure].
- **Persistenza dichiarata:** carrier `/etc/profile.d/bash_prompt_custom.sh` di 776 byte, finestra di due blocchi da 512 byte, `/dev/mmcblk0p19`, offset relativo alla partizione `704753664` (blocco `1376472`). Sono valori della specifica immagine Q60T. Il metodo può essere studiato per altri target; quei valori non sono un profilo TU7000 né un parametro universale Tizen. [LIVE-RUN §1][live], [SECURITY][security].
- **Limite di esecuzione:** UEP rimane attivo nel risultato Q60T. Il resoconto riporta rifiuto di ELF non firmati e perfino della copia byte-identica di bash su tmpfs; la catena usa script passati per contenuto. Root, possibilità di eseguire binari propri e disponibilità di SSH sono capacità distinte. La sezione Q70T con UEP abbassato e dropbear descrive il risultato di un altro autore su un altro dispositivo. [README][readme], [LIVE-RUN §10][live].

## Risultati dichiarati e controlli effettivamente distribuiti

### Cronologia delle prove riportate

DISCLOSURE conserva il limite della prima prova del 27 settembre: marker `id` volatile classificato UID 0, senza modifiche persistenti, account o flash. La classificazione utilizzava un predicato SDB; il marker non fu scaricato. Il follow-up del 29 ottobre estende il risultato a patch del rootfs, agent e persistenza. Non leggere il limite del test iniziale come negazione del follow-up, né attribuire alla prima prova tutte le capacità successive. [DISCLOSURE, Reproduction, Validation boundary e Follow-up][disclosure].

LIVE-RUN riporta derivazione dell'offset, hash di finestra/carrier, backup confrontati con l'immagine e rilettura della patch. Descrive un primo cold boot con tre invocazioni dell'hook, poi una correzione del lock e un secondo cold boot con una sola nuova riga marker e un agent. La successiva modifica di `sdk` viene dichiarata conservata dopo un ulteriore power cycle. Questo spiega il riepilogo di **tre power cycle** nel README principale rispetto ai **due** della prova iniziale di persistenza: non sono tre prove indipendenti della medesima configurazione finale. Standby/wake è esplicitamente distinto dal reboot. [LIVE-RUN §§5–7][live], [README del pacchetto, Status][package-readme].

I log integrali `LEDGER.jsonl`, i run `r1`/`r2`, manifest e artefatti esatti della sessione sono richiamati, ma non presenti nell'albero Git esaminato. Il documento pubblica estratti e tabelle, spesso con hash abbreviati. Questi sono evidenza narrativa di prima parte, non una suite riproducibile completa o un'attestazione indipendente. [.gitignore][ignore], [LIVE-RUN][live].

### Cosa significa davvero `make check` in un clone

Il README del pacchetto promette in un commento «81 tests», loopback S0–S8 e ledger chain. Il README radice precisa invece che suite, ledger e bookkeeping sono locali e non tracciati. L'albero pubblico contiene il **loopback harness**, ma non `tests/`, ledger o workflow CI. [README del pacchetto, Using it offline][package-readme], [README radice][readme], [albero pubblico][tree], [.gitignore][ignore].

Il [Makefile][makefile] esegue lint shell con alcune esclusioni, compilazione sintattica Python e, solo se trova `tests/test_*.py`, `unittest discover`; altrimenti stampa che i test sono saltati. Non esiste nel target una verifica del ledger. Quindi un clone non riceve gli 81 test citati, e `make test` non ne garantisce l'esecuzione.

Il [loopback distribuito][loopback] usa un carrier fixture, un file che simula la partizione, un sostituto di curl e un container `busybox:latest`. Include controlli dichiarati nel sorgente per patch/rilettura, backup, seconda esecuzione, rollback, finestra alterata, ripresa e lock dell'hook. Non riproduce Remote PC/RDP/SMB reali, VDFS/UEP/SMACK del TV, interruzione di alimentazione o il backend Vetro. Il tag del container non è fissato a digest. Questi limiti descrivono il banco prova distribuito, senza giudicarne qui approfonditamente la correttezza.

Il commit esaminato richiede, quando Docker viene eseguito, ritorno 0, sentinel finale `ALL-OK` e assenza di `[FAIL]`. Tuttavia, **se manca l'eseguibile Docker**, il ramo iniziale stampa `SKIPPED` e restituisce 0. Insieme allo skip delle suite, ciò consente al target finale di stampare `all one-shot checks passed` anche senza aver eseguito né suite privata né loopback. Un esito nominale di `make check` non va quindi riportato senza elenco di ciò che ha realmente girato. [loopback, righe 172–175 e 202–230][loopback], [Makefile][makefile]. Nessuno di questi controlli è stato eseguito da questa revisione.

### Limiti espliciti e incongruenze da chiarire

- **Rollback hardware non provato:** LIVE-RUN §10 dichiara prove offline del rollback e backup verificati, ma nessuna esecuzione dei percorsi di ripristino sul dispositivo. Backup valido e ripristino riuscito non sono la stessa evidenza. [LIVE-RUN][live].
- **Account patch non neutra:** il resoconto dichiara che la finestra shadow tronca un'entry adiacente di servizio nologin e non la ripara; SECURITY menziona una possibile modifica account applicata solo in parte e recupero non automatico. Sono limiti pubblicamente ammessi, da conservare nel quadro delle evidenze; l'audit del codice rootlogin è separato. [LIVE-RUN §7 e §10][live], [SECURITY][security].
- **Geometria incoerente:** LIVE-RUN §1 scrive `1,328,484,368 bytes = 3,502,080 sectors`. Con settori da 512 byte, il secondo valore è **1.793.064.960 byte**, non il primo; il primo non è neppure multiplo di 512. Inoltre la sola uguaglianza di dimensione non dimostra uguaglianza byte per byte dell'intera partizione. I riscontri locali degli hash della finestra sono un'affermazione distinta. Servono correzione documentale e misure originali prima di usare questa equivalenza come prova. Non è, da sola, dimostrazione che il risultato live sia falso. [LIVE-RUN §1–2][live].
- **Documentazione residua:** il README del pacchetto rimanda a `../persist-root/`, assente dall'albero pubblico, e mostra opzioni SSH/dropbear pur spiegando che UEP ne impedisce l'esecuzione sul target. LIVE-RUN distingue il server distribuito da un helper temporaneo usato nella sessione. Non presentare ogni esempio come percorso hardware validato e distribuito integralmente. [README del pacchetto][package-readme], [LIVE-RUN §9][live], [albero][tree].
- **Conferma vendor:** SECURITY e timeline dicono disclosure Samsung il 29 settembre, nessun fix, statement o CVE al momento della pubblicazione del 29 ottobre. È lo stato dichiarato da upstream, non una verifica attuale del catalogo Samsung o conferma del vendor; range vulnerabile e prima/ultima versione interessata restano ignoti. [SECURITY][security], [DISCLOSURE][disclosure].

## Differenza precisa rispetto al port TU7000 di Vetro #95

Fonte primaria: [rapporto del proprietario #95](https://github.com/andrearicci93/vetro/issues/95), consultato il 2 novembre 2026. Le issue e i commenti sono fonti modificabili e non hanno un commit pin equivalente ai file Git; i link sorgente di questo documento sono invece fissati al commit esaminato.

1. **Target differente:** #95 riguarda `UE43TU7000KXXU`, codice `20_KANTSU2_UHD_BASIC`, `T-KTSU2DEUC-2743.0`, Tizen 5.5 e Node.js 4.4.3. La condivisione di `2743.0` con il Q60T NikeL non rende identiche le immagini. Il report omette intenzionalmente offset e dati privati del setup.
2. **Build Vetro differente:** il proprietario dichiara Vetro 0.3.5 con modifiche locali e base commit non affidabilmente registrato. Non è Vetro stock, non è il checkout 0.5.0 e non è un diff riproducibile contro quel checkout. Nel report non è fornito il sorgente completo del port.
3. **Canale root differente:** #95 descrive bootstrap tramite file privato, broker locale autenticato e coda file della shell root, con adattamenti Node 4 per sintassi, Buffer e confronto MAC; segnala crash libuv del percorso spawn. Il README upstream descrive invece una coda `cmd/in` deliberatamente `0777`, accessibile a qualsiasi processo locale in grado di scriverla, senza listener. Non attribuire l'autenticazione del port al canale upstream né dedurla dalla sola presenza di un agent. [README upstream del pacchetto, The root channel][package-readme].
4. **Persistenza differente:** #95 dichiara lock con UUID di boot nello storage persistente e claim atomico dei job per evitare pulizia precoce delle directory temporanee e worker duplicati. Upstream documenta il lock `mkdir` in tmpfs del Q60T. Non sono la stessa implementazione già validata su entrambi i modelli. [LIVE-RUN §6][live].
5. **Account ed esecuzione:** #95 dichiara nessuna modifica account, listener SSH root, ELF nativo non firmato o patch UEP. Upstream Q60T include un risultato aggiuntivo con `sdk` UID/GID 0 e shadow modificato. Non rendere quella modifica requisito o prova del port TU7000.
6. **Launcher distinto:** #95 riporta .NET Core 3.0, host firmato `dotnet-launcher --standalone`, assenza della CLI `/usr/bin/dotnet`, variante launcher .NET 3.0 e correzioni HOME/catalogo per capacità filesystem ridotte dall'host. tiz0wn non distribuisce questo launcher o le modifiche Vetro. Il README Vetro 0.5.0 e la documentazione rooting pongono ancora limiti al root agent sul runtime Node 4, tra cui `crypto.generateKeyPairSync` da Node 10.12. [README Vetro fissato al commit][vetro-readme], [rooting/README fissato al commit][vetro-rooting].
7. **Prove TU7000 riportate:** tre cold boot con alimentazione scollegata, senza VM setup e senza apertura manuale di Vetro/Remote PC; UID/EUID 0 e `System::Privileged`; inventario iniziale 281 app; launcher e tasto Info evdev 188; disabilitazione/riabilitazione launcher e interventi reversibili sulle due app TV Plus. Sono osservazioni del proprietario del 31 ottobre, non risultati ripetuti qui. MQTT, Remapper generale, altre taglie TU7000 e stock installer sono esplicitamente esclusi.
8. **Diagnostica distinta dai cold boot:** l'export del 1 novembre è una fotografia. Il [commento automatico](https://github.com/andrearicci93/vetro/issues/95#issuecomment-6558643995) riporta agent UID 0 connesso, servizio attivo, 282 componenti, ma persistenza/background `unknown` e timeout di settings, launcher e Quick Wins. Le 281 app del baseline e i 282 componenti della cattura non sono misure necessariamente equivalenti. Il bot non certifica i reboot; il testo del proprietario li documenta separatamente. L'allegato diagnostico non è stato analizzato indipendentemente in questa revisione.

Un ulteriore confine utile è [#77](https://github.com/andrearicci93/vetro/issues/77): il TU7100 `UE50TU7100KXXU` con `T-KTSU2DEUC-2743.0` ha hash downstream di `mount.smb.sh` e `ps_agent` corrispondenti, ma front-end/manifest non accessibili e nessuna prova live della catena o di UID 0. #95 non convalida retroattivamente quel modello. Analogamente, [upstream #1](https://github.com/sebastianspicker/tiz0wn/issues/1) distingue i marker CIFS Q90T dalla sua successiva persistenza ottenuta tramite percorso USB: non unire ingressi e risultati provenienti da catene diverse.

## Licenza e provenienza

[`LICENSE`][license] contiene MIT, copyright 2026 Sebastian J. Spicker, con conservazione dell'avviso di copyright e del permesso nelle copie o porzioni sostanziali. [`NOTICE.md`][notice] delimita la licenza a script, documentazione e ricerca originali e dichiara assenza di firmware o sorgenti terzi vendorizzati. L'albero esaminato è coerente con la distribuzione di script/documenti e senza immagini firmware; non è un audit esaustivo dell'origine di ogni riga.

Le attribuzioni distinguono metodo e codice: metaljay per forma della sostituzione `profile.d`, backup/rollback e correzioni, con dichiarazione «No code copied»; cfloinc/Q70T (MIT) per invocazione per contenuto e limiti archive-root; txtsamu per modello UEP per inode e separazione kernel/user space. La [conferma originale di cfloinc](https://github.com/sebastianspicker/tiz0wn/issues/1#issuecomment-6504466699) precisa che i propri controlli Q70T sulla componente shell erano ancora in coda: non sono validazioni Q60T aggiuntive. [NOTICE][notice].

Luminger/USB è referenziato come AGPL-3.0, chris-ritsen/levkropp come fallback investigati (Unlicense per chris-ritsen), Synacktiv come decryptor usato per riferimento, HinTak/vdfs-tools come tool derivato Samsung GPLv2. NOTICE dichiara private e non pubblicate le patch locali al tool GPLv2; LIVE-RUN descrive ulteriori adattamenti necessari su revisioni diverse. Il MIT del repository non rilicenzia questi tool, firmware o contributi esterni. Prima di riutilizzare materiali effettivi, registrare commit e licenza di ciascuno e mantenere le attribuzioni; la semplice citazione di una tecnica non prova una dipendenza di codice distribuita. [NOTICE][notice], [LIVE-RUN §1][live].

## Sufficienza delle fonti e prove mancanti per un annuncio di supporto

Il sorgente pubblico basta per iniziare un audit e comprendere il risultato Q60T dichiarato. Non basta per riprodurre le 81 verifiche private, controllare l'intero dossier live, ricostruire il port #95 o certificare Vetro su una classe OS. Prima di dichiarare supporto Tizen 5.5 servono almeno:

- sorgente pubblicabile/licenziato del port Vetro, base e head fissati, diff completo, ricetta di build e artefatti identificabili; distinzione tra bootstrap, backend root e launcher;
- matrice **modello + famiglia + firmware + stamp REL**, con immagine e hash identificati, geometria corretta e valori derivati per ciascun target; la corrispondenza di due binari downstream non sostituisce la prova dell'ingresso completo;
- suite distribuite e risultati legati al commit, dipendenze riproducibili e report che separi pass, fail e skip; controlli del canale Vetro/Node 4 distinti dal loopback shell;
- tracce sanitizzate con UID/EUID/SMACK e configurazione precisa, cold boot identificabili con alimentazione rimossa e senza host/manual start, distinguendo configurazione prima e dopo le correzioni; prove separate di launcher, inventory, funzioni privilegiate e autenticazione;
- validazione documentata del ripristino sul profilo hardware interessato, oltre a integrità dei backup e simulazione offline; esplicito trattamento degli effetti collaterali account, se quella variante viene proposta;
- riproduzioni su ulteriori modelli/build prima di allargare il claim, oppure una lista limitata di combinazioni confermate con rifiuto esplicito delle altre.

La formulazione attualmente sostenibile è: **upstream riporta root persistente sul Q60T esatto; #95 riporta Vetro funzionante su un TU7000 esatto con port locale non distribuito nel rapporto. Il supporto generico Tizen 5.5 non è stabilito.**

[package]: https://github.com/sebastianspicker/tiz0wn/tree/66d9b6453604cccacafe73c8515301a911756fd3/exploits/tiz0wn-root
[tree]: https://github.com/sebastianspicker/tiz0wn/tree/66d9b6453604cccacafe73c8515301a911756fd3
[readme]: https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/README.md
[disclosure]: https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/docs/DISCLOSURE.md
[firmware]: https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/docs/firmware-analysis.md
[research]: https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/docs/Samsung_Q60T_Debloating_Research_2026-09-25.md
[live]: https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/exploits/tiz0wn-root/LIVE-RUN-2026-10-29.md
[package-readme]: https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/exploits/tiz0wn-root/README.md
[makefile]: https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/exploits/tiz0wn-root/Makefile
[loopback]: https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/exploits/tiz0wn-root/builder/loopback.py
[ignore]: https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/.gitignore
[security]: https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/SECURITY.md
[notice]: https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/NOTICE.md
[license]: https://github.com/sebastianspicker/tiz0wn/blob/66d9b6453604cccacafe73c8515301a911756fd3/LICENSE
[vetro-readme]: ../README.md#compatibility
[vetro-rooting]: README.md
