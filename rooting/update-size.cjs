'use strict';
// A TV updates itself with ONE shell script that its own updater writes and runs through the root agent, which takes at most
// 64 KiB (MaximumCommandBytes in the agent; it then runs `/bin/sh -c <script>`, so the kernel's 128 KiB limit on one argument
// would stop a bigger one anyway). The script is written by the updater the TV RUNS, not by the one being installed, so what
// counts is every published version a TV may still be on:
// - 0.7.0 (fixtures update-from-070): its script repeats the path of each changed file about ten times, roughly 1 KB per
//   changed file, so about 60 files may differ from 0.7.0. The count is cumulative: a TV left on 0.7.0 goes straight to
//   whatever is published, so the budget is measured from 0.7.0 itself, not from the release before.
// - 0.5.0 (fixtures update-from-050): no longer fits since 0.7.1 (owner's call, 2026-11-21). Such a TV must refuse the bundle
//   when it checks it, before anything is written: its okPath refuses any subfolder of payload/ (payload/net6 is shipped for
//   that), and refused() tells whether that holds. A 0.5.0 that went on to apply would fail at the root agent after it had
//   already rewritten its backup.json, and then offer a Go back that does nothing.
// - 0.7.1 and later write a compact script (the list once, then loops): current() measures it with every file changed.
// measure() writes the script exactly as each published build would (its updater.js and the sha256 of every file it installed
// are in tests/fixtures/update-from-<version>). Used by tests/update-size.test.cjs and by release.cjs, which refuses a bundle
// that would not fit.
const crypto = require('crypto');
const path = require('path');
const LIMIT = 65536;
const FROM = { '0.5.0': 'update-from-050', '0.7.0': 'update-from-070' };
const INSTALL_DIR = '/opt/usr/apps/vetrotvapp/res/wgt', WORK_DIR = '/opt/usr/home/owner/share/vetro-update';
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const fixtures = from => path.join(__dirname, 'tests', 'fixtures', FROM[from]);

function targetVersion(files) {
    const info = files.find(f => f.name === 'service/build-info.js');
    const parsed = info && require('../app/service/updater.js').parseBuildInfo(info.data);
    return parsed && parsed.version || '0.0.0';
}

// The bytes of the script that a TV on `from` writes for these files, for each published build of that version.
function measure(files, from) {
    from = from || '0.7.0';
    if (!FROM[from]) throw new Error('No fixtures for ' + from);
    const Old = require(path.join(fixtures(from), 'updater.js'));
    const installed = require(path.join(fixtures(from), 'installed.json')).variants;
    const to = targetVersion(files), next = {};
    files.filter(f => Old.okPath(f.name)).forEach(f => { next[f.name] = sha(f.data); });
    return Object.keys(installed).map(build => {
        const had = installed[build].files;
        const changed = Object.keys(next).filter(n => had[n] !== next[n]).sort();
        const existing = changed.filter(n => had[n]), added = changed.filter(n => !had[n]);
        const updater = new Old.Updater({ publicKey: 'x', installDir: INSTALL_DIR, workDir: WORK_DIR,
            buildInfo: { version: from, shell: 1 }, execute: () => Promise.resolve({}), dockStopCommand: installed[build].dockStop });
        const bytes = Buffer.byteLength(updater._applyScript(from, to, changed, existing, added, next, changed.some(n => /^native\/(?:dock|tuner)\//.test(n))));
        return { from, build, changed: changed.length, existing: existing.length, added: added.length, bytes, margin: LIMIT - bytes };
    });
}

// The paths of the bundle (what this tree's updater ships) that a TV on `from` refuses: its check stops at the first one in
// the manifest's order (sorted, as release.cjs writes it), before anything is written.
function refused(files, from) {
    const Old = require(path.join(fixtures(from), 'updater.js')), U = require('../app/service/updater.js');
    return files.map(f => f.name).filter(n => U.okPath(n) && !Old.okPath(n)).sort();
}

// The worst case for the updater in this tree (what 0.7.1 and later run): every shipped file changed, half of them new,
// with the launcher's stop lines. Also its manual Go back and its watchdog, which name the files too.
function current(files) {
    const U = require('../app/service/updater.js');
    const D = require('../app/service/dock.js'), T = require('../app/service/tuner.js');
    const dockStop = D.Dock.prototype.stopLines.call({}) + '\n' + T.Tuner.prototype.stopLines.call({});
    const names = files.map(f => f.name).filter(U.okPath).sort(), hashes = {};
    files.forEach(f => { hashes[f.name] = sha(f.data); });
    const existing = names.filter((n, i) => i % 2 === 0), added = names.filter((n, i) => i % 2 === 1);
    const u = new U.Updater({ publicKey: 'x', installDir: INSTALL_DIR, workDir: WORK_DIR, buildInfo: { version: '0.7.1', shell: 1 },
        execute: () => Promise.resolve({}), dockStopCommand: dockStop });
    const bytes = Buffer.byteLength(u._applyScript('0.7.1', '9.9.9', names, existing, added, hashes, true));
    const back = Buffer.byteLength(u._rollbackScript({ from: '0.7.1', to: '9.9.9', files: existing, added: added, dock: true }));
    return { files: names.length, bytes, rollbackBytes: back, margin: LIMIT - Math.max(bytes, back) };
}

module.exports = { measure, refused, current, targetVersion, LIMIT, FROM };
