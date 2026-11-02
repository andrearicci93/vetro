'use strict';
// #100: parts of Samsung's Settings (com.samsung.tv.coba.setting*) are not apps: app_launcher returns 0 and nothing opens.
const assert = require('assert').strict;
const remap = require('../service/remap.js');
['com.samsung.tv.coba.setting', 'com.samsung.tv.coba.setting.devicemanager', 'com.samsung.tv.coba.setting.networksettings'].forEach(id =>
    assert.equal(remap.launchable(id), false, id));
['org.tizen.netflix-app', 'com.samsung.tv.coba.settingsX', 'com.samsung.tv.cobasetting', 'amazon.primevideo'].forEach(id =>
    assert.equal(remap.launchable(id), true, id));
const rule = id => ({id: 'r', trigger: {type: 'physical', value: '497'}, actions: [{type: 'launch', appId: id}]});
// Rules saved by 0.3.5 still load, so one bad action does not cost the user every rule...
assert.equal(remap.validateRules([rule('com.samsung.tv.coba.setting')]).length, 1);
// ...but a new one is refused with a reason.
assert.throws(() => remap.checkLaunchable(remap.validateRules([rule('com.samsung.tv.coba.setting.devicemanager')])), /part of Samsung.s Settings, not an app/);
assert.equal(remap.checkLaunchable(remap.validateRules([rule('org.tizen.netflix-app')])).length, 1);
// Through the service: a new rule is refused with 400, an old one is skipped without a command.
(async () => {
    const path = require('path'), EventEmitter = require('events'), platform = require('../service/platform.js'), commands = [];
    platform.execute = c => { commands.push(c); return Promise.resolve({exit_code: 0, stdout: ''}); };
    const {context, router} = require('./service-harness.cjs')(path.resolve(__dirname, '..'));
    const post = (url, body) => new Promise(resolve => { const req = new EventEmitter(); req.method = 'POST'; req.url = url;
        const res = {writeHead(n) { this.status = n; }, end(s) { resolve({status: this.status, data: JSON.parse(s)}); }};
        router(req, res); req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); });
    const refused = await post('/remap', {rules: [rule('com.samsung.tv.coba.setting')]});
    assert.equal(refused.status, 400);
    assert.match(refused.data.error, /not an app/);
    const old = await context.runActions([{type: 'launch', appId: 'com.samsung.tv.coba.setting.networksettings'}, {type: 'launch', appId: 'org.tizen.netflix-app'}]);
    assert.deepEqual(commands, ['/usr/bin/app_launcher -s org.tizen.netflix-app'], 'only the real app is launched');
    assert.deepEqual(Array.from(old.skipped), ['launch:not-an-app']);
    assert.equal(old.sent, 1);
    console.log('PASS not launchable: Settings components are refused in new rules and still load from old ones (#100)');
})().catch(e => { console.error(e); process.exitCode = 1; });
