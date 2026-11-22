'use strict';
// The Disable groups taken from samshush's optional controls on 2026-11-22: Gaming Hub (with Samsung's "do not start" file for
// ghdaemon, whose unit restarts every 2 s on failure), SmartThings (asks first), SmartThings Find, Sound Sensor and Pet Care.
const assert = require('assert').strict;
const qs = require('../service/quick-settings.js');

const gaming = qs.find('gaming-hub'), st = qs.find('smartthings'), find = qs.find('smartthings-find'), sound = qs.find('sound-sensor');
[gaming, st, find, sound].forEach(g => { assert.ok(g, 'group exists'); assert.equal(g.section, 'memory'); assert.equal(g.onlyInstalled, true, g.id + ' shows only where its apps are'); });
assert.deepEqual(gaming.markerUnits, ['com.samsung.tv.ghdaemon.service']);
assert.equal(st.confirm, true, 'SmartThings asks first: the phone app and integrations lose the TV');
assert.ok(!sound.ids.includes('com.samsung.tv.tvsensor-iot-service') && !sound.ids.includes('com.samsung.tv.aisound-app'), 'the light sensor sync and adaptive sound stay');
['com.samsung.tv.ghdaemon', 'com.samsung.tizen.smartthings-thing', 'com.samsung.tv.smartthingsfind-daemon', 'com.samsung.tv.iotwidget-petcare']
    .forEach(id => assert.ok(qs.ALLOWED_IDS.includes(id), id + ' may be switched'));

// The Q80A on 2026-11-22: no Gaming Hub UI; ghdaemon and ghservice disabled by hand, ghdaemon still flagged autorestart, no marker:
// its unit was in auto-restart (1509 restarts). The group reads partly done until the switch clears the flag and puts the file down.
const rows = [{appId: 'com.samsung.tv.ghdaemon', disabled: true, onboot: false, autorestart: true},
    {appId: 'com.samsung.tv.ghservice', disabled: true, onboot: false, autorestart: false}];
const open = {'com.samsung.tv.ghdaemon.service': {marker: 'com.samsung.tv.ghdaemon', present: false}};
const shut = {'com.samsung.tv.ghdaemon.service': {marker: 'com.samsung.tv.ghdaemon', present: true}};
let s = qs.state(gaming, rows, open);
assert.equal(s.status, 'partial'); assert.deepEqual(s.flagged, ['com.samsung.tv.ghdaemon']); assert.deepEqual(s.markersOpen, ['com.samsung.tv.ghdaemon.service']);
s = qs.state(gaming, rows.map(r => Object.assign({}, r, {autorestart: false})), shut);
assert.equal(s.status, 'off', 'flags cleared and the file down: done');
s = qs.state(gaming, rows.map(r => Object.assign({}, r, {disabled: false})), shut);
assert.equal(s.status, 'partial', 'enabled again while the file is still there: not fully back');
assert.equal(qs.state(sound, rows, {}).status, 'unavailable', 'a 2021 TV has no Sound Sensor: no switch');
console.log('PASS samshush groups: Gaming Hub with ghdaemon\'s marker (the Q80A\'s restart loop reads partly done), SmartThings asks first, Find, Sound Sensor without the light sensor and adaptive sound');
