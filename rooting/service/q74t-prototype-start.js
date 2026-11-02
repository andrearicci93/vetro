'use strict';
require('./compat.js').install();
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var root = path.dirname(__dirname);
if (process.argv[2] !== '--session') {
    var log = fs.openSync(path.join(root, 'prototype.log'), 'a', 384);
    var inline = 'process.argv[2]="--session";require(' + JSON.stringify(__filename) + ')';
    var child = cp.spawn(process.execPath, ['-e', inline], {cwd: root,
        detached: true, stdio: ['ignore', log, log]});
    child.on('error', function (e) { console.error(e.message); process.exitCode = 1; });
    child.unref();
    fs.closeSync(log);
} else {
    process.env.VETRO_READ_ONLY = '1';
    fs.writeFileSync(path.join(root, 'prototype.pid'), String(process.pid), {mode: 384});
    var platform = require('./platform.js');
    var stopping = false;
    function stop() {
        if (stopping) return;
        stopping = true;
        platform.stop();
        try { fs.unlinkSync(path.join(root, 'prototype.pid')); } catch (e) {}
        process.exit(0);
    }
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    setTimeout(stop, 900000);
    require('./main.js');
    var proving = false;
    var timer = setInterval(function () {
        var state = platform.status();
        if (!state.agent.connected || proving) return;
        proving = true;
        clearInterval(timer);
        platform.execute('id; cat /proc/self/attr/current; sed -n "/^Cap/p" /proc/self/status; /usr/bin/node --version', 8000)
            .then(function (result) {
                var report = {time: new Date().toISOString(), agent: state.agent, command: result,
                    classification: result.exit_code === 0 && /^uid=0\(root\) gid=0\(root\)/.test(result.stdout)
                        ? 'root-agent-and-command-demonstrated' : 'inconclusive'};
                fs.writeFileSync(path.join(root, 'root-proof.json'), JSON.stringify(report, null, 2), {mode: 384});
            }).catch(function (error) { console.error('Root verification failed: ' + error.message); });
    }, 500);
}
