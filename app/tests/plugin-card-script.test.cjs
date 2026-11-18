'use strict';
// vetro-plugin.cjs check / pack with a Control center card: the same rules as the TV, the list entry names the card.
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const script = path.join(__dirname, '..', 'scripts', 'vetro-plugin.cjs');
const { pack, entryFor } = require(script);

function shard(manifest, code) {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-cardscript-')), 'lights');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(Object.assign({ id: 'lights', apiVersion: 1, name: 'Lights', version: '1.0.0' }, manifest)));
    fs.writeFileSync(path.join(dir, 'index.js'), code);
    return dir;
}
const check = dir => cp.spawnSync(process.execPath, [script, 'check', dir], { encoding: 'utf8' });
const both = 'module.exports = function () { return { card: function () { return { rows: [] }; }, cardSelect: function () { return { ok: true }; } }; };';

let r = check(shard({ controlCenter: { label: 'Lights' } }, both));
assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /Control center card: Lights/);
r = check(shard({ controlCenter: { label: 'Lights' } }, 'module.exports = function () { return { card: function () { return {}; } }; };'));
assert.notEqual(r.status, 0); assert.match(r.stderr, /card\(\) and cardSelect\(rowId\)/, 'both methods are required');
r = check(shard({ controlCenter: { label: '' } }, both));
assert.notEqual(r.status, 0); assert.match(r.stderr, /controlCenter/, 'the manifest rule is the TV\'s');
r = check(shard({}, 'module.exports = function () { return {}; };'));
assert.equal(r.status, 0, 'a Shard without the key needs none of it');

const packed = pack(shard({ controlCenter: { label: 'Lights', extra: 1 } }, both));
assert.deepEqual(entryFor(packed, 'dist/x.vplugin').controlCenter, { label: 'Lights' }, 'the catalog entry carries only the label');
assert.equal(entryFor(pack(shard({}, both)), 'x').controlCenter, undefined);
console.log('plugin-card-script: ok');
