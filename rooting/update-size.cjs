'use strict';
// A TV on 0.5.0 updates itself with ONE shell script that its own updater writes and runs through the root agent, which takes
// at most 64 KiB. That script repeats the path of every file that differs from what the TV has about ten times, so each first
// change to a shipped file costs roughly 500-1200 bytes, whatever its size. measure() writes the script exactly as each published
// 0.5.0 build would (its updater.js and the sha256 of every file each build installed are in tests/fixtures/update-from-050) for
// the files shipped now. Used by tests/update-size.test.cjs and by release.cjs, which refuses a bundle that would not fit.
const crypto = require('crypto');
const path = require('path');
const fixtures = path.join(__dirname, 'tests', 'fixtures', 'update-from-050');
const LIMIT = 65536;
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

function measure(files) {
    const Old = require(path.join(fixtures, 'updater.js'));
    const installed = require(path.join(fixtures, 'installed.json')).variants;
    const next = {};
    // The 0.5.0 okPath decides what such a TV takes (release.cjs also leaves payload subfolders out).
    files.filter(f => Old.okPath(f.name)).forEach(f => { next[f.name] = sha(f.data); });
    return Object.keys(installed).map(build => {
        const had = installed[build].files;
        const changed = Object.keys(next).filter(n => had[n] !== next[n]).sort();
        const existing = changed.filter(n => had[n]), added = changed.filter(n => !had[n]);
        const updater = new Old.Updater({ publicKey: 'x', installDir: '/opt/usr/apps/vetrotvapp/res/wgt', workDir: '/opt/usr/home/owner/share/vetro-update',
            buildInfo: { version: '0.5.0', shell: 1 }, execute: () => Promise.resolve({}), dockStopCommand: installed[build].dockStop });
        const bytes = Buffer.byteLength(updater._applyScript('0.5.0', '0.7.0', changed, existing, added, next, changed.some(n => /^native\/dock\//.test(n))));
        return { build, changed: changed.length, existing: existing.length, added: added.length, bytes, margin: LIMIT - bytes };
    });
}

module.exports = { measure, LIMIT };
