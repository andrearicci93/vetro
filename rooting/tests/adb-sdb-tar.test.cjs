'use strict';
const assert = require('assert').strict;
const net = require('net');
const { Connection } = require('../service/adb.js');
const sdb = require('../service/sdb.js');

function checksum(data) {
    if (!data) return 0;
    let t = 0;
    for (let i = 0; i < data.length; i++) t = (t + data[i]) & 0xffffffff;
    return t;
}

function encode(cmd, arg1, arg2, payload) {
    const data = payload == null ? null : (typeof payload === 'string' ? Buffer.concat([Buffer.from(payload), Buffer.from([0])]) : payload);
    const len = data ? data.length : 0;
    const c = Buffer.from(cmd).readUInt32LE(0);
    const b = Buffer.alloc(24 + len);
    b.writeUInt32LE(c, 0);
    b.writeUInt32LE(arg1 >>> 0, 4);
    b.writeUInt32LE(arg2 >>> 0, 8);
    b.writeUInt32LE(len >>> 0, 12);
    b.writeUInt32LE(checksum(data) >>> 0, 16);
    b.writeUInt32LE((c ^ 0xffffffff) >>> 0, 20);
    if (len > 0) data.copy(b, 24);
    return b;
}

(async () => {
    // 1. adb.js: 0-byte WRTE must not push(null) EOF or crash later WRTE frames
    let serverSocket = null;
    const server = net.createServer(sock => {
        serverSocket = sock;
        let buf = Buffer.alloc(0);
        sock.on('data', chunk => {
            buf = Buffer.concat([buf, chunk]);
            while (buf.length >= 24) {
                const len = buf.readUInt32LE(12);
                if (buf.length < 24 + len) break;
                const cmd = buf.slice(0, 4).toString('ascii');
                const arg1 = buf.readUInt32LE(4);
                buf = buf.slice(24 + len);
                if (cmd === 'CNXN') {
                    sock.write(encode('CNXN', 0x01000000, 4096, 'device::'));
                } else if (cmd === 'OPEN') {
                    sock.write(encode('OKAY', 99, arg1));
                    sock.write(encode('WRTE', 99, arg1, null));
                    sock.write(encode('WRTE', 99, arg1, Buffer.from('hello world')));
                    sock.write(encode('CLSE', 99, arg1));
                }
            }
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const port = server.address().port;
        const client = new Connection('127.0.0.1', port);
        await new Promise((resolve, reject) => {
            client.once('connect', resolve);
            client._socket.once('error', reject);
        });
        const stream = client.createStream('shell:echo hello');
        const chunks = [];
        stream.on('data', d => chunks.push(d));
        await new Promise((resolve, reject) => {
            stream.once('error', reject);
            stream.once('end', resolve);
        });
        assert.equal(Buffer.concat(chunks).toString('utf8'), 'hello world');
        client.close();
        if (serverSocket) serverSocket.destroy();
    } finally {
        await new Promise(resolve => server.close(resolve));
    }

    // 2. sdb.js: stream emitting 'error' during or after close() in finish() must not go uncaught
    const { EventEmitter } = require('events');
    for (const emitTiming of ['sync', 'async']) {
        const s = new EventEmitter();
        s.close = () => {
            if (emitTiming === 'sync') s.emit('error', new Error('late sync error'));
            else setImmediate(() => s.emit('error', new Error('late async error')));
        };
        const p = sdb.exec({ createStream: () => s }, 'shell:id', { until: t => t === 'done' });
        s.emit('data', Buffer.from('done'));
        assert.equal(await p, 'done');
        await new Promise(r => setImmediate(r));
    }

    // 3. Round 3: adb.js short-read header at EOF must not throw RangeError, and createStream on closed connection fails fast
    const truncServer = net.createServer(sock => {
        sock.once('data', () => {
            // Send only 10 bytes (< 24-byte header) then FIN
            sock.end(Buffer.alloc(10, 0x41));
        });
    });
    await new Promise(resolve => truncServer.listen(0, '127.0.0.1', resolve));
    try {
        const port = truncServer.address().port;
        const client = new Connection('127.0.0.1', port);
        await new Promise(resolve => client._socket.once('close', resolve));
        // createStream on dead connection must throw synchronously so sdb.exec fails fast instead of waiting 60s
        await assert.rejects(sdb.exec(client, 'shell:id', { timeout: 5000 }), err => err.code === 'sdbStreamFailed');
    } finally {
        await new Promise(resolve => truncServer.close(resolve));
    }

    console.log('PASS adb-sdb-tar: 0-byte WRTE, sdb close error guard, truncated-EOF safety, and dead-connection fast fail');
})().catch(e => { console.error(e); process.exit(1); });
