'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../service/remote-pc-deadline.js'), 'utf8');
function fixture() {
    let next = 0;
    const timers = new Map();
    const context = {module: {exports: {}}, setTimeout(callback, ms) {
        const id = ++next; timers.set(id, {callback, ms}); return id;
    }};
    vm.runInNewContext(source, context);
    return {schedule: context.module.exports.schedule, timers,
        cancel(id) { timers.delete(id); },
        expire() {
            const [id, timer] = timers.entries().next().value;
            timers.delete(id); timer.callback();
        }};
}
let clock = fixture(), events = [];
clock.schedule(() => events.push('stop'), () => events.push('start'));
assert.equal(clock.timers.values().next().value.ms, 900000);
clock.expire();
assert.deepEqual(events, ['stop'], 'default deadline closes without renewal');
for (const autoRenew of [false, 'true', 1]) {
    clock = fixture(); events = [];
    clock.schedule(() => events.push('stop'), () => events.push('start'), {autoRenew});
    clock.expire();
    assert.deepEqual(events, ['stop'], 'renewal requires explicit true');
}
clock = fixture(); events = [];
let handle;
function stop() { clock.cancel(handle); events.push('stop'); }
function start() {
    events.push('start');
    handle = clock.schedule(stop, start, {autoRenew: true, lifetimeMs: 50});
}
start();
for (let i = 0; i < 3; i++) {
    assert.equal(clock.timers.size, 1);
    assert.equal(clock.timers.values().next().value.ms, 50);
    clock.expire();
}
assert.deepEqual(events, ['start', 'stop', 'start', 'stop', 'start', 'stop', 'start']);
stop();
assert.equal(clock.timers.size, 0, 'explicit stop cancels pending renewal');
clock = fixture();
clock.schedule(() => { throw new Error('cleanup failed'); }, () => assert.fail('must not restart'), {autoRenew: true});
assert.throws(() => clock.expire(), /cleanup failed/);
console.log('PASS deadline default, explicit opt-in, stop-before-start, repeated renewal and cancellation');
