'use strict';
// Optional TV platform adapter. App code knows only start/stop/status/execute/install.
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var sdb = require('./sdb.js');
var checkTarget = require('./root-preflight.js').checkTarget;
var createPreflightRunner = require('./root-preflight-capture.js').createRunner;
var tarGz = require('./tar.js').tarGz;
var RootAgentServer = require('./root-agent.js').RootAgentServer;
var TunnelServer = require('./sdb-tunnel.js').TunnelServer;
var retryPolicy = require('./retry-policy.js');
var SDB_TUNNEL_PORT = 26201;
var SDB_TUNNEL_PORT_ERROR = null;
(function () {
    // Node 4.4 has no Number.isInteger. Reject out-of-range or non-integer
    // values instead of silently falling back to the default port.
    var raw = process.env.VETRO_SDB_TUNNEL_PORT;
    if (raw === undefined || raw === '') return;
    var n = Number(raw);
    if (!isFinite(n) || Math.floor(n) !== n || n < 1 || n > 65535) {
        SDB_TUNNEL_PORT_ERROR = 'invalid VETRO_SDB_TUNNEL_PORT: ' + raw;
        return;
    }
    SDB_TUNNEL_PORT = n;
})();
var tunnelServer = null;
var SDB_ACCESS_FILE = '/opt/usr/home/owner/share/vetro-sdb-access.json';
var debloatCommands = require('./debloat-commands.js');
var STAGE = '/home/owner/share/tmp/sdk_tools';

var state = {
    when: new Date().toISOString(),
    self: selfIdentity(),
    attempts: [],
    prepared: false,
    running: false,
    unsupported: false,
    rooting: { backend: 'sdb-archive', phase: 'stopped', failure: null },
    sdbTunnel: { listening: false },
    agent: { connected: false }
};

function selfIdentity() {
    var status = '';
    try { status = fs.readFileSync('/proc/self/status', 'utf8'); } catch (e) { }
    function field(n) { var m = status.match(new RegExp('^' + n + ':\\s*(.*)$', 'm')); return m ? m[1].trim() : null; }
    var smack = null;
    try { smack = fs.readFileSync('/proc/self/attr/current', 'utf8').trim(); } catch (e) { }
    return { pid: process.pid, uid: (typeof process.getuid === 'function') ? process.getuid() : null,
        cap_eff: field('CapEff'), smack: smack, node: process.version || null };
}

function buildInjection(command) {
    // One gate per attempt: SDB may deliver an attempt twice, but a later
    // relaunch must not inherit a gate left by an earlier agent lifetime.
    var gate = crypto.randomBytes(8).toString('hex');
    var script = '/bin/mkdir /tmp/s-' + gate + ' 2>/dev/null&&{ ' + command + ';}';
    var b64 = Buffer.from(script, 'utf8').toString('base64');
    return 'new2.tpk`printf${IFS}%s${IFS}' + b64 + '|base64${IFS}-d|bash`.tpk';
}

// Node 4.4 has no String.prototype.padStart and no destructuring.
function hex2(b) { return (b < 16 ? '0' : '') + b.toString(16); }
var pkg = 'archive-root-' + Array.from(crypto.randomBytes(8)).map(hex2).join('');

function ensureDir(p) {
    // Node 4.4 fs.mkdirSync has no {recursive:true} and throws EEXIST.
    var resolved = path.resolve(p);
    var parent = path.dirname(resolved);
    if (!parent || parent === resolved) return p;
    if (fs.existsSync(resolved)) return p;
    ensureDir(parent);
    try { fs.mkdirSync(resolved, 511 /* 0o777, as the recursive form did */); } catch (e) {
        if (e.code !== 'EEXIST') throw e;
    }
    return p;
}

// Start the agent with detached standard streams so the archive launcher
// returns and releases SDB command processing. setsid() in the agent alone
// does not release the waiting tar/archive parents. Paths are baked in once.
function buildLaunchScript(agentPort) {
    var staging = STAGE + '/' + pkg;
    return '#!/bin/sh\n' +
        '/usr/bin/dotnet ' + staging + '/SamsungTvRootAgent.dll ' +
        '127.0.0.1 ' + agentPort + ' ' +
        staging + '/root-agent.token ' +
        staging + ' </dev/null >' + staging + '/root-agent.log 2>&1 &\n';
}

// Every service start stages a new archive-root-<id> folder and a signed archive in on-demand/, and nothing
// removed the earlier ones (150+ folders, ~10 MB on a nearly full /opt after a few weeks). The current one and
// the newest few others stay, and so does any folder a running process still has on its command line.
var STAGE_KEEP = 3;
function stageInUse() {
    var used = '';
    try {
        fs.readdirSync('/proc').forEach(function (d) {
            if (!/^\d+$/.test(d)) return;
            try { used += fs.readFileSync('/proc/' + d + '/cmdline', 'utf8') + '\n'; } catch (e) {}
        });
    } catch (e) {}
    return used;
}
// Node 12 on the TV has no fs.rmSync.
function removeTree(p) {
    var st = fs.lstatSync(p);
    if (st.isDirectory()) {
        fs.readdirSync(p).forEach(function (n) { removeTree(p + '/' + n); });
        fs.rmdirSync(p);
    } else fs.unlinkSync(p);
}
function cleanStage(keep) {
    var removed = [];
    var onDemand = STAGE + '/on-demand';
    var used = stageInUse();
    var dirs = fs.readdirSync(STAGE).filter(function (n) {
        return /^archive-root-[0-9a-f]{16}$/.test(n) && n !== keep;
    }).map(function (n) {
        var t = 0;
        try { var st = fs.statSync(STAGE + '/' + n); t = st.mtimeMs || +st.mtime || 0; } catch (e) {}
        return { name: n, time: t };
    }).sort(function (a, b) { return b.time - a.time; });
    var spared = {};
    spared[keep] = true;
    dirs.forEach(function (d, i) {
        if (i < STAGE_KEEP - 1 || used.indexOf(d.name) >= 0) { spared[d.name] = true; return; }
        try { removeTree(STAGE + '/' + d.name); removed.push(d.name); } catch (e) {}
    });
    // Archives in on-demand/ whose folder is gone (or never existed) have no use.
    try {
        fs.readdirSync(onDemand).forEach(function (n) {
            var m = /^(archive-root-[0-9a-f]{16})\.tar\.gz(\.signature)?$/.exec(n);
            if (m && !spared[m[1]]) { try { fs.unlinkSync(onDemand + '/' + n); } catch (e) {} }
        });
    } catch (e) {}
    return removed;
}

function prepare(agentPort, runtime) {
    // crypto.generateKeyPairSync and KeyObject.export need Node 10.12+. Tizen 4
    // and 5.5 run Node 4.4, where the adapter must not touch the file system or
    // keep retrying: report it once and leave the rest of the service running.
    if (typeof crypto.generateKeyPairSync !== 'function') {
        var unsupported = new Error('root agent needs Node 10.12+ (this runtime has ' + process.version + ')');
        unsupported.code = 'platformUnsupported';
        throw unsupported;
    }

    var staging = ensureDir(STAGE + '/' + pkg);
    var onDemand = ensureDir(STAGE + '/on-demand');

    var keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    var publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
    var privatePem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });

    var bundle = path.join(__dirname, '..', 'payload');
    if (runtime === '6.0') bundle = path.join(bundle, 'net6');
    var names = [
        'SamsungTvArchiveRoot.dll', 'SamsungTvArchiveRoot.runtimeconfig.json', 'SamsungTvArchiveRoot.deps.json',
        'SamsungTvRootAgent.dll', 'SamsungTvRootAgent.runtimeconfig.json', 'SamsungTvRootAgent.deps.json'
    ];
    names.forEach(function (n) {
        var data = fs.readFileSync(path.join(bundle, n));
        if (/\.runtimeconfig\.json$/.test(n)) {
            var config = JSON.parse(data.toString('utf8'));
            config.runtimeOptions.rollForward = runtime === '6.0' ? 'Major' : 'LatestPatch';
            data = JSON.stringify(config);
        }
        fs.writeFileSync(path.join(staging, n), data);
    });

    fs.writeFileSync(path.join(staging, 'public.pem'), publicPem);
    fs.writeFileSync(path.join(staging, 'passwd'), 'owner:x:0:0:owner:/home/owner:/bin/sh\n');

    var launch = buildLaunchScript(agentPort);
    var tarBuf = tarGz([{ name: 'launch.sh', data: launch, mode: 448 /* 0o700 */, mtime: 0 }]);
    var signature = crypto.sign('RSA-SHA256', tarBuf, privatePem);

    fs.writeFileSync(path.join(onDemand, pkg + '.tar.gz'), tarBuf);
    fs.writeFileSync(path.join(onDemand, pkg + '.tar.gz.signature'), signature);

    // Housekeeping only: a failure here must never fail the preparation.
    var removed = 0;
    try { removed = cleanStage(pkg).length; } catch (e) {}
    state.preparedRuntime = runtime;
    state.prepared = true;
    state.staging = { pkg: pkg, dir: staging, onDemand: path.join(onDemand, pkg + '.tar.gz'), removedOld: removed };
}

// --- root agent lifecycle -------------------------------------------------
var secret = crypto.randomBytes(32);
var secretB64 = secret.toString('base64');
var agentServer = null;
var agentConnected = false;
var launchClient = null;   // temporary SDB connection during launch
var launching = false;
var relaunchTimer = null;
var launchGen = 0;        // invalidates stale retry timers
var callbackTimer = null;
var launchFailures = 0;   // consecutive failed launches since the agent last connected: drives the retry delay

// Wake. The TV stops sdbd at standby, which ends the agent; it starts sdbd again at wake. After the loss of an agent that had
// been connected for a while, a refused SDB handshake is tried again every FAST_RETRY_MS (instead of the backoff below) for
// FAST_WINDOW_MS of time the TV is awake, so at wake the agent is launched as soon as sdbd answers, not when a backoff timer
// armed before the TV suspended happens to fire. Awake time is the monotonic clock (process.hrtime): like libuv's timers it
// stops while the TV is suspended. Only refused handshakes are retried this fast: they are local socket calls and start no
// process on the TV. These retries do not grow launchFailures, and a repeat of the same failure is not written to the log.
var FAST_RETRY_MS = 2000, FAST_WINDOW_MS = 120000, STABLE_MS = 30000;
var lossHr = null;          // process.hrtime() when a stable agent was lost; null when there is nothing to recover fast
var lastFailure = null;     // 'stage:code' of the last failed attempt, for the log de-duplication in the fast window
var agentListeners = [];    // onAgent(fn): fn(true) once the agent is connected, fn(false) when it is lost
// In memory only (never in `state`, which is written to flash at every connect and loss), merged in status():
// firstConnect: the first connect of this run; reconnect: the last recovery after a loss. Times in ms. awakeMs is on the
// monotonic clock (without the time the TV was suspended), wallMs on the wall clock (with it); stages is the attempt that
// connected: handshakeMs (SDB connect), preflightMs, prepareMs, dispatchMs (the launch command), callbackMs (launch command
// sent to agent connected).
var timing = {firstConnect: null, reconnect: null, losses: 0};
var startHr = null, loss = null, attemptTimes = null;
function hrMs(since) { var d = process.hrtime(since); return Math.round(d[0] * 1000 + d[1] / 1e6); }
function notifyAgent(up) { agentListeners.slice().forEach(function (fn) { try { fn(up); } catch (e) { /* a listener never breaks the adapter */ } }); }
function fastRetry() { return lossHr !== null && hrMs(lossHr) < FAST_WINDOW_MS && /^sdb-handshake:/.test(lastFailure || ''); }

function pushAttempt(entry) {
    state.attempts.push(entry);
    if (state.attempts.length > 40) state.attempts.shift();
}

function prepareForRuntime(port) {
    try {
        prepare(port);
        delete state.prepareError;
    } catch (e) {
        state.prepareError = String(e.message || e);
        rootFailure('preparation', e.code === 'platformUnsupported' ? 'platformUnsupported' : 'prepare-failed');
        if (e.code !== 'platformUnsupported') return;
        rootPhase('unsupported');
        // This runtime will never be able to prepare the agent, so stop the
        // retry loop (which rewrote the status file every few seconds) and the
        // loopback listener that nothing can connect to.
        state.unsupported = true;
        if (agentServer) {
            try { agentServer.close(); } catch (ignored) {}
            agentServer = null;
        }
    }
}

// Report only phases we can observe. An SDB stream finishing does not prove
// injection or archive execution succeeded; only authenticated AUTH proves root.
function rootPhase(phase) { if (state.rooting.phase !== phase) phaseAt = Date.now(); state.rooting.phase = phase; }

// The TV screen asks for an attempt now (opening Vetro, OK on Check again). A few failures right after an install leave the
// backoff waiting minutes, and root then connected "suddenly" when the timer fired. Only a relaunch that waits (for its backoff
// timer, or for an agent that has not called back for a minute) starts at once, at most every 20 s: a launch in progress is
// never cut, and the failure count is kept, so a TV that can never get root still backs off.
var RETRY_NOW_MS = 20000, STALE_CALLBACK_MS = 60000, retryNowAt = 0, phaseAt = 0;
function retryNow() {
    if (!state.running || state.unsupported || agentConnected || launching || !agentServer) return false;
    var waiting = !!relaunchTimer || (state.rooting.phase === 'agent-callback' && Date.now() - phaseAt > STALE_CALLBACK_MS);
    if (!waiting || Date.now() - retryNowAt < RETRY_NOW_MS) return false;
    retryNowAt = Date.now();
    if (relaunchTimer) { clearTimeout(relaunchTimer); relaunchTimer = null; }
    relaunch();
    return true;
}
function rootFailure(stage, code) {
    state.rooting.failure = { stage: stage, code: code };
}
function transportCode(error) {
    var codes = ['sdbRefused', 'sdbTimeout', 'sdbReset', 'sdbAuthRequired', 'sdbError',
        'sdbClosed', 'sdbStreamFailed', 'sdbStreamError'];
    return error && codes.indexOf(error.code) >= 0 ? error.code : 'sdbError';
}

// sdbd accepts a single host connection. When the tunnel is listening it owns
// that connection and multiplexes every client, so Vetro must go through it too
// instead of opening a competing direct connection to 26101.
function sdbTarget() {
    var tunnel = state.sdbTunnel;
    if (tunnel && tunnel.listening && tunnel.port) {
        return { host: '127.0.0.1', port: tunnel.port, timeout: 8000 };
    }
    return { host: '127.0.0.1', port: 26101, timeout: 8000 };
}

function readSdbPreference() {
    try {
        var saved = JSON.parse(fs.readFileSync(SDB_ACCESS_FILE, 'utf8'));
        if (!saved || typeof saved.enabled !== 'boolean') throw new Error('Invalid saved SDB access state');
        return saved.enabled;
    } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}
function sdbAccess() {
    return {available: !!tunnelServer && state.sdbTunnel.listening === true,
        enabled: readSdbPreference(), active: !!tunnelServer && tunnelServer.lanEnabled === true && state.sdbTunnel.listening === true,
        port: state.sdbTunnel.port || SDB_TUNNEL_PORT};
}
function setSdbAccess(enabled) {
    return Promise.resolve().then(function () {
        if (typeof enabled !== 'boolean') throw new Error('Invalid SDB access state');
        if (enabled && (!tunnelServer || !state.sdbTunnel.listening)) throw new Error('SDB tunnel is not available');
        var tmp = SDB_ACCESS_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({enabled: enabled}) + '\n', {mode: 384});
        fs.renameSync(tmp, SDB_ACCESS_FILE);
        if (tunnelServer) tunnelServer.setLan(enabled);
        var result = sdbAccess();
        if (result.enabled !== enabled || (tunnelServer && result.active !== enabled)) throw new Error('SDB access was not confirmed');
        return result;
    });
}

// The tunnel's port can still be held by an older Vetro on its way out (the package installed over a running one: the old
// service is ended a few seconds after this one starts). With a single try the tunnel stayed down until the next restart
// of the service. Only "address in use" is tried again, every TUNNEL_RETRY_MS, at most TUNNEL_RETRIES times.
var TUNNEL_RETRY_MS = 5000, TUNNEL_RETRIES = 24;
var tunnelRetryTimer = null;
function openTunnel(done) {
    var enabled = false;
    try { enabled = readSdbPreference(); } catch (e) { /* unreadable settings never grant LAN access */ }
    // One shared listener/pool: the admission gate changes without interrupting Vetro's local SDB streams.
    var server = new TunnelServer({ port: SDB_TUNNEL_PORT, bindHost: '0.0.0.0', lanEnabled: enabled });
    tunnelServer = server;
    server.start(function (err, port) {
        // A stop() during startup replaced the server: do not resume launching.
        if (tunnelServer !== server) { if (!err) server.close(); return; }
        state.sdbTunnel = err
            ? { listening: false, error: String(err.message || err) }
            : { listening: true, port: port };
        done(err);
    });
}
function retryTunnel(left) {
    if (tunnelRetryTimer) clearTimeout(tunnelRetryTimer);
    tunnelRetryTimer = setTimeout(function () {
        tunnelRetryTimer = null;
        if (!state.running || !tunnelServer || state.sdbTunnel.listening) return;
        tunnelServer.close();
        openTunnel(function (err) { if (err && err.code === 'EADDRINUSE' && left > 1) retryTunnel(left - 1); });
    }, TUNNEL_RETRY_MS);
}

function startTunnel(cb) {
    if (SDB_TUNNEL_PORT_ERROR) {
        state.sdbTunnel = { listening: false, error: SDB_TUNNEL_PORT_ERROR };
        cb();
        return;
    }
    openTunnel(function (err) {
        if (err && err.code === 'EADDRINUSE') retryTunnel(TUNNEL_RETRIES);
        cb();
    });
}

function startAgent() {
    if (state.running) return;
    state.running = true;
    // Regenerate launch.sh for the current listener port on each lifecycle.
    state.prepared = false;
    state.unsupported = false;
    state.agentPort = null;
    var serverListening = false;
    state.rooting = { backend: 'sdb-archive', phase: 'preparing', failure: null };
    var server = new RootAgentServer({
        secret: secret,
        onConnect: function (conn) {
            if (agentServer !== server || !state.running) { conn._socket.destroy(); return; }
            if (relaunchTimer) { clearTimeout(relaunchTimer); relaunchTimer = null; }
            if (callbackTimer) { clearTimeout(callbackTimer); callbackTimer = null; }
            agentConnected = true;
            // A connected agent ends any launch still in flight (it would otherwise keep `launching` set and
            // block every later relaunch), and the next outage starts again from the short retry delay.
            launching = false;
            launchFailures = 0;
            var stages = attemptTimes ? Object.assign({}, attemptTimes.ms, attemptTimes.dispatchHr ? {callbackMs: hrMs(attemptTimes.dispatchHr)} : {}) : null;
            if (loss) timing.reconnect = {lostAt: loss.at, connectedFor: loss.connectedFor, awakeMs: hrMs(loss.hr), wallMs: Date.now() - loss.at, attempts: loss.attempts, stages: stages};
            else if (!timing.firstConnect && startHr) timing.firstConnect = {ms: hrMs(startHr), stages: stages};
            loss = null; lossHr = null; lastFailure = null; attemptTimes = null;
            rootPhase('connected');
            state.rooting.failure = null;
            state.agent = {
                connected: true,
                pid: conn.identity.pid,
                uid: conn.identity.uid,
                gid: conn.identity.gid,
                cap_eff: conn.identity.cap_eff,
                smack: conn.identity.smack,
                at: Date.now()
            };
            pushAttempt({ t: Date.now(), phase: 'agent-connected', output: 'uid=' + conn.identity.uid + ' cap=' + conn.identity.cap_eff });
            persist();
            // The agent has detached; release any remaining launch connection.
            if (launchClient) { try { sdb.close(launchClient); } catch (e) {} launchClient = null; }
            notifyAgent(true);
        },
        onClose: function () {
            if (agentServer !== server || !state.running) return;
            if (!serverListening) {
                try { server.close(); } catch (e) {}
                agentServer = null;
                rootFailure('agent-connection', 'agent-disconnected');
                persist();
                return;
            }
            var connectedFor = state.agent && state.agent.at ? Date.now() - state.agent.at : 0;
            agentConnected = false;
            state.agent = { connected: false };
            timing.losses++;
            loss = {at: Date.now(), hr: process.hrtime(), connectedFor: connectedFor, attempts: 0};
            // Only an agent that had been up for a while is recovered fast: one that dies right after connecting keeps the backoff.
            lossHr = connectedFor >= STABLE_MS ? loss.hr : null;
            lastFailure = lossHr ? 'sdb-handshake:loss' : null;
            rootFailure('agent-connection', 'agent-disconnected');
            if (launchClient) { try { sdb.close(launchClient); } catch (e) {} launchClient = null; }
            persist();
            notifyAgent(false);
            scheduleRelaunch();
        }
    });
    agentServer = server;

    startTunnel(function () {
        if (agentServer !== server || !state.running) return;
        server.start(function (port) {
            if (agentServer !== server || !state.running) return;
            serverListening = true;
            if (!startHr) startHr = process.hrtime();
            state.agentPort = port;
            if (typeof crypto.generateKeyPairSync !== 'function') prepareForRuntime(port);
            relaunch();
        });
    });
}

function scheduleRelaunch() {
    if (!state.running || state.unsupported || relaunchTimer) return;
    rootPhase('retrying');
    relaunchTimer = setTimeout(function () {
        relaunchTimer = null;
        relaunch();
    }, fastRetry() ? FAST_RETRY_MS : retryPolicy.relaunchDelay(launchFailures));
}

function relaunch() {
    if (launching || agentConnected || !agentServer || !state.agentPort || !state.running || state.unsupported) return;
    launching = true;
    rootPhase('preparing');
    var gen = ++launchGen;

    // kill any previous hanging injection before starting a new one, so two
    // archive-root chains never run at once (they share the staging dir and
    // the single token)
    if (launchClient) { try { sdb.close(launchClient); } catch (e) {} launchClient = null; }

    var stage = 'sdb-handshake';
    rootPhase('sdb-handshake');
    state.preflight = null;
    var entry = { t: Date.now(), phase: 'launch' };
    pushAttempt(entry);
    if (loss) loss.attempts++;
    // How long each stage of this attempt took (shown in status().timing once it connects).
    var times = attemptTimes = {ms: {}, hr: process.hrtime()};
    function lap(name) { times.ms[name] = hrMs(times.hr); times.hr = process.hrtime(); }
    Promise.resolve().then(function () {
        if (!state.running || gen !== launchGen || agentConnected) return;
        return sdb.connect(sdbTarget());
    }).then(function (client) {
        if (!state.running || gen !== launchGen || agentConnected) { if (client) sdb.close(client); return; }
        launchClient = client;
        entry.connect = 'ok';
        lap('handshakeMs');
        stage = 'preflight';
        rootPhase('preflight');
        return checkTarget({run: createPreflightRunner(client, buildInjection)});
    }).then(function (assessment) {
        if (!state.running || gen !== launchGen || agentConnected) return;
        lap('preflightMs');
        state.preflight = assessment;
        stage = 'preparation';
        rootPhase('preparing');
        if (!state.prepared || state.preparedRuntime !== assessment.runtime) {
            state.prepared = false;
            try { prepare(state.agentPort, assessment.runtime); } catch (e) {
                state.prepareError = String(e.message || e);
                e.code = 'prepare-failed';
                throw e;
            }
        }
        delete state.prepareError;
        lap('prepareMs');
        try {
            fs.writeFileSync(STAGE + '/' + pkg + '/root-agent.token', secretB64 + '\n', { mode: 384 /* 0o600 */ });
        } catch (e) {
            e.code = 'token-write-failed';
            throw e;
        }
        return launchClient;
    })
        .then(function (client) {
            if (!state.running || gen !== launchGen || agentConnected) {
                sdb.close(client);
                if (gen === launchGen) launching = false;
                return;
            }
            launchClient = client;
            var launchCmd = '/usr/bin/dotnet ' + STAGE + '/' + pkg + '/SamsungTvArchiveRoot.dll ' + pkg;
            var injection = buildInjection(launchCmd);
            entry.connect = 'ok';
            rootPhase('launch-command');
            // The launch script returns independently of the agent lifetime.
            // Release this connection on agent connect as an additional safeguard.
            function closeLaunch() {
                if (launchClient === client) launchClient = null;
                if (client) { try { sdb.close(client); } catch (ignored) {} }
            }
            Promise.resolve().then(function () {
                if (!state.running || gen !== launchGen || agentConnected) return;
                return sdb.exec(client, 'shell:0 appinstall tpk ' + injection, { timeout: 60000 });
            }).then(function (out) {
                entry.output = out;
                if (gen === launchGen) { lap('dispatchMs'); times.dispatchHr = times.hr; }
                if (state.running && gen === launchGen && !agentConnected) rootPhase('agent-callback');
            }).catch(function (e) {
                entry.err = String(e.message || e);
                if (state.running && gen === launchGen && !agentConnected) {
                    rootFailure('launch-command', transportCode(e));
                    rootPhase('agent-callback');
                    persist();
                }
            }).then(closeLaunch, closeLaunch);
            launching = false;
            // if the agent has not connected within 30s, retry — but only if
            // this launch is still the current one (no newer relaunch started)
            if (callbackTimer) clearTimeout(callbackTimer);
            var cbTimer = setTimeout(function () {
                if (callbackTimer === cbTimer) callbackTimer = null;
                if (state.running && gen === launchGen && !agentConnected && !launching) {
                    // Keep a more specific error from this launch when available.
                    if (!entry.err) rootFailure('agent-callback', 'agent-timeout');
                    launchFailures++;
                    relaunch();
                }
            }, retryPolicy.callbackWait(launchFailures));
            callbackTimer = cbTimer;
        })
        .catch(function (e) {
            // This attempt is over whatever happened around it. Leaving the flag set when the agent connected
            // meanwhile would make every relaunch after a later disconnect return at once.
            if (gen === launchGen) launching = false;
            if (!state.running || gen !== launchGen || agentConnected) return;
            if (launchClient) sdb.close(launchClient);
            launchClient = null;
            entry.connect = 'fail:' + (e.code || 'error');
            entry.err = String(e.message || e);
            var code = stage === 'sdb-handshake' ? transportCode(e) : e.code || 'preflight-failed';
            rootFailure(stage, code);
            // Inside the fast window (see FAST_RETRY_MS) a refused handshake is not counted, and the same failure again is not logged again.
            var failure = stage + ':' + code, repeat = fastRetry() && failure === lastFailure;
            lastFailure = failure;
            if (!fastRetry()) launchFailures++;
            if (!repeat) persist();
            scheduleRelaunch();
        });
}

// Both files are capped (retry-policy.js): /tmp is RAM and /opt is a flash partition that is often nearly full.
function persist() {
    var line = JSON.stringify(state) + '\n';
    retryPolicy.appendBounded(fs, '/opt/usr/home/owner/share/vetro.jsonl', line);
    retryPolicy.appendBounded(fs, '/tmp/vetro.jsonl', line);
}

function agentExecute(cmd, timeoutMs) {
    if (!agentServer || !agentConnected) {
        var missing = new Error('no root agent connected');
        missing.code = 'no-root-agent';
        return Promise.reject(missing);
    }
    var timeout = timeoutMs == null ? 30000 : timeoutMs;
    if (typeof timeout === 'number' && isFinite(timeout)) {
        timeout = Math.max(100, Math.min(Math.floor(timeout), 120000));
    }
    return agentServer.execute(cmd, timeout);
}

function status() {
    return Object.assign({}, state, { mode: 'tv-integration', agentLog: agentServer ? agentServer.log : [],
        timing: {firstConnect: timing.firstConnect, reconnect: timing.reconnect, losses: timing.losses} });
}
// fn(true) when the agent connects, fn(false) when it is lost. The service uses it to restore the remote bridge at once.
function onAgent(fn) { if (typeof fn === 'function') agentListeners.push(fn); }
function stop() {
    state.running = false;
    state.agentPort = null;
    rootPhase('stopped');
    ++launchGen;
    if (relaunchTimer) clearTimeout(relaunchTimer);
    relaunchTimer = null;
    if (callbackTimer) clearTimeout(callbackTimer);
    callbackTimer = null;
    if (launchClient) sdb.close(launchClient);
    launchClient = null;
    if (agentServer) agentServer.close();
    agentServer = null;
    agentConnected = false;
    if (tunnelRetryTimer) clearTimeout(tunnelRetryTimer);
    tunnelRetryTimer = null;
    if (tunnelServer) tunnelServer.close();
    tunnelServer = null;
    state.sdbTunnel = { listening: false };
    launching = false;
    launchFailures = 0;
    lossHr = null; lastFailure = null; loss = null; attemptTimes = null;
    state.agent = {connected: false};
}
function install(packageId, wgtPath) {
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(packageId) || !/^\/[A-Za-z0-9_./-]+\.wgt$/.test(wgtPath)) {
        return Promise.reject(new Error('invalid package ID or WGT path'));
    }
    var dispatched = false;
    return sdb.connect(sdbTarget()).then(function (client) {
        dispatched = true;
        return sdb.exec(client, 'shell:0 vd_appinstall ' + packageId + ' ' + wgtPath, {timeout: 120000})
            .then(function (r) { sdb.close(client); return r; }, function (e) { sdb.close(client); throw e; });
    }).catch(function (error) {
        error.submitted = dispatched ? null : false;
        throw error;
    });
}
function setApplicationsEnabled(appIds, enabled) {
    try {
        var command = enabled ? debloatCommands.enableCommand(appIds) : debloatCommands.disableCommand(appIds);
        return agentExecute(command, 60000);
    } catch (error) { return Promise.reject(error); }
}
module.exports = {start: startAgent, stop: stop, status: status, execute: agentExecute, onAgent: onAgent, retryNow: retryNow,
    sdbAccess: sdbAccess, setSdbAccess: setSdbAccess, install: install, setApplicationsEnabled: setApplicationsEnabled};
