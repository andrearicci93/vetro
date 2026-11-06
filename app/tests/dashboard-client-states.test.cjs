'use strict';
// Regression tests for the state machines that run in the dashboard page (app/docs/STATE-MACHINES.md, machines SM-12 to SM-17).
// Each block reproduces a sequence that used to leave the page in a state it could not leave, or sent the TV a request built
// from out-of-date data.
const assert = require('assert').strict, vm = require('vm');
const html = require('../service/dashboard.js')(), nodes = {}, calls = [], intervals = [];
const el = id => nodes[id] || (nodes[id] = {value: '', checked: false, disabled: false, hidden: true, textContent: '', innerHTML: '', className: '', dataset: {}, focus() {}, setAttribute() {}, removeAttribute() {}, getAttribute: () => null, querySelectorAll: () => [], contains: () => false});
let response = {}, fault = {};
const timeouts = [], cleared = new Set(), gates = {};
const sandbox = {
    document: {getElementById: id => id === 'componentProgress' && globalThis.__noProgress ? null : el(id), querySelectorAll: () => [], querySelector: s => el('q:' + s), body: {classList: {contains: () => false, toggle() {}}}, addEventListener() {}, activeElement: null, hidden: false},
    setInterval(fn, ms) { intervals.push({fn, ms}); return intervals.length; }, setTimeout(fn, ms) { timeouts.push({fn, ms}); return timeouts.length; }, clearTimeout(id) { cleared.add(id); }, AbortController, console, confirm: () => true,
    fetch: async (url, opts) => {
        const p = opts && opts.body ? JSON.parse(opts.body) : null;
        calls.push({url, p});
        const key = (p ? 'POST ' : 'GET ') + url;
        if (url === '/hang') return new Promise((resolve, reject) => opts.signal.addEventListener('abort', () => reject(Object.assign(Error('aborted'), {name: 'AbortError'}))));
        if (fault[key]) throw Error(fault[key]);
        let d = response[key];
        if (typeof d === 'function') d = d(p);
        const gate = gates[key] && gates[key].shift();
        if (gate) await gate;
        if (d === undefined) d = url.startsWith('/apps') ? {apps: [], summary: {total: 0}} : url === '/remap' ? {rules: []}
            : url === '/input' ? {devices: [], status: {policy: {mode: 'off'}, events: []}}
            : url.startsWith('/monitor') ? {ts: Date.now(), memory: {}, cpu: {cores: []}, processes: [], network: []} : {};
        return {ok: true, json: async () => d};
    }
};
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], sandbox);
const tick = (n = 3) => new Promise(r => { let i = 0; (function next() { if (++i > n) r(); else setImmediate(next); })(); });
const latest = () => sandbox.operationEntries[0];
const posted = url => calls.filter(c => c.url === url && c.p);
const fetched = url => calls.filter(c => c.url === url || c.url.indexOf(url + '?') === 0);

// A promise that never settles ends the process quietly with status 0: make that a failure.
let finished = false;
process.on('exit', code => { if (code === 0 && !finished) { console.error('FAIL the test ended before its last check ran (a promise never settled)'); process.exit(1); } });

(async () => {
    await tick();

    // --- Privacy panel: consent rows used a helper that no longer exists ---------------------------------------------------
    sandbox.settingsSection = 'privacy';
    sandbox.privacyData = {hbbtv: {appRunning: false}, doNotTrack: 0, acr: {recognitionStatus: 'off'}, adId: {psidPresent: false}, tvPlusConsent: false,
        agreementsAvailable: true, agreements: [{id: 'privacy', agreed: true}, {id: 'ads', agreed: false}], scope: 'Read only.'};
    sandbox.renderPrivacy();
    assert.match(el('settingGroups').innerHTML, /Reported consents/);
    assert.match(el('settingGroups').innerHTML, /Given/);
    assert.match(el('settingGroups').innerHTML, /Not given/);
    console.log('PASS the privacy panel renders when the TV reports consent rows');

    // --- Processes tab: a summary sample must not replace the last full one ----------------------------------------------
    const process = {pid: 7, name: 'example', cpuPercent: 1, rssBytes: 1048576, state: 'S', threads: 2};
    sandbox.drawMonitor({ts: Date.now(), memory: {}, cpu: {cores: []}, network: [], processes: [process], processCount: 1});
    sandbox.drawMonitor({ts: Date.now(), scope: 'summary', memory: {}, cpu: {cores: []}, network: []});
    sandbox.renderProcesses();
    assert.match(el('processRows').innerHTML, /data-process="7"/, 'the process list survives a summary sample');
    assert.doesNotThrow(() => el('processRows').onclick({target: {closest: () => ({dataset: {process: '7'}})}}), 'a click on a row after a summary sample does not throw');
    console.log('PASS the process list keeps the last full sample when a summary sample arrives');

    // --- Quick tab: one operation at a time ------------------------------------------------------------------------------
    sandbox.winsBusy = true; calls.length = 0;
    sandbox.applyQuick('tracking-all', true);
    sandbox.clearLeftovers();
    await tick();
    assert.equal(posted('/quick').length + posted('/leftovers').length, 0, 'nothing is sent while a quick win is applying (the TV would answer 409)');
    sandbox.winsBusy = false;
    console.log('PASS group switches and leftovers wait for a running quick win');

    // --- Remapper: never replace a list that was not just compared with the TV ---------------------------------------------
    const rule = {id: 'physical_68', enabled: true, trigger: {type: 'physical', value: '68'}, actions: [{type: 'launch', appId: 'example.app'}]};
    const other = {id: 'physical_69', enabled: true, trigger: {type: 'physical', value: '69'}, actions: [{type: 'launch', appId: 'other.app'}]};
    sandbox.rules = [];
    response['GET /remap'] = {rules: [other]};   // another browser tab saved a shortcut after this page loaded
    calls.length = 0;
    await sandbox.saveRuleSet([rule], 'Add shortcut', el('saveRule'));
    assert.equal(posted('/remap').length, 0, 'a save built from an out-of-date list is not sent');
    assert.match(latest().message, /changed on the TV/);
    assert.deepEqual(JSON.parse(JSON.stringify(sandbox.rules)), [other], 'the page now shows the list the TV holds');
    response['GET /remap'] = {};                  // unreadable answer
    await sandbox.saveRuleSet([rule], 'Add shortcut', el('saveRule'));
    assert.equal(posted('/remap').length, 0);
    assert.match(latest().message, /unreadable/);
    response['GET /remap'] = {rules: [other]};
    response['POST /remap'] = p => ({rules: p.rules, persisted: true});
    await sandbox.saveRuleSet([other, rule], 'Add shortcut', el('saveRule'));
    assert.equal(posted('/remap').length, 1, 'with a current list the save goes through');
    delete response['GET /remap']; delete response['POST /remap'];
    console.log('PASS a shortcut save is refused when the page list differs from the TV list');

    // --- Remapper: leaving the tab while listening gives the remote back ----------------------------------------------------
    sandbox.currentPanel = 'remote'; sandbox.inputListening = true; sandbox.inputPreferenceState = null; calls.length = 0;
    sandbox.switchPanel('quick');
    await tick();
    const stop = posted('/input');
    assert.equal(stop.length, 1, 'leaving the Remapper while listening sends a stop');
    assert.equal(stop[0].p.mode, 'off');
    sandbox.inputListening = false; sandbox.currentPanel = 'quick'; calls.length = 0;
    sandbox.switchPanel('dock'); sandbox.switchPanel('quick');
    await tick();
    assert.equal(posted('/input').length, 0, 'switching tabs without listening sends nothing');
    console.log('PASS leaving the Remapper tab ends a listening session');

    // --- Stale "expected" values: a rejected write refreshes the value, so the retry is not stale --------------------------
    sandbox.hbbtvData = {value: 1, restoreValue: null};
    fault['POST /hbbtv'] = 'Value changed; refresh before editing';
    response['GET /hbbtv'] = {value: 5};
    await sandbox.setHbbtv(true);
    assert.equal(sandbox.hbbtvData.value, 5, 'the HbbTV value is read again after a rejected change');
    delete fault['POST /hbbtv']; delete response['GET /hbbtv'];

    sandbox.settingsSection = 'picture';
    sandbox.tvSettingsData = {items: [{id: 'contrast', label: 'Contrast', value: 45, min: 0, max: 50, writable: true, group: 'picture'}], network: {}, device: {}};
    el('setting-contrast').value = '40';
    fault['POST /tv-settings'] = 'TV value changed; refresh before saving';
    response['GET /tv-settings'] = {items: [{id: 'contrast', label: 'Contrast', value: 30, min: 0, max: 50, writable: true, group: 'picture'}], network: {}, device: {}};
    const button = {dataset: {setting: 'contrast'}, disabled: false, textContent: 'Save'};
    await el('settingGroups').onclick({target: {closest: selector => selector === '[data-setting]' ? button : null}});
    await tick();
    assert.equal(sandbox.tvSettingsData.items[0].value, 30, 'the TV setting is read again after a rejected save');
    delete fault['POST /tv-settings']; delete response['GET /tv-settings'];
    console.log('PASS a rejected write re-reads the value it was compared against');

    // --- Quick tab recovers when the first app list failed ---------------------------------------------------------------
    sandbox.inventory = []; calls.length = 0;
    sandbox.loadQuick();
    await tick();
    assert.ok(fetched('/apps').length > 0, 'opening the Quick tab with no app list asks for it again');
    console.log('PASS the Quick tab reloads an empty app list');

    // --- Component drawer: a progress line that is no longer on the page is not an error --------------------------------------
    sandbox.selected = {appId: 'example.app'}; el('detail').hidden = false; globalThis.__noProgress = true;
    assert.doesNotThrow(() => sandbox.operationUpdate({appId: 'example.app', label: 'Disable', target: 'Example', time: '12:00', state: 'pending', message: ''}, 'pending', 'Working'));
    globalThis.__noProgress = false; sandbox.selected = null; el('detail').hidden = true;
    console.log('PASS the history update survives a drawer that was replaced meanwhile');

    // --- Plugin page (a tab of the Plugins panel): leaving the panel unloads the frame; a stopped plugin ends the view ---------------
    const running = {id: 'example', name: 'Example', version: '1.0.0', permissions: [], state: 'running', enabled: true, trust: 'file', ui: {label: 'Example'}};
    sandbox.currentPanel = 'plugins'; sandbox.pluginBusy = false;
    sandbox.pluginData = {plugins: [running]};
    response['POST /plugins/example/session'] = {path: '/plugins/example/api/ui'};
    sandbox.showPluginTab('example');
    await tick();
    assert.match(el('pluginFrame').src, /\/plugins\/example\/api\/ui/);
    assert.equal(sandbox.pluginView, 'example');
    assert.match(el('pluginTabs').innerHTML, /data-plugin-tab="example"[^>]*aria-selected="true"/);
    sandbox.switchPanel('quick');
    assert.equal(el('pluginFrame').src, 'about:blank', 'the plugin page stops running when the Plugins panel is left');
    assert.equal(sandbox.pluginView, null);
    assert.doesNotMatch(el('pluginTabs').innerHTML, /data-plugin-tab="example"[^>]*aria-selected="true"/);
    // Going from one plugin page to another must not leave the first page showing while the second one loads.
    sandbox.currentPanel = 'plugins';
    sandbox.showPluginTab('example'); await tick();
    el('pluginFrame').src = '/plugins/old/api/ui';
    response['POST /plugins/example/session'] = new Promise(() => {}).then(() => ({}));   // never answers
    sandbox.showPluginTab('example');
    assert.equal(el('pluginFrame').src, 'about:blank', 'the previous page is unloaded before the next one is requested');
    response['POST /plugins/example/session'] = {path: '/plugins/example/api/ui'};
    // A plugin that stops while its page is open is noticed by the 5 s refresh (the page lives inside the Plugins panel).
    sandbox.currentPanel = 'plugins'; sandbox.showPluginTab('example'); await tick(); calls.length = 0;
    response['GET /plugins'] = {plugins: [Object.assign({}, running, {state: 'stopped', enabled: false})]};
    intervals.forEach(i => i.fn());
    await tick();
    assert.ok(fetched('/plugins').length > 0, 'the plugin list is read while a plugin page is open');
    assert.equal(sandbox.pluginView, null, 'the page of a plugin that stopped is closed');
    assert.equal(el('pluginFrame').src, 'about:blank');
    delete response['GET /plugins']; delete response['POST /plugins/example/session'];
    sandbox.switchPanel('quick'); calls.length = 0;
    console.log('PASS the plugin page is unloaded when the panel is left and watched while it is open');

    // --- A request nobody answers is cancelled -------------------------------------------------------------------------------
    const hung = sandbox.api('/hang');
    const timer = timeouts.map((x, i) => ({x, id: i + 1})).filter(e => e.x.ms === sandbox.API_TIMEOUT_MS).pop();
    assert.ok(timer, 'every request arms a timeout');
    timer.x.fn();
    await Promise.race([assert.rejects(hung, /did not answer in time/), new Promise((resolve, reject) => setTimeout(() => reject(Error('the timed-out request never ended')), 500))]);
    const quick = sandbox.api('/status'); const armed = timeouts.map((x, i) => ({x, id: i + 1})).filter(e => e.x.ms === sandbox.API_TIMEOUT_MS).pop();
    await quick;
    assert.ok(cleared.has(armed.id), 'an answered request disarms its timeout');
    console.log('PASS a request with no answer ends with an error instead of a busy flag that never clears');

    // --- Domain filter ----------------------------------------------------------------------------------------------------
    el('dnsDomains').value = 'unsaved.example'; el('dnsDomains').oninput();
    sandbox.dnsState({enabled: true, applied: true, domains: ['saved.example'], resolvers: []});
    assert.equal(el('dnsDomains').value, 'unsaved.example', 'a reply does not overwrite what is being typed');
    el('dnsEnabled').checked = false;
    response['POST /dns'] = {enabled: false, applied: false, domains: ['unsaved.example'], resolvers: [], namespaceWarnings: []};
    await el('saveDns').onclick();
    assert.equal(sandbox.dnsDirty, false, 'saving makes the box follow the TV again');
    sandbox.dnsState({enabled: true, applied: true, domains: ['saved.example'], resolvers: []});
    assert.equal(el('dnsDomains').value, 'saved.example');
    // The switch: the TV saved the filter but did not apply it. The page must say what the TV holds.
    sandbox.quickData.dns = {enabled: false, applied: false, domains: ['saved.example'], resolvers: []};
    response['POST /dns'] = {enabled: true, applied: false, domains: ['saved.example'], resolvers: []};
    await sandbox.setDns(true);
    assert.equal(latest().state, 'warning');
    assert.equal(sandbox.quickData.dns.enabled, true, 'the page shows the saved-but-not-applied state, not the old one');
    delete response['POST /dns'];
    console.log('PASS the domain box keeps unsaved edits, and an unapplied filter is shown as it is');

    // --- Older answers do not replace newer ones ------------------------------------------------------------------------------
    let n = 0, release;
    response['GET /wins'] = () => ({wins: {}, n: ++n});
    gates['GET /wins'] = [new Promise(r => release = r)];
    const first = sandbox.loadWins(), second = sandbox.loadWins();
    await second; release(); await first;
    assert.equal(sandbox.quickData.wins.n, 2, 'the slow first answer arrives last and is ignored');
    delete response['GET /wins']; delete gates['GET /wins'];
    // A switch that was just changed reads the state back; a read that started earlier must not undo it.
    let k3 = 0, release4;
    response['GET /wins'] = () => ({wins: {}, tag: ++k3 === 1 ? 'stale' : 'fresh'});
    response['POST /wins'] = {changed: true, ok: true};
    gates['GET /wins'] = [new Promise(r => release4 = r)];
    const staleRead = sandbox.loadWins();
    await sandbox.setWin('ambient', true);
    release4(); await staleRead;
    assert.equal(sandbox.quickData.wins.tag, 'fresh', 'the state read back after a change is not replaced by an older read');
    delete response['GET /wins']; delete response['POST /wins']; delete gates['GET /wins'];
    const later = Date.now() + 60000;
    sandbox.drawMonitor({ts: later, memory: {}, cpu: {cores: []}, network: [], processes: [process], processCount: 1});
    sandbox.drawMonitor({ts: later - 1000, memory: {}, cpu: {cores: []}, network: [], processes: [], processCount: 0});
    assert.equal(sandbox.liveData.ts, later, 'a sample older than the one shown is dropped');
    console.log('PASS late answers and older samples do not replace newer data');

    // --- Plugins page: the 5 s refresh leaves the page alone while the file chooser is open ----------------------------------
    sandbox.currentPanel = 'plugins'; sandbox.pluginBusy = false; calls.length = 0;
    sandbox.document.activeElement = {dataset: {pluginFile: ''}};
    intervals.forEach(i => i.fn());
    await tick();
    assert.equal(fetched('/plugins').length, 0, 'no rebuild while the file input has focus');
    sandbox.document.activeElement = null;
    intervals.forEach(i => i.fn());
    await tick();
    assert.ok(fetched('/plugins').length > 0, 'the refresh runs again afterwards');
    console.log('PASS the plugin list refresh waits for the file chooser');
    // --- Remapper: the saved list is read when the tab opens, and a failed read is said ------------------------------------------
    sandbox.currentPanel = 'quick'; calls.length = 0;
    sandbox.switchPanel('remote');
    await tick();
    assert.ok(fetched('/remap').length > 0, 'opening the Remapper reads the saved shortcuts again');
    sandbox.switchPanel('quick');
    fault['GET /remap'] = 'offline';
    await sandbox.loadRules();
    assert.match(el('rules').textContent, /Could not read the saved shortcuts: offline/, 'a failed read is shown, not silent');
    delete fault['GET /remap']; response['GET /remap'] = {};
    await sandbox.loadRules();
    assert.match(el('rules').textContent, /unreadable/, 'an answer without a list is not taken as an empty list');
    delete response['GET /remap'];
    console.log('PASS the Remapper reads the saved list when opened and reports a failed read');

    // --- Quick tab: no second app-list request while the first is still running -------------------------------------------------
    sandbox.inventory = []; sandbox.appsState = {state: 'loading', error: null}; calls.length = 0;
    sandbox.loadQuick();
    await tick();
    assert.equal(fetched('/apps').length, 0, 'the page start (loadApps then loadQuick) asks for the list once');
    sandbox.appsState = {state: 'empty', error: null};
    console.log('PASS the Quick tab does not repeat an app-list request that is still running');

    // --- Quick tab: a group switch is disabled while a quick win runs ------------------------------------------------------------
    const realState = sandbox.quickState, group = sandbox.quickGroups.filter(g => g.id !== 'samsung-home')[0];
    sandbox.quickState = () => ({status: 'on', installed: [], enabled: [], disabled: [], flagged: []});
    sandbox.inventory = [{appId: 'x'}]; sandbox.winsBusy = false;
    assert.doesNotMatch(sandbox.groupItem(group), /data-quick-toggle="[^"]*"[^>]*disabled/);
    sandbox.winsBusy = true;
    assert.match(sandbox.groupItem(group), /data-quick-toggle="[^"]*"[^>]*disabled/, 'the switch cannot be used while a quick win runs');
    sandbox.quickData.leftovers = {files: [{name: 'a.wgt', isPackage: true, size: 10}], packageBytes: 10, extras: [], extraKinds: {}};
    sandbox.renderQuick();
    assert.match(el('quickStorage').innerHTML, /data-leftovers-clear disabled/, 'the clear button is disabled while a quick win runs');
    sandbox.winsBusy = false; sandbox.renderQuick();
    assert.match(el('quickStorage').innerHTML, /data-leftovers-clear >/, 'and enabled again afterwards');
    sandbox.quickData.leftovers = null; sandbox.quickState = realState; sandbox.inventory = [];
    console.log('PASS group switches are disabled while a quick win runs');

    // --- Launcher: an answer to an older read does not replace a newer state --------------------------------------------------
    let release2;
    response['GET /dock'] = () => ({mode: 'vetro', enabled: true, n: 'stale'});
    gates['GET /dock'] = [new Promise(r => release2 = r)];
    const slow = sandbox.loadDock();
    response['POST /dock'] = {mode: 'off', enabled: false, n: 'fresh'};
    await sandbox.setDock('disable', 'Turn off the launcher');
    release2(); await slow;
    assert.equal(sandbox.dockData.n, 'fresh', 'a read that started before the change does not undo it');
    assert.equal(sandbox.launcherEnabled, false, 'nor does it unlock the Samsung Home switch');
    let k2 = 0, release3;
    response['GET /dock'] = () => (++k2 === 1 ? {mode: 'vetro', enabled: true, n: 1} : {mode: 'off', enabled: false, n: 2});
    gates['GET /dock'] = [new Promise(r => release3 = r)];
    const d1 = sandbox.loadDock(), d2 = sandbox.loadDock();
    await d2; release3(); await d1;
    assert.equal(sandbox.dockData.n, 2, 'the slow first answer arrives last and is ignored');
    assert.equal(sandbox.launcherEnabled, false);
    delete response['GET /dock']; delete response['POST /dock'];
    console.log('PASS late launcher answers do not replace newer ones');

    // --- Restore and Remove: they wait for the other Quick settings actions instead of clearing their busy flag ------------------
    for (const flag of ['quickBusy', 'winsBusy', 'keepBusy']) {
        sandbox[flag] = true; calls.length = 0;
        sandbox.runRestore(); sandbox.eraseVetroData();
        await tick();
        assert.equal(posted('/restore').length, 0, 'nothing is sent while ' + flag + ' is set');
        assert.equal(sandbox[flag], true, 'a refused restore leaves the flag of the running action alone');
        sandbox[flag] = false;
    }
    console.log('PASS Restore the TV and Remove Vetro wait for the running action');

    // --- Component drawer: a refresh that fails after the drawer was replaced does not throw -----------------------------------------
    sandbox.bindComponentControls({appId: 'example.app', name: 'Example'});
    fault['GET /apps?refresh=1'] = 'offline';
    globalThis.__noProgress = true;
    await assert.doesNotReject(() => el('refreshDetail').onclick.call(el('refreshDetail')));
    globalThis.__noProgress = false;
    await el('refreshDetail').onclick.call(el('refreshDetail'));
    assert.match(el('componentProgress').textContent, /Refresh failed: offline/);
    delete fault['GET /apps?refresh=1'];
    console.log('PASS the drawer refresh failure survives a drawer that was replaced meanwhile');
    finished = true;
})().catch(e => { console.error(e); process.exit(1); });
