'use strict';
// #200: apps that are only an HbbTV link (SVT Play) open through the HbbTV app, as Samsung's Home opens them.
const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');
const link = require('../service/hbbtv-link.js');
const catalog = require('../service/dock-catalog.js');

const SVT = 'https://hbbtv.play.svt.se/v2/index.xhtml';

// The link rule
assert.equal(link.validLink(SVT), true);
assert.equal(link.validLink('http://example.org/a?b=1&c=%20#x'), true);
['', 'ftp://x', 'https://', 'https://a b', "https://a'b", 'https://a"b', 'https://a\\b', 'https://a\nb', 'javascript:alert(1)', null, 5,
    'https://' + 'a'.repeat(501)].forEach(bad => assert.equal(link.validLink(bad), false, 'refused: ' + JSON.stringify(bad)));
assert.equal(link.validLink('https://' + 'a'.repeat(500)), true, 'the longest link the dock also accepts');

// The operation and the link only: tizenid would start a deep-link session, whose end opens Samsung's Home
assert.deepEqual(link.launchArgs(SVT), ['__APP_SVC_OP_TYPE__', 'http://tizen.org/appcontrol/operation/default', 'hbbtv', SVT]);
['tizenid', 'deeplink', 'caller_process'].forEach(key => assert.ok(link.launchCommand('5exPmCT0nz.svtplay').indexOf(key) < 0, 'no ' + key));
assert.throws(() => link.launchCommand('a;reboot'), /invalid appId/);
assert.throws(() => link.launchCommand("a'b"), /invalid appId/);

// The launch command, run by a real shell with a fake sqlite3 and app_launcher: the link decides the target, and a
// hostile link stays one argument that the shell never runs.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-hbbtv-'));
try {
    const log = path.join(dir, 'log'), tool = path.join(dir, 'app_launcher'), sqlite = path.join(dir, 'sqlite3'), linkFile = path.join(dir, 'link');
    fs.writeFileSync(tool, '#!/bin/sh\nfor a in "$@"; do printf "%s\\n" "$a"; done > ' + JSON.stringify(log) + '\n', {mode: 0o755});
    fs.writeFileSync(sqlite, '#!/bin/sh\ncase "$*" in *5exPmCT0nz.svtplay*) cat ' + JSON.stringify(linkFile) + ';; esac\n', {mode: 0o755});
    const run = (appId, value) => {
        fs.writeFileSync(linkFile, value);
        try { fs.unlinkSync(log); } catch (e) { /* first run */ }
        const command = link.launchCommand(appId).split('/usr/bin/app_launcher').join(tool);
        execFileSync('/bin/sh', ['-c', command], {env: {PATH: dir + ':/usr/bin:/bin'}, cwd: dir});
        return fs.readFileSync(log, 'utf8').split('\n').slice(0, -1);
    };
    assert.deepEqual(run('5exPmCT0nz.svtplay', SVT + '\n'), ['-s', 'org.tizen.hbbtv'].concat(link.launchArgs(SVT)), 'SVT Play goes to the HbbTV app');
    assert.deepEqual(run('4rd98xReqr.URPlay', SVT + '\n'), ['-s', '4rd98xReqr.URPlay'], 'an app without a link starts by its id');
    assert.deepEqual(run('5exPmCT0nz.svtplay', ''), ['-s', '5exPmCT0nz.svtplay'], 'no link (or no metadata table): by its id');
    assert.deepEqual(run('5exPmCT0nz.svtplay', 'file:///etc/passwd\n'), ['-s', '5exPmCT0nz.svtplay'], 'only http(s) links count');
    const hostile = 'https://x/$(touch pwned)`touch pwned2`;touch pwned3 "q';
    assert.equal(run('5exPmCT0nz.svtplay', hostile + '\n')[5], hostile, 'a hostile link is passed as one argument');
    assert.ok(!fs.existsSync(path.join(dir, 'pwned')) && !fs.existsSync(path.join(dir, 'pwned2')) && !fs.existsSync(path.join(dir, 'pwned3')), 'and never run');
} finally { fs.rmSync(dir, {recursive: true, force: true}); }

// The launcher row: the catalog reads the link and writes it as the entry's seventh field
const hex = s => Buffer.from(s).toString('hex');
const parsed = catalog.parse([
    'F|csfs', 'O|d/webapp@svt', 'O|d/webapp@ur',
    'R|' + hex('svt') + '|' + hex('SVT Play') + '|' + hex('5exPmCT0nz.svtplay') + '|0',
    'R|' + hex('ur') + '|' + hex('UR Play') + '|' + hex('4rd98xReqr.URPlay') + '|0',
    'L|' + hex('5exPmCT0nz.svtplay') + '|' + hex(SVT),
    'L|' + hex('4rd98xReqr.URPlay') + '|' + hex('https://a b'),
    'L|' + hex('bad id') + '|' + hex(SVT),
    'L|zz|nothex'
].join('\n'));
assert.deepEqual(parsed.hbbtvLinks, {'5exPmCT0nz.svtplay': SVT}, 'only valid links of valid app ids are kept');
const lines = catalog.tsv(catalog.build(parsed)).split('\n');
assert.ok(lines.includes('svt-play\tSVT Play\t5exPmCT0nz.svtplay\t\t\t\t' + SVT), 'SVT Play carries its link');
assert.ok(lines.includes('ur-play\tUR Play\t4rd98xReqr.URPlay'), 'other apps are unchanged');
assert.match(catalog.script(), /package_app_app_metadata WHERE md_key='http:\/\/samsung\.com\/tv\/metadata\/hbbtv\.link'/, 'the catalog reads the metadata');

console.log('PASS HbbTV-link apps (#200): Samsung Home\'s request from the remapper, Task manager and launcher row');
