'use strict';
const assert = require('assert').strict;
const fs = require('fs'), os = require('os'), path = require('path');
const service = require('./provider-harness.cjs')(path.resolve(__dirname, '..')).context;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-stage-'));
const id = n => 'archive-root-' + n.toString(16).padStart(16, '0');
fs.mkdirSync(root + '/on-demand');
const make = (n, age) => {
    const dir = root + '/' + id(n);
    fs.mkdirSync(dir + '/nested', {recursive: true});
    fs.writeFileSync(dir + '/SamsungTvRootAgent.dll', 'x'); fs.writeFileSync(dir + '/nested/f', 'x');
    fs.writeFileSync(root + '/on-demand/' + id(n) + '.tar.gz', 'x'); fs.writeFileSync(root + '/on-demand/' + id(n) + '.tar.gz.signature', 'x');
    const t = new Date(Date.now() - age * 1000); fs.utimesSync(dir, t, t);
};
for (let i = 1; i <= 6; i++) make(i, (7 - i) * 100);     // 6 is the newest, 1 the oldest
make(99, 5000);                                           // the current one, however old
fs.writeFileSync(root + '/on-demand/' + id(500) + '.tar.gz', 'x');    // orphan archive: no folder
fs.writeFileSync(root + '/on-demand/other.tar.gz', 'x');              // not ours: untouched
fs.mkdirSync(root + '/not-ours'); fs.writeFileSync(root + '/archive-root-short', 'x');

service.fs = fs; service.STAGE = root; service.stageInUse = () => id(2);   // a process still runs from folder 2
const removed = service.cleanStage(id(99));

const left = fs.readdirSync(root).sort();
assert.deepEqual(left, ['archive-root-short', id(2), id(5), id(6), id(99), 'not-ours', 'on-demand'].sort(),
    'current + 2 newest + the one in use stay; older ones go');
assert.equal(removed.length, 3);
assert.deepEqual(fs.readdirSync(root + '/on-demand').sort(),
    [id(2), id(5), id(6), id(99)].map(n => [n + '.tar.gz', n + '.tar.gz.signature']).flat().concat('other.tar.gz').sort(),
    'archives follow their folders; foreign files stay');
fs.rmSync(root, {recursive: true, force: true});
console.log('PASS staging cleanup: current, newest and in-use folders stay; older folders and orphan archives are removed');
