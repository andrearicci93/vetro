'use strict';
// Tizen's web-service host terminates on child_process.execFile. Capture the
// read-only probes through the same SDB injection route as archive-root instead.
var fs = require('fs');
var net = require('net');
var crypto = require('crypto');
var sdb = require('./sdb.js');
function error() { var e = new Error('preflight capture failed'); e.code = 'preflight-failed'; return e; }
function quote(value) { return "'" + value.replace(/'/g, "'\\''") + "'"; }
function createRunner(client, injection, options) {
    var opts = options || {}, directory = opts.directory || '/home/owner/share/tmp';
    return function run(file, args) {
        return new Promise(function (resolve, reject) {
            var token = crypto.randomBytes(16).toString('hex');
            var script = directory + '/.vetro-preflight-' + token + '.sh';
            var sockets = [], output = null, dispatched = false, finished = false;
            var server = net.createServer(function (socket) {
                sockets.push(socket);
                var data = '';
                socket.setEncoding('utf8');
                socket.on('error', function () { finish(error()); });
                socket.on('data', function (chunk) {
                    data += chunk;
                    if (data.length > 128 * 1024) finish(error());
                });
                socket.on('end', function () {
                    var prefix = token + '\n';
                    var ending = /\nVETRO_EXIT:(\d+)\n$/.exec(data);
                    if (data.indexOf(prefix) !== 0 || !ending || output !== null) return finish(error());
                    var code = Number(ending[1]);
                    output = {ok: code === 0, code: code, output: data.slice(prefix.length, ending.index)};
                    complete();
                });
            });
            var timer = setTimeout(function () { finish(error()); }, opts.timeout || 15000);
            function finish(failure, result) {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                sockets.forEach(function (socket) { socket.destroy(); });
                server.close();
                try { fs.unlinkSync(script); } catch (ignored) {}
                if (failure) reject(failure); else resolve(result);
            }
            function complete() { if (output !== null && dispatched) finish(null, output); }
            server.on('error', function () { finish(error()); });
            server.listen(0, '127.0.0.1', function () {
                if (finished) return;
                var command = [file].concat(args).map(quote).join(' ');
                var body = 'exec 3<>/dev/tcp/127.0.0.1/' + server.address().port + '\n' +
                    "printf '%s\\n' " + quote(token) + ' >&3\n' +
                    command + ' >&3 2>&3\n' +
                    "printf '\\nVETRO_EXIT:%s\\n' \"$?\" >&3\nexec 3>&-\n";
                try {
                    // The SDK user must be able to read the service's staging
                    // script. The callback is loopback-only and bounded.
                    fs.writeFileSync(script, body, {mode: 420 /* 0o644 */});
                    var request = 'shell:0 appinstall tpk ' + injection('. ' + script);
                    if (Buffer.byteLength(request) > 510) throw error();
                    Promise.resolve(sdb.exec(client, request, {timeout: opts.timeout || 15000})).then(function () {
                        dispatched = true;
                        complete();
                    }, function () { finish(error()); });
                } catch (failure) { finish(error()); }
            });
        });
    };
}
module.exports = {createRunner: createRunner};
