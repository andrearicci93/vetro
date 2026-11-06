'use strict';
// Regression tests for the persisted state files (app/docs/STATE-MACHINES.md, section 4):
// a write cut short must leave the previous content, not half of the new one.
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path');
const atomicFile = require('../service/atomic-file.js');
const { Dock } = require('../service/dock.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-state-'));

// A disk that dies in the middle of any write: half of the data lands, then the call fails.
function crashDuringWrite(body) {
    const original = fs.writeFileSync;
    fs.writeFileSync = function (file, data) {
        original.call(fs, file, String(data).slice(0, Math.floor(String(data).length / 2)));
        throw new Error('power cut');
    };
    try { body(); } finally { fs.writeFileSync = original; }
}

// --- the helper ------------------------------------------------------------------------------------------------
{
    const file = path.join(dir, 'a.json');
    atomicFile.write(fs, file, '{"v":1}');
    assert.equal(fs.readFileSync(file, 'utf8'), '{"v":1}');
    crashDuringWrite(() => assert.throws(() => atomicFile.write(fs, file, '{"v":2,"long":"xxxxxxxxxxxx"}'), /power cut/));
    assert.equal(fs.readFileSync(file, 'utf8'), '{"v":1}', 'the old content survives a write that dies half way');
    assert.deepEqual(fs.readdirSync(dir).filter(n => n.endsWith('.tmp')), [], 'no temporary file is left behind');
    console.log('PASS atomic write: old content survives a cut write');
}

// --- the dock setting: it holds autorunWas ---------------------------------------------------------------------
{
    const stateFile = path.join(dir, 'vetro-dock.json');
    const dock = new Dock({ execute: async () => ({ exit_code: 0, stdout: '' }), stateFile, appsFile: path.join(dir, 'apps.tsv') });
    dock.writeState({ enabled: true, since: 1, fixTizenTube: false, autorunWas: 1 });
    crashDuringWrite(() => assert.throws(() => dock.patchState({ enabled: false }), /could not be saved/));
    const kept = dock.readState();
    assert.equal(kept.enabled, true);
    assert.equal(kept.autorunWas, 1, 'the record that Vetro switched Autorun Smart Hub off must not be lost to a cut write');
    assert.deepEqual(fs.readdirSync(dir).filter(n => n.endsWith('.tmp')), [], 'the half-written temporary file is removed');
    console.log('PASS dock state keeps autorunWas through a cut write');
}

// --- the remote-control rules (/remap) ------------------------------------------------------------------------
(async () => {
    const EventEmitter = require('events'), load = require('./service-harness.cjs'), root = path.resolve(__dirname, '..');
    const REMAP = '/opt/usr/home/owner/share/vetro-remap.json';
    const files = {}; files[REMAP] = JSON.stringify({ rules: [], marker: 'old' });
    let cut = false;
    const stub = {
        readFileSync: p => { if (p in files) return files[p]; throw new Error('ENOENT'); },
        writeFileSync: (p, t) => { files[p] = cut ? String(t).slice(0, 5) : String(t); if (cut) throw new Error('power cut'); },
        renameSync: (a, b) => { files[b] = files[a]; delete files[a]; },
        unlinkSync: p => { delete files[p]; }
    };
    const service = load(root, { dependencies: { fs: stub, './platform.js': { start() {}, status: () => ({ agent: { connected: false } }), execute: () => Promise.resolve({ exit_code: 0, stdout: '' }) } }, setInterval: () => ({ unref() {} }) });
    const post = body => new Promise(resolve => {
        const req = new EventEmitter(); req.method = 'POST'; req.url = '/remap'; req.headers = {}; req.socket = { remoteAddress: '127.0.0.1' };
        service.router(req, { writeHead(code) { this.code = code; }, setHeader() {}, end(s) { resolve({ code: this.code, body: JSON.parse(s) }); } });
        req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end');
    });
    cut = true;
    const answer = await post({ rules: [] });
    assert.equal(answer.body.persisted, false, 'a cut write is reported as not saved');
    assert.equal(JSON.parse(files[REMAP]).marker, 'old', 'the saved rules are still the old, complete file');
    assert.deepEqual(Object.keys(files), [REMAP], 'no temporary file is left behind');
    console.log('PASS remote-control rules survive a cut write');
})().catch(e => { console.error(e); process.exit(1); });
