'use strict';
// Commands cross only root-owned files in a mode-0700 directory.
var fs = require('fs');
var path = require('path');

function create(directory, workerPid, expectedUid) {
    var stat = fs.lstatSync(directory);
    expectedUid = expectedUid == null ? 0 : expectedUid;
    if (!stat.isDirectory() || stat.uid !== expectedUid || (stat.mode & 511) !== 448 ||
        fs.existsSync(path.join(directory, 'request')) ||
        !Number.isInteger(workerPid) || workerPid < 2) throw new Error('Invalid private shell runtime');
    var stopped = false, pending = null;
    function killGroup(pid) { if (pid > 1) { try { process.kill(-pid, 'SIGKILL'); } catch (e) {} } }
    function run(task, callback) {
        if (stopped || pending) throw new Error('Shell executor is unavailable');
        var start = Date.now(), canceled = false, finished = false, pid = 0;
        var prefix = String(task.seq), timer;
        function file(kind) { return path.join(directory, kind + '-' + prefix); }
        function size(kind) { try { return fs.statSync(file(kind)).size; } catch (e) { return 0; } }
        function read(kind) {
            try {
                var fd = fs.openSync(file(kind), 'r'), bytes = Buffer.alloc(Math.min(size(kind), 1024 * 1024));
                try { var count = fs.readSync(fd, bytes, 0, bytes.length, 0); return bytes.slice(0, count); }
                finally { fs.closeSync(fd); }
            } catch (e) { return Buffer.alloc(0); }
        }
        function done(code, timedOut, note) {
            if (finished) return;
            finished = true;
            clearInterval(timer);
            killGroup(pid);
            var out = read('out'), err = read('err');
            if (out.length + err.length > 1024 * 1024) err = err.slice(0, Math.max(0, 1024 * 1024 - out.length));
            ['cmd', 'pid', 'out', 'err', 'done', 'done.tmp'].forEach(function (kind) {
                try { fs.unlinkSync(file(kind)); } catch (e) {}
            });
            pending = null;
            callback({exit_code: code, timed_out: timedOut, stdout: out.toString('utf8'),
                stderr: err.toString('utf8') + (note || '')});
        }
        function poll() {
            if (!pid) {
                var found = read('pid').toString('utf8').trim();
                if (/^[1-9][0-9]*$/.test(found)) pid = Number(found);
            }
            var elapsed = Date.now() - start, timeout = elapsed >= task.timeout;
            if ((canceled || timeout) && pid) { done(124, !canceled, ''); return; }
            if ((canceled || timeout) && elapsed > Math.max(task.timeout, 1000) + 1000) {
                killGroup(workerPid); done(124, !canceled, '\nShell worker did not acknowledge command\n'); return;
            }
            if (size('out') + size('err') >= 1024 * 1024) { done(125, false, '\nCommand output limit exceeded\n'); return; }
            var result = read('done').toString('utf8').trim();
            if (/^[0-9]{1,3}$/.test(result)) done(Number(result), false, '');
        }
        fs.writeFileSync(file('cmd'), task.command + '\n', {flag: 'wx', mode: 384});
        pending = function () { canceled = true; poll(); };
        timer = setInterval(poll, 20);
        fs.writeFileSync(path.join(directory, 'request.tmp'), prefix + '\n', {mode: 384, flag: 'wx'});
        fs.renameSync(path.join(directory, 'request.tmp'), path.join(directory, 'request'));
        return pending;
    }
    run.close = function () {
        stopped = true;
        if (pending) pending();
        killGroup(workerPid);
        // Cleanup is best-effort; an active cancellation owns its own files.
        try { fs.unlinkSync(path.join(directory, 'request')); } catch (e) {}
        try { fs.rmdirSync(directory); } catch (e) {}
    };
    return run;
}
module.exports = {create: create};
