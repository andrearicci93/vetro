'use strict';
const assert = require('assert').strict;
const fs = require('fs'), os = require('os'), path = require('path');
const {Voice} = require('../service/voice.js');
(async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-voice-test-'));
    try {
        const stateFile = path.join(folder, 'state.json'), calls = [];
        let fail = false;
        const voice = new Voice({stateFile, execute: async command => {
            calls.push(command);
            return {exit_code: fail ? 1 : 0, stdout: command.startsWith('if systemctl') ? 'running\n{"state":"ready","completed":2}' : ''};
        }});
        await voice.supervise(true);
        assert.equal(calls.length, 0, 'unconfigured voice is disabled');
        fs.writeFileSync(stateFile, '{"enabled":true}');
        await voice.supervise(false);
        assert.equal(calls.length, 0, 'wait for root connection');
        await voice.supervise(true);
        assert.match(calls[0], /Restart=on-failure/);
        assert.match(calls[0], /systemctl is-active --quiet vetro-voice.service/);
        assert.match(calls[0], /--watch .*config.json/);
        assert.ok(!calls[0].includes('apiKey'), 'credentials are never in supervisor commands');
        const status = await voice.status();
        assert.equal(status.state, 'ready'); assert.equal(status.completed, 2);
        fail = true; await voice.supervise(true);
        assert.ok(voice.error); assert.equal(voice.busy, false);
        fail = false; await voice.supervise(true); assert.equal(voice.error, null);
        await voice.change(false);
        assert.equal(voice.enabled(), false);
        assert.ok(calls.some(c => c.includes('touch /tmp/vetro-voice-service.cancel; systemctl stop')));
        const count = calls.length;
        await voice.supervise(true);
        assert.equal(calls.length, count, 'disable survives later supervisor ticks');
        console.log('PASS voice lifecycle: opt-in, reconnect, restart, status, disable');
    } finally { fs.rmSync(folder, {recursive: true, force: true}); }
})().catch(error => { console.error(error); process.exit(1); });
