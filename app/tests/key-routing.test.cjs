'use strict';
// Keys the service sends while Vetro UI has windows on the TV: Remapper key actions reach the tuner on screen, and the launcher and
// the tuner are told to watch a new forwarding node at once. Also: every stop of the remote bridge ends a volume repeat.
const assert = require('assert').strict, net = require('net'), crypto = require('crypto');
const kr = require('../service/key-routing.js');
const control = require('../service/control.js');
const {Bridge} = require('../service/physical-input.js');

// ---- Remapper key actions ----
const ok = control.injectCommand('Return');
const routed = kr.keyCommand('Return', ok);
assert.ok(routed.startsWith('if p=$(cat /home/owner/vetro-tuner.pid 2>/dev/null); [ -n "$p" ] && [ -d /proc/$p ] && [ -p /tmp/vetro-tuner.ctl ] && [ -e /tmp/vetro-tuner.ctl.shown ]; then'),
    'only a live tuner, on screen, with a real pipe');
assert.ok(routed.includes("then ( exec 3<>/tmp/vetro-tuner.ctl && echo 'key 28' >&3 ); else /usr/bin/input_keyevent Return; fi"), 'OK goes to the tuner on screen (a write that never blocks), by name otherwise');
assert.ok(kr.keyCommand('XF86ChannelList', control.injectCommand('XF86ChannelList')).includes("echo 'list' >&3"), 'the channel list key opens the tuner\'s list');
assert.ok(kr.keyCommand('0', control.injectCommand('0')).includes("echo 'key 11' >&3") && kr.keyCommand('1', control.injectCommand('1')).includes("echo 'key 2' >&3"), 'digits as the remote reads them (KEY_1 = 2, KEY_0 = 11)');
const home = kr.keyCommand('XF86Home', control.injectCommand('XF86Home'));
assert.ok(home.includes("then ( exec 3<>/tmp/vetro-tuner.ctl && echo 'hide' >&3 ); fi; /usr/bin/input_keyevent XF86Home"), 'Home sends the tuner away first, then goes to the system');
assert.equal(kr.keyCommand('XF86AudioRaiseVolume', control.injectCommand('XF86AudioRaiseVolume')), '/usr/bin/input_keyevent XF86AudioRaiseVolume', 'any other key: unchanged');
assert.equal(kr.keyCommand('XF86PowerOff', control.injectCommand('XF86PowerOff')), '/usr/bin/input_keyevent XF86PowerOff', 'Power does not hold the tuner away');
assert.equal(kr.keyCommand('Return', null), null, 'nothing to send stays nothing');
Object.keys(kr.TUNER_KEYS).forEach(function (k) { assert.ok(control.injectCommand(k), k + ' is a key a rule can send'); });

// ---- rescan ----
const rescan = kr.rescanCommand();
assert.ok(rescan.includes("[ -d /proc/$p ] && [ -p /home/owner/tvlauncher.fifo ]; then ( exec 3<>/home/owner/tvlauncher.fifo && echo 'rescan' >&3 ); fi"), 'the launcher, only alive and with its pipe');
assert.ok(rescan.includes("[ -d /proc/$p ] && [ -p /tmp/vetro-tuner.ctl ]; then ( exec 3<>/tmp/vetro-tuner.ctl && echo 'rescan' >&3 ); fi"), 'the tuner, only alive and with its pipe');
assert.ok(rescan.endsWith('; true'), 'a missing process is not an error');
assert.ok(!/[`]/.test(rescan + routed + home), 'no command substitution beyond the pid read');

// ---- the bridge's hooks: onConnect after AUTH, onStop on every stop (asked, or the helper went away) ----
(async function () {
    let socket, connects = [], stops = 0;
    function execute(cmd) {
        if (cmd === 'cat /proc/bus/input/devices') return Promise.resolve({exit_code: 0, stdout: 'N: Name="Smart Control"\nP: Phys=\nH: Handlers=event4\n'});
        const secret = Buffer.from(/printf %s '([^']+)'/.exec(cmd)[1], 'base64');
        const port = Number(/'127.0.0.1' '(\d+)'/.exec(cmd)[1]);
        socket = net.connect(port, '127.0.0.1'); socket.on('error', () => {});
        socket.once('data', chunk => {
            const nonce = Buffer.from(chunk.toString().trim().split('\t')[1], 'hex');
            const b = s => Buffer.from(s).toString('base64');
            const payload = ['AUTH', '1', '0', '0', b('Smart Control'), b('/dev/input/event4'), b('evdev'), b('TV'), 'filter'].join('\t');
            socket.write(payload + '\t' + crypto.createHmac('sha256', secret).update(nonce).update(Buffer.from([0])).update(payload).digest('hex') + '\n');
        });
        return Promise.resolve({exit_code: 0});
    }
    const bridge = new Bridge(execute, () => {}, {onConnect: s => connects.push(s), onStop: () => { stops++; }});
    try {
        const before = stops;
        const s = await bridge.start('Smart Control', 'filter', ['68']);
        assert.equal(s.policy.connected, true);
        assert.equal(connects.length, 1, 'onConnect once the helper holds the remote');
        assert.equal(connects[0].policy.mode, 'filter');
        const atConnect = stops;
        assert.ok(atConnect >= before, 'a start stops what ran before');
        socket.destroy();                                           // the helper goes away by itself
        await new Promise(r => setTimeout(r, 80));
        assert.equal(bridge.status().policy.connected, false);
        assert.ok(stops > atConnect, 'onStop when the helper disconnects on its own (a held volume key must stop repeating)');
        const n = stops; bridge.stop();
        assert.equal(stops, n + 1, 'onStop on an asked stop too');
        new Bridge(execute, () => {}).stop();                       // no hooks: nothing breaks
        new Bridge(execute, () => {}, {onStop: () => { throw new Error('x'); }}).stop();   // a failing hook never breaks a stop
        console.log('PASS key routing: Remapper keys reach the tuner on screen, Home sends it away, rescan only to live pipes, bridge hooks on connect and on every stop');
    } finally { bridge.stop(); if (socket) socket.destroy(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
