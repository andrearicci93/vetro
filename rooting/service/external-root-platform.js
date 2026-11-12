'use strict';
// Opt-in rendezvous for an already privileged, separately provisioned launcher.
// No SDB, exploit, firmware write, or fallback to acquiring root.
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var compat = fs.existsSync(__dirname + '/compat.js') ? './compat.js' : '../../app/service/compat.js';
require(compat).install();
var RootAgentServer = require('./root-agent.js').RootAgentServer;
var helperCommand = require('./remote-pc-content.js').helperCommand;
var schedule = require('./remote-pc-deadline.js').schedule;
var buildRules = require('./remote-pc-smack.js').buildRules;
var FILES = ['node-root-agent.js', 'shell-executor.js', 'shell-worker.sh', 'compat.js', 'launch', 'session.json', 'launch.tmp'];
function quote(s) { return "'" + s.replace(/'/g, "'\\''") + "'"; }
function unavailable(message, code) {
    var e = new Error(message); e.code = code || 'no-root-agent'; e.submitted = false;
    return Promise.reject(e);
}
function create(options) {
    options = options || {};
    var lifetime = options.lifetimeMs == null ? 900000 : options.lifetimeMs;
    if (!Number.isInteger(lifetime) || lifetime < 1000 || lifetime > 7200000) throw new Error('Invalid external-root lifetime');
    var smack = options.smack || 'none';
    if (['none', 'both-write'].indexOf(smack) < 0) throw new Error('Invalid external-root SMACK mode');
    var server = null, directory = null, secret = null, deadline = null, retry = null, generation = 0;
    var state = {running: false, prepared: false, setupRequired: true, agent: {connected: false},
        rooting: {backend: 'external-root', phase: 'stopped', failure: null}};
    function reset() {
        generation++;
        clearTimeout(deadline); deadline = null;
        clearTimeout(retry); retry = null;
        var old = server; server = null;
        if (old) old.close();
        if (secret) secret.fill(0);
        secret = null;
        if (directory) {
            FILES.forEach(function (name) { try { fs.unlinkSync(path.join(directory, name)); } catch (e) {} });
            try { fs.rmdirSync(directory); } catch (e) {}
        }
        directory = null;
        state.prepared = false; state.setupRequired = true; state.agent = {connected: false};
        delete state.bootstrapPath;
        delete state.bootstrapLog;
    }
    function launchScript(dir) {
        var runtime = '/tmp/vr-' + crypto.randomBytes(12).toString('hex');
        var log = '/tmp/vetro-root-' + crypto.randomBytes(12).toString('hex') + '.log';
        state.bootstrapLog = log;
        var rules = smack === 'none' ? '' : buildRules();
        var inline = 'require(' + JSON.stringify(dir + '/node-root-agent.js') + ').main(process.argv.slice(1))';
        return '#!/bin/sh\numask 077\n' +
            '[ "$(id -u)" = 0 ] && [ "$(id -g)" = 0 ] || exit 1\n' +
            'if [ "${1-}" != --session ]; then\n' +
            '  (set -C; : >' + quote(log) + ') || exit 1\n' +
            '  ' + helperCommand(dir + '/launch', 'vetro-bootstrap', ['--session']) +
                ' </dev/null >' + quote(log) + ' 2>&1 &\n  exit 0\nfi\n' +
            'r=' + quote(runtime) + '\nmkdir -m 700 "$r" || exit 1\n' +
            helperCommand(dir + '/shell-worker.sh', 'vetro-worker', [runtime]) +
                ' </dev/null >>' + quote(log) + ' 2>&1 &\nw=$!\n' +
            'trap \'kill -KILL -- "-$w" 2>/dev/null; rm -f "$r"/*; rmdir "$r" 2>/dev/null\' 0\n' +
            rules + '/usr/bin/node -e ' + quote(inline) + ' ' + quote(dir + '/session.json') +
                ' "$r" "$w" </dev/null >>' + quote(log) + ' 2>&1\n';
    }
    function prepare() {
        if (!state.running) return;
        reset();
        var gen = generation;
        state.rooting.phase = 'preparing'; state.rooting.failure = null;
        try {
            secret = crypto.randomBytes(32);
            directory = '/tmp/vq-' + crypto.randomBytes(12).toString('hex');
            fs.mkdirSync(directory, 448);
            FILES.slice(0, 4).forEach(function (name) {
                var source = name === 'compat.js' ? require.resolve(compat) : path.join(__dirname, name);
                fs.writeFileSync(path.join(directory, name), fs.readFileSync(source), {mode: 420, flag: 'wx'});
            });
            var current = new RootAgentServer({secret: secret,
                onConnect: function (conn) {
                    if (!state.running || gen !== generation) { conn._socket.destroy(); return; }
                    // AUTH proves the peer; a bounded, harmless round trip also
                    // proves that its shell worker can still execute a job.
                    current.execute('printf VETRO_ROOT_READY', 3000).then(function (result) {
                        if (!state.running || gen !== generation) return;
                        if (result.exit_code !== 0 || result.timed_out || result.stdout !== 'VETRO_ROOT_READY') {
                            conn._socket.destroy(); return;
                        }
                        state.agent = Object.assign({connected: true}, conn.identity);
                        state.setupRequired = false; state.rooting.phase = 'connected';
                    }).catch(function () { conn._socket.destroy(); });
                },
                onClose: function (error) {
                    if (!state.running || gen !== generation) return;
                    reset(); state.rooting.phase = 'retrying';
                    state.rooting.failure = {stage: 'agent-connection', code: error ? 'listener-failed' : 'agent-disconnected'};
                    // Prepare a new rendezvous only. Never resubmit a command.
                    retry = setTimeout(prepare, 1000);
                }});
            server = current;
            current.start(function (port) {
                if (!state.running || gen !== generation) { current.close(); return; }
                try {
                    fs.writeFileSync(path.join(directory, 'session.json'), JSON.stringify({host: '127.0.0.1',
                        port: port, secret: secret.toString('base64'), lifetimeMs: lifetime}), {mode: 384, flag: 'wx'});
                    fs.chmodSync(directory, 457 /* 0711: root can traverse, token remains 0600 */);
                    // The external launcher discovers `launch`. Publish it only
                    // after the complete config and source files are ready.
                    fs.writeFileSync(path.join(directory, 'launch.tmp'), launchScript(directory), {mode: 420, flag: 'wx'});
                    fs.renameSync(path.join(directory, 'launch.tmp'), path.join(directory, 'launch'));
                    state.prepared = true; state.bootstrapPath = path.join(directory, 'launch');
                    state.rooting.phase = 'agent-callback';
                    deadline = schedule(function () {
                        reset();
                        if (options.autoRenew !== true) { state.running = false; state.rooting.phase = 'stopped'; }
                    }, prepare, {autoRenew: options.autoRenew === true, lifetimeMs: lifetime});
                } catch (error) { failed(); }
            });
        } catch (error) { failed(); }
    }
    function failed() {
        stop(); state.rooting.failure = {stage: 'preparation', code: 'prepare-failed'};
    }
    function start() { if (!state.running) { state.running = true; prepare(); } }
    function stop() { state.running = false; reset(); state.rooting.phase = 'stopped'; }
    function execute(command, timeoutMs) {
        if (!server || !state.agent.connected) return unavailable('No authenticated external root agent');
        if (typeof command !== 'string' || !command.trim() || command.indexOf('\x00') >= 0 || Buffer.byteLength(command) > 65536 ||
            (timeoutMs != null && (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000))) {
            return unavailable('Invalid external-root command or timeout', 'invalid-request');
        }
        return server.execute(command, timeoutMs).catch(function (error) {
            // Dispatch may have happened; a lost response is not a safe retry.
            if (error.submitted !== false) error.submitted = null;
            throw error;
        });
    }
    function status() {
        return Object.assign({}, state, {agent: Object.assign({}, state.agent),
            rooting: {backend: 'external-root', phase: state.rooting.phase, failure: state.rooting.failure},
            mode: 'tv-integration', experimental: true, persistent: false, autoRenew: options.autoRenew === true,
            smackMode: smack, agentLog: server ? server.log.slice() : [],
            capabilities: {install: false, packageActivation: false, launcher: false, physicalInput: false},
            self: {pid: process.pid, uid: process.getuid(), node: process.version},
            limitations: ['Requires a separately authorized privileged bootstrap',
                'Persistent association and revocation are not implemented', 'Native helpers are not verified on this backend']});
    }
    return {start: start, stop: stop, status: status, execute: execute,
        install: function () { return unavailable('Installation is not verified on the external-root backend', 'unsupported-operation'); },
        setApplicationsEnabled: function () { return unavailable('Package activation is not verified on the external-root backend', 'unsupported-operation'); }};
}
var buildInfo = require(fs.existsSync(__dirname + '/build-info.js') ? './build-info.js' : '../../app/service/build-info.js');
module.exports = create(buildInfo.externalRoot);
module.exports.create = create;
