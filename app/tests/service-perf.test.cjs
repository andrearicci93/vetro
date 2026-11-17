'use strict';
// The service side of the performance pass (main.js), against a fake root agent:
//  - when the agent connects (a boot, a wake) the remote bridge is restored at once, before any timer round;
//  - a saved interception that keeps failing is tried every 5 s for a minute, then every 30 s; the agent coming back, a
//    request to /input or a saved Remapper bring the 5 s pace back at once;
//  - boot tasks: Vetro's own startup flags are one registry query, the DNS filter that was never used costs no command;
//  - JSON over 1 KB is gzipped for a client that accepts it, and only then; app icons carry an ETag and answer 304;
//  - GET /status counts root commands per minute (rootCommands) and says when the bridge listened again (remoteBridge).
const assert = require('assert').strict, fs = require('fs'), path = require('path'), zlib = require('zlib'), EventEmitter = require('events');
const load = require('./service-harness.cjs'), root = path.resolve(__dirname, '..');

const hex = values => values.map(v => Buffer.from(String(v)).toString('hex')).join('|');
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(32, 1)]);
function registryRow(i) { return hex(['app.' + i, 'pkg.' + i, 'webapp', 'uiapp', 'false', 'true', '1.0', '10', 'A', 'false', 'false', 'false', 'false', 'false', 'App number ' + i, '/usr/apps/pkg.' + i + '/shared/res/icon.png']); }

let disk, starts, inventories, connected, startFails, commands, agentListener, uptime = 100;
class Bridge {
    constructor(execute, onEvent, hooks) { this.hooks = hooks || {}; this.current = {mode: 'off', connected: false}; }
    inventory() { inventories++; return Promise.resolve([{name: 'Smart Control', node: '/dev/input/event5', unique: true, selectable: true}]); }
    status() { return {policy: this.current, events: []}; }
    stop() { this.current = {mode: 'off', connected: false}; }
    async start(device, mode, tokens, list) {
        starts.push({device, mode, list: Array.isArray(list)});
        if (startFails) throw new Error('native input helper did not connect');
        this.current = {mode, connected: true, device: 'Smart Control', node: device};
        if (this.hooks.onConnect) this.hooks.onConnect(this.status());
        return this.status();
    }
}
function boot() {
    const timers = [];
    disk = JSON.stringify({rules: [{id: 'physical_4', enabled: true, trigger: {type: 'physical', value: '4'}, actions: [{type: 'launch', appId: 'example.app'}]}],
        input: {enabled: true, device: 'Smart Control', node: '/dev/input/event5'}});
    starts = []; inventories = 0; connected = false; startFails = false; commands = []; agentListener = null;
    const service = load(root, {dependencies: {
        fs: {readFileSync: p => p.endsWith('vetro-remap.json') ? disk : '', existsSync: () => false, writeFileSync() {}, renameSync() {}, unlinkSync() {}},
        './physical-input.js': {Bridge},
        os: {uptime: () => uptime, networkInterfaces: () => ({})},
        './platform.js': {start() {}, onAgent(fn) { agentListener = fn; }, status: () => ({agent: {connected}, timing: {firstConnect: null, reconnect: null, losses: 0}}),
            execute: cmd => {
                commands.push(cmd);
                if (cmd.includes('package_dependency_info')) return Promise.resolve({exit_code: 0, stdout: ''});
                if (cmd.includes('SELECT hex(app_id),hex(is_disabled)')) return Promise.resolve({exit_code: 0, stdout: ''});
                if (cmd.includes("WHERE a.app_id='vetrotvapp.svc'")) return Promise.resolve({exit_code: 0, stdout: hex(['vetrotvapp.svc', 'vetrotvapp', 'false', 'true', 'false', 'false', 'false', 'true', 'true', '']) + '\n'});
                if (cmd.includes('FROM package_app_info a')) return Promise.resolve({exit_code: 0, stdout: Array.from({length: 40}, (x, i) => registryRow(i)).join('\n') + '\n'});
                if (cmd.includes('base64 "/usr/apps/')) return Promise.resolve({exit_code: 0, stdout: PNG.toString('base64') + '\n'});
                return Promise.resolve({exit_code: 0, stdout: ''});
            }}},
        setInterval: (fn, ms) => { timers.push({fn, ms}); return {unref() {}}; }});
    service.context.dock.readState = () => ({enabled: false, volumePill: false, numberPad: false, customApp: null});
    service.timer = text => timers.filter(t => String(t.fn).includes(text)).map(t => t.fn);
    service.restoreRound = async () => { service.context.restoreInput(); await settle(); };
    return service;
}
const settle = () => new Promise(r => setImmediate(r));
function request(service, method, url, headers, body) {
    return new Promise(resolve => {
        const req = new EventEmitter(); req.method = method; req.url = url; req.headers = headers || {};
        const res = {headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, getHeader(k) { return this.headers[k.toLowerCase()]; },
            writeHead(code, h) { this.code = code; Object.keys(h || {}).forEach(k => { this.headers[k.toLowerCase()] = h[k]; }); },
            end(data) { this.body = data; resolve(this); }};
        service.router(req, res);
        if (body) req.emit('data', Buffer.from(JSON.stringify(body)));
        req.emit('end');
    });
}
function json(res) { return JSON.parse(res.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(res.body).toString() : String(res.body)); }

(async () => {
    // --- reconnect order -------------------------------------------------------------------------------------------
    let service = boot();
    assert.equal(typeof agentListener, 'function', 'the service listens for the agent');
    connected = true; agentListener(true); await settle();
    assert.equal(starts.length, 1, 'the bridge is restored as soon as the agent connects, before any timer round');
    assert.equal(starts[0].list, true, 'with the device list it has just read (no second read)');
    assert.equal(inventories, 1);
    let status = json(await request(service, 'GET', '/status'));
    assert.equal(typeof status.remoteBridge.first.bridgeMs, 'number', 'GET /status says when the bridge listened again');
    // A wake: the agent and the helper are gone, then the agent is back.
    connected = false; agentListener(false); service.context.physical.stop(); await service.restoreRound();
    assert.equal(starts.length, 1, 'nothing is tried while the agent is away');
    connected = true; agentListener(true); await settle();
    assert.equal(starts.length, 2);
    status = json(await request(service, 'GET', '/status'));
    assert.equal(typeof status.remoteBridge.last.bridgeMs, 'number', 'the last reconnect is kept apart from the first');
    console.log('PASS reconnect: the remote bridge is restored at once when the agent connects, with one device read, and its time is in /status');

    // --- restore back-off ------------------------------------------------------------------------------------------
    service.context.physical.stop(); startFails = true; starts.length = 0;
    for (let i = 0; i < 20; i++) await service.restoreRound();
    assert.equal(starts.length, 12, 'twelve tries (a minute at 5 s), then it waits 30 s: ' + starts.length);
    await request(service, 'GET', '/input');
    await service.restoreRound();
    assert.equal(starts.length, 13, 'a request to /input tries again at once');
    for (let i = 0; i < 15; i++) await service.restoreRound();
    const before = starts.length;
    agentListener(true); await settle();
    assert.equal(starts.length, before + 1, 'the agent coming back tries again at once');
    startFails = false; await service.restoreRound(); service.context.physical.stop();
    for (let i = 0; i < 3; i++) await service.restoreRound();
    assert.ok(service.context.inputFailures === 0, 'a success clears the count');
    console.log('PASS remote bridge restore: every 5 s for a minute of failures, then every 30 s; /input, the agent and a success reset it');

    // --- boot tasks ------------------------------------------------------------------------------------------------
    service = boot(); connected = true;
    const self = service.timer('AppRegistry.one');
    assert.equal(self.length, 1);
    self[0](); for (let i = 0; i < 10; i++) await settle();
    const registryReads = commands.filter(c => c.includes('pkgmgr_parser.db'));
    assert.equal(registryReads.length, 1, "Vetro's startup flags are one registry query, not the whole inventory: " + registryReads.length);
    assert.ok(registryReads[0].includes("WHERE a.app_id='vetrotvapp.svc'") && !registryReads[0].includes('/user/'), 'the one row of vetrotvapp.svc, main registry only: ' + registryReads[0]);
    assert.ok(commands.some(c => /base64 -d \| sh$/.test(c) && Buffer.from(c.split(' ')[1], 'base64').toString().includes("UPDATE package_app_info SET app_onboot='true' WHERE app_id='vetrotvapp.svc'")), 'the missing on-boot flag is put back');
    commands.length = 0;
    const dns = service.timer('neverUsed');
    dns[0](); await settle();
    assert.deepEqual(commands, [], 'a DNS filter that was never switched on costs no command at boot');
    // The Startup tab's cache is not built in the first five minutes after a boot.
    commands.length = 0;
    const warm = service.timer('STARTUP_WARM_AFTER_S');
    uptime = 100; for (let i = 0; i < 40; i++) { warm[0](); await settle(); }
    assert.equal(commands.filter(c => c.includes('systemctl list-units')).length, 0, 'not in the first five minutes, and those rounds do not count against its tries');
    uptime = 400; warm[0](); await settle();
    assert.equal(commands.filter(c => c.includes('systemctl list-units')).length, 1, 'after five minutes, once');
    // neverUsed: only a folder that provably does not exist; one that exists, or that the service cannot look into, is read.
    const realStat = fs.statSync, Filter = require('../service/local-dns.js').Filter, filter = new Filter(() => Promise.reject(new Error('no')));
    try {
        fs.statSync = () => { const e = new Error('nope'); e.code = 'ENOENT'; throw e; }; assert.equal(filter.neverUsed(), true);
        fs.statSync = () => { const e = new Error('denied'); e.code = 'EACCES'; throw e; }; assert.equal(filter.neverUsed(), false, 'EACCES is not "never used"');
        fs.statSync = () => ({isDirectory: () => true}); assert.equal(filter.neverUsed(), false, 'an existing folder is read');
    } finally { fs.statSync = realStat; }
    console.log('PASS boot tasks: one registry query for Vetro\'s own flags; nothing for a DNS filter that was never used (ENOENT only); the Startup cache after five minutes');

    // The real bridge: with the list it was given, start() does not read the devices again.
    {
        const sent = [], Real = require('../service/physical-input.js').Bridge;
        const b = new Real(cmd => { sent.push(cmd); return Promise.resolve({exit_code: 0, stdout: ''}); }, () => {});
        const list = [{name: 'Smart Control', node: '/dev/input/event5', unique: true, selectable: true}];
        const started = b.start('/dev/input/event5', 'filter', ['4'], list).catch(() => null);
        for (let i = 0; i < 5; i++) await settle();
        await new Promise(r => setTimeout(r, 50));
        b.stop(); await started;
        assert.ok(!sent.some(c => c.includes('/proc/bus/input/devices')), 'no second device read: ' + sent.join(' | '));
        assert.ok(sent.some(c => c.includes('SamsungTvRemoteInputAgent.dll')), 'the helper is launched');
        const again = new Real(cmd => { sent.push(cmd); return Promise.resolve({exit_code: 0, stdout: ''}); }, () => {});
        sent.length = 0; await again.start('/dev/input/event5', 'filter', ['4']).catch(() => null);
        assert.ok(sent[0].includes('/proc/bus/input/devices'), 'without a list it reads them, as before');
    }
    console.log('PASS remote bridge: start() with the list just read sends no second device read');

    // --- answers ---------------------------------------------------------------------------------------------------
    service = boot(); connected = true;
    const plain = await request(service, 'GET', '/apps');
    assert.equal(plain.headers['content-encoding'], undefined, 'no gzip for a client that does not ask');
    const packed = await request(service, 'GET', '/apps', {'accept-encoding': 'gzip, deflate'});
    assert.equal(packed.headers['content-encoding'], 'gzip');
    assert.equal(packed.headers.vary, 'accept-encoding');
    assert.equal(packed.headers['content-length'], packed.body.length);
    assert.deepEqual(json(packed).apps.map(a => a.appId), json(plain).apps.map(a => a.appId));
    assert.ok(packed.body.length < String(plain.body).length / 3, 'much smaller');
    const small = await request(service, 'GET', '/exec', {'accept-encoding': 'gzip'});
    assert.equal(small.headers['content-encoding'], undefined, 'a small answer is sent as it is');
    const cors = await request(service, 'GET', '/status', {'accept-encoding': 'gzip'});
    assert.ok(json(cors).rootCommands, 'still readable');
    const icon = await request(service, 'GET', '/apps/icon?appId=app.3');
    assert.equal(icon.code, 200); assert.ok(Buffer.compare(icon.body, PNG) === 0);
    assert.match(icon.headers.etag, /^"[0-9a-f]{20}"$/); assert.match(icon.headers['cache-control'], /max-age=86400/);
    const again = await request(service, 'GET', '/apps/icon?appId=app.3', {'if-none-match': icon.headers.etag});
    assert.equal(again.code, 304); assert.equal(again.body, undefined);
    status = json(await request(service, 'GET', '/status'));
    assert.equal(status.rootCommands.perMinute.length, 10);
    assert.ok(status.rootCommands.perMinute[0] >= 4 && status.rootCommands.lastTenMinutes === status.rootCommands.perMinute.reduce((a, b) => a + b, 0), JSON.stringify(status.rootCommands));
    console.log('PASS answers: JSON over 1 KB gzipped only when asked, icons with an ETag (304), root commands per minute in /status');
})().catch(e => { console.error(e); process.exit(1); });
