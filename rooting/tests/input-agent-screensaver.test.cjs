'use strict';
// Regression tests for SamsungTvRemoteInputAgent swallowed-key screensaver activity reset.
// When a physical key (e.g. Vol/Mute for VolumePill, 123 for NumberPad, or a remapped shortcut)
// is swallowed in filter mode, it never reaches /dev/uinput, so Enlightenment's idle counter
// is never reset by input delivery and active screensavers are not dismissed.
const assert = require('assert').strict;
const child = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const csPath = path.resolve(__dirname, '..', 'payload', 'SamsungTvRemoteInputAgent.cs');
const cs = fs.readFileSync(csPath, 'utf8');

// 1. Dispatch guard: only filtered, blocked, non-wake EV_KEY down/repeat (value 1 or 2) trigger activity reset.
assert.match(
    cs,
    /else if \(filter\s+&& block\s+&& !wake\s+&& type == EventKey\s+&& \(value == 1 \|\| value == 2\)\)\s*\{\s*NotifyFilteredKeyActivity\(code, value\);\s*\}/,
    'swallowed key down/repeat in filter mode must notify screensaver activity'
);

// 2. Picture Off / standby & power/sleep safety guards.
assert.match(
    cs,
    /VconfGetInt\(DisplayStateKey, out state\) == 0 && state >= DisplayStateOff/,
    'ScreenIsOff must treat state >= DisplayStateOff (3+) as off'
);
assert.match(
    cs,
    /if \(IsPowerOrSleepKey\(code\) \|\| ScreenIsOff\(\)\)\s*\{\s*return;\s*\}/,
    'NotifyFilteredKeyActivity must skip power/sleep keys and screen-off states'
);
const powerMethod = cs.slice(
    cs.indexOf('private static bool IsPowerOrSleepKey'),
    cs.indexOf('private static bool ScreenIsOff')
);
for (const powerCode of [112, 116, 142, 352, 353, 374, 449, 463, 523, 531]) {
    assert.match(
        powerMethod,
        new RegExp('\\bcase ' + powerCode + ':'),
        'IsPowerOrSleepKey must exclude code ' + powerCode
    );
}
for (const volCode of [66, 67, 68, 113, 114, 115]) {
    assert.ok(
        !new RegExp('\\bcase ' + volCode + ':').test(powerMethod),
        'volume/mute code ' + volCode + ' must still reset screensaver when screen is on'
    );
}

// 3. Reconstruct ScrsaverDbusCall + ScreensaverActivityCommand from C# string constants and verify shell contract.
const dbusMatch = cs.match(/private const string ScrsaverDbusCall =\s*"([^"]+)";/);
assert.ok(dbusMatch, 'ScrsaverDbusCall constant present');
const dbusCall = dbusMatch[1];
assert.ok(dbusCall.includes('org.enlightenment.wm.info.scrsaver'), 'targets Enlightenment scrsaver D-Bus method');

const cmdBlockMatch = cs.match(/private const string ScreensaverActivityCommand =([\s\S]*?);\s*private const int DeviceBusy/);
assert.ok(cmdBlockMatch, 'ScreensaverActivityCommand constant present');
let shellCmd = '';
const tokenRe = /"((?:\\.|[^"\\])*)"|ScrsaverDbusCall/g;
let m;
while ((m = tokenRe.exec(cmdBlockMatch[1])) !== null) {
    if (m[0] === 'ScrsaverDbusCall') {
        shellCmd += dbusCall;
    } else {
        shellCmd += m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
}
assert.ok(shellCmd.includes("lk='/tmp/vetro-scrsaver.lock'"), 'uses atomic /tmp/vetro-scrsaver.lock directory');
assert.ok(shellCmd.includes('*"State: Enabled"*'), 'only toggles scrsaver when State: Enabled');
assert.ok(shellCmd.includes('int32:3 double:0') && shellCmd.includes('int32:2 double:0'), 'pulses scrsaver 3 -> 2');
assert.ok(shellCmd.includes('$lk/d'), 'records dirty marker for crash recovery');

// 4. Live POSIX /bin/sh execution of the extracted command (runs on Linux CI and macOS/Linux hosts).
if (fs.existsSync('/bin/sh')) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-scrsaver-test-'));
    try {
        const lockDir = path.join(tmp, 'lock');
        const logFile = path.join(tmp, 'dbus.log');
        const stateFile = path.join(tmp, 'state.txt');
        const binDir = path.join(tmp, 'bin');
        fs.mkdirSync(binDir);
        const mockDbus = path.join(binDir, 'dbus-send');
        fs.writeFileSync(
            mockDbus,
            '#!/bin/sh\n' +
            'for last; do :; done\n' +
            'prev=""\n' +
            'for a in "$@"; do case "$a" in int32:*) prev="$a";; esac; done\n' +
            'echo "$prev $last" >> "' + logFile + '"\n' +
            'if [ "$prev" = "int32:1" ]; then cat "' + stateFile + '"; fi\n' +
            'exit 0\n',
            { mode: 0o755 }
        );
        const isolatedCmd = shellCmd.replace('/tmp/vetro-scrsaver.lock', lockDir);
        const env = Object.assign({}, process.env, { PATH: binDir + ':' + (process.env.PATH || '') });

        // Case A: State: Enabled -> queries 1, pulses 3 -> 2, removes lock
        fs.writeFileSync(stateFile, '   string "State: Enabled"\n');
        fs.writeFileSync(logFile, '');
        const r1 = child.spawnSync('/bin/sh', ['-c', isolatedCmd], { env, encoding: 'utf8' });
        assert.equal(r1.status, 0, r1.stderr);
        assert.deepEqual(fs.readFileSync(logFile, 'utf8').trim().split('\n'), [
            'int32:1 double:0',
            'int32:3 double:0',
            'int32:2 double:0'
        ]);
        assert.equal(fs.existsSync(lockDir), false, 'lock cleaned after enabled pulse');

        // Case B: State: Disabled -> queries 1 only, never re-enables user-disabled screensaver
        fs.writeFileSync(stateFile, '   string "State: Disabled"\n');
        fs.writeFileSync(logFile, '');
        const r2 = child.spawnSync('/bin/sh', ['-c', isolatedCmd], { env, encoding: 'utf8' });
        assert.equal(r2.status, 0, r2.stderr);
        assert.deepEqual(fs.readFileSync(logFile, 'utf8').trim().split('\n'), [
            'int32:1 double:0'
        ]);
        assert.equal(fs.existsSync(lockDir), false, 'lock cleaned when disabled');

        // Case C: Stale lock with dead PID + dirty /d marker -> recovers int32:2 first
        fs.mkdirSync(lockDir);
        fs.writeFileSync(path.join(lockDir, 'p'), '999999\n');
        fs.writeFileSync(path.join(lockDir, 'd'), '');
        fs.writeFileSync(stateFile, '   string "State: Disabled"\n');
        fs.writeFileSync(logFile, '');
        const r3 = child.spawnSync('/bin/sh', ['-c', isolatedCmd], { env, encoding: 'utf8' });
        assert.equal(r3.status, 0, r3.stderr);
        assert.deepEqual(fs.readFileSync(logFile, 'utf8').trim().split('\n'), [
            'int32:2 double:0',
            'int32:1 double:0'
        ]);
        assert.equal(fs.existsSync(lockDir), false, 'stale dirty lock recovered and cleaned');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

console.log('PASS input-agent screensaver reset: swallowed EV_KEY guard, Picture Off/Power exclusions, and atomic scrsaver D-Bus pulse');
