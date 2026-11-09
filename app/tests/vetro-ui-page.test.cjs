'use strict';
// The Vetro UI page: one entry for the launcher, live TV and the on-screen displays; the overview switches, the displays' needs,
// the confirmation before Vetro UI takes a key a shortcut of the user's uses, and the locked rows in the Remapper.
const assert = require('assert').strict, vm = require('vm');
const html = require('../service/dashboard.js')();
const nodes = {};
const el = id => nodes[id] || (nodes[id] = {id, value: '', hidden: true, textContent: '', innerHTML: '', disabled: false, checked: false, focus() {}});
const calls = [], confirms = [];
let answer = true;
let dock = {installed: true, enabled: true, mode: 'vetro', running: true, volumePill: false, numberPad: false, volumeEdge: 'left', entries: [], inputs: []};
let tuner = {installed: true, supported: true, enabled: false, running: false, samsungTunerFound: true, failures: 0, features: []};
let input = {devices: [], status: {policy: {mode: 'off', connected: false}, preference: {enabled: false}, events: []}};
let remap = {rules: [{id: 'physical_68', enabled: true, trigger: {type: 'physical', value: '68'}, actions: [{type: 'launch', appId: 'org.example.app'}]}], reserved: [], interception: {auto: false, problem: null}};
const sandbox = {document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}}, console, setTimeout() { return 1; }, clearTimeout() {}, setInterval() {},
    confirm: text => { confirms.push(text); return answer; },
    fetch: async (url, opts) => {
        const body = opts && opts.body ? JSON.parse(opts.body) : null;
        calls.push({url, body});
        let data = {};
        if (url === '/dock' && !body) data = dock;
        else if (url === '/dock') {
            if (body.action === 'volumePill' || body.action === 'numberPad') {
                dock = Object.assign({}, dock, {[body.action]: body.on});
                const on = dock.volumePill || dock.numberPad;
                input = {devices: [], status: {policy: {mode: on ? 'filter' : 'off', connected: on}, preference: {enabled: on}, events: []}};
                remap = Object.assign({}, remap, {reserved: (dock.volumePill ? [{code: '68', label: 'Vol +', owner: 'volume', name: 'Glass volume bar', live: true}] : []), interception: {auto: on, problem: null}});
            }
            if (body.action === 'volumeEdge') dock = Object.assign({}, dock, {volumeEdge: body.edge});
            data = dock;
        } else if (url === '/tuner') data = tuner;
        else if (url === '/input') data = input;
        else if (url === '/remap' && !body) data = remap;
        else if (url === '/remap') { remap = Object.assign({}, remap, {rules: body.rules}); data = {ok: true, persisted: true, rules: body.rules}; }
        else if (url.startsWith('/apps')) data = {apps: [], summary: {total: 0}};
        return {ok: true, json: async () => data};
    }};
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], sandbox);
const tick = async (n) => { for (let i = 0; i < (n || 4); i++) await new Promise(r => setImmediate(r)); };

(async () => {
    await tick();
    // One entry, four tabs; the old entries open their tab.
    assert.match(html, /<button data-tab="vetroui"[^>]*>[\s\S]*?Vetro UI<\/button>/);
    ['overview', 'launcher', 'tuner', 'osd'].forEach(t => assert.match(html, new RegExp('data-ui-tab="' + t + '"')));
    sandbox.switchPanel('osd'); await tick();
    assert.equal(sandbox.currentPanel, 'vetroui'); assert.equal(sandbox.uiTab, 'osd');
    assert.equal(el('uiPanel-osd').hidden, false); assert.equal(el('uiPanel-launcher').hidden, true);

    // The overview: one switch per part, and how they work together.
    sandbox.showUiTab('overview'); sandbox.renderUi();
    let over = el('uiOverview').innerHTML;
    ['data-ui-launcher', 'data-ui-tuner', 'data-ui-osd="volumePill"', 'data-ui-osd="numberPad"'].forEach(a => assert.ok(over.includes(a), 'overview switch: ' + a));
    assert.match(over, /The Home key opens the Vetro launcher/);
    assert.match(over, /drawn by the launcher’s process/); assert.match(over, /Vetro UI turns it on by itself/); assert.match(over, /Your shortcuts come second/);

    // The displays: what they need, their switches, the bar's position and a preview that follows it.
    let osd = el('osd').innerHTML;
    assert.match(osd, /Drawn by the Vetro launcher’s process, which is on/);
    assert.match(osd, /The remote interception is off/);
    assert.match(osd, /data-osd="volumePill"/); assert.match(osd, /data-osd-edge/);
    assert.match(osd, /aria-label="The glass volume bar on the left edge/);
    assert.doesNotMatch(el('dockBody').innerHTML, /Glass volume bar|Glass number pad/, 'no longer on the Launcher tab');
    assert.doesNotMatch(el('tunerBody').innerHTML, /data-tuner-dock/, 'nor among the tuner’s switches');

    // Turning the bar on while a shortcut of the user's is on Vol +: a question that names it, nothing sent before the answer.
    const before = calls.filter(c => c.url === '/dock' && c.body).length;
    const sw = {dataset: {osd: 'volumePill'}, checked: true};
    el('osd').onchange({target: sw});
    assert.equal(sw.checked, false);
    osd = el('osd').innerHTML;
    assert.match(osd, /One of your shortcuts uses the same key/); assert.match(osd, /Key Vol \+ \(68\) opens org\.example\.app/); assert.match(osd, /Vetro UI’s keys come first/);
    assert.equal(calls.filter(c => c.url === '/dock' && c.body).length, before);
    el('osd').onclick({target: {closest: () => ({dataset: {osdCancel: ''}})}});
    assert.doesNotMatch(el('osd').innerHTML, /One of your shortcuts/);
    el('osd').onchange({target: {dataset: {osd: 'volumePill'}, checked: true}});
    await el('osd').onclick({target: {closest: () => ({dataset: {osdConfirm: 'volumePill'}})}}); await tick(8);
    assert.deepEqual(calls.filter(c => c.url === '/dock' && c.body).slice(before).map(c => c.body), [{action: 'volumePill', on: true}]);
    osd = el('osd').innerHTML;
    assert.match(osd, /Remote interception on, turned on by Vetro UI/);
    assert.match(sandbox.operationEntries[0].message, /Glass volume bar on\./);

    // The pad has no conflict: no question.
    await el('osd').onchange({target: {dataset: {osd: 'numberPad'}, checked: true}}); await tick(8);
    assert.deepEqual(calls.filter(c => c.url === '/dock' && c.body).pop().body, {action: 'numberPad', on: true});
    // The position moves the preview.
    await el('osd').onchange({target: {dataset: {osdEdge: ''}, value: 'bottom'}}); await tick(8);
    assert.deepEqual(calls.filter(c => c.url === '/dock' && c.body).pop().body, {action: 'volumeEdge', edge: 'bottom'});
    assert.match(el('osd').innerHTML, /aria-label="The glass volume bar on the bottom edge/);

    // With Samsung's Home on the Home key the displays say they do nothing, and where to choose a launcher.
    sandbox.dockData = Object.assign({}, dock, {enabled: false, mode: 'off'}); sandbox.renderOsd();
    assert.match(el('osd').innerHTML, /these displays do nothing/); assert.match(el('osd').innerHTML, /data-ui-open="launcher"/);
    sandbox.dockData = dock;

    // The Remapper lists the keys Vetro UI holds, locked, first; the user's shortcut on the same key says it is overridden.
    sandbox.switchPanel('remote'); await tick(8);
    const list = el('rules').innerHTML;
    assert.match(list, /rule-locked[^>]*data-held="68"[\s\S]*aria-label="Locked"[\s\S]*Glass volume bar[\s\S]*Vetro UI/);
    assert.ok(list.indexOf('rule-locked') < list.indexOf('data-delete'), 'the locked rows come first');
    assert.doesNotMatch(list.slice(0, list.indexOf('data-delete')), /data-delete="68"/, 'a locked row cannot be deleted');
    assert.match(list, /Overridden by Vetro UI/);
    // A new shortcut on a held key asks first.
    el('inputCode').value = '68'; el('targetApp').value = 'org.example.other'; answer = false;
    await el('saveRule').onclick(); await tick();
    assert.match(confirms.pop(), /Key 68 \(Vol \+\) is used by Vetro UI \(Glass volume bar\)/);
    assert.ok(!calls.some(c => c.url === '/remap' && c.body), 'declined: nothing saved');
    // Turning the interception off while Vetro UI uses it asks first; declined, the switch stays on.
    const filter = el('filter'); filter.checked = false;
    filter.onchange.call(filter);
    assert.match(confirms.pop(), /Without it Vol, Mute and 123 go back to Samsung’s own bar and pad/);
    assert.equal(filter.checked, true);
    // Samsung's Home on the Home key with the bar switched on: turning the Vetro launcher on names the shortcut it will override.
    sandbox.uiRules = [{id: 'physical_68', enabled: true, trigger: {type: 'physical', value: '68'}, actions: [{type: 'launch', appId: 'org.example.app'}]},
        {id: 'physical_88', enabled: true, trigger: {type: 'physical', value: '88'}, actions: [{type: 'launch', appId: 'org.example.ch'}]}];
    sandbox.dockData = Object.assign({}, dock, {enabled: false, mode: 'off', volumePill: true}); sandbox.dockConfirm = true; sandbox.renderDock();
    assert.match(el('dockBody').innerHTML, /One of your shortcuts stops running\.<\/strong> Key Vol \+ \(68\) opens org\.example\.app: the glass volume bar is on/);
    sandbox.dockConfirm = false; sandbox.dockData = Object.assign({}, dock, {enabled: true, mode: 'vetro'}); sandbox.renderDock();
    // A shortcut on a tuner key: the Live TV tab says the tuner never gets it, the Remapper marks it.
    sandbox.tunerData = Object.assign({}, tuner, {enabled: true, running: true}); sandbox.renderTuner();
    assert.match(el('tunerBody').innerHTML, /A shortcut of yours uses a key of the tuner: CH \+ \(88\) opens org\.example\.ch\. While the remote interception is on, that key goes to the shortcut/);
    sandbox.remapTuner = true; sandbox.rules = sandbox.uiRules; sandbox.reservedKeys = [{code: '68', label: 'Vol +', owner: 'volume', name: 'Glass volume bar', live: false}]; sandbox.showRules();
    assert.match(el('rules').innerHTML, /Live TV does not get CH \+/);
    assert.doesNotMatch(el('rules').innerHTML, /Overridden by Vetro UI/, 'a held key that waits for a launcher does not override anything yet');
    // The task manager: a switch on the Launcher tab and in the overview, the hint under the bar in the preview, the panel's preview,
    // and a note when a shortcut of the user's holds Down or OK.
    sandbox.dockData = Object.assign({}, dock, {enabled: true, mode: 'vetro', taskManager: false}); sandbox.renderDock();
    let launcher = el('dockBody').innerHTML;
    assert.match(launcher, /data-quick-item="task-manager"/); assert.match(launcher, /data-dock-tasks/); assert.match(launcher, /By zabique/);
    assert.doesNotMatch(launcher, /lp-hint-below/, 'off: the bar has no hint under it');
    assert.match(launcher, /aria-label="The launcher’s task manager/);
    sandbox.dockData = Object.assign({}, sandbox.dockData, {taskManager: true}); sandbox.renderDock();
    launcher = el('dockBody').innerHTML;
    assert.match(launcher, /class="lp lp-tasks"/); assert.match(launcher, /Task manager ˅/);
    sandbox.uiRules = [{id: 'physical_108', enabled: true, trigger: {type: 'physical', value: '108'}, actions: [{type: 'launch', appId: 'org.example.down'}]}]; sandbox.renderDock();
    assert.match(el('dockBody').innerHTML, /A shortcut of yours uses Key Down \(108\) opens org\.example\.down\. While the remote interception is on, the launcher never gets that key/);
    sandbox.dockData = Object.assign({}, sandbox.dockData, {enabled: false, mode: 'custom', customApp: 'org.example.app'}); sandbox.renderDock();
    assert.match(el('dockBody').innerHTML, /Only in the Vetro launcher/);
    sandbox.uiRules = []; sandbox.dockData = Object.assign({}, dock, {taskManager: false}); sandbox.renderUi();
    assert.match(el('uiOverview').innerHTML, /data-ui-tasks/);
    const sent = calls.length;
    await el('uiOverview').onchange({target: {dataset: {uiTasks: ''}, checked: true}}); await tick(8);
    assert.deepEqual(calls.slice(sent).find(c => c.url === '/dock' && c.body).body, {action: 'taskManager', on: true});
    // A part switched off in Vetro Shards says so.
    sandbox.dockData = null; sandbox.dockError = 'Vetro Launcher is not running'; sandbox.renderUi();
    assert.match(el('uiOverview').innerHTML, /Vetro Launcher is switched off in Vetro Shards\. Turn it on there to use this part\./);
    console.log('PASS Vetro UI page: one entry, overview switches, displays and their needs, conflict question, locked rows in the Remapper');
})().catch(e => { console.error(e); process.exit(1); });
