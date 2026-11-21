'use strict';
const assert = require('assert').strict;
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const loadService = require('./service-harness.cjs');

function req(method, url, body) {
    const r = new EventEmitter();
    r.method = method;
    r.url = url;
    r.headers = { host: '127.0.0.1:8099' };
    r.socket = { remoteAddress: '127.0.0.1' };
    if (body !== undefined) {
        process.nextTick(() => {
            r.emit('data', Buffer.from(JSON.stringify(body)));
            r.emit('end');
        });
    }
    return r;
}
function res() {
    let resolve;
    const done = new Promise(r => { resolve = r; });
    const chunks = [];
    const o = {
        statusCode: 200,
        headers: {},
        writeHead(s, h) { o.statusCode = s; o.headers = h || {}; },
        setHeader(k, v) { o.headers[k] = v; },
        end(d) {
            if (d) chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d)));
            resolve({ status: o.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') });
        }
    };
    return { res: o, done };
}

(async () => {
    const execCalls = [];
    const svc = loadService(path.resolve(__dirname, '..'), {
        dependencies: {
            './updater.js': { Updater: function () {} },
            './platform.js': {
                start() {}, stop() {},
                status() { return { mode: 'root', agent: { connected: true } }; },
                onAgent() {},
                execute(cmd, ms) {
                    execCalls.push({ cmd, ms });
                    if (cmd.includes('base64 -d | sh')) {
                        const sh = Buffer.from(cmd.split(' ')[1], 'base64').toString('utf8');
                        if (sh.includes('BEFORE|$(meminfo)')) {
                            return Promise.resolve({
                                exit_code: 0,
                                stdout: 'BEFORE|512000|350000\nCLOSED|com.samsung.tv.store|36000\nCLOSED|org.tizen.browser|48000\nAFTER|680000|490000\n'
                            });
                        }
                    }
                    return Promise.resolve({ exit_code: 0, stdout: '' });
                }
            }
        }
    });

    // POST /memory/free endpoint
    const r = res();
    svc.router(req('POST', '/memory/free', {}), r.res);
    const out = await r.done;
    assert.equal(out.status, 200);
    assert.equal(out.body.ok, true);
    assert.equal(out.body.before.availableBytes, 512000 * 1024);
    assert.equal(out.body.after.availableBytes, 680000 * 1024);
    assert.equal(out.body.closed.length, 2);
    assert.equal(out.body.closed[0].name, 'Apps');
    const freeCmd = execCalls.find(c => c.cmd.includes('base64 -d | sh') && Buffer.from(c.cmd.split(' ')[1], 'base64').toString('utf8').includes('BEFORE|'));
    const freeSh = Buffer.from(freeCmd.cmd.split(' ')[1], 'base64').toString('utf8');
    ['com.samsung.tv.bixbycapsuleviewer', 'com.samsung.tv.quicklaunch', 'org.tizen.volume-app', 'org.tizen.chromium-efl*', 'org.tizen.autofilld', "app_component='uiapp'", 'self_pid=', 'self_ppid=', ':cpu:/background', 'compact_memory'].forEach(tok => {
        assert.ok(freeSh.includes(tok), 'memoryFreeScript includes ' + tok);
    });

    // includeHome: false skips Samsung Home helpers cleanly
    const r2 = res();
    svc.router(req('POST', '/memory/free', { includeHome: false }), r2.res);
    const out2 = await r2.done;
    assert.equal(out2.status, 200);
    const secondCmd = execCalls[execCalls.length - 1];
    const secondSh = Buffer.from(secondCmd.cmd.split(' ')[1], 'base64').toString('utf8');
    assert.ok(secondSh.includes('com.samsung.tv.csfs|com.samsung.tv.home.sidebar|com.samsung.tv.home.media') && secondSh.includes('[ "$adj" -ge 300 ]'), 'includeHome:false protects Samsung Home and uses minAdj 300');

    // Dashboard #freeRam button UI flow
    const html = require('../service/dashboard.js')();
    assert.ok(html.includes('id="freeRam"') && !/>Free memory</.test(html), 'uses Free up RAM button without colliding with Disable tab test');
    const nodes = {};
    const makeNode = id => ({
        id, value: '', checked: false, disabled: false, hidden: true, textContent: '', innerHTML: '',
        className: '', dataset: {}, style: {}, focus() {},
        setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
        querySelectorAll() { return []; }, querySelector() { return null; }, contains() { return false; }
    });
    const el = id => nodes[id] || (nodes[id] = makeNode(id));
    const dashCalls = [];
    const sandbox = {
        document: { getElementById: el, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, hidden: false },
        console, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1,
        fetch: async (url, opts) => {
            dashCalls.push({ url, opts });
            if (url === '/memory/free') {
                return { ok: true, json: async () => ({ ok: true, before: { availableBytes: 500 * 1048576 }, after: { availableBytes: 660 * 1048576 }, closed: [{ appId: 'com.samsung.tv.store', name: 'Apps', rssBytes: 36 * 1048576 }] }) };
            }
            if (url.startsWith('/monitor')) {
                return { ok: true, json: async () => ({ ts: Date.now(), memory: { availableBytes: 660 * 1048576, totalBytes: 1800 * 1048576 }, cpu: { cores: [] }, network: [] }) };
            }
            if (url === '/status') return { ok: true, json: async () => ({ agent: { connected: true }, mode: 'root' }) };
            if (url === '/wins') return { ok: true, json: async () => ({ wins: {} }) };
            return { ok: true, json: async () => ({ apps: [], files: [], rules: [], devices: [], status: { policy: { mode: 'off' }, events: [] } }) };
        }
    };
    vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], sandbox);
    await el('freeRam').onclick();
    assert.ok(dashCalls.some(c => c.url === '/memory/free' && c.opts && c.opts.method === 'POST'), '#freeRam posts to /memory/free');
    assert.ok(dashCalls.some(c => c.url === '/monitor?scope=summary'), '#freeRam refreshes monitor summary afterwards');
    assert.match(el('freeRamStatus').textContent, /Closed 1 background app \(Apps\) · Available RAM: 500 MiB → 660 MiB/);
    assert.equal(el('freeRamStatus').hidden, false);

    console.log('PASS /memory/free sweep and Dashboard Free up RAM UI');
})().catch(e => { console.error(e); process.exit(1); });
