'use strict';
// Own systemd unit so standby does not kill voice along with the SDB root agent.
// Only the enabled flag is readable by the app; API credentials stay root-only.
var fs = require('fs');
var path = require('path');
var STATE = '/opt/usr/home/owner/share/vetro-voice.json';
var CONFIG = '/opt/usr/home/owner/share/vetro-voice/config.json';
var CANCEL = '/tmp/vetro-voice-service.cancel';
var STATUS = '/tmp/vetro-voice-status.json';
var UNIT = 'vetro-voice.service';
function q(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
function checked(r) {
    if (!r || r.exit_code || r.timed_out) throw Error('Voice service operation failed');
    return r.stdout || '';
}
function Voice(options) {
    this.execute = options.execute;
    this.stateFile = options.stateFile || STATE;
    this.dir = options.dir || path.join(__dirname, '..', 'native', 'voice');
    this.busy = false;
    this.error = null;
}
Voice.prototype.enabled = function () {
    try { return JSON.parse(fs.readFileSync(this.stateFile, 'utf8')).enabled === true; }
    catch (_) { return false; }
};
Voice.prototype.startScript = function () {
    return [
        'set -e',
        'test -s ' + q(CONFIG),
        'test -s ' + q(path.join(this.dir, 'VetroVoiceTrial.dll')),
        'if systemctl is-active --quiet ' + UNIT + '; then exit 0; fi',
        'rm -f ' + CANCEL,
        'systemctl reset-failed ' + UNIT + ' >/dev/null 2>&1 || true',
        'systemd-run --unit=vetro-voice --collect -p Restart=on-failure -p RestartSec=3 -p UMask=0077 ' +
            '-p KillSignal=SIGINT -p TimeoutStopSec=8 -p StandardOutput=journal -p StandardError=journal ' +
            '/usr/bin/env HOME=/home/owner /usr/bin/dotnet ' + q(path.join(this.dir, 'VetroVoiceTrial.dll')) + ' --watch ' + q(CONFIG)
    ].join('\n');
};
Voice.prototype.supervise = function (connected) {
    var self = this;
    if (!connected || !this.enabled() || this.busy) return Promise.resolve();
    this.busy = true;
    return this.execute(this.startScript(), 8000).then(checked).then(function () { self.error = null; })
        .catch(function (e) { self.error = e.message; }).finally(function () { self.busy = false; });
};
Voice.prototype.status = function () {
    var self = this;
    return this.execute('if systemctl is-active --quiet ' + UNIT + '; then echo running; else echo stopped; fi; ' +
        'cat ' + STATUS + ' 2>/dev/null || true', 5000).then(checked).then(function (out) {
        var lines = out.trim().split('\n'), detail = {};
        try { detail = JSON.parse(lines.slice(1).join('\n')); } catch (_) {}
        return {enabled: self.enabled(), running: lines[0] === 'running', state: detail.state || null,
            completed: detail.completed || 0, error: self.error || detail.error || null};
    });
};
Voice.prototype.change = function (enabled) {
    var self = this;
    if (typeof enabled !== 'boolean') return Promise.reject(Error('enabled must be a boolean'));
    try { fs.writeFileSync(this.stateFile, JSON.stringify({enabled: enabled})); }
    catch (_) { return Promise.reject(Error('Voice setting could not be saved')); }
    if (enabled) return this.supervise(true).then(function () { return self.status(); });
    return this.execute('touch ' + CANCEL + '; systemctl stop ' + UNIT + ' >/dev/null 2>&1 || true', 12000)
        .then(checked).then(function () { return self.status(); });
};
module.exports = {Voice: Voice};
