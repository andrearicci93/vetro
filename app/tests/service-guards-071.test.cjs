'use strict';
const assert = require('assert').strict;
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

function decodeWrap(cmd) {
    const m = /^echo (\S+) \| base64 -d \| sh$/.exec(cmd);
    assert.ok(m, 'expected base64-wrapped sh command');
    return Buffer.from(m[1], 'base64').toString('utf8');
}

// 1. disabled-ledger.js: empty input never invokes grep -e "" wipe; parse uses null-proto map; rc guard before mv
{
    const ledger = require('../service/disabled-ledger.js');
    assert.equal(decodeWrap(ledger.removeCommand([])), 'true');
    assert.equal(decodeWrap(ledger.removeCommand()), 'true');
    assert.equal(decodeWrap(ledger.removeCommand(null)), 'true');
    const rmScript = decodeWrap(ledger.removeCommand(['com.example.a']));
    assert.ok(rmScript.includes('rc=$?') && rmScript.includes('[ "$rc" -le 1 ]'), 'removeCommand must guard mv on grep exit code');
    assert.deepEqual(ledger.parse('com.example.a\nconstructor\ncom.example.a\n'), ['com.example.a', 'constructor']);
}

// 2. component-actions.js: atomic non-empty backup and .timeout 5000 on readonly queries
{
    const actions = require('../service/component-actions.js');
    const script = decodeWrap(actions.command({ action: 'flags', flag: 'onboot', enabled: false }, { appId: 'com.test.app', packageId: 'com.test' }));
    assert.ok(script.includes('[ ! -s "$backup" ]'), 'backup guard checks non-empty file');
    assert.ok(script.includes('> "$backup.tmp"') && script.includes('[ ! -s "$backup.tmp" ]') && script.includes('mv -f "$backup.tmp" "$backup"'), 'backup writes atomically via .tmp');
    const readonlyCalls = script.match(/sqlite3 -readonly[^\n]*/g) || [];
    assert.equal(readonlyCalls.length, 2);
    readonlyCalls.forEach(c => assert.ok(c.includes('.timeout 5000'), 'readonly query must set .timeout 5000: ' + c));
}

// 3. plugin-host.js: RESERVED prototype names, null-proto/non-array _readState, atomic _writeState, cardJobs cleanup in _halt
{
    const { PluginHost } = require('../service/plugin-host.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-ph071-'));
    const h = new PluginHost({ dir, external: false });
    assert.throws(() => h.register({ id: 'constructor', apiVersion: 1, create() { return {}; } }), /Invalid plugin id/);
    assert.throws(() => h.register({ id: 'prototype', apiVersion: 1, create() { return {}; } }), /Invalid plugin id/);

    fs.writeFileSync(path.join(dir, 'plugins.json'), '{"enabled":[],"trust":[],"suspended":false}');
    const st = h._readState();
    assert.equal(st.enabled.constructor, undefined, 'enabled map must not inherit Object.prototype');
    assert.equal(st.trust.toString, undefined, 'trust map must not inherit Object.prototype');
    assert.equal(Array.isArray(st.enabled), false, 'array enabled in JSON rejected');

    h._writeState({ enabled: { a: true }, suspended: false, developer: false, trust: {} });
    assert.equal(fs.existsSync(path.join(dir, 'plugins.json.tmp')), false);
    assert.equal(h._readState().enabled.a, true);

    h.cardJobs['dummy'] = { read: Promise.resolve() };
    h._halt({ def: { id: 'dummy' }, instance: { stop() {} } });
    assert.equal(h.cardJobs['dummy'], undefined, '_halt must clear cardJobs entry');
}

// 4. control.js: KEY_SET and LAN_KEYS immune to Object.prototype shadowing
{
    const control = require('../service/control.js');
    for (const bad of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
        assert.equal(control.injectCommand(bad), null, 'injectCommand rejects ' + bad);
        assert.equal(control.nativeKey(bad), null, 'nativeKey rejects ' + bad);
    }
    assert.equal(control.nativeKey('KEY_HOME'), 'XF86Home');
    assert.equal(control.injectCommand('XF86Home'), '/usr/bin/input_keyevent XF86Home');
}

// 5. dock-catalog.js: 0-byte .appLayerCache.1 fallback, .timeout 5000, fixTizenTube on non-csfs fallback & pool
{
    const catalog = require('../service/dock-catalog.js');
    const script = catalog.script();
    assert.ok(script.includes('[ -s "$B/.appLayerCache.1" ]') && script.includes('[ -s "$B/.appLayerCache.2" ]'), 'cache script checks -s before cat');
    const sqAll = script.match(/sqlite3 -readonly/g) || [];
    const sqTimeout = script.match(/sqlite3 -readonly -cmd "\.timeout 5000"/g) || [];
    assert.ok(sqAll.length >= 3, 'expected at least 3 catalog sqlite3 -readonly calls');
    assert.equal(sqTimeout.length, sqAll.length, 'every catalog sqlite3 -readonly must set .timeout 5000');

    const hex = s => Buffer.from(s).toString('hex');
    const ytIcon = '/opt/share/webappservice/apps_icon/all/yt/224x224.png';
    const ttIcon = '/opt/share/webappservice/apps_icon/all/tt/icon.png';
    const out = [
        'F|media',
        'R|' + hex('yt0') + '|' + hex('YouTube') + '|' + hex('com.samsung.tv.cobalt-yt') + '|0|1',
        'R|' + hex('tt0') + '|' + hex('TizenTube') + '|' + hex('9Ur5IzDKqV.TizenTube') + '|0|1',
        'I|yt0|' + ytIcon,
        'I|tt0|' + ttIcon,
        'A|' + hex('com.samsung.tv.cobalt-yt') + '|false',
        'A|' + hex('9Ur5IzDKqV.TizenTube') + '|false'
    ].join('\n');
    const built = catalog.build(catalog.parse(out), { fixTizenTube: true });
    const ttEntry = built.entries.find(e => e.appId === '9Ur5IzDKqV.TizenTube');
    assert.ok(ttEntry, 'TizenTube present in media fallback entries');
    assert.equal(ttEntry.killFirst, 'com.samsung.tv.cobalt-yt');
    assert.equal(ttEntry.icon, ytIcon);

    // Empty Home order with csfs present still populates allApps via poolList with fixTizenTube applied
    const outPool = out.replace('F|media', 'F|csfs');
    const builtPool = catalog.build(catalog.parse(outPool), { fixTizenTube: true });
    const ttPool = builtPool.allApps.find(e => e.appId === '9Ur5IzDKqV.TizenTube');
    assert.ok(ttPool && ttPool.killFirst === 'com.samsung.tv.cobalt-yt' && ttPool.icon === ytIcon);
}

// 6-12 Async service guard tests
(async () => {
    // 5b. dock.js: lastCards in catch fallback, refreshPending preserved on error, openEntry honors execute failure
    const { Dock } = require('../service/dock.js');
    const dDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-dock071-'));
    const d = new Dock({
        dir: dDir,
        stateFile: path.join(dDir, 'missing.json'),
        appsFile: path.join(dDir, 'apps.tsv'),
        execute: async (cmd) => {
            if (/^app_launcher -s /.test(cmd)) return { exit_code: 1, stdout: '', stderr: 'launch refused' };
            return { exit_code: 0, stdout: '' };
        },
        now: () => 1000,
        uptime: () => 99999
    });
    assert.deepEqual(d.readState().lastCards, [], 'missing state fallback provides lastCards array');
    d.writeCatalog = () => Promise.reject(new Error('disk full'));
    d.refreshPending = true;
    d.refreshCatalogLater();
    await new Promise(r => setTimeout(r, 10));
    assert.equal(d.refreshPending, true, 'refreshCatalogLater restores refreshPending on failure');
    d.entries = () => [{ slug: 'yt', appId: 'com.test.yt', shard: true, system: false, panel: false, source: null }];
    d.shards = null;
    const openRes = await d.openEntry('yt');
    assert.equal(openRes.ok, false);
    assert.match(openRes.reason, /launch refused/);

    // 8. restore.js: parallel plan() + areaProven + keyGuides, and runComponents() runs inventory before ledger read
    const { Restore } = require('../service/restore.js');
    let rActive = 0, rMax = 0;
    const track = fn => async (...a) => {
        rActive++;
        if (rActive > rMax) rMax = rActive;
        await new Promise(r => setTimeout(r, 2));
        try { return fn(...a); } finally { rActive--; }
    };
    const rest = new Restore({
        inventory: track(() => ({ apps: [], registryError: false })),
        wins: { read: track(() => ({ wins: { telemetry: { status: 'off' }, ambient: { status: 'off' }, multiscreen: { status: 'off' }, firmware: { status: 'off' }, airplay: { status: 'off' } } })) },
        keyGuides: { read: track(() => ({ status: 'on' })), apply: async () => ({ status: 'off' }) },
        hbbtv: { read: track(() => ({ off: false })) },
        dns: { status: track(() => ({ enabled: false, applied: false })) },
        execute: track(() => ({ exit_code: 0, stdout: 'HO|0|0\n' })),
        plugins: { list: () => [] },
        dock: { readState: () => ({ enabled: false }) },
        input: { active: () => false },
        mqtt: { enabled: () => false }
    });
    const plan = await rest.plan();
    assert.ok(plan && Array.isArray(plan._data.areaProven), 'Restore.plan exposes _data.areaProven');
    assert.ok(plan.items.some(i => i.id === 'key-guides' && i.state === 'changed'), 'Restore.plan includes keyGuides item');
    rMax = 0;
    await rest.runComponents(plan._data.areaProven);
    assert.equal(rMax, 1, 'Restore.runComponents runs inventory before ledger read');

    // 9. mqtt.js: _fail destroys without DISCONNECT; graceful close sends DISCONNECT
    const { MqttClient } = require('../service/mqtt.js');
    function makeConnectedClient() {
        const sock = Object.assign(new EventEmitter(), {
            written: [], destroyed: false, ended: false,
            setNoDelay() {}, setTimeout() {},
            write(b) { sock.written.push(Buffer.from(b)); },
            end(b) { sock.ended = true; if (b) sock.written.push(Buffer.from(b)); },
            destroy() { sock.destroyed = true; }
        });
        const c = new MqttClient({ host: '127.0.0.1' }, () => sock);
        c._connected = true;
        c._socket = sock;
        return { c, sock };
    }
    const failCase = makeConnectedClient();
    failCase.c.on('error', () => {});
    failCase.c._fail('keepalive timeout');
    assert.equal(failCase.sock.destroyed, true);
    assert.equal(failCase.sock.ended, false);
    assert.equal(failCase.sock.written.length, 0, '_fail must NOT send DISCONNECT packet');

    const okCase = makeConnectedClient();
    okCase.c.close();
    assert.equal(okCase.sock.ended, true);
    assert.equal(okCase.sock.written[0][0] >> 4, 14, 'graceful close sends MQTT DISCONNECT (type 14)');

    // 10. system-monitor.js: negative clock guard in UNITS_READ & startup({wait}) bypassing incomplete cache
    const monitor = require('../service/system-monitor.js');
    let agePhase = 0;
    const m = new monitor.Monitor(cmd => {
        if (cmd.indexOf('echo "AGE|$a"') >= 0) {
            assert.ok(cmd.includes('[ "$a" -lt 0 ] && a=999999'), 'UNITS_READ handles backward clock step');
            assert.ok(cmd.includes('la=999999') && cmd.includes('[ "$la" -lt 0 ]'), 'UNITS_READ handles negative lock age');
            assert.ok(cmd.includes('|| rm -f '), 'UNITS_READ cleans .tmp on failure');
            agePhase++;
            return Promise.resolve({ exit_code: 0, stdout: agePhase >= 2 ? 'AGE|1\nhotel.service disabled\n' : 'AGE|999999\n' });
        }
        return Promise.resolve({ exit_code: 0, stdout: 'hotel.service loaded active running Hotel\n' });
    });
    const incomplete = await m.startup();
    assert.equal(incomplete[0].bootState, null);
    const complete = await m.startup({ wait: 5000 });
    assert.equal(complete[0].bootState, 'disabled', 'startup({wait}) must bypass fresh incomplete cache');

    // 11. plugin-launcher.js: action(null) via route never crashes
    const { PluginHost } = require('../service/plugin-host.js');
    const launcher = require('../service/plugin-launcher.js');
    const ld = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-pl071-'));
    const ph = new PluginHost({
        dir: ld, external: false, stableMs: 10,
        services: {
            agentConnected: () => false,
            json(res, obj, code) { res.code = code || 200; res.body = obj; },
            readJson(req, res, cb) { cb(null); } // simulate permissive body reader passing JSON null
        }
    }).register(launcher.definition({
        readState: () => ({ enabled: false }), installed: () => true,
        status: async () => ({}), enable: async () => ({}), disable: async () => ({}),
        refresh: async () => ({}), supervise: async () => {}
    }, { tickMs: 1000 }));
    ph.start();
    const resObj = { code: 0, body: null };
    ph.dispatch('launcher', { method: 'POST', url: '/dock', headers: {} }, resObj, 'action', (r, o, c) => { r.code = c || 200; r.body = o; });
    await new Promise(r => setTimeout(r, 15));
    assert.equal(resObj.code, 409);
    assert.deepEqual(resObj.body, { ok: false, error: 'Invalid dock action' });
    ph.stop();

    // 13. main.js: listen backoff and serviceOwner guard on all 8 boot/maintenance timers
    const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'service', 'main.js'), 'utf8');
    assert.match(mainSrc, /var listenRetries = 0;/);
    for (const name of ['updateConfirmTimer', 'dnsRestoreTimer', 'lockBootTimer', 'winsBootTimer', 'keepRemovedTimer', 'keepRemovedBootTimer', 'startupWarmTimer', 'selfStartupTimer']) {
        const re = new RegExp('var ' + name + '\\s*=\\s*setInterval\\(function\\s*\\(\\)\\s*\\{\\s*if\\s*\\(!serviceOwner\\)\\s*return;');
        assert.match(mainSrc, re, name + ' must check if (!serviceOwner) return; first');
    }

    // 13b. Behavioral vm test for main.js boot timer gating and listen retry backoff
    const vm = require('vm');
    const serviceRoot = path.resolve(__dirname, '..', 'service');
    const serverEvents = {};
    const intervals = [];
    const timeouts = [];
    const errLogs = [];
    const fakeProcess = { env: {}, argv: ['node', 'main.js'], pid: 12345, on() {}, exit() {} };
    const fakeConsole = { log() {}, error() { errLogs.push(Array.prototype.slice.call(arguments).join(' ')); } };
    const vmDeps = {
        fs: Object.assign({}, fs, { readFileSync() { return ''; } }),
        http: { createServer() { return { listen() {}, on(ev, cb) { serverEvents[ev] = cb; } }; } },
        './updater.js': { Updater: function () { this.finish = () => Promise.resolve(); } },
        './platform.js': { start() {}, stop() {}, onAgent() {}, status: () => ({ mode: 'tv-integration', agent: { connected: true } }) },
        './plugin-host.js': { PluginHost: function () { this.register = () => {}; this.start = () => {}; this.stop = () => {}; } },
        './mqtt-bridge.js': Object.assign({}, require('../service/mqtt-bridge.js'), {
            MqttBridge: function () { this.onMessage = () => {}; this.event = () => {}; this.connected = false; this.start = () => {}; this.setTopics = () => {}; this.status = () => ({ connected: false, state: 'disabled', events: [] }); this.configure = () => {}; this.publish = () => {}; }
        }),
        './stale-service.js': { endOlderService: () => Promise.resolve({ ended: false, reason: 'no-answer' }) }
    };
    const ctx = vm.createContext({
        require(name) {
            if (Object.prototype.hasOwnProperty.call(vmDeps, name)) return vmDeps[name];
            return name[0] === '.' ? require(path.join(serviceRoot, name)) : require(name);
        },
        __dirname: serviceRoot,
        module: { exports: {} },
        Buffer, process: fakeProcess, console: fakeConsole,
        setTimeout(fn, ms) { timeouts.push({ fn, ms }); return { unref() {} }; },
        clearTimeout() {},
        setInterval(fn, ms) { const h = { fn, ms, cleared: false, unref() {} }; intervals.push(h); return h; },
        clearInterval(h) { if (h) h.cleared = true; }
    });
    vm.runInContext(mainSrc, ctx);
    for (const h of intervals) h.fn();
    assert.equal(ctx.updateConfirmAttempts, 0);
    assert.equal(ctx.dnsRestoreAttempts, 0);
    assert.equal(ctx.lockBootAttempts, 0);
    assert.equal(ctx.winsBootAttempts, 0);
    assert.equal(ctx.keepRemovedBootAttempts, 0);
    assert.equal(ctx.startupWarmAttempts, 0);
    assert.equal(ctx.selfStartupAttempts, 0);

    for (let i = 0; i < 5; i++) serverEvents.error({ code: 'EACCES' });
    assert.deepEqual(timeouts.map(t => t.ms), [15000, 30000, 60000, 120000, 240000]);
    assert.equal(errLogs.filter(l => /cannot listen on port/.test(l)).length, 3);
    assert.equal(ctx.listenRetries, 5);

    serverEvents.listening();
    assert.equal(ctx.listenRetries, 0);
    timeouts.length = 0;
    serverEvents.error({ code: 'EACCES' });
    assert.deepEqual(timeouts.map(t => t.ms), [15000]);

    // 13c. main.js: keyGuides.chosen() cache and hasKeyCapability validation
    let kgReads = 0;
    vmDeps.fs.readFileSync = p => {
        if (String(p).indexOf('vetro-key-guides.json') !== -1) { kgReads++; return '{"on":true}'; }
        if (String(p).indexOf('/capabilities/key') !== -1) return '10000 0\n';
        return 'null';
    };
    assert.equal(ctx.keyGuides.chosen(), true);
    assert.equal(ctx.keyGuides.chosen(), true);
    assert.equal(kgReads, 1, 'keyGuides.chosen() must cache disk read in memory');
    assert.equal(ctx.hasKeyCapability({ selectable: true, node: '/dev/input/event4' }), true);
    assert.equal(ctx.hasKeyCapability({ selectable: false, node: '/dev/input/event4' }), false);
    assert.equal(ctx.hasKeyCapability({ selectable: true, node: '/dev/input/../evil' }), false);

    // 14. Round 3 service guards: SQLite .timeout 5000 (app-registry, dock-catalog), prototype keys, bootAirplay & shardCardSelect
    const appRegistry = require('../service/app-registry.js');
    let regCmd = '', oneCmd = '';
    await appRegistry.load(cmd => { regCmd = cmd; return Promise.resolve({exit_code: 0, stdout: '\n__VETRO_DEPS__\n\n__VETRO_DEPS_RC__0\n__VETRO_USER__\n'}); }, {apps: [], packages: []});
    await appRegistry.one(cmd => { oneCmd = cmd; return Promise.resolve({exit_code: 0, stdout: '\n__VETRO_USER__\n'}); }, 'org.example.app');
    assert.equal((regCmd.match(/-cmd "\.timeout 5000"/g) || []).length, 3, 'all 3 sqlite3 calls in app-registry.load use .timeout 5000');
    assert.equal((oneCmd.match(/-cmd "\.timeout 5000"/g) || []).length, 2, 'both sqlite3 calls in app-registry.one use .timeout 5000');

    const dockCatalog = require('../service/dock-catalog.js');
    assert.ok(dockCatalog.hbbtvLink.launchCommand('5exPmCT0nz.svtplay').includes('sqlite3 -readonly -cmd ".timeout 5000"'), 'hbbtvLink.launchCommand uses .timeout 5000');
    const protoBuilt = dockCatalog.build({
        order: ['d/webapp@c', 's/livetv@toString'],
        registry: {c: {title: 'Constructor', appId: 'org.example.ctor', hidden: false}},
        icons: {},
        packageIcons: {}
    });
    assert.equal(protoBuilt.entries[0].slug, 'constructor', 'app titled Constructor keeps slug "constructor" instead of colliding with Object.prototype');
    assert.ok(protoBuilt.skipped.some(s => s.item === 's/livetv@toString' && s.reason === 'Unknown live source'));

    const qw = require('../service/quick-wins.js');
    let savedWins = {};
    const fakeWinsFs = {
        readFileSync() { return JSON.stringify(savedWins); },
        writeFileSync(f, t) { savedWins = JSON.parse(t); },
        renameSync() {}
    };
    const winsOff = new qw.Wins(async () => ({exit_code: 0, stdout: 'AP|1\nAF|0\nAS|active\nAW|0\n'}), {fs: fakeWinsFs, sleep: async () => {}, bootId: () => 'b1'});
    savedWins = {airplay: true, airplayBoot: 'b1'};
    await winsOff.apply('airplay', false);
    assert.equal(savedWins.airplayBoot, null, 'airplay(false) clears airplayBoot');
    savedWins = {airplay: true};
    const winsPollFail = new qw.Wins(async () => ({exit_code: 1, timed_out: true, stdout: ''}), {fs: fakeWinsFs, sleep: async () => {}, bootId: () => 'b2', skipAmbient: true});
    assert.deepEqual(await winsPollFail.boot(null), []);
    assert.equal(savedWins.airplayBoot, undefined, 'failed bootAirplay polls do not stamp airplayBoot');

    const shardDock = new Dock();
    shardDock.setShards({
        selectCard() { return {ok: false, note: 'Failed action'}; },
        cardOf() { throw new Error('cardOf crashed synchronously'); }
    });
    const shardSelectOut = await shardDock.shardCardSelect('broken', 'row1');
    assert.match(shardSelectOut, /^status\tunavailable\nresult\tfail\nnote\tFailed action\nchoosable\t0\n$/);

    console.log('PASS service-guards-071: all 14 service guards verified');
})().catch(e => { console.error(e); process.exitCode = 1; });
