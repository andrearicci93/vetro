'use strict';
const assert = require('assert').strict;
const path = require('path');
const EventEmitter = require('events');
const harness = require('./service-harness.cjs')(path.resolve(__dirname, '..'), {
    dependencies: {'./build-info.js': {version: 'fixture', readOnly: true}},
    setInterval: function () { return {unref() {}}; }
});
let executions = 0;
harness.context.platform.execute = function () { executions++; return Promise.reject(Error('unexpected execution')); };
for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    for (const url of ['/exec', '/dock', '/debloat', '/dns', '/components/action', '/mqtt', '/install']) {
        const request = new EventEmitter(); request.method = method; request.url = url;
        let status, body;
        harness.router(request, {writeHead(code) { status = code; }, end(data) { body = JSON.parse(data); }});
        assert.equal(status, 403);
        assert.match(body.error, /read-only/);
    }
}
function probe(address, body) {
    return new Promise(resolve => {
        const request = new EventEmitter(); request.method = 'POST'; request.url = '/probe';
        request.headers = {}; request.socket = {remoteAddress: address};
        const response = {setHeader() {}, writeHead(code) { this.code = code; },
            end(data) { resolve({code: this.code, body: JSON.parse(data)}); }};
        harness.router(request, response);
        request.emit('data', Buffer.from(JSON.stringify(body)));
        request.emit('end');
    });
}
(async () => {
    const local = await probe('127.0.0.1', {probe: {tizenObject: {ok: true, value: true}}, apps: []});
    assert.equal(local.code, 200);
    assert.equal(local.body.ok, true);
    assert.equal((await probe('192.0.2.1', {apps: []})).code, 403);
    assert.equal(executions, 0);
    assert.equal(harness.context.READ_ONLY, true);
    console.log('PASS read-only build: actions refused, widget diagnostics accepted only from loopback, no platform execution');
})().catch(error => {console.error(error); process.exitCode = 1;});
