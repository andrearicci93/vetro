'use strict';
// The Tizen 10 host bootstrap must stay a short command: the vddebugmenu
// task-name reader executes single read() fragments, so long lines break.
// Vetro prepares a /tmp/vetro symlink to the staging dir and an l.sh launcher;
// the host only ever sends `cat /tmp/vetro/l.sh|sh`.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');

process.env.VETRO_ROOT_BACKEND = 'vddebugmenu';

const files = {};
const links = {};
const fakeFs = {
    readFileSync: function (p, enc) { if (files[p] != null) return files[p]; if (String(p).indexOf(root) === 0) return fs.readFileSync(p, enc); throw new Error('ENOENT'); },
    writeFileSync: function (p, d) { files[p] = String(d); },
    appendFileSync: function (p, d) { files[p] = (files[p] || '') + String(d); },
    statSync: function (p) { if (files[p] == null) throw new Error('ENOENT'); return {size: Buffer.byteLength(files[p])}; },
    mkdirSync: function () {}, readdirSync: function () { return []; },
    existsSync: function (p) { return String(p).endsWith('payload/vddebugmenu.enabled'); },
    unlinkSync: function (p) { if (links[p] == null && files[p] == null) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } delete links[p]; delete files[p]; },
    symlinkSync: function (target, p) { links[p] = target; }
};
let agentOpts = null;
const dependencies = {
    fs: fakeFs,
    './root-preflight.js': {checkTarget: () => Promise.resolve({runtime: '6.0', source: 'detected'})},
    './root-preflight-capture.js': {createRunner: () => function () { return Promise.resolve(''); }},
    './sdb.js': {connect: () => Promise.resolve({}), close: () => {}, exec: () => { throw new Error('no SDB exec'); }},
    './vddebugmenu.js': {run: () => Promise.resolve('VETRO_VDDEBUG_DONE_test')},
    './root-agent.js': {RootAgentServer: function (o) { agentOpts = o; this.start = function (cb) { cb(o.port); }; this.close = function () {}; this.log = []; }},
    './sdb-tunnel.js': {TunnelServer: function () { this.start = function (cb) { if (cb) cb(null, 26201); }; this.close = function () {}; }}
};
const timers = [];
const context = vm.createContext({module: {exports: {}},
    require: name => Object.prototype.hasOwnProperty.call(dependencies, name) ? dependencies[name]
        : name[0] === '.' ? require(path.join(root, 'service', name)) : require(name),
    __dirname: path.join(root, 'service'), Buffer, process, console,
    setTimeout: function (fn, ms) { const t = {fn, ms, cleared: false}; timers.push(t); return t; },
    clearTimeout: function (t) { if (t) t.cleared = true; }});
vm.runInContext(fs.readFileSync(path.join(root, 'service/platform.js'), 'utf8'), context);
const provider = context.module.exports;

(async function () {
    provider.start();
    await new Promise(r => setImmediate(r));
    const status = provider.status();
    assert.equal(status.rooting.backend, 'vddebugmenu');
    assert.equal(status.rooting.phase, 'agent-callback');
    assert.equal(status.agentPort, 26202);
    const dir = status.staging.dir;
    assert.ok(dir.indexOf('/home/owner/share/tmp/sdk_tools/') === 0, 'staging stays under the root the agent validates');
    assert.equal(links['/tmp/vetro'], dir, 'the short symlink points at the staging dir');
    const launch = files[dir + '/l.sh'];
    assert.ok(launch, 'l.sh is written');
    assert.ok(launch.indexOf('/usr/bin/dotnet ' + dir + '/SamsungTvRootAgent.dll 127.0.0.1 26202 ' + dir + '/root-agent.token ' + dir) >= 0, 'the full dotnet line lives in the file, not in the menu input');
    assert.ok(/&\n\s*sleep 3\s*$/.test(launch), 'the agent is backgrounded and the parent stays alive for callback setup');
    assert.ok(files[dir + '/root-agent.token'], 'the token is written');
    const hostCommand = 'cat /tmp/vetro/l.sh|sh';
    assert.ok(hostCommand.length <= 40, 'the bootstrap command stays short: ' + hostCommand.length);

    // After a loss the adapter refreshes token + launcher and waits for the
    // host again; it never dials the unreachable loopback SDB.
    files[dir + '/root-agent.token'] = undefined;
    delete files[dir + '/root-agent.token'];
    agentOpts.onClose();
    await new Promise(r => setImmediate(r));
    const retry = timers.filter(t => !t.cleared && t.ms >= 8000).pop();
    assert.ok(retry, 'a relaunch is armed after the loss');
    retry.fn();
    await new Promise(r => setImmediate(r));
    assert.equal(provider.status().rooting.phase, 'agent-callback');
    assert.ok(files[dir + '/root-agent.token'], 'the token is rewritten for the next bootstrap');
    assert.equal(links['/tmp/vetro'], dir);
    provider.stop();
    console.log('PASS host bootstrap: short symlink command, l.sh launcher, token refresh without SDB');
})().catch(e => { console.error(e); process.exit(1); });
