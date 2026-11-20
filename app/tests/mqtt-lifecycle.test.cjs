'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const vm = require('vm');
const EventEmitter = require('events');
const timers = new Map(); let next = 0;
class Client extends EventEmitter { connect() {} close() { this.emit('close'); } }
const context = vm.createContext({module: {exports: {}}, require: n => n === 'fs' ? {readFileSync: () => '{"host":"broker"}'} : {MqttClient: Client},
 setInterval: fn => { const id = ++next; timers.set(id, fn); return id; }, clearInterval: id => timers.delete(id),
 setTimeout: fn => { const id = ++next; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id)});
vm.runInContext(fs.readFileSync(require.resolve('../service/mqtt-bridge.js'), 'utf8'), context);
const bridge = new context.module.exports.MqttBridge(() => ({}));
bridge.start(); assert.equal(timers.size, 2);
bridge.start(); assert.equal(timers.size, 2, 'start must be idempotent');
const previous = bridge.client;
bridge.setTopics(['vetro/cmd']);
assert.equal(bridge.client, previous, 'setTopics while connecting does not abort in-flight connection');
bridge._connect();
assert.equal(timers.size, 2, 'replacing a client must not schedule its reconnect');
previous.emit('close');
assert.equal(timers.size, 2, 'stale close must not schedule reconnect');
bridge.client.emit('close');
assert.equal(timers.size, 3, 'unexpected close schedules one reconnect');
bridge.stop();
assert.equal(timers.size, 0, 'stop clears publication, config polling and reconnect');
assert.equal(bridge.client, null);
console.log('PASS MQTT lifecycle: replacement, stale close, idempotent start and full stop');
