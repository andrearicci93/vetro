'use strict';
// Q74T: con nessun operatore al Remote PC, il canale deve rigenerarsi da
// solo dopo il deadline (autoRenew), invece di fermarsi per sempre — il
// supervisore di boot (root-supervisor.sh) deve sempre trovare una
// directory /tmp/vq-* fresca da eseguire. Il comportamento di default per
// chi non passa autoRenew resta quello originale (owner-triggered).
const path = require('path');
const MODULE_PATH = path.join(__dirname, '..', 'service', 'remote-pc-platform.js');

function withAutoRenew() {
    delete require.cache[require.resolve(MODULE_PATH)];
    const createPlatform = require(MODULE_PATH).create;
    return new Promise((resolve, reject) => {
        const platform = createPlatform({lifetimeMs: 50, autoRenew: true});
        let cycles = 0;
        let last = null;
        const check = setInterval(() => {
            const status = platform.status();
            if (status.prepared && status.bootstrapUsername && status.bootstrapUsername !== last) {
                last = status.bootstrapUsername;
                cycles += 1;
                if (cycles >= 3) { clearInterval(check); platform.stop(); resolve(); }
            }
        }, 10);
        platform.start();
        setTimeout(() => {
            clearInterval(check); platform.stop();
            reject(new Error('solo ' + cycles + ' rigenerazioni in 2s, attese >=3'));
        }, 2000);
    });
}

function withoutAutoRenew() {
    delete require.cache[require.resolve(MODULE_PATH)];
    const createPlatform = require(MODULE_PATH).create;
    return new Promise((resolve, reject) => {
        const platform = createPlatform({lifetimeMs: 50});
        platform.start();
        setTimeout(() => {
            const status = platform.status();
            platform.stop();
            if (status.running === false && status.prepared === false) resolve();
            else reject(new Error('senza autoRenew il canale non si e\' fermato: ' + JSON.stringify(status)));
        }, 300);
    });
}

Promise.resolve()
    .then(withAutoRenew)
    .then(() => console.log('PASS autoRenew: il canale si rigenera da solo dopo il deadline (>=3 cicli osservati)'))
    .then(withoutAutoRenew)
    .then(() => console.log('PASS senza autoRenew: comportamento originale invariato (si ferma dopo il deadline)'))
    .catch((e) => { console.error('FAIL ' + e.message); process.exitCode = 1; });
