'use strict';
const assert = require('assert').strict;
const service = require('./provider-harness.cjs')(require('path').resolve(__dirname, '..')).context;
let connects = 0; let retries = 0;
service.sdb = {connect: () => { connects++; return Promise.reject(new Error('unexpected connect')); }};
service.agentServer = {};
service.state.agentPort = 12345;
service.state.running = true;
service.prepare = () => { throw new Error('staging unavailable'); };
service.scheduleRelaunch = () => { retries++; };
service.relaunch();
setImmediate(function () {
assert.equal(connects, 0, 'failed preparation must never launch incomplete payload');
assert.equal(retries, 1, 'failed preparation must remain recoverable');
assert.equal(service.launching, false);
console.log('PASS preparation failure does not launch and schedules recovery');
});
