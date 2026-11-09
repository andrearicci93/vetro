'use strict';
const assert = require('assert').strict, vm = require('vm');
const html = require('../service/dashboard.js')();
const nodes = {};
const el = id => nodes[id] || (nodes[id] = {id, value: '', hidden: true, textContent: '', innerHTML: '', disabled: false, focus() {}});
const calls = [];
let dock = {installed: true, enabled: false, running: false, busy: false, error: null, apps: null, log: '', fixTizenTube: false,
    entries: [{slug: 'netflix', label: 'Netflix', appId: 'org.tizen.netflix-app', system: false}, {slug: 'tizentube', label: 'TizenTube', appId: 'xvvl3S1TT1.TizenTubeStandalone', system: false}, {slug: 'settings', label: 'Settings', appId: 'com.samsung.tv.csfs', system: true}]};
const sandbox = {document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}}, console, setTimeout() { return 1; }, clearTimeout() {}, setInterval() {},
    fetch: async (url, opts) => {
        const body = opts && opts.body ? JSON.parse(opts.body) : null;
        calls.push({url, body});
        let data = {};
        if (url === '/dock' && !body) data = dock;
        else if (url === '/dock') {
            if (body.action === 'enable') dock = Object.assign({}, dock, {enabled: true, running: true, apps: {count: 11, skipped: [{item: 'd/webapp@gone', reason: 'Not installed'}]}, log: 'elm_run'});
            if (body.action === 'fixTizenTube') dock = Object.assign({}, dock, {fixTizenTube: body.on});
            if (body.action === 'showHomeSources' || body.action === 'useSourceImages') dock=Object.assign({},dock,{[body.action]:body.on});
            if (body.action === 'disable') dock = Object.assign({}, dock, {enabled: false, running: false, mode: 'off'});   // the service derives mode from the state
            if (body.action === 'enableCustom') dock = Object.assign({}, dock, {mode: 'custom', customApp: body.appId, running: true});
            if (body.action === 'disableCustom') dock = Object.assign({}, dock, {mode: 'off', customApp: null, running: false});
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
    assert.match(html, /<nav aria-label="Main">[\s\S]*?Quick settings<\/button><button data-tab="vetroui"[^>]*>[\s\S]*?Vetro UI<\/button><button data-tab="remote"[^>]*>[\s\S]*?Remapper<\/button><button data-tab="plugins"[^>]*>[\s\S]*?Vetro Shards<\/button><\/nav>/, 'Quick settings, Vetro UI (launcher, live TV, on-screen displays), Remapper and Vetro Shards');
    assert.doesNotMatch(html, /data-tab="dock"|data-tab="tuner"/, 'the launcher and the tuner are tabs of Vetro UI, not sidebar entries');
    assert.ok(!calls.some(c => c.url === '/dock'), 'the dock is not read until its tab is opened');
    sandbox.switchPanel('dock'); await tick(); await tick();
    assert.equal(sandbox.currentPanel, 'vetroui', 'the old Launcher entry opens Vetro UI');
    assert.equal(sandbox.uiTab, 'launcher', 'on its Launcher tab');
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
    assert.match(page, /class="lp-tile lp-sel"[^>]*><img alt="Netflix" src="\/dock\/icon\?slug=netflix"/, 'the first app is the selected one');
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
    dock=Object.assign({},dock,{error:null,showHomeSources:false,useSourceImages:false});
    await sandbox.loadDock();
    assert.match(el('dockBody').innerHTML,/HDMI sources on Home/);
    assert.doesNotMatch(el('dockBody').innerHTML,/Restore original choice|data-dock-source-restore/);
    assert.match(el('dockBody').innerHTML,/HDMI source images/);
    await el('dock').onchange({target:{dataset:{dockSourceOption:'showHomeSources'},checked:true}}); await tick();
    assert.deepEqual(calls.filter(c=>c.body).pop().body,{action:'showHomeSources',on:true});
    await el('dock').onchange({target:{dataset:{dockSourceOption:'useSourceImages'},checked:true}}); await tick();
    assert.deepEqual(calls.filter(c=>c.body).pop().body,{action:'useSourceImages',on:true});
    assert.equal(sandbox.dockData.showHomeSources,true);
    await el('dock').onchange({target:{dataset:{dockSourceOption:'showHomeSources'},checked:false}}); await tick();
    assert.equal(sandbox.dockData.showHomeSources,false);
    assert.equal(sandbox.dockData.useSourceImages,true,'turning the source filter off leaves artwork choice intact');
    const source={slug:'in-hdmi1',label:'HDMI 1',appId:'source:13'};
    assert.match(sandbox.previewMarkup({entries:[source],useSourceImages:false}),/slug=in-hdmi1&images=0/);
    assert.match(sandbox.previewMarkup({entries:[source],useSourceImages:true}),/slug=in-hdmi1&images=1/,'source artwork choice invalidates the preview image cache');

    // The Custom launcher tab: the user's own app on the Home key.
    const reload = async () => { await el('dock').onclick({target: {closest: () => ({dataset: {dockReload: ''}})}}); await tick(); await tick(); };
    dock = Object.assign({}, dock, {installed: true, enabled: false, error: null, mode: 'off', customApp: null, running: false});
    await reload();
    sandbox.inventory = [
        {appId: 'org.example.launcher', name: 'My Launcher', system: false, removable: true, show: true, disabled: false},
        {appId: 'com.samsung.tv.csfs', name: 'Samsung Home', system: true, removable: false, show: true, disabled: false},
        {appId: 'org.example.hidden', name: 'Hidden Tool', system: false, removable: true, show: false, disabled: false},
        {appId: 'org.example.off', name: 'Switched Off', system: false, removable: true, show: true, disabled: true}];
    sandbox.renderDock();
    assert.match(html, /role="tab" id="dtab-vetro" data-dock-tab="vetro"[^>]*>Vetro launcher<\/button><button type="button" role="tab" id="dtab-custom" data-dock-tab="custom"[^>]*>Another app \(custom launcher\)<\/button>/, 'two choices on the Launcher tab: the Vetro launcher or another app');
    assert.equal(el('dockCustom').hidden, true, 'the Vetro launcher tab is the one open first');
    el('dock').onclick({target: {closest: () => ({dataset: {dockTab: 'custom'}})}});
    assert.equal(el('dockCustom').hidden, false); assert.equal(el('dockBody').hidden, true);
    let custom = el('dockCustom').innerHTML;
    assert.match(custom, /<option value="org\.example\.launcher" selected>My Launcher<\/option>/);
    assert.doesNotMatch(custom, /Hidden Tool|Switched Off|value="com\.samsung\.tv\.csfs"/, 'only apps you installed, with a launcher entry, switched on');
    assert.match(custom, /data-custom-switch[^>]*aria-label="Custom launcher"/); assert.doesNotMatch(custom, /data-custom-switch[^>]* checked/);
    assert.match(custom, /<h2[^>]*id="customHomeTitle"[^>]*>[\s\S]*Samsung Home<\/h2>/, 'the Samsung Home switch lives here, no longer in Quick settings');
    // Turning it on asks first, says what changes, and sends nothing before the confirmation.
    const csw = {dataset: {customSwitch: ''}, checked: true};
    el('dock').onchange({target: csw});
    assert.equal(csw.checked, false);
    assert.ok(!calls.some(c => c.body && c.body.action === 'enableCustom'));
    custom = el('dockCustom').innerHTML;
    assert.match(custom, /Use My Launcher as the launcher\?/); assert.match(custom, /Samsung’s Home off/); assert.match(custom, /Autorun Smart Hub/); assert.match(custom, /turns this mode off by itself/);
    el('dock').onclick({target: {closest: () => ({dataset: {customCancel: ''}})}});
    assert.doesNotMatch(el('dockCustom').innerHTML, /Use My Launcher as the launcher\?/);
    csw.checked = true; el('dock').onchange({target: csw});
    await el('dock').onclick({target: {closest: () => ({dataset: {customConfirm: ''}})}}); await tick(); await tick(); await tick();
    assert.deepEqual(calls.filter(c => c.url === '/dock' && c.body).pop().body, {action: 'enableCustom', appId: 'org.example.launcher'});
    custom = el('dockCustom').innerHTML;
    assert.match(custom, /On · running/); assert.match(custom, /data-custom-switch[^>]* checked/);
    assert.match(sandbox.operationEntries[0].message, /Custom launcher on and running/);
    assert.equal(sandbox.launcherEnabled, true, 'any launcher on locks the Samsung Home switch');
    assert.match(el('dockBody').innerHTML, /My Launcher is the launcher now\. The Vetro launcher and another app are never on together\./);
    assert.match(el('dockBody').innerHTML, /data-launcher-switch="vetro"[^>]*>Use the Vetro launcher instead</, 'one button switches straight over');
    assert.match(el('dockBody').innerHTML, /data-dock-switch[^>]* disabled/, 'the Vetro launcher cannot be turned on at the same time');
    // Changing the app needs no second confirmation.
    sandbox.inventory.push({appId: 'org.example.second', name: 'Second Launcher', system: false, removable: true, show: true, disabled: false});
    el('dock').onchange({target: {dataset: {customApp: ''}, value: 'org.example.second'}});
    assert.match(el('dockCustom').innerHTML, /data-custom-change/);
    await el('dock').onclick({target: {closest: () => ({dataset: {customChange: ''}})}}); await tick(); await tick(); await tick();
    assert.deepEqual(calls.filter(c => c.url === '/dock' && c.body).pop().body, {action: 'enableCustom', appId: 'org.example.second'});
    // Turning it off needs no warning.
    await el('dock').onchange({target: {dataset: {customSwitch: ''}, checked: false}}); await tick(); await tick(); await tick();
    assert.deepEqual(calls.filter(c => c.url === '/dock' && c.body).pop().body, {action: 'disableCustom'});
    assert.match(el('dockCustom').innerHTML, /state-chip[^>]*>Off</); assert.equal(sandbox.launcherEnabled, false);
    // With the Vetro launcher on, the custom one cannot be chosen.
    dock = Object.assign({}, dock, {enabled: true, mode: 'vetro', running: true});
    sandbox.inventory = [{appId: 'org.example.launcher', name: 'My Launcher', system: false, removable: true, show: true, disabled: false}]; // the mock app list is empty, and turning a mode on or off re-reads it
    await reload();
    sandbox.inventory = [{appId: 'org.example.launcher', name: 'My Launcher', system: false, removable: true, show: true, disabled: false}]; sandbox.renderDock();
    custom = el('dockCustom').innerHTML;
    assert.match(custom, /data-launcher-switch="custom"[^>]*>Use My Launcher instead</); assert.match(custom, /data-custom-switch[^>]* disabled/); assert.match(custom, /<select[^>]* disabled/);
    // Switching straight from the Vetro launcher to the app: one question, then off and on in that order.
    el('dock').onclick({target: {closest: () => ({dataset: {launcherSwitch: 'custom'}})}});
    custom = el('dockCustom').innerHTML;
    assert.match(custom, /Switch the Home key from the Vetro launcher to My Launcher\?/); assert.match(custom, /If the second step fails, Samsung’s Home answers the Home key/);
    const sent = calls.filter(c => c.url === '/dock' && c.body).length;
    el('dock').onclick({target: {closest: () => ({dataset: {launcherSwitchCancel: ''}})}});
    assert.doesNotMatch(el('dockCustom').innerHTML, /Switch the Home key/); assert.equal(calls.filter(c => c.url === '/dock' && c.body).length, sent, 'Cancel sends nothing');
    el('dock').onclick({target: {closest: () => ({dataset: {launcherSwitch: 'custom'}})}});
    await el('dock').onclick({target: {closest: () => ({dataset: {launcherSwitchConfirm: ''}})}}); for (let i = 0; i < 8; i++) await tick();
    assert.deepEqual(calls.filter(c => c.url === '/dock' && c.body).slice(sent).map(c => c.body), [{action: 'disable'}, {action: 'enableCustom', appId: 'org.example.launcher'}]);
    assert.equal(sandbox.dockData.mode, 'custom');
    sandbox.inventory = [];
    console.log('PASS launcher UI: confirmation before turning on, direct turn off, state, app list, errors');
})().catch(e => { console.error(e); process.exitCode = 1; });
