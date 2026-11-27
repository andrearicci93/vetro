'use strict';
const assert = require('assert').strict;
const net = require('net');
const crypto = require('crypto');
const {Bridge} = require('../service/physical-input.js');

const INVENTORY = 'N: Name="Smart Control"\nP: Phys=\nH: Handlers=event4\n';

function makeHarness(onAuth) {
    const sockets = [];
    const commands = [];
    const events = [];
    function execute(cmd) {
        commands.push(cmd);
        if (cmd === 'cat /proc/bus/input/devices') {
            return Promise.resolve({exit_code: 0, stdout: INVENTORY});
        }
        const secret = Buffer.from(/printf %s '([^']+)'/.exec(cmd)[1], 'base64');
        const port = Number(/'127.0.0.1' '(\d+)'/.exec(cmd)[1]);
        const socket = net.connect(port, '127.0.0.1');
        sockets.push(socket);
        socket.on('error', () => {});
        socket.once('data', chunk => {
            const nonce = Buffer.from(chunk.toString().trim().split('\t')[1], 'hex');
            function send(payload) {
                const mac = crypto.createHmac('sha256', secret).update(nonce).update(Buffer.from([0])).update(payload).digest('hex');
                socket.write(payload + '\t' + mac + '\n');
            }
            const b = s => Buffer.from(s).toString('base64');
            send(['AUTH', '123', '0', '0', b('Smart Control'), b('/dev/input/event4'), b('evdev'), b('TV'), 'filter'].join('\t'));
            if (onAuth) onAuth(send, b);
        });
        return Promise.resolve({exit_code: 0});
    }
    const bridge = new Bridge(execute, event => events.push(event));
    return {
        bridge,
        commands,
        events,
        cleanup() {
            bridge.stop();
            for (const s of sockets) s.destroy();
        }
    };
}

(async function () {
    // 1. Token validation: plain numeric codes and :hold tokens (0..767)
    {
        const h = makeHarness();
        try {
            const invalid = ['140:bad', '999:hold', '768:hold', '768', ':hold', '140:', '140:hold:x', '', 'abc', 140, null];
            for (const bad of invalid) {
                await assert.rejects(
                    h.bridge.start('Smart Control', 'filter', [bad]),
                    /invalid input codes/,
                    'rejects invalid token: ' + String(bad)
                );
            }
            // No helper should have been launched for rejected tokens.
            assert.equal(h.commands.length, 0);

            const validTokens = ['0', '67', '140:hold', '0:hold', '767:hold'];
            const status = await h.bridge.start('Smart Control', 'filter', validTokens);
            assert.equal(status.policy.connected, true);
            assert.deepEqual(status.policy.blocked, validTokens);
            const launch = h.commands.find(c => c.includes('SamsungTvRemoteInputAgent.dll'));
            assert.ok(launch && launch.includes("'0,67,140:hold,0:hold,767:hold'"), 'passes hold tokens to native helper');
            h.bridge.stop();

            // Backward compatibility: plain numeric token alone
            const plain = await h.bridge.start('Smart Control', 'filter', ['140']);
            assert.equal(plain.policy.connected, true);
            assert.deepEqual(plain.policy.blocked, ['140']);
        } finally {
            h.cleanup();
        }
    }

    // 2. Event validation accepts down, repeat, up, and hold actions
    {
        let sendFn, encodeFn;
        const h = makeHarness((send, b) => { sendFn = send; encodeFn = b; });
        try {
            await h.bridge.start('Smart Control', 'filter', ['140:hold']);
            const emit = (seq, action, decision, value) => {
                sendFn('EVENT\t' + seq + '\t' + encodeFn(JSON.stringify({
                    type: 1,
                    code: 140,
                    value,
                    sequence: seq,
                    device: 'Smart Control',
                    node: '/dev/input/event4',
                    action,
                    decision
                })));
            };
            emit(1, 'down', 'hold-wait', 1);
            emit(2, 'hold', 'blocked', 2);
            emit(3, 'up', 'blocked', 0);
            emit(4, 'repeat', 'native', 2);
            await new Promise(r => setTimeout(r, 40));
            assert.deepEqual(h.events.map(e => [e.action, e.decision]), [
                ['down', 'hold-wait'],
                ['hold', 'blocked'],
                ['up', 'blocked'],
                ['repeat', 'native']
            ]);
            assert.equal(h.bridge.status().policy.connected, true);

            // Unknown action must fail validation and stop the bridge
            emit(5, 'bogus', 'blocked', 1);
            await new Promise(r => setTimeout(r, 40));
            assert.equal(h.bridge.status().policy.mode, 'off');
            assert.match(h.bridge.status().error || '', /invalid input event/);
        } finally {
            h.cleanup();
        }
    }

    console.log('PASS physical-input hold: token validation (:hold and plain), event action validation (down/up/repeat/hold)');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
