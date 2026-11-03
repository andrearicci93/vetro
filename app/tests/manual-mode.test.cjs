'use strict';
const assert = require('assert').strict;
const path = require('path');
const EventEmitter = require('events');
const timers = [];
let bridgeStarts = 0;
const {context, router} = require('./service-harness.cjs')(path.resolve(__dirname, '..'), {
    dependencies: {
        './build-info.js': {version: 'fixture', rootMethod: 'remote-pc', remotePcMode: 'manual', readOnly: false, automaticRestore: false},
        './mqtt-bridge.js': {MqttBridge: function () {
            this.connected = false; this.setTopics = function () {}; this.start = function () { bridgeStarts++; };
        }}
    },
    setInterval: function (callback) { timers.push(callback); return {unref() {}}; }
});
function request(url, body) {
    return new Promise(resolve => {
        const req = new EventEmitter(); req.method = 'POST'; req.url = url;
        let status;
        router(req, {writeHead(code) {status = code;}, end(data) {resolve({status, body: JSON.parse(data)});}});
        req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end');
    });
}
(async () => {
    assert.equal(context.READ_ONLY, false);
    assert.equal(context.AUTOMATIC_RESTORE, false);
    assert.equal(bridgeStarts, 0, 'saved MQTT config is not started in manual mode');
    context.platform = {status: () => ({agent: {connected: true}})};
    let automaticCalls = 0;
    for (const [object, key] of [[context.dock, 'supervise'], [context.dnsFilter, 'restore'], [context.wins, 'boot']]) {
        object[key] = () => {automaticCalls++; return Promise.resolve({});};
    }
    context.restoreInput = () => {automaticCalls++;};
    context.inventory = () => {automaticCalls++; return Promise.resolve({apps: []});};
    for (let tick = 0; tick < 70; tick++) for (const callback of timers) callback();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(automaticCalls, 0, 'connected root does not replay dock/input/DNS/wins or alter boot flags');

    const id = 'example.userapp'; let disabled = false; const commands = [];
    context.inventory = async () => ({apps: [{appId: id, disabled, system: false, removable: true}]});
    context.agentExecute = async command => {
        commands.push(command); disabled = command.includes('pkgcmd -D');
        return {exit_code: 0, timed_out: false, stdout: ''};
    };
    const off = await request('/debloat', {action: 'disable', appIds: [id]});
    assert.equal(off.status, 200); assert.equal(off.body.verified, true); assert.equal(disabled, true);
    const on = await request('/debloat', {action: 'enable', appIds: [id]});
    assert.equal(on.status, 200); assert.equal(on.body.verified, true); assert.equal(disabled, false);
    assert.equal(commands.length, 2);
    assert.ok(commands.every(command => command.endsWith('--global')), 'HTTP toggles retain global flag readback');
    const rejected = await request('/debloat', {action: 'disable', appIds: [id, 'other.app']});
    assert.equal(rejected.status, 409, 'the individual Debloater still requires one target');
    assert.equal(commands.length, 2);
    let launcherCalls = 0;
    context.dock.enable = async () => {launcherCalls++; return {enabled: true};};
    assert.equal((await request('/dock', {action: 'enable'})).status, 200);
    assert.equal(launcherCalls, 1, 'launcher is available only by explicit action in manual mode');
    console.log('PASS manual mode: explicit Debloater round trip and Launcher request, no automatic restore or startup flags');
})().catch(e => {console.error(e); process.exitCode = 1;});
