'use strict';
// Firmware and Tizen version read by the service itself, for the diagnostic report. The widget posts the model and
// the firmware only when the Vetro page has finished its probe, and two community reports (#17, #25) came back with
// both empty. /etc/prd_info.ini and /etc/tizen-release are world-readable text files; this reads two lines of them.
// The commercial model is not in either file, so it still comes from the widget.
var execError = require('./exec-error.js');

var FIRMWARE = /^T-[A-Z0-9]{2,12}(?:-\d{4})?-\d{1,5}\.\d{1,3}$/;
var TIZEN = /(\d{1,2}\.\d{1,2}\.\d{1,2})/;

function script() {
    return [
        'sed -n "/^\\[Version\\]/,/^\\[/p" /etc/prd_info.ini 2>/dev/null | grep -E "^Version=" | head -n 1',
        'head -n 1 /etc/tizen-release 2>/dev/null | sed "s/^/Tizen=/"',
        'true'
    ].join('\n');
}
function wrap(s) { return 'echo ' + Buffer.from(s).toString('base64') + ' | base64 -d | sh'; }

// Anything that does not look like what the TV writes is dropped, not exported.
function parse(text) {
    var out = {firmware: null, tizenVersion: null};
    String(text || '').split('\n').forEach(function (line) {
        line = line.replace(/\r$/, '').trim();
        var m = /^Version=(.+?);?$/.exec(line);
        if (m && FIRMWARE.test(m[1]) && !out.firmware) out.firmware = m[1];
        m = /^Tizen=(.+)$/.exec(line);
        if (m && !out.tizenVersion) { var v = TIZEN.exec(m[1]); if (v) out.tizenVersion = v[1]; }
    });
    return out;
}

function read(execute) {
    return execute(wrap(script()), 5000).then(function (r) {
        if (!r || r.exit_code || r.timed_out) throw execError.failed(r, 'device info unavailable');
        return parse(r.stdout);
    });
}

// The probe values the widget posted, plus whatever the service can add. It only ever adds: it never rejects, and it
// resolves with the probe alone once maxMs have passed, so a busy or stuck root agent cannot cost the report its
// model and firmware. The firmware the widget posted is not replaced.
function merge(probe, execute, maxMs) {
    var timer;
    var added = Promise.resolve().then(function () { return read(execute); }).then(function (info) {
        return Object.assign({}, probe, {tizenVersion: info.tizenVersion},
            probe.firmware || !info.firmware ? {} : {firmware: info.firmware, firmwareSource: 'service-read'});
    }).catch(function () { return probe; });
    var late = new Promise(function (resolve) { timer = setTimeout(function () { resolve(probe); }, maxMs); });
    return Promise.race([added, late]).then(function (v) { clearTimeout(timer); return v; });
}

module.exports = {read: read, merge: merge, parse: parse, script: script};
