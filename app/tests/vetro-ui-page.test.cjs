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
                remap = Object.assign({}, remap, {reserved: (dock.volumePill ? [{code: '68', label: 'Vol +', owner: 'volume', name: 'Volume bar', live: true}] : []), interception: {auto: on, problem: null}});
            }
            if (body.action === 'volumeEdge') dock = Object.assign({}, dock, {volumeEdge: body.edge});
            if (body.action === 'cards') dock = Object.assign({}, dock, {cards: body.cards});
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
    assert.match(html, /<button data-tab="vetroui"[^>]*>[\s\S]*?Vetro UI<span class="chip nav-count">Preview<\/span><\/button>/);
    ['overview', 'launcher', 'tuner', 'osd'].forEach(t => assert.match(html, new RegExp('data-ui-tab="' + t + '"')));
    sandbox.switchPanel('osd'); await tick();
    assert.equal(sandbox.currentPanel, 'vetroui'); assert.equal(sandbox.uiTab, 'osd');
    assert.equal(el('uiPanel-osd').hidden, false); assert.equal(el('uiPanel-launcher').hidden, true);

    // The overview: one switch per part, and how they work together.
    sandbox.showUiTab('overview'); sandbox.renderUi();
    let over = el('uiOverview').innerHTML;
    ['data-ui-launcher', 'data-ui-tuner', 'data-ui-osd="volumePill"', 'data-ui-osd="numberPad"'].forEach(a => assert.ok(over.includes(a), 'overview switch: ' + a));
    assert.match(over, /The Home key opens the Vetro launcher/);
    assert.match(over, /drawn by the launcher/); assert.match(over, /which Vetro UI turns on for you/); assert.match(over, /Vetro UI comes first/);
    // The slideshow beside the switches: the launcher rising, the guide scrolling, the bar, the pad, the task manager.
    assert.match(over, /data-show="overview"/); assert.equal((over.match(/class="tuner-shot tshow-slide/g) || []).length, 5);
    assert.match(over, /class="lp[^"]* lp-rise"/); assert.match(over, /Up opens Sources/); assert.match(over, /Up, while watching live TV/); assert.match(over, /class="tg-scroll"/); assert.match(over, /tshow-slide is-on/);
    assert.match(over, /data-show-pause aria-pressed="false"/);

    // The displays: what they need, their switches, the bar's position and a preview that follows it.
    let osd = el('osd').innerHTML;
    assert.match(osd, /Drawn by the Vetro launcher\./);
    assert.match(osd, /The remote interception is off/);
    assert.match(osd, /data-osd="volumePill"/); assert.match(osd, /data-osd-edge/);
    assert.match(osd, /aria-label="The volume bar on the left edge/);
    assert.doesNotMatch(el('dockBody').innerHTML, /Volume bar|Number pad/, 'no longer on the Launcher tab');
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
    assert.match(sandbox.operationEntries[0].message, /Volume bar on\./);

    // The pad has no conflict: no question.
    await el('osd').onchange({target: {dataset: {osd: 'numberPad'}, checked: true}}); await tick(8);
    assert.deepEqual(calls.filter(c => c.url === '/dock' && c.body).pop().body, {action: 'numberPad', on: true});
    // The position moves the preview.
    await el('osd').onchange({target: {dataset: {osdEdge: ''}, value: 'bottom'}}); await tick(8);
    assert.deepEqual(calls.filter(c => c.url === '/dock' && c.body).pop().body, {action: 'volumeEdge', edge: 'bottom'});
    assert.match(el('osd').innerHTML, /aria-label="The volume bar on the bottom edge/);

    // With Samsung's Home on the Home key the displays say they do nothing, and where to choose a launcher.
    sandbox.dockData = Object.assign({}, dock, {enabled: false, mode: 'off'}); sandbox.renderOsd();
    assert.match(el('osd').innerHTML, /Turn on a launcher to use these displays/); assert.match(el('osd').innerHTML, /data-ui-open="launcher"/);
    sandbox.dockData = dock;

    // The sound output under the Volume bar: nothing on the TV speakers, one muted sentence otherwise; a receiver and the optical outputs
    // get Vol from Samsung (S95C, S90D, S90F 2026-11-20), so there is no warning any more.
    const osdWith = (audioOutput, extra) => { sandbox.osdShowKey = null; sandbox.dockData = Object.assign({}, dock, extra || {}, {audioOutput}); sandbox.renderOsd(); return el('osd').innerHTML; };
    assert.doesNotMatch(osdWith({selection: 0, extVolume: 0, mbr: true}), /data-audio-note/);
    assert.doesNotMatch(osdWith(null), /data-audio-note/);
    assert.match(osdWith({selection: 2, extVolume: 0, mbr: true}), /<p class="notice" data-audio-note>Sound goes to a receiver or soundbar on HDMI\. Vol and Mute pass to it through Samsung/);
    assert.match(osdWith({selection: 1, extVolume: -1, mbr: true}, {volumePill: true}), /<p class="notice" data-audio-note>Sound goes to the optical output\. Vol and Mute pass to Samsung, which drives the soundbar/);
    assert.doesNotMatch(osdWith({selection: 1, extVolume: -1, mbr: true}, {volumePill: true}), /quick-callout" data-audio-note/, 'no amber: Vetro no longer holds Vol there');
    assert.match(osdWith({selection: 9, extVolume: 0, mbr: false}), /Sound plays on the TV and the optical output\. Vol and Mute pass to Samsung/);
    assert.match(osdWith({selection: 4, extVolume: 0, mbr: false}), /whether a Wi-Fi speaker follows it has not been tried/);
    assert.match(osdWith({selection: 5, extVolume: 0, mbr: false}), /<p class="notice" data-audio-note>Sound goes to Bluetooth headphones or a speaker\. Vol and Mute pass to Samsung, which sets the level of the Bluetooth device/);
    sandbox.osdShowKey = null; sandbox.dockData = dock;

    // The Remapper lists the keys Vetro UI holds, locked, first; the user's shortcut on the same key says it is overridden.
    sandbox.switchPanel('remote'); await tick(8);
    const list = el('rules').innerHTML;
    assert.match(list, /rule-locked[^>]*data-held="68"[\s\S]*aria-label="Locked"[\s\S]*Volume bar[\s\S]*Vetro UI/);
    assert.ok(list.indexOf('rule-locked') < list.indexOf('data-delete'), 'the locked rows come first');
    assert.doesNotMatch(list.slice(0, list.indexOf('data-delete')), /data-delete="68"/, 'a locked row cannot be deleted');
    assert.match(list, /Overridden by Vetro UI/);
    // A new shortcut on a held key asks first.
    el('inputCode').value = '68'; el('targetApp').value = 'org.example.other'; answer = false;
    await el('saveRule').onclick(); await tick();
    assert.match(confirms.pop(), /Key 68 \(Vol \+\) is used by Vetro UI \(Volume bar\)/);
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
    assert.match(el('dockBody').innerHTML, /One of your shortcuts stops running\.<\/strong> Key Vol \+ \(68\) opens org\.example\.app: the volume bar is on/);
    sandbox.dockConfirm = false; sandbox.dockData = Object.assign({}, dock, {enabled: true, mode: 'vetro'}); sandbox.renderDock();
    // A shortcut on a tuner key: the Live TV tab says the tuner never gets it, the Remapper marks it.
    sandbox.tunerData = Object.assign({}, tuner, {enabled: true, running: true}); sandbox.renderTuner();
    assert.match(el('tunerBody').innerHTML, /A shortcut of yours uses a key of the tuner: CH \+ \(88\) opens org\.example\.ch\. While the remote interception is on, that key goes to the shortcut/);
    sandbox.remapTuner = true; sandbox.rules = sandbox.uiRules; sandbox.reservedKeys = [{code: '68', label: 'Vol +', owner: 'volume', name: 'Volume bar', live: false}]; sandbox.showRules();
    assert.match(el('rules').innerHTML, /Live TV does not get CH \+/);
    assert.doesNotMatch(el('rules').innerHTML, /Overridden by Vetro UI/, 'a held key that waits for a launcher does not override anything yet');
    // The Control center: one switch per card on the Launcher tab, one for the whole in the overview, the hint under the bar in the preview,
    // the panel's preview, and a note when a shortcut of the user's holds Down or OK. An older service's Task manager switch reads as that card.
    sandbox.dockData = Object.assign({}, dock, {enabled: true, mode: 'vetro', taskManager: false, cards: [], cardChoices: ['tasks', 'audio'], maxCards: 3}); sandbox.renderDock();
    let launcher = el('dockBody').innerHTML, cards = el('dockCards').innerHTML;
    assert.match(cards, /data-quick-item="control-center"/); assert.match(cards, /data-dock-card="tasks"/); assert.match(cards, /data-dock-card="audio"/); assert.match(cards, /By zabique/);
    assert.doesNotMatch(launcher, /data-dock-card|data-quick-item="control-center"/, 'the Control center has its own sub-tab, apart from the customization');
    assert.doesNotMatch(launcher, /lp-hint-below/, 'off: the bar has no hint under it');
    assert.match(cards, /aria-label="The launcher’s Control center/);
    sandbox.dockData = Object.assign({}, sandbox.dockData, {taskManager: true, cards: ['tasks']}); sandbox.renderDock();
    launcher = el('dockBody').innerHTML;
    assert.match(launcher, /class="lp lp-tasks"/); assert.match(launcher, /Task manager ˅/, 'one card: its own name under the bar');
    sandbox.dockData = Object.assign({}, sandbox.dockData, {cards: ['tasks', 'audio']}); sandbox.renderDock();
    assert.match(el('dockBody').innerHTML, /Control center ˅/, 'two cards: Control center under the bar');
    assert.deepEqual(Array.from(sandbox.cardsWith({cards: ['audio'], cardChoices: ['tasks', 'audio']}, 'tasks', true)), ['audio', 'tasks'], 'a card turned on joins on the right, keeping existing order');
    assert.deepEqual(Array.from(sandbox.cardsWith({cards: ['tasks', 'audio'], cardChoices: ['tasks', 'audio']}, 'tasks', false)), ['audio'], 'and off leaves the others');
    assert.deepEqual(Array.from(sandbox.cardsWith({cards: ['picture', 'sleep', 'tasks'], cardChoices: ['tasks', 'audio', 'picture', 'sleep']}, 'sleep', false)), ['picture', 'tasks'], 'toggling off preserves custom order');
    assert.deepEqual(Array.from(sandbox.cardsWith({cards: ['picture', 'sleep'], cardChoices: ['tasks', 'audio', 'picture', 'sleep']}, 'tasks', true)), ['picture', 'sleep', 'tasks'], 'toggling on preserves custom order');
    assert.deepEqual(Array.from(sandbox.cardsReorder(['tasks', 'picture', 'sleep'], 'tasks', 'sleep')), ['picture', 'sleep', 'tasks'], 'dragging tasks to sleep moves it to the end in one step');
    assert.deepEqual(Array.from(sandbox.cardsReorder(['tasks', 'picture', 'sleep'], 'picture', 'tasks')), ['picture', 'tasks', 'sleep'], 'dragging picture to tasks moves it to the front');
    assert.deepEqual(Array.from(sandbox.cardsReorder(['tasks', 'picture', 'sleep'], 'picture', 'picture')), ['tasks', 'picture', 'sleep'], 'same-card drop is a no-op');
    assert.deepEqual(Array.from(sandbox.cardsReorder(['tasks', 'picture', 'sleep'], 'audio', 'sleep')), ['tasks', 'picture', 'sleep'], 'missing card is a no-op');
    assert.deepEqual(Array.from(sandbox.cardsReorder(['picture', 'shard:home-assistant'], 'shard:home-assistant', 'picture')), ['shard:home-assistant', 'picture'], 'Shard cards reorder cleanly');
    assert.deepEqual(Array.from(sandbox.dockCards({taskManager: true})), ['tasks'], 'an older service: the Task manager switch is that card');
    // A Shard's card: a switch of its own, named by the Shard, off until chosen; a saved one whose Shard is off is shown as paused (and keeps the choice).
    const ha = {cardShards: {'shard:home-assistant': 'Home Assistant'}, cardChoices: ['tasks', 'audio', 'picture', 'sleep', 'shard:home-assistant']};
    sandbox.dockData = Object.assign({}, dock, ha, {enabled: true, mode: 'vetro', cards: ['tasks'], maxCards: 3, cardsPaused: []}); sandbox.renderDock();
    assert.match(el('dockCards').innerHTML, /data-quick-item="card-shard:home-assistant"[\s\S]*Home Assistant[\s\S]*A Shard adds this card[\s\S]*data-dock-card="shard:home-assistant"/);
    assert.deepEqual(Array.from(sandbox.cardsWith(sandbox.dockData, 'shard:home-assistant', true)), ['tasks', 'shard:home-assistant'], 'turned on, it joins the others');
    sandbox.dockData = Object.assign({}, sandbox.dockData, {cards: ['tasks', 'shard:home-assistant']}); sandbox.renderDock();
    assert.match(el('dockBody').innerHTML, /Control center ˅/);
    sandbox.dockData = Object.assign({}, sandbox.dockData, {cards: ['shard:home-assistant']}); sandbox.renderDock();
    assert.match(el('dockBody').innerHTML, /Home Assistant ˅/, 'one card: the Shard\'s label under the bar');
    sandbox.dockData = Object.assign({}, dock, {enabled: true, mode: 'vetro', cards: ['tasks'], cardChoices: ['tasks', 'audio', 'picture', 'sleep'], cardShards: {}, maxCards: 3,
        cardsPaused: [{card: 'shard:home-assistant', label: 'Home Assistant', why: 'The Shard is switched off'}]}); sandbox.renderDock();
    assert.match(el('dockCards').innerHTML, /card-paused-shard:home-assistant[\s\S]*Home Assistant[\s\S]*The Shard is switched off\. Your choice is kept[\s\S]*Paused/);
    assert.doesNotMatch(el('dockCards').innerHTML, /data-dock-card="shard:home-assistant"/, 'no switch for a card that is not there');
    sandbox.dockData = Object.assign({}, sandbox.dockData, {cards: ['tasks', 'audio'], cardsPaused: []}); sandbox.renderDock();
    sandbox.uiRules = [{id: 'physical_108', enabled: true, trigger: {type: 'physical', value: '108'}, actions: [{type: 'launch', appId: 'org.example.down'}]}]; sandbox.renderDock();
    assert.match(el('dockCards').innerHTML, /A shortcut of yours uses Key Down \(108\) opens org\.example\.down\. While the remote interception is on, the launcher never gets that key/);
    sandbox.dockData = Object.assign({}, sandbox.dockData, {enabled: false, mode: 'custom', customApp: 'org.example.app'}); sandbox.renderDock();
    assert.match(el('dockCards').innerHTML, /Only in the Vetro launcher/);
    sandbox.uiRules = []; sandbox.dockData = Object.assign({}, dock, {taskManager: false, cards: []}); sandbox.renderUi();
    assert.match(el('uiOverview').innerHTML, /data-ui-tasks/);
    const sent = calls.length;
    await el('uiOverview').onchange({target: {dataset: {uiTasks: ''}, checked: true}}); await tick(8);
    assert.deepEqual(calls.slice(sent).find(c => c.url === '/dock' && c.body).body, {action: 'cards', cards: Array.from(sandbox.rememberedCards())}, 'on brings back the cards that were chosen');
    sandbox.dockCards({cards: ['audio', 'tasks']});
    assert.deepEqual(Array.from(sandbox.rememberedCards()), ['audio', 'tasks'], 'the last choice is remembered, in its order');
    sandbox.dockCards({cards: []});
    assert.deepEqual(Array.from(sandbox.rememberedCards()), ['audio', 'tasks'], 'switching the Control center off does not forget it');
    // Horizontal drag-and-drop, mobile long-press touch drag, tap/keyboard fallback, and explicit Apply/Cancel confirmation.
    dock = sandbox.dockData = Object.assign({}, dock, {enabled: true, mode: 'vetro', cards: ['tasks'], cardChoices: ['tasks', 'audio', 'picture', 'sleep'], maxCards: 3, cardsPaused: []});
    sandbox.renderDock();
    assert.doesNotMatch(el('dockCards').innerHTML, /data-dock-slot|data-dock-cards-apply|cardOrderLabel/, 'one active card shows no order strip, hint, or Apply button');
    dock = sandbox.dockData = Object.assign({}, dock, {cards: ['tasks', 'picture', 'sleep']});
    sandbox.renderDock();
    cards = el('dockCards').innerHTML;
    assert.match(cards, /id="cardOrderLabel">Card order — drag to reorder, or hold and drag on touch\.<\/p>/, 'short muted hint sits above the order strip');
    assert.ok(cards.indexOf('data-dock-slot="tasks"') < cards.indexOf('data-dock-slot="picture"')
        && cards.indexOf('data-dock-slot="picture"') < cards.indexOf('data-dock-slot="sleep"'), 'slots appear in left-to-right screen order');
    assert.doesNotMatch(cards, /data-dock-cards-apply|data-dock-cards-cancel|Order changed/, 'no Apply/Cancel or pending chip until order changes');

    // Desktop drag-and-drop: local draft only, zero requests until Apply order is clicked.
    const sentBeforeDrag = calls.length;
    el('dock').ondragstart({target: {closest: () => ({dataset: {dockSlot: 'tasks'}, classList: {add() {}, remove() {}}})}, dataTransfer: {setData() {}}});
    el('dock').ondragover({target: {closest: () => ({dataset: {dockSlot: 'sleep'}, classList: {add() {}, remove() {}}})}, dataTransfer: {}, preventDefault() {}});
    el('dock').ondrop({target: {closest: () => ({dataset: {dockSlot: 'sleep'}, classList: {add() {}, remove() {}}})}, preventDefault() {}});
    el('dock').ondragend({});
    assert.equal(calls.length, sentBeforeDrag, 'drag-and-drop does not send a request before confirmation');
    cards = el('dockCards').innerHTML;
    assert.ok(cards.indexOf('data-dock-slot="picture"') < cards.indexOf('data-dock-slot="sleep"')
        && cards.indexOf('data-dock-slot="sleep"') < cards.indexOf('data-dock-slot="tasks"'), 'preview strip shows picture, sleep, tasks immediately');
    assert.match(cards, /Order changed/);
    assert.match(cards, /data-dock-cards-apply/);
    assert.match(cards, /data-dock-cards-cancel/);

    // Cancel reverts draft cleanly with zero requests.
    await el('dock').onclick({target: {closest: () => ({dataset: {dockCardsCancel: ''}})}});
    assert.equal(calls.length, sentBeforeDrag, 'Cancel sends nothing');
    cards = el('dockCards').innerHTML;
    assert.ok(cards.indexOf('data-dock-slot="tasks"') < cards.indexOf('data-dock-slot="picture"')
        && cards.indexOf('data-dock-slot="picture"') < cards.indexOf('data-dock-slot="sleep"'));
    assert.doesNotMatch(cards, /data-dock-cards-apply|Order changed/);

    // Tap/click two cards to reorder locally, and cancel selection with Escape.
    await el('dock').onclick({target: {closest: () => ({dataset: {dockSlot: 'tasks'}})}});
    assert.match(el('dockCards').innerHTML, /data-dock-slot="tasks" aria-pressed="true"/);
    el('dock').onkeydown({target: {closest: () => ({dataset: {dockSlot: 'tasks'}})}, key: 'ArrowRight', preventDefault() {}});
    cards = el('dockCards').innerHTML;
    assert.ok(cards.indexOf('data-dock-slot="picture"') < cards.indexOf('data-dock-slot="tasks"'), 'ArrowRight shifts picked card right in draft');
    el('dock').onkeydown({target: {closest: () => ({dataset: {dockSlot: 'tasks'}})}, key: 'Escape'});
    assert.doesNotMatch(el('dockCards').innerHTML, /aria-pressed="true"/, 'Escape clears active pick');
    await el('dock').onclick({target: {closest: () => ({dataset: {dockCardsCancel: ''}})}});

    // Mobile long-press-to-grab + drag: hold timer arms drag, then dragging over target slot updates draft on touchend; moving >10px before hold cancels.
    let scheduledTimer = null;
    const origSetTimeout = sandbox.setTimeout;
    sandbox.setTimeout = (fn) => { scheduledTimer = fn; return 42; };
    const mkSlot = (name) => ({dataset: {dockSlot: name}, disabled: false, style: {transform: ''}, classList: {add() {}, remove() {}}});
    const touchTasks = mkSlot('tasks'), touchSleep = mkSlot('sleep');
    sandbox.document.elementFromPoint = () => ({closest: s => s === '[data-dock-slot]' ? touchSleep : null});
    el('dock').ontouchstart({touches: [{clientX: 10, clientY: 10}], target: {closest: () => touchTasks}});
    assert.equal(typeof scheduledTimer, 'function', 'hold timer armed on touchstart');
    scheduledTimer();
    let touchPrevented = false;
    el('dock').ontouchmove({touches: [{clientX: 120, clientY: 12}], preventDefault() { touchPrevented = true; }});
    assert.equal(touchPrevented, true, 'touchmove prevents page scroll while dragging grabbed card');
    el('dock').ontouchend({});
    assert.equal(calls.length, sentBeforeDrag, 'touch drag stages draft without immediate request');
    cards = el('dockCards').innerHTML;
    assert.ok(cards.indexOf('data-dock-slot="picture"') < cards.indexOf('data-dock-slot="sleep"')
        && cards.indexOf('data-dock-slot="sleep"') < cards.indexOf('data-dock-slot="tasks"'));
    // Moving >10 px before hold timer fires treats gesture as normal scroll (cancels grab).
    scheduledTimer = null;
    el('dock').ontouchstart({touches: [{clientX: 10, clientY: 10}], target: {closest: () => mkSlot('picture')}});
    el('dock').ontouchmove({touches: [{clientX: 10, clientY: 40}], preventDefault() {}});
    el('dock').ontouchend({});
    sandbox.setTimeout = origSetTimeout;
    delete sandbox.document.elementFromPoint;

    // Apply sends ONE /dock cards call, hides Apply/Cancel, and updates rememberedCards & Session history.
    await el('dock').onclick({target: {closest: () => ({dataset: {dockCardsApply: ''}})}}); await tick(8);
    assert.deepEqual(calls.filter(c => c.url === '/dock' && c.body).pop().body, {action: 'cards', cards: ['picture', 'sleep', 'tasks']});
    assert.deepEqual(Array.from(sandbox.rememberedCards()), ['picture', 'sleep', 'tasks']);
    assert.doesNotMatch(el('dockCards').innerHTML, /data-dock-cards-apply|Order changed/);
    assert.match(sandbox.operationEntries[0].message, /Control center: Picture mode, Sleep timer, Task manager/);

    // Shard card drag-and-drop + Apply works cleanly too.
    dock = sandbox.dockData = Object.assign({}, dock, ha, {cards: ['picture', 'shard:home-assistant']});
    sandbox.renderDock();
    el('dock').ondragstart({target: {closest: () => ({dataset: {dockSlot: 'shard:home-assistant'}, classList: {add() {}, remove() {}}})}, dataTransfer: {setData() {}}});
    el('dock').ondrop({target: {closest: () => ({dataset: {dockSlot: 'picture'}, classList: {add() {}, remove() {}}})}, preventDefault() {}});
    await el('dock').onclick({target: {closest: () => ({dataset: {dockCardsApply: ''}})}}); await tick(8);
    assert.deepEqual(calls.filter(c => c.url === '/dock' && c.body).pop().body, {action: 'cards', cards: ['shard:home-assistant', 'picture']});
    // A part switched off in Vetro Shards says so.
    sandbox.dockData = null; sandbox.dockError = 'Vetro Launcher is not running'; sandbox.renderUi();
    assert.match(el('uiOverview').innerHTML, /Vetro Launcher is switched off in Vetro Shards\. Turn it on there to use this part\./);
    console.log('PASS Vetro UI page: one entry, overview switches, displays and their needs, conflict question, locked rows in the Remapper');
})().catch(e => { console.error(e); process.exit(1); });
