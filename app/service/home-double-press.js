'use strict';
var fs = require('fs');
var crypto = require('crypto');
var atomicFile = require('./atomic-file.js');
var APP_ID = /^[A-Za-z0-9_.-]{1,120}$/;
function normalize(value) {
    if (value == null) return {enabled: false, mode: 'shortcut', appId: null};
    if (!value || typeof value.enabled !== 'boolean' || ['shortcut', 'app'].indexOf(value.mode) < 0 ||
        (value.mode === 'app' && (typeof value.appId !== 'string' || !APP_ID.test(value.appId)))) throw Error('Choose a double-press destination');
    return {enabled: value.enabled, mode: value.mode, appId: value.mode === 'app' ? value.appId : null};
}
// The native event loop acknowledges the exact request only after applying it.
// A process id and fresh nonce prevent an old acknowledgement confirming a save.
function apply(value, options) {
    var setting = normalize(value), pid = options.pid;
    if (!Number.isInteger(pid) || pid <= 0) return Promise.reject(Error('The running launcher could not be identified'));
    var request = ['v1', crypto.randomBytes(16).toString('hex'), pid,
        !setting.enabled ? 'off' : setting.mode, setting.enabled && setting.mode === 'app' ? setting.appId : ''].join('\t') + '\n';
    var fd, sent = false;
    try {
        atomicFile.write(fs, options.file, request, {mode: 384});
        fd = fs.openSync(options.fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
        if (!fs.fstatSync(fd).isFIFO()) throw Error('The launcher control pipe is unavailable');
        var command = Buffer.from('reload-double-home\n');
        if (fs.writeSync(fd, command) !== command.length) throw Error('The launcher control request was incomplete');
        sent = true;
    } catch (error) {
        return Promise.reject(Error('Could not send the double-press setting to the running launcher (' + (error.code || error.message) + ')'));
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
        // A failed delivery must not leave a request another command can apply later.
        if (!sent) try { fs.unlinkSync(options.file); } catch (ignored) {}
    }
    var now = options.now || Date.now, sleep = options.sleep || function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
    var deadline = now() + (options.timeoutMs || 3000);
    function poll() {
        try {
            var stat = fs.statSync(options.file + '.applied');
            if (stat.isFile() && stat.size <= 256 && fs.readFileSync(options.file + '.applied', 'utf8') === request) return Promise.resolve();
        } catch (ignored) {}
        if (now() >= deadline) return Promise.reject(Error('The running launcher did not confirm the double-press setting'));
        return sleep(50).then(poll);
    }
    return poll().finally(function () {
        // The saved JSON is authoritative at the next start; this file is only an IPC request.
        try { fs.unlinkSync(options.file); } catch (ignored) {}
    });
}
module.exports = {normalize: normalize, apply: apply};

