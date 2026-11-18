'use strict';
// A plugin that adds a card to the Control center: manifest field "controlCenter", the host's cleaning of card(), the timeouts and
// cardSelect(). Errors of the card never count towards the failures that switch a plugin off.
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path');
const { PluginHost, checkManifest, checkBundle, CARD_ROWS_MAX } = require('../service/plugin-host.js');

function tmp() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-card-')), 'p'); }
const manifest = extra => Object.assign({ id: 'shard', apiVersion: 1 }, extra);
function def(id, extra, inst) { return Object.assign({ id, apiVersion: 1, defaultEnabled: true, create() { return inst || {}; } }, extra); }
const CC = { label: 'Home Assistant' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function host(inst, opts) {
    const h = new PluginHost(Object.assign({ dir: tmp(), external: false }, opts)).register(def('shard', { controlCenter: CC }, inst));
    h.cardReadMs = 60; h.cardActionMs = 120;
    h.start();
    return h;
}

const keepAlive = setInterval(() => {}, 1000);   // the host's timeouts are unref'd, like the service's other timers
(async function () {
    // manifest rules: optional, an object with a short plain label, not a permission, and the same rules for the installer
    checkManifest(manifest());
    checkManifest(manifest({ controlCenter: CC }));
    checkManifest(manifest({ controlCenter: { label: 'x'.repeat(24) } }));
    checkManifest(manifest({ controlCenter: { label: 'Lights', future: true } }));    // unknown keys inside are ignored
    [[], 'Home', 7, { label: '' }, { label: '  ' }, {}, { label: 'x'.repeat(25) }, { label: '<b>x</b>' }, { label: 'a\nb' }, { label: 5 }].forEach(v =>
        assert.throws(() => checkManifest(manifest({ controlCenter: v })), /controlCenter/, JSON.stringify(v)));
    assert.throws(() => checkBundle({ format: 'vetro-plugin', version: 1, manifest: manifest({ controlCenter: { label: '' } }), files: { 'index.js': '' } }), /controlCenter/);
    assert.throws(() => new PluginHost({ dir: tmp(), external: false }).register(def('bad', { controlCenter: { label: '' } })), /bad: controlCenter/);
    assert.throws(() => checkManifest(manifest({ permissions: ['controlCenter'] })), /Unknown permission/, 'not a permission');

    // the card exists only while the plugin runs and has both methods
    const good = { card() { return { rows: [{ id: 'a', label: 'Living room', value: 'on', ticked: true }, { id: 'b', label: 'Kitchen' }], note: 'Hi' }; }, cardSelect() { return { ok: true }; } };
    const h0 = new PluginHost({ dir: tmp(), external: false }).register(def('shard', { controlCenter: CC }, good));
    assert.deepEqual(h0.cards(), [], 'not running yet');
    assert.deepEqual(await h0.cardOf('shard'), { ok: false, unavailable: true, reason: 'Not running' });
    h0.start();
    assert.deepEqual(h0.cards(), [{ plugin: 'shard', label: 'Home Assistant' }]);
    assert.deepEqual(h0.status('shard').controlCenter, { label: 'Home Assistant', error: null });
    h0.setEnabled('shard', false);
    assert.deepEqual(h0.cards(), [], 'switched off: the card is gone');
    assert.equal((await h0.cardOf('shard')).unavailable, true);
    assert.equal((await h0.selectCard('shard', 'a')).unavailable, true);
    h0.stop();
    assert.deepEqual(new PluginHost({ dir: tmp(), external: false }).register(def('shard', { controlCenter: CC }, { card() { return {}; } })).cards(), []);
    const noSelect = new PluginHost({ dir: tmp(), external: false }).register(def('shard', { controlCenter: CC }, { card() { return {}; } }));
    noSelect.start();
    assert.deepEqual(noSelect.cards(), [], 'card() without cardSelect() is no card');
    assert.match((await noSelect.cardOf('shard')).reason, /cardSelect/);
    noSelect.stop();
    const plain = new PluginHost({ dir: tmp(), external: false }).register(def('shard', {}, good));
    plain.start();
    assert.deepEqual(plain.cards(), [], 'without the manifest key a plugin that has the methods is no card');
    assert.equal((await plain.cardOf('shard')).reason, 'No such card');
    assert.equal((await plain.cardOf('nope')).reason, 'No such card');
    assert.equal((await plain.cardOf('__proto__')).unavailable, true);
    plain.stop();

    // a good read: cleaned
    const h1 = host(good);
    const c = await h1.cardOf('shard');
    assert.deepEqual(c, { ok: true, label: 'Home Assistant', rows: [{ id: 'a', label: 'Living room', value: 'on', ticked: true }, { id: 'b', label: 'Kitchen', value: '', ticked: false }], note: 'Hi', choosable: true });
    h1.stop();

    // limits are the host's: rows, lengths, control characters, ids, duplicates, non-string fields
    const many = []; for (let i = 0; i < 20; i++) many.push({ id: 'r' + i, label: 'Row ' + i });
    const messy = host({
        card() {
            return { rows: [
                { id: 'ok', label: 'x'.repeat(100), value: 'v'.repeat(100), ticked: 'yes' },
                { id: 'ctl', label: 'a\tb\nc\u0000d e', value: 12.5, ticked: true },
                { id: 'ok', label: 'duplicate id' }, { id: 'bad id', label: 'space' }, { id: 'x'.repeat(41), label: 'long id' }, { id: "a'b", label: 'quote' },
                { id: 'nolabel' }, { id: 'blank', label: '  \t ' }, { id: 5, label: 'number id' }, null, 'row', { id: 'p', label: { toString() { return 'obj'; } } }
            ].concat(many), note: 'n'.repeat(500), choosable: 'maybe' };
        }, cardSelect() { return true; } });
    const m = await messy.cardOf('shard');
    assert.equal(m.ok, true);
    assert.equal(m.rows.length, CARD_ROWS_MAX, 'at most ' + CARD_ROWS_MAX + ' rows');
    assert.equal(m.rows[0].label.length, 40); assert.equal(m.rows[0].value.length, 24); assert.equal(m.rows[0].ticked, false, 'only true ticks');
    assert.deepEqual(m.rows[1], { id: 'ctl', label: 'a b c d e', value: '12.5', ticked: true });
    assert.deepEqual(m.rows.map(r => r.id).slice(0, 4), ['ok', 'ctl', 'r0', 'r1'], 'bad and duplicate rows are dropped, not an error');
    assert.equal(m.note.length, 80);
    assert.equal(m.choosable, true);
    m.rows.forEach(r => { assert.match(r.id, /^[A-Za-z0-9_.-]{1,40}$/); assert.ok(!/[\u0000-\u001f]/.test(r.label + r.value)); });
    messy.stop();

    // choosable:false and no rows are carried as they are
    const locked = host({ card() { return { rows: [{ id: 'a', label: 'A', ticked: true }], note: 'Locked', choosable: false }; }, cardSelect() { return true; } });
    assert.equal((await locked.cardOf('shard')).choosable, false);
    locked.stop();
    const empty = host({ card() { return { rows: 'nope', note: 'No lights found' }; }, cardSelect() { return true; } });
    assert.deepEqual(await empty.cardOf('shard'), { ok: true, label: 'Home Assistant', rows: [], note: 'No lights found', choosable: false });
    empty.stop();

    // card() can answer with a Promise; throws, rejects, hangs and nonsense are "Not available" with a reason, never a rejection
    const asyncOk = host({ card() { return Promise.resolve({ rows: [{ id: 'a', label: 'A' }] }); }, cardSelect() { return true; } });
    assert.equal((await asyncOk.cardOf('shard')).rows.length, 1);
    asyncOk.stop();
    const bad = {
        throws: { card() { throw new Error('sync boom'); } }, rejects: { card() { return Promise.reject(new Error('ha down')); } },
        hangs: { card() { return new Promise(() => {}); } }, nothing: { card() { return undefined; } }, array: { card() { return []; } }, text: { card() { return 'x'; } }
    };
    for (const name of Object.keys(bad)) {
        const hx = host(Object.assign({ cardSelect() { return true; } }, bad[name]));
        const t0 = Date.now(), r = await hx.cardOf('shard');
        assert.equal(r.ok, false, name); assert.equal(r.unavailable, true, name); assert.ok(r.reason, name);
        if (name === 'throws') assert.match(r.reason, /sync boom/);
        if (name === 'rejects') assert.match(r.reason, /ha down/);
        if (name === 'hangs') { assert.match(r.reason, /in time/); assert.ok(Date.now() - t0 < 1000, 'the timeout answers'); }
        assert.equal(hx.status('shard').controlCenter.error, r.reason, name + ': the dashboard can say why');
        // errors of the card never switch the plugin off: far more than maxErrors in a row and it still runs
        for (let i = 0; i < 6; i++) await hx.cardOf('shard');
        assert.equal(hx.status('shard').state, 'running', name + ': still running');
        assert.equal(hx.status('shard').errors, 0, name + ': not counted');
        assert.equal(hx.cards().length, 1, name);
        hx.stop();
    }
    // the error clears with the next good read
    let broken = true;
    const flaky = host({ card() { if (broken) throw new Error('once'); return { rows: [{ id: 'a', label: 'A' }] }; }, cardSelect() { return true; } });
    await flaky.cardOf('shard'); assert.equal(flaky.status('shard').controlCenter.error, 'once');
    broken = false; await flaky.cardOf('shard'); assert.equal(flaky.status('shard').controlCenter.error, null);
    flaky.stop();

    // reads that overlap share one call (the Control center opened again while a slow plugin still answers)
    let calls = 0;
    const slow = host({ card() { calls++; return sleep(30).then(() => ({ rows: [{ id: 'a', label: 'A' }] })); }, cardSelect() { return true; } });
    const [r1, r2] = await Promise.all([slow.cardOf('shard'), slow.cardOf('shard')]);
    assert.equal(calls, 1); assert.deepEqual(r1, r2);
    await slow.cardOf('shard'); assert.equal(calls, 2, 'a later read asks again');
    slow.stop();

    // the plugin is switched off while it is answering: the answer is dropped
    let h5; let release;
    h5 = host({ card() { return new Promise(res => { release = () => res({ rows: [{ id: 'a', label: 'A' }] }); }); }, cardSelect() { return true; } });
    const pending = h5.cardOf('shard');
    h5.setEnabled('shard', false); release();
    assert.match((await pending).reason, /switched off/);
    h5.stop();

    // cardSelect: the row id is checked before the plugin is asked; ok, false, a note, new rows, a throw, a hang
    const asked = [];
    let mode = 'ok', live = [{ id: 'a', label: 'A', ticked: true }, { id: 'b', label: 'B' }];
    const sel = host({
        card() { return { rows: live }; },
        cardSelect(id) {
            asked.push(id);
            if (mode === 'ok') { live = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', ticked: true }]; return { ok: true }; }
            if (mode === 'rows') return Promise.resolve({ ok: true, note: 'Done', rows: [{ id: 'z', label: 'Z', ticked: true }] });
            if (mode === 'undefined') return undefined;
            if (mode === 'false') return false;
            if (mode === 'refuse') return { ok: false, note: 'Lamp offline' };
            if (mode === 'throws') throw new Error('call failed');
            if (mode === 'hangs') return new Promise(() => {});
        }
    });
    for (const bad of ['', 'a b', "a'b", '../x', 'x'.repeat(41), 5, null, undefined]) {
        const r = await sel.selectCard('shard', bad);
        assert.equal(r.unavailable, true, JSON.stringify(bad));
    }
    assert.deepEqual(asked, [], 'nothing reached the plugin');
    let r = await sel.selectCard('shard', 'b');
    assert.equal(r.ok, true); assert.deepEqual(r.card.rows.map(x => [x.id, x.ticked]), [['a', false], ['b', true]], 'no rows returned: the card is read again');
    mode = 'rows'; r = await sel.selectCard('shard', 'b');
    assert.equal(r.note, 'Done'); assert.deepEqual(r.card.rows.map(x => x.id), ['z'], 'rows returned by cardSelect are used (and cleaned)');
    mode = 'undefined'; r = await sel.selectCard('shard', 'a'); assert.equal(r.ok, true, 'a plugin that returns nothing did its job');
    mode = 'false'; r = await sel.selectCard('shard', 'a'); assert.equal(r.ok, false);
    mode = 'refuse'; r = await sel.selectCard('shard', 'a'); assert.equal(r.ok, false); assert.equal(r.note, 'Lamp offline'); assert.equal(r.card.rows.length, 2);
    mode = 'throws'; r = await sel.selectCard('shard', 'a'); assert.equal(r.ok, false); assert.match(r.note, /call failed/); assert.equal(r.card, null);
    mode = 'hangs'; const t1 = Date.now(); r = await sel.selectCard('shard', 'a'); assert.equal(r.ok, false); assert.match(r.note, /in time/); assert.ok(Date.now() - t1 < 1500);
    assert.equal(sel.status('shard').state, 'running'); assert.equal(sel.status('shard').errors, 0, 'a failing action is not a failure of the plugin');
    // one action at a time
    let finish;
    const one = host({ card() { return { rows: [{ id: 'a', label: 'A' }] }; }, cardSelect() { return new Promise(res => { finish = () => res({ ok: true }); }); } });
    const first = one.selectCard('shard', 'a');
    const second = await one.selectCard('shard', 'a');
    assert.equal(second.ok, false); assert.match(second.note, /Another change/);
    finish(); assert.equal((await first).ok, true);
    one.stop(); sel.stop();

    // the card changes reach the listener (the dock restarts the launcher with the new --cards): start and stop of a plugin with a card
    const h6 = new PluginHost({ dir: tmp(), external: false }).register(def('shard', { controlCenter: CC }, good)).register(def('plain'));
    let changes = 0; h6.onInterceptChange(() => { changes++; });
    h6.start(); assert.equal(changes, 1, 'only the plugin with the card notifies');
    h6.setEnabled('shard', false); assert.equal(changes, 2);
    h6.stop();

    clearInterval(keepAlive);
    console.log('plugin-card: ok');
})().catch(e => { console.error(e); process.exit(1); });
