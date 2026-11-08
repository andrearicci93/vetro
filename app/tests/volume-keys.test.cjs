'use strict';
// Vol+ / Vol- go to the dock's glass pill; if the dock cannot be reached the original key is injected again.
const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const vk = require('../service/volume-keys.js');
const {Dock} = require('../service/dock.js');

(async () => {
    assert.deepEqual(vk.withTokens(['560'], {volume: true}), ['560', '66', '67', '68']);
    assert.deepEqual(vk.withTokens(['68'], {volume: true}), ['68', '66', '67']);
    assert.deepEqual(vk.withTokens(['560'], {}), ['560']);

    const V = {volume: true}, P = {pad: true};
    const down = {code: 68, action: 'down', decision: 'blocked'};
    assert.equal(vk.wants(down, V), true);
    assert.equal(vk.wants({code: 67, action: 'repeat', decision: 'blocked'}, V), true);
    assert.equal(vk.wants(down, {volume: false}), false, 'off: not handled');
    assert.equal(vk.wants({code: 68, action: 'up', decision: 'blocked'}, V), true, 'release stops the repeat');
    assert.equal(vk.wants({code: 68, action: 'down', decision: 'native'}, V), false, 'not held back');
    assert.equal(vk.wants({code: 66, action: 'down', decision: 'blocked'}, V), true, 'mute is soft, handled by the dock');
    assert.equal(vk.wants({code: 140, action: 'down', decision: 'blocked'}, V), false);

    const written = [];
    const reinjected = [];
    let how = await vk.handle(down, {write: (p, t) => written.push([p, t]), reinject: k => reinjected.push(k)});
    assert.equal(how, 'dock');
    assert.deepEqual(written, [[vk.FIFO, 'volup\n']]);
    assert.deepEqual(reinjected, []);
    written.length = 0;
    how = await vk.handle({code: 67, action: 'repeat', decision: 'blocked'}, {write: (p, t) => written.push(t), reinject: k => reinjected.push(k)});
    assert.deepEqual(written, ['voldown\n']);

    how = await vk.handle(down, {write: () => { throw new Error('ENXIO'); }, reinject: async k => { reinjected.push(k); }});
    assert.equal(how, 'native');
    assert.deepEqual(reinjected, ['XF86AudioRaiseVolume'], 'no reader on the FIFO: the key is given back to Samsung');

    // A FIFO nobody reads must fail at once instead of blocking the service.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-volume-'));
    const fifo = path.join(tmp, 'f.fifo');
    require('child_process').execFileSync('mkfifo', [fifo]);
    const fell = [];
    how = await vk.handle(down, {fifo, reinject: k => fell.push(k)});
    assert.equal(how, 'native');
    assert.deepEqual(fell, ['XF86AudioRaiseVolume']);

    // The switch lives in the dock state and tells the service to restart the bridge.
    const stateFile = path.join(tmp, 'state.json');
    let notified = null;
    const dock = new Dock({execute: async () => ({exit_code: 0, stdout: ''}), dir: tmp, stateFile, onVolumeChange: on => { notified = on; }});
    assert.equal(dock.readState().volumePill, false);
    await dock.setVolumePill(true);
    assert.equal(dock.readState().volumePill, true);
    assert.equal(notified, true);
    await dock.setVolumePill(false);
    assert.equal(dock.readState().volumePill, false);
    await assert.rejects(() => dock.setVolumePill('yes'));
    // Hold: one step at once, then a step every ~90 ms after ~380 ms; release stops it; device repeats are not doubled.
    const sent = [];
    const rep = vk.repeater({write: (p, t) => sent.push(t), reinject: () => {}});
    await rep.event(down);
    assert.equal(sent.length, 1);
    await rep.event({code: 68, action: 'repeat', decision: 'blocked'});
    assert.equal(sent.length, 1, 'device repeat ignored while the own timer runs');
    await new Promise(r => setTimeout(r, 700));
    assert.ok(sent.length >= 4 && sent.length <= 6, 'held: ' + sent.length);
    await rep.event({code: 68, action: 'up', decision: 'blocked'});
    const after = sent.length;
    await new Promise(r => setTimeout(r, 300));
    assert.equal(sent.length, after, 'release stops it');
    assert.equal(rep.active(), false);
    const m = [];
    const rm = vk.repeater({write: (p, t) => m.push(t), reinject: () => {}});
    await rm.event({code: 66, action: 'down', decision: 'blocked'});
    await rm.event({code: 66, action: 'repeat', decision: 'blocked'});
    await rm.event({code: 66, action: 'up', decision: 'blocked'});
    await new Promise(r => setTimeout(r, 500));
    assert.deepEqual(m, ['volmute\n'], 'mute is one change per press');
    console.log('volume-keys ok');
})().catch(e => { console.error(e); process.exit(1); });
