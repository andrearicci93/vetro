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
console.log('PASS hdmi keys: aliases, injection command, remap rule');
