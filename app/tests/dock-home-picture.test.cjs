'use strict';
// Samsung's Home picture mode (avocd NewHome) handed back when another app is on screen: the script the supervision's cheap check carries,
// run by a real shell against fake vconftool and busctl (S95C 2026-11-20: with Vetro's launcher the video kept Home's mode, motion smoothing off).
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path');
const {execFileSync} = require('child_process');
const {HOME_PICTURE_SCRIPT, Dock} = require('../service/dock.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-homepic-')), bin = path.join(dir, 'bin'), calls = path.join(dir, 'calls');
fs.mkdirSync(bin);
function tv(homeShown, front) {
    fs.writeFileSync(path.join(bin, 'vconftool'), '#!/bin/sh\ncase "$2" in\n' +
        (homeShown === null ? '' : '  memory/avoc/home_shown) echo "memory/avoc/home_shown, value = ' + homeShown + ' (Int32)";;\n') +
        '  memory/appfw/current_fullscreen_appid) echo "memory/appfw/current_fullscreen_appid, value = ' + front + ' (String)";;\n  *) exit 1;;\nesac\n', {mode: 0o755});
    fs.writeFileSync(path.join(bin, 'busctl'), '#!/bin/sh\necho "$@" >> ' + calls + '\necho "i 0"\n', {mode: 0o755});
    try { fs.unlinkSync(calls); } catch (e) {}
    const out = execFileSync('/bin/sh', ['-c', HOME_PICTURE_SCRIPT], {env: {PATH: bin + ':/usr/bin:/bin'}}).toString();
    return {out: out.trim(), busctl: fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim() : ''};
}

let r = tv(1, 'NuvioTV002.Nuvio');
assert.equal(r.out, 'cleared');
assert.equal(r.busctl, '--timeout=3 call org.tizen.tv.avoc /org/tizen/tv/avoc org.tizen.tv.avoc.AvOutputControl SetNewHome i 0');
for (const home of ['com.samsung.tv.csfs', 'com.samsung.tv.home.media', 'com.samsung.tv.coba.newhome']) {
    r = tv(1, home); assert.equal(r.out, ''); assert.equal(r.busctl, '', 'Samsung Home on screen keeps its own mode: ' + home);
}
r = tv(0, 'NuvioTV002.Nuvio'); assert.equal(r.busctl, '', 'nothing to hand back');
r = tv(null, 'org.tizen.tv-viewer'); assert.equal(r.busctl, '', 'Tizen 6.0: no key, no call');

// The launcher's copy (C# verbatim string) is the same script.
{
    const cs = fs.readFileSync(path.join(__dirname, '..', '..', 'dock', 'src', 'Core', 'HomePicture.cs'), 'utf8');
    const m = /public const string Script = @"((?:[^"]|"")*)";/.exec(cs);
    assert.ok(m, 'HomePicture.Script found');
    assert.equal(m[1].replace(/""/g, '"'), HOME_PICTURE_SCRIPT, 'dock/src/Core/HomePicture.cs and app/service/dock.js run the same script');
}

// The supervision's cheap check carries it and counts what it handed back, still one command per round.
(async () => {
    const cmds = [];
    const d = new Dock({execute: cmd => { cmds.push(cmd); return Promise.resolve({exit_code: 0, stdout: 'dock=123\nhomepicture=cleared\n'}); }, now: () => 5000});
    const c = await d.check();
    assert.equal(c.running, true); assert.equal(c.pid, 123);
    assert.equal(cmds.length, 1); assert.ok(cmds[0].indexOf('SetNewHome i 0') > 0);
    const s = await d.statusNow();
    assert.equal(s.homePictureClears, 1); assert.equal(s.homePictureAgoSeconds, 0);
    console.log('PASS Home picture mode: handed back under another app, kept under Samsung Home, nothing on 6.0; carried by the cheap check');
})().catch(e => { console.error(e); process.exitCode = 1; });
