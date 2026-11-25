'use strict';
const assert = require('assert').strict;
const path = require('path');
const EventEmitter = require('events');
const loadService = require('./service-harness.cjs');

const items = [
    {sourceType:13, family:'hdmi', port:1, label:'HDMI', key:'KEY_INPUT_13'},
    {sourceType:33, family:'displayport', port:null, label:'DisplayPort', key:'KEY_INPUT_33'},
    {sourceType:41, family:'usbc', port:null, label:'USB-C', key:'KEY_INPUT_41'}
];
const inventory = {items, monitor:true, available:true, currentSourceType:33};
let selections = [], selectImpl = async (_execute, type) => ({ok:true, sourceType:type, currentSourceType:type});
const inputs = {
    read: async () => inventory,
    select: async (execute, type) => { selections.push(type); return selectImpl(execute, type); }
};
const {context, router} = loadService(path.resolve(__dirname, '..'), {
    listen:false, setInterval:() => 1, dependencies:{'./input-sources.js':inputs}
});
const commands = [];
context.agentExecute = async (command, _timeout, guard) => {
    if (guard && !guard()) throw Error('Input action cancelled');
    commands.push(command); return {exit_code:0, stdout:''};
};
function request(method, body) {
    return new Promise((resolve, reject) => {
        const req = new EventEmitter();
        Object.assign(req, {method, url:'/inputs', headers:{host:'127.0.0.1:8099'}, socket:{remoteAddress:'127.0.0.1'}, resume(){}});
        const res = {headersSent:false, statusCode:200, setHeader(){}, writeHead(code){this.statusCode=code;this.headersSent=true;},
            end(text){try { resolve({code:this.statusCode, body:JSON.parse(text)}); } catch(e) { reject(e); }}};
        router(req, res);
        if (body !== undefined) process.nextTick(() => { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); });
    });
}
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    const read = await request('GET');
    assert.equal(read.code, 200);
    assert.deepEqual(read.body.items.map(x => x.label), ['HDMI','DisplayPort','USB-C']);
    assert.deepEqual(selections, [], 'reading choices never changes the input');
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
        const unsupported = await request(method, {sourceType:41});
        assert.equal(unsupported.code, 405, method + ' cannot select an input');
        assert.deepEqual(selections, [], 'unsupported HTTP methods never reach the selector');
    }
    const invalid = await request('POST', {sourceType:'41'});
    assert.equal(invalid.code, 400);
    assert.deepEqual(selections, [], 'unvalidated values never reach the selector');

    await context.runActions([{type:'key',key:'KEY_INPUT_41'}]);
    assert.deepEqual(selections, [41]);
    assert.deepEqual(commands, [], 'USB-C uses the source selector, not a made-up key');
    await context.runActions([{type:'key',key:'KEY_HDMI1'}]);
    assert.deepEqual(selections, [41,13], 'an old HDMI 1 shortcut uses the real monitor input');
    await assert.rejects(context.runActions([{type:'key',key:'KEY_HDMI4'}]), /not available/);
    assert.deepEqual(selections, [41,13], 'a phantom HDMI port is never dispatched');
    await assert.rejects(context.runActions([{type:'key',key:'KEY_INPUT_41'}], false, () => false), /cancelled/);
    assert.deepEqual(selections, [41,13], 'cancelled remote work cannot switch inputs');

    inventory.monitor = false;
    await context.runActions([{type:'key',key:'KEY_HDMI1'}]);
    assert.match(commands.pop(), /input_keyevent XF86DiscretHDMI1/);
    const originalRead = inputs.read;
    inputs.read = async () => { throw Error('Inventory unavailable'); };
    const oldSettings=context.state.settings;
    context.state.settings={modelCode:'LS27BG652'};
    await context.runActions([{type:'key',key:'KEY_HDMI1'}]);
    assert.match(commands.pop(), /input_keyevent XF86DiscretHDMI1/, 'a TV legacy shortcut survives an unreadable cache');
    context.state.settings=oldSettings;
    inputs.read = originalRead;
    inventory.monitor = true;
    await request('GET');
    inputs.read = async () => { throw Error('Inventory unavailable'); };
    await assert.rejects(context.runActions([{type:'key',key:'KEY_HDMI1'}]), /Inventory unavailable/, 'a known monitor does not fall back to unverified TV keys');
    inputs.read = originalRead;

    let release;
    selectImpl = () => new Promise(resolve => { release = resolve; });
    const first = request('POST', {sourceType:13});
    await tick();
    const concurrent = await request('POST', {sourceType:41});
    assert.equal(concurrent.code, 409, 'whole source changes cannot interleave');
    release({ok:true, sourceType:13, currentSourceType:13});
    assert.equal((await first).code, 200);
    selectImpl = async () => { throw Error('Selected input was not confirmed'); };
    const failed = await request('POST', {sourceType:41});
    assert.equal(failed.code, 503);
    assert.match(failed.body.error, /not confirmed/);
    selectImpl = async (_execute, type) => ({ok:true, sourceType:type, currentSourceType:type});
    assert.equal((await request('POST', {sourceType:41})).code, 200, 'failure releases the selection lock');
    console.log('PASS monitor input routes: real ports, USB-C and legacy dispatch, cancellation, validation, concurrency and failed verification');
})().catch(error => { console.error(error); process.exitCode=1; });
