'use strict';
// Remote PC integration; an existing boot supervisor may renew the channel.
var compatPath = require('fs').existsSync(__dirname + '/compat.js') ? './compat.js' : '../../app/service/compat.js';
require(compatPath).install();
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var RootAgentServer = require('./root-agent.js').RootAgentServer;
var debloatCommands = require('./debloat-commands.js');
var buildInfo = require(fs.existsSync(__dirname + '/build-info.js') ? './build-info.js' : '../../app/service/build-info.js');

function quote(value) { return "'" + value.replace(/'/g, "'\\''") + "'"; }

// This process's own SMACK label (e.g. "User::Pkg::vetrotvapp"), read once
// and reused to let the root agent talk to it on real hardware where the
// universal "_" subject label is explicitly denied socket delivery to a
// package-specific object label (see the launch script below). Validated
// against SMACK's own label grammar (printable, no whitespace, <=23 bytes)
// before ever reaching a shell string; an unreadable/invalid label simply
// skips the rule-load step rather than risk any injection into `launch`.
function ownSmackLabel() {
    try {
        var label = fs.readFileSync('/proc/self/attr/current', 'utf8').trim();
        if (label && label.length <= 23 && /^[\x21-\x7e]+$/.test(label) && label.indexOf('"') === -1) return label;
    } catch (e) { /* no SMACK on this platform, or unreadable */ }
    return null;
}

function create(options) {
    options = options || {};
    var server = null, directory = null, secret = null;
    var state = {running: false, prepared: false, setupRequired: true, agent: {connected: false}};
    var deadline = null;
    function writeConfig(port) {
        var file = path.join(directory, 'session.json');
        // Exclusive creation refuses stale symlinks or replacement files.
        fs.writeFileSync(file, JSON.stringify({host: '127.0.0.1', port: port,
            secret: secret.toString('base64'), lifetimeMs: options.lifetimeMs || 900000}), {mode: 384, flag: 'wx'});
    }
    function start() {
        if (state.running) return;
        state.running = true;
        secret = crypto.randomBytes(32);
        try {
            directory = fs.mkdtempSync ? fs.mkdtempSync('/tmp/vq-') : '/tmp/vq-' + crypto.randomBytes(6).toString('hex');
            if (!fs.mkdtempSync) fs.mkdirSync(directory, 448);
            fs.chmodSync(directory, 448);
            ['node-root-agent.js', 'compat.js', 'shell-executor.js', 'shell-worker.sh'].forEach(function (name) {
                var source = name === 'compat.js' ? require.resolve(compatPath) : path.join(__dirname, name);
                fs.writeFileSync(path.join(directory, name), fs.readFileSync(source), {mode: 420, flag: 'wx'});
            });
            var inline = 'require(' + JSON.stringify(directory + '/node-root-agent.js') + ').main(process.argv.slice(1))';
            state.bootstrapLog = '/tmp/vetro-root-' + crypto.randomBytes(8).toString('hex') + '.log';
            var log = state.bootstrapLog;
            var ownLabel = ownSmackLabel();
            var smackFix = ownLabel
                ? 'printf \'%s\\n\' ' + quote('_ ' + ownLabel + ' rwxat') + ' > /sys/fs/smackfs/load2 2>/dev/null || true\n' +
                  'printf \'%s\\n\' ' + quote(ownLabel + ' _ rwxat') + ' > /sys/fs/smackfs/load2 2>/dev/null || true\n'
                : '';
            var launch = '#!/bin/sh\numask 022\n' +
                'if [ -e ' + log + ' ] || [ -L ' + log + ' ]; then\n' +
                '  [ ! -L ' + log + ' ] && [ -f ' + log + ' ] && [ "$(stat -c %u:%h:%a ' + log + ')" = 0:1:644 ] || exit 1\n' +
                'else\n  (set -C; : >' + log + ') || exit 1\nfi\n' +
                'exec >>' + log + ' 2>&1\nid\ngrep CapEff /proc/self/status\n' +
                'if [ "${1-}" != --session ]; then setsid /bin/sh -c \'. ' + directory + '/launch --session\' </dev/null >>' + state.bootstrapLog + ' 2>&1 & exit 0; fi\n' +
                'umask 077\nr=/tmp/vr-$$\nmkdir -m 700 "$r" || exit 1\n' +
                // Invocazione per contenuto, non per percorso indiretto via
                // variabile ("s=$1;shift;. "$s""): osservato "Killed" su
                // hardware reale (Q74T/NikeM) in questo punto esatto, con
                // id/CapEff del launch gia' stampati correttamente prima -
                // il processo parte e muore per segnale, non viene rifiutato
                // all'avvio. La riga 41 qui sopra (". DIRECTORY/launch",
                // percorso letterale, non da variabile) non mostra lo stesso
                // sintomo sullo stesso hardware.
                'setsid /bin/sh -c "$(cat ' + directory + '/shell-worker.sh)" vetro-worker "$r" </dev/null >>' + state.bootstrapLog + ' 2>&1 &\nw=$!\n' +
                // SMACK blocks the agent's own TCP connect() to this
                // service's listening socket on real hardware (observed:
                // `lsm=SMACK fn=smack_socket_sock_rcv_skb action=denied
                // subject="_" object="<ownLabel>"` in dmesg, even though the
                // agent runs with full capabilities) — the universal "_"
                // label does not get an implicit floor/hat pass for socket
                // delivery on this platform's SMACK build. As root we can
                // load an explicit rule for this one pair before connecting;
                // best-effort (`|| true`) and skipped entirely when this
                // process's own label could not be read, so a platform that
                // does not need it is never put at risk by this step.
                smackFix +
                '/usr/bin/node -e \'' + inline + '\' ' + directory + '/session.json "$r" "$w" </dev/null >>' + state.bootstrapLog + ' 2>&1\n' +
                'kill -KILL -- "-$w" 2>/dev/null\nrm -f "$r"/*\nrmdir "$r" 2>/dev/null\n';
            fs.writeFileSync(path.join(directory, 'launch'), launch, {mode: 420, flag: 'wx'});
            // Code may be read by a differently labelled root process. The
            // directory remains owner-writable only and the token stays 0600.
            fs.chmodSync(directory, 457 /* 0711 */);
            server = new RootAgentServer({secret: secret,
                onConnect: function (conn) {
                    state.agent = Object.assign({connected: true}, conn.identity);
                    state.setupRequired = false;
                },
                onClose: function (error) {
                    if (error) { state.prepareError = error.message; stop(); return; }
                    state.agent = {connected: false};
                    state.setupRequired = true;
                    // A disconnected command is never retried; the owner may launch again.
                    if (state.running) {
                        try { writeConfig(state.agentPort); } catch (e) { state.prepareError = e.message; }
                    }
                }});
            server.start(function (port) {
                try {
                    state.agentPort = port;
                    writeConfig(port);
                    state.prepared = true;
                    // mount.smb.sh joins unquoted credential words with commas.
                    // A space-free stdin entry survives that step unchanged.
                    state.bootstrapUsername = 'lab$(bash<' + directory + '/launch)';
                    // autoRenew: an unattended root supervisor (not an owner at
                    // Remote PC) is expected to pick up a fresh 'launch' every
                    // cycle, so the channel must regenerate itself forever
                    // instead of stopping for good when the deadline fires.
                    // The owner-triggered default (autoRenew falsy) is
                    // unchanged: one window, then stop, exactly as before.
                    deadline = setTimeout(function () {
                        stop();
                        if (options.autoRenew) start();
                    }, options.lifetimeMs || 900000);
                } catch (e) { state.prepareError = e.message; stop(); }
            });
        } catch (e) { state.prepareError = e.message; stop(); }
    }
    function stop() {
        state.running = false;
        clearTimeout(deadline); deadline = null;
        if (server) server.close();
        server = null;
        state.agent = {connected: false};
        state.prepared = false;
        state.setupRequired = true;
        delete state.bootstrapUsername;
        if (secret) secret.fill(0);
        secret = null;
        if (directory) {
            ['session.json', 'launch', 'compat.js', 'node-root-agent.js', 'shell-executor.js', 'shell-worker.sh'].forEach(function (name) {
                try { fs.unlinkSync(path.join(directory, name)); } catch (e) {}
            });
            try { fs.rmdirSync(directory); } catch (e) {}
            directory = null;
        }
    }
    function unavailable(message) {
        var error = new Error(message); error.code = 'q74t-prototype-limited';
        error.submitted = false;
        return Promise.reject(error);
    }
    function execute(command, timeoutMs) {
        if (!server || !state.agent.connected) {
            var missing = new Error('no root agent connected; waiting for the boot supervisor or Remote PC setup');
            missing.code = 'no-root-agent'; missing.submitted = false;
            return Promise.reject(missing);
        }
        return server.execute(command, timeoutMs == null ? 30000 : timeoutMs);
    }
    function install(packageId, wgtPath) {
        if (!options.allowMutations) return unavailable('Package installation is not enabled in diagnostics mode');
        if (typeof packageId !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(packageId) ||
            typeof wgtPath !== 'string' || !/^\/[A-Za-z0-9_./-]+\.wgt$/.test(wgtPath) ||
            /(?:^|\/)\.\.(?:\/|$)/.test(wgtPath)) {
            var invalid = new Error('invalid package ID or WGT path'); invalid.submitted = false;
            return Promise.reject(invalid);
        }
        return execute('vd_appinstall ' + packageId + ' ' + quote(wgtPath), 120000).then(function (result) {
            if (result.exit_code !== 0 || result.timed_out) {
                throw new Error(result.stderr || result.stdout || 'Package installation did not complete');
            }
            // Exit 0 is a submission result, never proof the package was installed.
            return (result.stdout || '') + (result.stderr || '');
        }).catch(function (error) {
            if (error.submitted !== false) error.submitted = null;
            throw error;
        });
    }
    function setApplicationsEnabled(appIds, enabled) {
        if (!options.allowMutations) return unavailable('Package changes are not enabled in diagnostics mode');
        try {
            if (typeof enabled !== 'boolean' || !Array.isArray(appIds) || appIds.length > 32 ||
                appIds.some(function (id) { return typeof id !== 'string' || !/^[A-Za-z0-9_.-]{1,180}$/.test(id); })) {
                throw new Error('invalid application IDs or enabled state');
            }
            if (!enabled && appIds.some(function (id) { return /^vetrotvapp(?:\.|$)/.test(id); })) {
                throw new Error('Cannot disable Vetro');
            }
            var command = enabled ? debloatCommands.enableCommand(appIds) : debloatCommands.disableCommand(appIds);
            if (!appIds.length) return Promise.resolve({exit_code: 0, timed_out: false, stdout: '', stderr: ''});
            return execute(command, 60000);
        } catch (error) { return Promise.reject(error); }
    }
    function status() {
        return Object.assign({}, state, {mode: 'tv-integration', rootMethod: 'remote-pc',
            experimental: true, persistent: false, autoRenew: !!options.autoRenew,
            setupMethod: options.autoRenew ? 'boot-supervisor-or-remote-pc' : 'remote-pc',
            readOnly: !options.allowMutations,
            self: {pid: process.pid, uid: process.getuid(), node: process.version},
            agentLog: server ? server.log.slice() : [],
            limitations: [options.autoRenew ? 'Boot supervisor must already be installed separately' : 'Owner-triggered setup',
                options.autoRenew ? 'Channel renews every 15 minutes' : '15-minute prototype',
                'Launcher and physical input require a compatible .NET runtime']});
    }
    return {start: start, stop: stop, status: status, execute: execute,
        install: install, setApplicationsEnabled: setApplicationsEnabled};
}

// Q74T: nessun operatore presente al Remote PC qui, il supervisore di boot
// (root-supervisor.sh) deve rinnovare il canale da solo a ogni ciclo.
module.exports = create({autoRenew: true, allowMutations: buildInfo.rootMethod === 'remote-pc' &&
    buildInfo.readOnly === false && (buildInfo.remotePcMode === 'manual' || buildInfo.remotePcMode === 'automatic')});
module.exports.create = create;
