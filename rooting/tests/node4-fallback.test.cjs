'use strict';
// Node 4.4 (Tizen 4 and 5.5) has no crypto.generateKeyPairSync: the root agent
// cannot be prepared there at all. The adapter has to say so once and stop, not
// retry forever and rewrite the status file every few seconds while the rest of
// the service (dashboard, apps, diagnostics) keeps working.
const assert = require('assert').strict;
const path = require('path');
const context = require('./provider-harness.cjs')(path.resolve(__dirname, '..')).context;

context.crypto = { randomBytes: function () { return Buffer.alloc(8); } };
context.state.running = true;
context.agentServer = { close: function () { context.closed = true; } };

context.prepareForRuntime(4321);
assert.equal(context.state.unsupported, true, 'an unsupported runtime is recorded');
assert.match(context.state.prepareError, /Node 10\.12\+/, 'the reason names the runtime requirement');
assert.equal(context.closed, true, 'the loopback listener that nothing can reach is closed');

let connects = 0, retries = 0;
context.sdb = { connect: function () { connects++; return Promise.reject(new Error('must not connect')); } };
context.scheduleRelaunch = function () { retries++; };
// Keep a server so the check cannot pass just because relaunch() has none.
context.agentServer = { close: function () {} };
context.relaunch();
assert.equal(connects, 0, 'nothing is launched without a prepared payload');
assert.equal(retries, 0, 'an unsupported runtime is final, not retried');

console.log('PASS Node 4.4 adapter fallback: one clear reason, no retry loop, no launch');
