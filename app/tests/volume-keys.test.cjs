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

    // Guide (#340): held back only while the tuner is on, and handed to the tuner's own line, never to the launcher's FIFO.
    assert.deepEqual(vk.withTokens([], {guide: true}), ['130']);
    assert.deepEqual(vk.withTokens(['130'], {guide: true}), ['130'], 'no duplicate');
    assert.equal(vk.wants({code: 130, action: 'down', decision: 'blocked'}, {guide: true}), true);
    assert.equal(vk.wants({code: 130, action: 'down', decision: 'blocked'}, {volume: true, pad: true}), false, 'tuner off: Samsung keeps the key');
    const guideSent = [], guideWritten = [], guideBack = [];
    let g = await vk.handle({code: 130, action: 'down', decision: 'blocked'}, {write: (p, t) => guideWritten.push(t), reinject: k => guideBack.push(k), tuner: n => { guideSent.push(n); }});
    assert.equal(g, 'tuner');
    assert.deepEqual(guideSent, ['XF86ChannelGuide']);
    assert.deepEqual(guideWritten, [], 'the launcher\'s FIFO is not touched');
    g = await vk.handle({code: 130, action: 'down', decision: 'blocked'}, {write: () => {}, reinject: async k => { guideBack.push(k); }, tuner: async () => { throw new Error('agent gone'); }});
    assert.equal(g, 'native');
    assert.deepEqual(guideBack, ['XF86ChannelGuide'], 'a line that fails gives the key back to Samsung');
    assert.equal(vk.reinjectCommand('XF86ChannelGuide'), '/usr/bin/input_keyevent XF86ChannelGuide');
    const guideRep = vk.repeater({reinject: () => {}, tuner: () => {}});
    await guideRep.event({code: 130, action: "down", decision: "blocked"});
    assert.equal(guideRep.active(), false, "Guide is a toggle: no repeat timer");
    guideRep.stop();

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

    // 2022+ firmware: the service may not open the root-made FIFO (EACCES). The root agent writes the word instead, and from then on
    // the service does not try its own open again; the route and the errno are reported.
    const relayed = [], routes = [], st = {refused: false};
    let opens = 0;
    const refused = () => { opens++; const e = new Error('denied'); e.code = 'EACCES'; throw e; };
    const viaAgent = {write: refused, relay: async w => { relayed.push(w); }, reinject: k => reinjected.push(k), route: (h, e) => routes.push([h, e]), state: st};
    reinjected.length = 0;
    how = await vk.handle(down, viaAgent);
    assert.equal(how, 'agent');
    assert.deepEqual(relayed, ['volup']);
    assert.equal(st.refused, true);
    how = await vk.handle({code: 140, action: 'down', decision: 'blocked'}, viaAgent);
    assert.equal(how, 'agent');
    assert.deepEqual(relayed, ['volup', 'pad']);
    assert.equal(opens, 1, 'not opened again once refused');
    assert.deepEqual(routes, [['agent', 'EACCES'], ['agent', 'EACCES']], 'the reason stays in the report once the agent writes');
    assert.deepEqual(reinjected, []);
    // The agent finds no launcher reading: the key goes back to Samsung.
    how = await vk.handle(down, Object.assign({}, viaAgent, {relay: async () => { throw new Error('launcher not reading'); }}));
    assert.equal(how, 'native');
    assert.deepEqual(reinjected, ['XF86AudioRaiseVolume']);
    // ENOENT (the launcher starting, or a service that sees the path differently from root): the agent tries, whose check sends the
    // key back to Samsung when no launcher reads; not sticky, the service's own open is tried again next time.
    const st2 = {refused: false}, rel2 = [], r2 = [];
    const gone = () => { const e = new Error('gone'); e.code = 'ENOENT'; throw e; };
    how = await vk.handle(down, {write: gone, relay: async w => { rel2.push(w); }, reinject: () => {}, route: (h, e) => r2.push([h, e]), state: st2});
    assert.equal(how, 'agent');
    assert.deepEqual(rel2, ['volup']);
    assert.deepEqual(r2, [['agent', 'ENOENT']]);
    assert.equal(st2.refused, false);
    const back = [];
    how = await vk.handle(down, {write: gone, relay: async () => { throw new Error('launcher not reading'); }, reinject: k => back.push(k), route: (h, e) => r2.push([h, e]), state: st2});
    assert.equal(how, 'native');
    assert.deepEqual(back, ['XF86AudioRaiseVolume']);
    assert.deepEqual(r2[1], ['native', 'ENOENT']);
    reinjected.length = 0;

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
    // Where the pill sits: left by default, one of four edges, anything else refused, saved in the state.
    assert.equal(dock.readState().volumeEdge, 'left');
    await dock.setVolumeEdge('bottom');
    assert.equal(dock.readState().volumeEdge, 'bottom');
    await assert.rejects(() => dock.setVolumeEdge('middle'));
    assert.equal(dock.readState().volumeEdge, 'bottom');
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
