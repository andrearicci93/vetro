'use strict';
// Hide remote key guides: the shell Vetro runs on the TV, executed by a real shell against a fake vconftool that keeps one file
// per key ("<type> <value>"), as the Tizen 9 firmware has them (memory bool keys) and as 2021-22 firmware has tv-viewer's (db).
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path');
const {execFileSync} = require('child_process');
const load = require('./service-harness.cjs'), root = path.resolve(__dirname, '..');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-keyguides-'));
const keys = path.join(dir, 'keys'), bin = path.join(dir, 'bin');
fs.mkdirSync(keys); fs.mkdirSync(bin);
const file = k => path.join(keys, k.replace(/\//g, '_'));
const setKey = (k, type, v) => fs.writeFileSync(file(k), type + ' ' + v);
const getKey = k => fs.existsSync(file(k)) ? fs.readFileSync(file(k), 'utf8').trim() : null;
// vconftool get <key> -> "<key>, value = <v> (Bool|Int32)"; vconftool set -f -t <bool|int> <key> <v>
fs.writeFileSync(path.join(bin, 'vconftool'), [
    '#!/bin/sh',
    'K=' + JSON.stringify(keys),
    'if [ "$1" = get ]; then f="$K/$(echo "$2" | tr / _)"; [ -f "$f" ] || exit 1; read t v < "$f";',
    // A bool prints as the TV prints it, "True (Boolean)" / "False (Boolean)" (the preview12 code looked for "(Bool)" and digits).
    '  if [ "$t" = bool ]; then [ "$v" = 1 ] && v=True || v=False; T=Boolean; else T=Int32; fi; echo "$2, value = $v ($T)"; exit 0; fi',
    'if [ "$1" = set ]; then shift; [ "$1" = -f ] && shift; [ "$1" = -t ] || exit 2; t=$2; k=$3; v=$4; echo "$t $v" > "$K/$(echo "$k" | tr / _)"; exit 0; fi',
    'exit 3'
].join('\n'), {mode: 0o755});

const saved = {};
const service = load(root, {dependencies: {fs: {
    readFileSync: p => { if (p in saved) return saved[p]; throw Object.assign(Error('ENOENT'), {code: 'ENOENT'}); },
    writeFileSync: (p, s) => { saved[p] = s; }, renameSync: (a, b) => { saved[b] = saved[a]; delete saved[a]; }, unlinkSync: p => { delete saved[p]; },
    openSync: () => 3, fsyncSync: () => {}, closeSync: () => {}, existsSync: () => false
}}});
const scripts = [];
service.context.agentExecute = function (command) {
    const script = Buffer.from(/^echo (\S+) \| base64 -d \| sh$/.exec(command)[1], 'base64').toString();
    scripts.push(script);
    return Promise.resolve({exit_code: 0, stdout: execFileSync('/bin/sh', ['-c', script], {env: {PATH: bin + ':/usr/bin:/bin'}}).toString()});
};
const kg = service.context.keyGuides;
const j = async p => JSON.parse(JSON.stringify(await p));   // objects made inside the service's context have another prototype

(async () => {
    try {
        // Tizen 9: the two memory flags, cleared at boot.
        setKey('memory/volume-app/key_guide_status', 'bool', 0);
        setKey('memory/tv-viewer/key_guide_status', 'bool', 0);
        assert.deepEqual(await j(kg.read()), {status: 'off', keys: 2}, 'two flags found, not chosen');
        assert.equal(await kg.boot(), null, 'not chosen: nothing written at boot');
        assert.equal(getKey('memory/volume-app/key_guide_status'), 'bool 0');
        assert.deepEqual(await j(kg.apply(true)), {status: 'on', keys: 2}, 'on: both flags read back as seen');
        assert.equal(getKey('memory/volume-app/key_guide_status'), 'bool 1');
        assert.equal(getKey('memory/tv-viewer/key_guide_status'), 'bool 1');
        // A cold boot clears them: read says partial until the boot run sets them again.
        setKey('memory/volume-app/key_guide_status', 'bool', 0); setKey('memory/tv-viewer/key_guide_status', 'bool', 0);
        assert.equal((await kg.read()).status, 'partial');
        await kg.boot();
        assert.equal(getKey('memory/tv-viewer/key_guide_status'), 'bool 1', 'set again after the boot');
        assert.equal((await kg.read()).status, 'on');
        // 2021-22 firmware: tv-viewer's persistent flag. Off puts the memory flags back to Samsung's default, never the db one.
        setKey('db/tv-viewer/key_guide_status', 'int', 0);
        await kg.apply(true);
        assert.equal(getKey('db/tv-viewer/key_guide_status'), 'int 1', 'the db flag is set with its own type');
        assert.deepEqual(await j(kg.apply(false)), {status: 'off', keys: 3});
        assert.equal(getKey('memory/volume-app/key_guide_status'), 'bool 0', 'off: memory flags back to the default');
        assert.equal(getKey('db/tv-viewer/key_guide_status'), 'int 1', 'off: the db flag (shown once already) is left alone');
        // A TV with none of the keys: not available.
        fs.readdirSync(keys).forEach(f => fs.unlinkSync(path.join(keys, f)));
        assert.deepEqual(await j(kg.read()), {status: 'unknown'});
        assert.ok(scripts.every(s => !/[;&|`$]\s*rm |reboot/.test(s)), 'nothing but vconftool');
        console.log('PASS key guides: Tizen 9 memory flags set now and after each boot, 2021-22 db flag, off restores, unknown without keys');
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
})().catch(e => { console.error(e); process.exitCode = 1; });
