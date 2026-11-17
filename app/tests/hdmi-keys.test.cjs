'use strict';
const assert = require('assert');
const control = require('../service/control.js');
const remap = require('../service/remap.js');

[1, 2, 3, 4].forEach(function (n) {
    const native = control.nativeKey('KEY_HDMI' + n);
    assert.strictEqual(native, 'XF86DiscretHDMI' + n);
    assert.strictEqual(control.injectCommand(native), '/usr/bin/input_keyevent XF86DiscretHDMI' + n);
});

// A remap rule from a physical button to an input must validate and resolve.
const rules = remap.validateRules([{id: 'netflix-hdmi3', trigger: {type: 'physical', value: '560'}, actions: [{type: 'key', key: 'KEY_HDMI3'}]}]);
const actions = remap.resolve(rules, 'physical', '560');
assert.strictEqual(actions.length, 1);
assert.strictEqual(control.nativeKey(actions[0].key), 'XF86DiscretHDMI3');
assert.strictEqual(control.nativeKey('KEY_HDMI5'), null);
// The rule editor offers them (#204): every key in its list is one the service accepts.
const page = require('../service/dashboard.js');
const html = typeof page === 'function' ? page() : (page.html || page.dashboardHtml || page.render)();
const list = /<select id="mqttKey">(.*?)<\/select>/.exec(html)[1].match(/KEY_[A-Z0-9]+/g);
['KEY_TV', 'KEY_HDMI1', 'KEY_HDMI2', 'KEY_HDMI3', 'KEY_HDMI4'].forEach(k => assert.ok(list.indexOf(k) >= 0, k + ' is offered in the rule editor'));
list.forEach(k => assert.ok(control.nativeKey(k), k + ' is a key the service can send'));
console.log('PASS hdmi keys: aliases, injection command, remap rule, offered in the editor');
