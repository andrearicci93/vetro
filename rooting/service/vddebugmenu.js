'use strict';

// Tizen 10 vddebugmenu bootstrap. This is deliberately opt-in: the sequence
// is firmware-specific and must never be selected from a model/year guess.
var SENTINEL = 'VETRO_VDDEBUG_DONE_';
var BEGIN = 'VETRO_VDDEBUG_BEGIN_';
var END = 'VETRO_VDDEBUG_END_';

// vddebugmenu echoes stdin. A marker embedded in the echoed command is not
// proof that the privileged command ran. The official tvroot.sh waits for a
// line beginning with the marker (not necessarily ending there): this TV can
// append the menu separator to the same line. Accept that suffix, but never
// accept a marker occurring after `echo ` in the echoed input.
function hasMarkerLine(output, marker) {
    var lines = output.replace(/\r/g, '').split('\n');
    for (var i = 0; i < lines.length; i++) if (lines[i].indexOf(marker) === 0) return true;
    return false;
}

function run(client, command, options) {
    options = options || {};
    var trace = typeof options.log === 'function' ? options.log : function () {};
    var rawTrace = typeof options.rawLog === 'function' ? options.rawLog : function () {};
    var timeout = options.timeout || 30000;
    var stream;
    // The CLI command `shell 0 hyperuart_vddebugmenu` maps to the wire
    // service `shell:0 hyperuart_vddebugmenu`. Without the shell: prefix the
    // TV closes the local stream before sending OKAY/open.
    var service = 'shell:0 hyperuart_vddebugmenu';
    trace('stream-create', service);
    try { stream = client.createStream(service); }
    catch (e) { trace('stream-create-error', String(e.message || e)); return Promise.reject(e); }
    return new Promise(function (resolve, reject) {
        var output = '', settled = false, timer, stepTimers = [];
        // Keep the task markers short: the menu can echo oversized task names
        // without executing them.
        var id = Math.random().toString(16).slice(2, 8);
        var begin = 'VB' + id;
        var end = 'VE' + id;
        var done = 'VD' + id;
        trace('markers', 'begin=' + begin + ' end=' + end + ' done=' + done);
        function finish(error) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            stepTimers.forEach(clearTimeout);
            try { stream.removeAllListeners(); stream.close(); } catch (ignored) {}
            if (error) {
                trace('diagnosis', JSON.stringify({
                    code: error.code || error.message || String(error),
                    bytes: output.length,
                    echoedDone: output.indexOf('echo ' + done + ';#') >= 0,
                    markerLineDone: hasMarkerLine(output, done),
                    markerLineBegin: hasMarkerLine(output, begin),
                    markerLineEnd: hasMarkerLine(output, end)
                }));
            }
            trace('finish', error ? (error.code || error.message || String(error)) : 'sentinel');
            rawTrace('event', 'finish ' + (error ? (error.code || error.message || String(error)) : 'sentinel'));
            if (error) reject(error); else resolve(output);
        }
        timer = setTimeout(function () {
            var e = new Error('vddebugmenu timeout'); e.code = 'vddebugTimeout'; finish(e);
        }, timeout);
        stream.on('data', function (chunk) {
            var text = chunk.toString();
            output += text;
            rawTrace('rx', text);
            trace('data', 'bytes=' + chunk.length + ' total=' + output.length + ' tail=' + JSON.stringify(output.slice(-160)));
            if (hasMarkerLine(output, done)) {
                trace('done-marker', 'received marker-line bytes=' + output.length);
                finish(null);
            }
        });
        stream.on('error', function (e) { trace('stream-error', String(e.message || e)); e.code = e.code || 'vddebugStreamError'; finish(e); });
        stream.on('end', function () { trace('stream-end', 'settled=' + settled); if (!settled) { var e = new Error('vddebugmenu closed'); e.code = 'vddebugClosed'; finish(e); } });
        stream.on('open', function () {
            trace('stream-open', 'profile=generic');
            // The menu must finish each transition before receiving the next
            // line. The generic profile uses the published one-shot sequence.
            // Keep the privileged command in the foreground until the
            // launcher has run it and emitted the end markers.
            var task = 'x;echo ' + begin + ';' + command + ';echo ' + end + ';echo ' + done + ';#\n';
            var steps = ['20089999\n94\n7\n1\nx;pkill -f dlogd_sdb;#\n1\n' + task + '99\n99\n99\n'];
            function send(i) {
                if (settled || i >= steps.length) return;
                stream.write(steps[i], function (error) {
                    rawTrace('tx', steps[i]);
                    trace('step-write', 'index=' + i + ' bytes=' + steps[i].length + (error ? ' error=' + String(error.message || error) : ' ok'));
                    if (error) return finish(error);
                    if (i + 1 < steps.length) {
                        var wait = options.stepDelay === undefined ? 1000 : options.stepDelay;
                        trace('step-wait', 'after=' + i + ' ms=' + wait);
                        var t = setTimeout(function () { send(i + 1); }, wait);
                        stepTimers.push(t);
                    }
                });
            }
            send(0);
        });
    });
}

module.exports = {run: run, SENTINEL: SENTINEL};
