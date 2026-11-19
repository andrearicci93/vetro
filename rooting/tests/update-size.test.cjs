'use strict';
// A TV on 0.5.0 updates itself with ONE shell script that its own updater writes and runs through the root agent, which takes
// at most 64 KiB. That script repeats the path of every file that differs from what the TV has about ten times, so each first
// change to a shipped file costs roughly 500-1200 bytes, whatever its size. This test writes the script exactly as each published
// 0.5.0 build would (its updater.js is kept in fixtures/update-from-050, with the sha256 of every file each build installed) for
// the files the release tool ships today, and fails before a commit pushes it over the limit.
const assert = require('assert').strict;
const crypto = require('crypto');
const path = require('path');
const fixtures = path.join(__dirname, 'fixtures', 'update-from-050');
const Old = require(path.join(fixtures, 'updater.js'));
const installed = require(path.join(fixtures, 'installed.json')).variants;
const { collectIntegration } = require('../build.cjs');

const LIMIT = 65536;
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
process.env.VETRO_SOURCE_REVISION = '0'.repeat(40);
const next = {};
// The release tool's own filter is the new okPath minus payload subfolders; the 0.5.0 okPath is what decides here.
collectIntegration().map(f => ({ n: decodeURIComponent(f.uri), d: Buffer.from(f.data) })).filter(f => Old.okPath(f.n)).forEach(f => { next[f.n] = sha(f.d); });

const report = [];
Object.keys(installed).forEach(build => {
    const had = installed[build].files;
    const changed = Object.keys(next).filter(n => had[n] !== next[n]).sort();
    const existing = changed.filter(n => had[n]), added = changed.filter(n => !had[n]);
    const updater = new Old.Updater({ publicKey: 'x', installDir: '/opt/usr/apps/vetrotvapp/res/wgt', workDir: '/opt/usr/home/owner/share/vetro-update',
        buildInfo: { version: '0.5.0', shell: 1 }, execute: () => Promise.resolve({}), dockStopCommand: installed[build].dockStop });
    const bytes = Buffer.byteLength(updater._applyScript('0.5.0', '0.7.0', changed, existing, added, next, changed.some(n => /^native\/dock\//.test(n))));
    report.push(build + ': ' + changed.length + ' files (' + existing.length + ' changed, ' + added.length + ' new), ' + bytes + ' bytes, margin ' + (LIMIT - bytes));
    assert.ok(bytes < LIMIT, 'the update script from 0.5.0 build ' + build + ' is ' + bytes + ' bytes, over the 64 KiB the root agent takes. ' +
        'Move the change into a file 0.7.0 already changes, or keep it for a later release.');
});
console.log('PASS update from 0.5.0 fits: ' + report.join('; '));
