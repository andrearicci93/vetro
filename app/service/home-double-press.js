'use strict';
var crypto = require('crypto');
var APP_ID = /^[A-Za-z0-9_.-]{1,120}$/;
var QUOTE_RE = /'/g;
function quote(value) { return "'" + String(value).replace(QUOTE_RE, "'\\''") + "'"; }
function normalize(value) {
    if (value == null) return {enabled: false, mode: 'shortcut', appId: null};
    if (!value || typeof value.enabled !== 'boolean' || ['shortcut', 'app'].indexOf(value.mode) < 0 ||
        (value.mode === 'app' && (typeof value.appId !== 'string' || !APP_ID.test(value.appId)))) throw Error('Choose a double-press destination');
    return {enabled: value.enabled, mode: value.mode, appId: value.mode === 'app' ? value.appId : null};
}
// The app service cannot access the root launcher's IPC on every TV. Keep all
// request, FIFO and acknowledgement IO in a bounded helper run by the root agent.
function apply(value, options) {
    var setting = normalize(value), pid = options.pid;
    if (!Number.isInteger(pid) || pid <= 0) return Promise.reject(Error('The running launcher could not be identified'));
    if (typeof options.execute !== 'function') return Promise.reject(Error('The root launcher connection is unavailable'));
    var nonce = crypto.randomBytes(16).toString('hex');
    var request = ['v1', nonce, pid, !setting.enabled ? 'off' : setting.mode,
        setting.enabled && setting.mode === 'app' ? setting.appId : ''].join('\t') + '\n';
    var command = '/usr/bin/dotnet ' + quote(options.dll) + ' --apply-double-home ' + quote(Buffer.from(request).toString('base64')) +
        ' --dir ' + quote(options.runDir) + ' --double-home-settings ' + quote(options.file);
    return Promise.resolve().then(function () { return options.execute(command, 15000); }).then(function (result) {
        if (!result || result.timed_out) throw Error('The root launcher settings request timed out');
        if (result.exit_code !== 0) throw Error(String(result.stderr || result.stdout || 'The root launcher settings request failed').trim().slice(0,500));
        // Tizen's runtime may write GC diagnostics to the same output stream.
        // Require one complete acknowledgement for this request, independently
        // of those lines; stale, partial and ambiguous acknowledgements fail.
        var replies = String(result.stdout || '').split(/\r?\n/).filter(function (line) {
            return line.indexOf('double-home-applied ') === 0;
        });
        if (replies.length !== 1 || replies[0] !== 'double-home-applied ' + nonce) throw Error('The running launcher did not confirm the double-press setting');
    });
}
module.exports = {normalize: normalize, apply: apply};

