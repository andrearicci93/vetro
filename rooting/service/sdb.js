'use strict';

// Node 4.4 (Tizen 5.5 and older) cannot parse destructuring.
const Connection = require('./adb.js').Connection;
const SDB_PORT = 26101;

function SdbError(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
}

function connect(options) {
    const opts = options || {};
    const host = opts.host || '127.0.0.1';
    const port = opts.port || SDB_PORT;
    const timeout = opts.timeout || 8000;
    const log = opts.log || function () {};

    return new Promise((resolve, reject) => {
        let client;
        try { client = new Connection(host, port, log); }
        catch (e) { return reject(SdbError('sdbRefused', String(e.message || e))); }

        const socket = client._socket;
        let settled = false;
        const timer = setTimeout(() => finish(SdbError('sdbTimeout', 'no answer on ' + host + ':' + port)), timeout);

        function finish(err, value) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            client.removeListener('connect', onConnect);
            socket.removeListener('error', onError);
            socket.removeListener('close', onClose);
            if (err) { try { socket.destroy(); } catch (e) {} reject(err); }
            else resolve(value);
        }
        function onConnect() { finish(null, client); }
        function onError(e) {
            const code = (e && e.code) || 'unknown';
            if (code === 'ECONNREFUSED') return finish(SdbError('sdbRefused', 'refused'));
            if (code === 'ECONNRESET') return finish(SdbError('sdbReset', 'reset'));
            if (code === 'ESDBAUTH') return finish(SdbError('sdbAuthRequired', String(e.message)));
            finish(SdbError('sdbError', code + ': ' + String(e.message || e)));
        }
        function onClose() { finish(SdbError('sdbClosed', 'closed before handshake')); }

        client.on('connect', onConnect);
        socket.on('error', onError);
        socket.on('close', onClose);
    });
}

function exec(client, command, options) {
    const opts = options || {};
    const timeout = opts.timeout || 60000;
    const until = opts.until;
    return new Promise((resolve, reject) => {
        let stream;
        try { stream = client.createStream(command); }
        catch (e) { return reject(SdbError('sdbStreamFailed', String(e.message || e))); }

        let output = '';
        let settled = false;
        const timer = setTimeout(() => finish(SdbError('sdbTimeout', 'timeout: ' + command), output), timeout);

        function finish(err, value) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { stream.removeAllListeners(); stream.close(); } catch (e) {}
            if (err) reject(err); else resolve(value);
        }
        function onData(chunk) {
            output += chunk.toString();
            if (until && until(output)) finish(null, output);
        }
        function onEnd() { finish(null, output); }
        function onError(e) { finish(SdbError('sdbStreamError', String(e && e.message || e)), output); }

        stream.on('data', onData);
        stream.on('error', onError);
        stream.on('end', onEnd);
        stream.on('close', onEnd);
    });
}

function close(client) {
    try { client.close(); } catch (e) {}
}

module.exports = { connect, exec, close, SDB_PORT };