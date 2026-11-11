'use strict';
// Bounded hardware probe, loaded inline with the TV's signed Node runtime.
// Run as the real service UID/SMACK label. It does not launch the full app.
var fs = require('fs');
var path = require('path');
function main(directory, expectedUid, expectedLabel, options) {
    options = options || {};
    var renew = options.autoRenew === true;
    var platform = require(path.join(directory, 'external-root-platform.js')).create({lifetimeMs: renew ? 10000 : 120000, autoRenew: renew});
    var output = path.join(directory, 'result.json'), stopped = false, checking = false, lastBootstrap = null;
    var report = {hardwareVerified: false, self: {pid: process.pid, uid: process.getuid(), euid: process.geteuid(),
        gid: process.getgid(), node: process.version, smack: fs.readFileSync('/proc/self/attr/current', 'utf8').trim()},
        restartKind: renew ? 'deadline-renewal' : 'explicit-stop-start', checks: [], sessions: []};
    function save() {
        fs.writeFileSync(output + '.tmp', JSON.stringify(report), {mode: 384, flag: 'wx'});
        fs.renameSync(output + '.tmp', output);
    }
    function finish(error) {
        if (stopped) return;
        stopped = true; clearInterval(poll); clearTimeout(timeout);
        report.final = platform.status();
        if (error) report.error = error.message;
        platform.stop(); save();
    }
    var poll = setInterval(function () {
        if (stopped || checking) return;
        var status = platform.status();
        if (!status.agent.connected || status.bootstrapPath === lastBootstrap) return;
        lastBootstrap = status.bootstrapPath;
        checking = true; report.agent = status.agent;
        report.sessions.push({agent: status.agent, bootstrapPath: status.bootstrapPath, bootstrapLog: status.bootstrapLog});
        platform.execute('id; cat /proc/self/attr/current; grep CapEff /proc/self/status', 5000).then(function (result) {
            report.checks.push({name: 'identity', result: result});
            if (result.exit_code || result.timed_out || !/^uid=0\(/.test(result.stdout)) throw Error('Root command identity not verified');
            // A private temporary file round trip, no TV settings or packages.
            return platform.execute('d=$(mktemp -d /tmp/vetro-probe.XXXXXX) || exit 1; ' +
                'trap \'rm -f "$d/proof"; rmdir "$d"\' 0; printf verified > "$d/proof"; cat "$d/proof"', 5000);
        }).then(function (result) {
            report.checks.push({name: 'temporary-file', result: result});
            if (result.exit_code !== 0 || result.timed_out || result.stdout !== 'verified') throw Error('Temporary file round trip failed');
            if (report.sessions.length === 1) {
                checking = false; save();
                if (!renew) {
                    platform.stop();
                    setTimeout(function () { if (!stopped) platform.start(); }, 200);
                }
            } else {
                report.hardwareVerified = report.sessions[0].bootstrapPath !== report.sessions[1].bootstrapPath;
                if (!report.hardwareVerified) throw Error('Adapter restart reused the previous rendezvous');
                finish();
            }
        }).catch(finish);
    }, 100);
    var timeout = setTimeout(function () { finish(new Error('External bootstrap did not become ready within 90 seconds')); }, 90000);
    if (report.self.uid !== expectedUid || report.self.euid !== expectedUid || report.self.smack !== expectedLabel) {
        finish(new Error('Probe is not running as the expected service identity')); return;
    }
    save(); platform.start();
}
module.exports = {main: main};
