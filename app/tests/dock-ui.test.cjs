'use strict';
const assert = require('assert').strict, vm = require('vm');
const html = require('../service/dashboard.js')();
const nodes = {};
const el = id => nodes[id] || (nodes[id] = {id, value: '', hidden: true, textContent: '', innerHTML: '', disabled: false, focus() {}});
const calls = [];
let dock = {installed: true, enabled: false, running: false, busy: false, error: null, apps: null, log: '', fixTizenTube: false,
    entries: [{slug: 'netflix', label: 'Netflix', appId: 'org.tizen.netflix-app', system: false}, {slug: 'tizentube', label: 'TizenTube', appId: 'xvvl3S1TT1.TizenTubeStandalone', system: false}, {slug: 'settings', label: 'Settings', appId: 'com.samsung.tv.csfs', system: true}]};
// The source rows as the page rendered them, as a minimal DOM the page's Save, move and hide handlers can read back.
let domRows = [];
function mountRows() {
    domRows = el('dockBody').innerHTML.split('data-source-row data-source-slug="').slice(1).map(part => {
        const label = {value: /data-source-label value="([^"]*)"/.exec(part)[1]}, icon = {value: /<option value="(\w+)" selected>/.exec(part)[1]};
        const hide = {checked: /data-source-hide checked/.test(part)};
        return {dataset: {sourceSlug: part.slice(0, part.indexOf('"'))}, querySelector: sel => ({'[data-source-label]': label, '[data-source-icon]': icon, '[data-source-hide]': hide})[sel]};
    });
    return domRows;
}
const clickDock = (dataset, row) => el('dock').onclick({target: {closest: sel => sel === 'button' ? {dataset, closest: () => row} : null}});
let failSave = null;
const sandbox = {document: {getElementById: el, querySelectorAll: sel => sel === '#dockBody [data-source-row]' ? domRows : [], querySelector: () => null, addEventListener() {}}, console, setTimeout() { return 1; }, clearTimeout() {}, setInterval() {},
    fetch: async (url, opts) => {
        const body = opts && opts.body ? JSON.parse(opts.body) : null;
        calls.push({url, body});
        let data = {};
        if (url === '/dock' && !body) data = dock;
        else if (url === '/dock') {
            if (body.action === 'saveSources' && failSave) return {ok: false, json: async () => ({ok: false, error: failSave})};
            if (body.action === 'enable') dock = Object.assign({}, dock, {enabled: true, running: true, apps: {count: 11, skipped: [{item: 'd/webapp@gone', reason: 'Not installed'}]}, log: 'elm_run'});
            if (body.action === 'fixTizenTube') dock = Object.assign({}, dock, {fixTizenTube: body.on});
            if (body.action === 'disable') dock = Object.assign({}, dock, {enabled: false, running: false});
            data = dock;
        } else if (url.startsWith('/apps')) data = {apps: [], summary: {total: 0}, source: 'package registry + public probe'};
        else if (url === '/hbbtv') data = {value: 19, off: true, canRestore: true, restoreValue: 20};
        else if (url === '/dns') data = {enabled: false, applied: false, domains: [], resolvers: []};
        else if (url === '/leftovers') data = {files: [], packageBytes: 0, storageBefore: {availableBytes: 1}, errors: []};
        else if (url === '/input') data = {devices: [], status: {policy: {mode: 'off'}, events: []}};
        else if (url === '/remap') data = {rules: []};
        return {ok: true, json: async () => data};
    }};
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], sandbox);
const tick = () => new Promise(r => setImmediate(r));

(async () => {
    await tick(); await tick();
    assert.match(html, /<nav aria-label="Main">[\s\S]*?Quick settings<\/button><button data-tab="dock"[^>]*>[\s\S]*?Launcher<span class="chip beta">Beta<\/span><\/button><button data-tab="remote"[^>]*>[\s\S]*?Remapper<\/button><\/nav>/, 'Quick settings, Launcher (beta) and Remapper are the three first entries');
    assert.ok(!calls.some(c => c.url === '/dock'), 'the dock is not read until its tab is opened');
    sandbox.switchPanel('dock'); await tick(); await tick();
    assert.equal(sandbox.currentPanel, 'dock');
    let page = el('dockBody').innerHTML;
    assert.match(page, /Vetro launcher/); assert.match(page, /state-chip[^>]*>Off</);
    assert.match(page, /data-dock-switch[^>]*aria-label="Vetro launcher"/);
    assert.doesNotMatch(page, /data-dock-switch[^>]* checked/);
    assert.doesNotMatch(page, /Rebuild app list/, 'nothing to rebuild while off');
    assert.match(page, /dock-layout[\s\S]*dock-left[\s\S]*lp-pill[\s\S]*quick-group/, 'two columns: the preview on the left, the switches on the right, already while the launcher is off');
    assert.match(page, /How the launcher will look with this TV’s apps/);assert.match(page, /lp-scene/, 'a still TV picture behind the launcher');
    sandbox.dockData = Object.assign({}, dock, {entries: []}); sandbox.renderDock();
    assert.match(el('dockBody').innerHTML, /An example row/, 'no list read yet: an example row, never an empty box');
    sandbox.dockData = dock; sandbox.renderDock();
    assert.match(page, /<h3>Fix TizenTube<\/h3>/);
    assert.match(page, /com\.samsung\.tv\.cobalt-yt/, 'says which process it closes');
    assert.match(page, /data-dock-fix[^>]*aria-label="Fix TizenTube"/);
    assert.doesNotMatch(page, /data-dock-fix[^>]* checked/);

    // Turning it on needs a confirmation that says what will change, and does nothing before it.
    const sw = {dataset: {dockSwitch: ''}, checked: true};
    el('dock').onchange({target: sw});
    assert.equal(sw.checked, false, 'the switch stays off until confirmed');
    assert.ok(!calls.some(c => c.url === '/dock' && c.body), 'nothing sent yet');
    page = el('dockBody').innerHTML;
    assert.match(page, /Turn on the Vetro launcher\?/);
    assert.match(page, /instead of Samsung’s Home/);
    assert.match(page, /closes Samsung’s Home each time you press it/);
    assert.match(page, /goes back to Samsung’s Home by itself/);
    assert.match(page, /Nothing of Samsung’s is removed or disabled/);
    assert.match(page, /Tested on a Q80A only/);

    // Cancel leaves it as it was.
    el('dock').onclick({target: {closest: () => ({dataset: {dockCancel: ''}})}});
    assert.doesNotMatch(el('dockBody').innerHTML, /Turn on the Vetro launcher\?/);
    assert.ok(!calls.some(c => c.url === '/dock' && c.body));

    // Confirm turns it on.
    sw.checked = true;
    el('dock').onchange({target: sw});
    await el('dock').onclick({target: {closest: () => ({dataset: {dockConfirm: ''}})}}); await tick(); await tick(); await tick();
    assert.deepEqual(calls.find(c => c.url === '/dock' && c.body).body, {action: 'enable'});
    page = el('dockBody').innerHTML;
    assert.match(page, /On · running/);
    assert.match(page, /data-dock-switch[^>]* checked/);
    assert.match(page, /11 apps from Samsung’s Home row/);
    assert.match(page, /Left out: gone \(not installed\)/);
    assert.match(page, /Rebuild app list/);
    assert.match(page, /<details><summary>Launcher log<\/summary>/);
    // The preview appears with the launcher: one tile per app, the system entries after a divider.
    assert.match(page, /<h3>Preview<\/h3>/);
    assert.match(page, /class="lp-pill"/);
    assert.equal((page.match(/\/dock\/icon\?slug=/g) || []).length, 3);
    assert.match(page, /src="\/dock\/icon\?slug=netflix"/);
    assert.match(page, /<i class="lp-divider"><\/i>[^]*lp-oval[^]*slug=settings/, 'Settings is an oval pill after the divider');
    assert.match(page, /class="lp-tile lp-sel"[^>]*><img alt="" src="\/dock\/icon\?slug=netflix"/, 'the first app is the selected one');
    assert.doesNotMatch(page, /lp-label/, 'no name or clock row: the design shows none');
    assert.match(page, /<div class="lp-hint">Source/, 'the hint over the bar');
    assert.match(sandbox.operationEntries[0].message, /Launcher on and running\. Press Home on the remote to open it\./, 'recorded in Actions');

    // Turning it off needs no warning.
    const off = {dataset: {dockSwitch: ''}, checked: false};
    await el('dock').onchange({target: off}); await tick(); await tick(); await tick();
    assert.deepEqual(calls.filter(c => c.url === '/dock' && c.body).pop().body, {action: 'disable'});
    assert.match(el('dockBody').innerHTML, /state-chip[^>]*>Off</);

    // Fix TizenTube is its own switch: no warning, one request, and it stays after a reload.
    const fix = {dataset: {dockFix: ''}, checked: true};
    await el('dock').onchange({target: fix}); await tick(); await tick(); await tick();
    assert.deepEqual(calls.filter(c => c.url === '/dock' && c.body).pop().body, {action: 'fixTizenTube', on: true});
    assert.match(el('dockBody').innerHTML, /data-dock-fix[^>]* checked/);
    assert.match(sandbox.operationEntries[0].message, /Fix TizenTube on; it applies when the launcher is on\./, 'recorded in Actions');
    fix.checked = false;
    await el('dock').onchange({target: fix}); await tick(); await tick(); await tick();
    assert.deepEqual(calls.filter(c => c.url === '/dock' && c.body).pop().body, {action: 'fixTizenTube', on: false});
    assert.doesNotMatch(el('dockBody').innerHTML, /data-dock-fix[^>]* checked/);
    dock = Object.assign({}, dock, {enabled: true, running: true, entries: [{slug: 'netflix', label: 'Netflix', appId: 'org.tizen.netflix-app', system: false}]});
    await el('dock').onclick({target: {closest: () => ({dataset: {dockReload: ''}})}}); await tick(); await tick();
    assert.match(el('dockBody').innerHTML, /TizenTube is not in Samsung’s Home row/, 'tells when there is no TizenTube tile to fix');
    // Registry read and no TizenTube anywhere: the switch is greyed out (unless it is already on, so it can be turned off)
    sandbox.inventory = [{appId: 'org.tizen.netflix-app'}];
    sandbox.dockData = dock; sandbox.renderDock();
    page = el('dockBody').innerHTML;
    assert.match(page, /TizenTube is not installed on this TV/);
    assert.match(page, /data-dock-fix[^>]* disabled/, 'nothing to fix: the switch is greyed out');
    sandbox.inventory = [{appId: 'xvvl3S1TT1.TizenTubeStandalone'}];
    sandbox.dockData = dock; sandbox.renderDock();
    page = el('dockBody').innerHTML;
    assert.doesNotMatch(page, /TizenTube is not installed/); assert.match(page, /TizenTube is not in Samsung’s Home row/, 'installed but without a tile: the other chip'); assert.doesNotMatch(page, /data-dock-fix[^>]* disabled/);
    sandbox.inventory = [];

    // A package without the dock cannot be switched on.
    dock = Object.assign({}, dock, {installed: false});
    await el('dock').onclick({target: {closest: () => ({dataset: {dockReload: ''}})}}); await tick(); await tick();
    page = el('dockBody').innerHTML;
    assert.match(page, /Not in this package/);
    assert.match(page, /data-dock-switch[^>]* disabled/);

    // An error from the service is shown, not hidden.
    dock = Object.assign({}, dock, {installed: true, enabled: false, error: 'The launcher did not start.'});
    await el('dock').onclick({target: {closest: () => ({dataset: {dockReload: ''}})}}); await tick(); await tick();
    assert.match(el('dockBody').innerHTML, /The launcher did not start\./);

    // Sources: the five rows from /dock, the TV's name as the placeholder, and a chip only where no device is detected.
    const SOURCE_ROWS = [
        {slug: 'in-tv', label: 'TV', labelOverride: null, autoLabel: 'TV', source: 0, hidden: false, icon: 'tv', iconChoice: 'auto', present: true},
        {slug: 'in-hdmi1', label: 'Mac mini', labelOverride: 'Mac mini', autoLabel: 'HDMI 1', source: 13, hidden: false, icon: 'pc', iconChoice: 'pc', present: true},
        {slug: 'in-hdmi2', label: 'Fire TV', labelOverride: null, autoLabel: 'Fire TV', source: 14, hidden: false, icon: 'streaming', iconChoice: 'auto', present: true},
        {slug: 'in-hdmi3', label: 'PlayStation 5', labelOverride: null, autoLabel: 'PlayStation 5', source: 15, hidden: false, icon: 'console', iconChoice: 'auto', present: true},
        {slug: 'in-hdmi4', label: 'HDMI 4', labelOverride: null, autoLabel: 'HDMI 4', source: 16, hidden: false, icon: 'hdmi', iconChoice: 'auto', present: false}
    ];
    dock = Object.assign({}, dock, {error: null, enabled: true, detection: {available: true}, inputs: SOURCE_ROWS});
    await el('dock').onclick({target: {closest: () => ({dataset: {dockReload: ''}})}}); await tick(); await tick();
    page = el('dockBody').innerHTML;
    assert.equal(mountRows().length, 5);
    assert.match(page, /<input data-source-label value="" placeholder="Fire TV"/, 'an automatic name is a placeholder, never a value');
    assert.match(page, /<input data-source-label value="Mac mini" placeholder="HDMI 1"/);
    assert.equal((page.match(/<small>Auto: /g) || []).length, 4, 'a Vetro name has no automatic-name hint');
    assert.match(page, /<option value="pc" selected>Computer<\/option>/);
    assert.match(page, /aria-label="Move TV up" disabled/); assert.match(page, /aria-label="Move HDMI 4 down" disabled/);
    assert.equal((page.match(/No device detected/g) || []).length, 1);

    // Moves and hides are drafts: nothing is sent, typed names survive the re-render, and the last visible row cannot be hidden.
    const sent = () => calls.filter(c => c.url === '/dock' && c.body);
    const before = sent().length;
    domRows[2].querySelector('[data-source-label]').value = 'Typed';
    await clickDock({sourceMove: '-1'}, domRows[3]);
    assert.deepEqual(mountRows().map(r => r.dataset.sourceSlug), ['in-tv', 'in-hdmi1', 'in-hdmi3', 'in-hdmi2', 'in-hdmi4']);
    assert.equal(domRows[3].querySelector('[data-source-label]').value, 'Typed');
    domRows.slice(1).forEach(r => { r.querySelector('[data-source-hide]').checked = false; });
    el('dock').onchange({target: {dataset: {sourceHide: ''}}});
    page = el('dockBody').innerHTML;
    assert.match(page, /data-source-hide checked disabled aria-label="Hide TV"/, 'the last visible row cannot be hidden');
    assert.equal((page.match(/source-row source-hidden/g) || []).length, 4);
    assert.equal(sent().length, before, 'a move or hide sends nothing');

    // A failed save reports the error and keeps the typed rows; a good save sends the rows in screen order.
    mountRows();
    failSave = 'The inputs list could not be saved: EISDIR';
    await clickDock({dockSaveSources: ''}); await tick(); await tick(); await tick();
    failSave = null;
    assert.match(sandbox.operationEntries[0].message, /EISDIR/);
    assert.equal(sandbox.dockBusy, false);
    assert.equal(mountRows()[3].querySelector('[data-source-label]').value, 'Typed', 'the typed rows are still on screen');
    domRows[3].querySelector('[data-source-label]').value = '   ';
    await clickDock({dockSaveSources: ''}); await tick(); await tick(); await tick();
    assert.deepEqual(sent().pop().body, {action: 'saveSources', sources: [
        {slug: 'in-tv', label: null, hidden: false, icon: 'auto'}, {slug: 'in-hdmi1', label: 'Mac mini', hidden: true, icon: 'pc'},
        {slug: 'in-hdmi3', label: null, hidden: true, icon: 'auto'}, {slug: 'in-hdmi2', label: null, hidden: true, icon: 'auto'},
        {slug: 'in-hdmi4', label: null, hidden: true, icon: 'auto'}]}, 'blank is automatic; hidden rows stay in the list');
    assert.match(sandbox.operationEntries[0].message, /Source list saved; the launcher was restarted\./);
    assert.deepEqual(mountRows().map(r => r.dataset.sourceSlug), SOURCE_ROWS.map(r => r.slug), 'after a save the page shows what the TV returned');

    // Refresh is its own action; detection being unavailable is said, and no port is called empty.
    await clickDock({dockRefreshSources: ''}); await tick(); await tick(); await tick();
    assert.deepEqual(sent().pop().body, {action: 'refreshSources'});
    sandbox.dockData = Object.assign({}, dock, {detection: {available: false}, inputs: SOURCE_ROWS.map(r => Object.assign({}, r, {present: null}))});
    sandbox.renderDock();
    assert.match(el('dockBody').innerHTML, /Source detection is unavailable/);
    assert.doesNotMatch(el('dockBody').innerHTML, /No device detected/);
    console.log('PASS launcher UI: confirmation before turning on, direct turn off, state, app list, errors, source list');
})().catch(e => { console.error(e); process.exitCode = 1; });
