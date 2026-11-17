'use strict';
// The two web pages do no work that changes nothing: the dashboard reads only what the Quick settings tab on screen shows (and
// not twice in 30 s), writes a section only when its markup changed, keeps the launcher's preview while its switches redraw,
// and its timers stop while their page is not shown; the TV page moves the focus by changing two tile classes.
const assert = require('assert').strict, vm = require('vm'), fs = require('fs'), path = require('path');
const html = require('../service/dashboard.js')();
const tick = () => new Promise(r => setImmediate(r));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };

// ---- dashboard -------------------------------------------------------------------------------------------------------
const nodes = {}, writes = {};
function node(id) {
  const n = {id, value: '', hidden: true, textContent: '', disabled: false, focus() {}, setAttribute() {}, querySelectorAll: () => [], querySelector: () => null, _h: '', firstChild: {}};
  Object.defineProperty(n, 'innerHTML', {configurable: true, get() { return this._h; }, set(v) { writes[id] = (writes[id] || 0) + 1; this._h = v; this.firstChild = {}; }});
  return n;
}
// The launcher's box gets the shape the page relies on: the layout (preview + switches) and the Customization section.
function dockBox() {
  const n = node('dockBody');
  Object.defineProperty(n, 'innerHTML', {get() { return this._h; }, set(v) { writes.dockBody = (writes.dockBody || 0) + 1; this._h = v; this.firstChild = {lastChild: node('dockGroup')}; this.lastChild = node('dockLook'); }});
  return n;
}
const el = id => nodes[id] || (nodes[id] = id === 'dockBody' ? dockBox() : node(id));
const calls = [], intervals = [];
let failLeftovers = 0, dock = {installed: true, enabled: false, running: false, mode: 'off', entries: [{slug: 'netflix', label: 'Netflix', appId: 'org.tizen.netflix-app', system: false}], apps: null, log: ''};
const doc = {getElementById: el, querySelectorAll: s => { doc.asked.push(s); return []; }, querySelector: () => null, addEventListener() {}, hidden: false, asked: []};
const sandbox = {document: doc, console, setTimeout() { return 1; }, clearTimeout() {}, setInterval(f, ms) { intervals.push({f, ms}); return intervals.length; }, localStorage: {getItem: () => null, setItem() {}},
  fetch: async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : null; calls.push(url + (body ? ' POST' : '')); let data = {};
    if (url.startsWith('/apps')) data = {apps: [{appId: 'org.tizen.netflix-app', packageId: 'org.tizen.netflix-app', name: 'Netflix', show: true, disabled: false, area: 'other', role: 'optional'}], summary: {total: 1}, source: 'package registry + public probe'};
    else if (url === '/status') data = {agent: {connected: true}, mode: 'root', app: {version: '9.9.9'}};
    else if (url === '/leftovers' && failLeftovers-- > 0) return {ok: false, status: 500, json: async () => ({error: 'busy'})};
    else if (url === '/leftovers') data = {files: [], packageBytes: 0, storageBefore: {availableBytes: 1}, errors: [], extras: [], extraKinds: {}};
    else if (url === '/wins') data = {ts: 1, wins: {firmware: {status: 'off', value: 1}, multiscreen: {status: 'on'}, ambient: {status: 'off'}, telemetry: {status: 'off'}, airplay: {status: 'off'}}};
    else if (url === '/hbbtv') data = {value: 19, off: true, canRestore: true};
    else if (url === '/dns') data = {enabled: false, applied: false, domains: [], resolvers: []};
    else if (url === '/keep-removed') data = {enabled: false, packages: [], last: null, history: []};
    else if (url === '/pairing-mode') data = {enabled: true, mode: 'manual'};
    else if (url === '/sdb-access') data = {available: true, enabled: false, active: false};
    else if (url === '/quick/uninstall') data = {items: []};
    else if (url === '/factory-test') data = {active: false};
    else if (url === '/dock' && body) { dock = Object.assign({}, dock, body.action === 'fixTizenTube' ? {fixTizenTube: body.on} : {noMotion: body.on}); data = dock; }
    else if (url === '/dock') data = dock;
    else if (url === '/tuner') data = {installed: true, enabled: false};
    else if (url === '/input') data = {devices: [], status: {policy: {mode: 'off'}, events: []}};
    else if (url === '/remap') data = {rules: []};
    else if (url === '/plugins') data = {plugins: []};
    return {ok: true, json: async () => data};
  }};
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], sandbox);
const since = n => calls.slice(n).filter(u => u !== '/status');

(async () => {
  await settle();
  // At start (Quick settings, General): the factory banner and General's two reads, nothing of the other tabs, no shortcut list
  const QUICK = ['/factory-test', '/leftovers', '/wins', '/hbbtv', '/dns', '/keep-removed', '/pairing-mode', '/sdb-access', '/quick/uninstall'];
  assert.deepEqual(calls.filter(u => QUICK.includes(u)).sort(), ['/factory-test', '/leftovers', '/wins'], 'the first page reads only what General shows');
  assert.ok(!calls.includes('/remap'), 'the shortcut list is read by the Remapper and Home Assistant pages, not at start');
  // Each tab reads its own, once: what another tab read in the last 30 s is not asked again
  const tabs = [['privacy', ['/dns']], ['voice', []], ['memory', ['/hbbtv']], ['uninstall', ['/quick/uninstall', '/keep-removed']], ['developer', ['/pairing-mode', '/sdb-access']], ['general', []]];
  for (const [t, want] of tabs) { const n = calls.length; sandbox.showQuickTab(t); await settle(); assert.deepEqual(since(n).sort(), want.slice().sort(), 'the ' + t + ' tab reads ' + (want.join(' ') || 'nothing')); }
  let n = calls.length; sandbox.switchPanel('vetroui'); await settle(); n = calls.length; sandbox.switchPanel('quick'); await settle();
  assert.deepEqual(since(n), [], 'Quick settings opened again within 30 s asks the TV nothing');
  // Answers older than 30 s are read again; a failed read is read again at the next open
  Object.keys(sandbox.quickReadAt).forEach(k => { sandbox.quickReadAt[k] -= 31000; });
  failLeftovers = 1; n = calls.length; sandbox.switchPanel('quick'); await settle();
  assert.deepEqual(since(n).sort(), ['/factory-test', '/leftovers', '/wins'], 'old answers are read again');
  assert.match(el('quickStorage').innerHTML, /busy/, 'the failed read is said');
  n = calls.length; sandbox.switchPanel('quick'); await settle();
  assert.deepEqual(since(n), ['/leftovers'], 'only the failed read is asked again');
  // Restore forgets every answer: the tab on screen is read again at once
  n = calls.length; sandbox.loadQuick(true); await settle();
  assert.deepEqual(since(n).sort(), ['/factory-test', '/leftovers', '/wins']);

  // A section is written only when its markup changed
  const ids = ['quickStorage', 'quickControl', 'quickRestore', 'quickRemove', 'quickTracking', 'quickVoice', 'quickMemory', 'quickKeep', 'quickUninstall', 'quickPairing', 'quickSdb'];
  const count = () => Object.fromEntries(ids.map(id => [id, writes[id] || 0]));
  let w0 = count(); sandbox.renderQuick(); sandbox.renderPairingMode(); sandbox.renderSdbAccess(); await sandbox.loadWins(); await settle();
  assert.deepEqual(count(), w0, 'a redraw or a read that changes nothing writes no section');
  // A change or a click on a control inside a section makes its next redraw write it (the switch shows the state again)...
  sandbox.unpaint({type: 'change', target: {parentNode: el('quickMemory')}}); w0 = count(); sandbox.renderQuick();
  assert.deepEqual(Object.keys(count()).filter(k => count()[k] !== w0[k]), ['quickMemory'], 'only the section the user touched is written again');
  // ...opening a <details> (a click on its summary) does not: a background redraw leaves it open
  sandbox.unpaint({type: 'click', target: {closest: () => null, parentNode: el('quickMemory')}}); w0 = count(); sandbox.renderQuick();
  assert.deepEqual(count(), w0, 'a click outside the controls does not force a redraw');
  // A write by another path (textContent) is noticed: the next redraw writes again
  el('quickStorage').firstChild = {}; w0 = count(); sandbox.renderQuick(); assert.equal(count().quickStorage, w0.quickStorage + 1);

  // The launcher: the preview is drawn once; a busy switch redraws the switches beside it, not the pictures
  sandbox.switchPanel('vetroui'); await settle();
  const box = el('dockBody'), d0 = writes.dockBody;
  assert.ok(d0 >= 1 && /lp-tile/.test(box.innerHTML), 'the preview is drawn');
  const group = box.firstChild.lastChild, look = box.lastChild;
  await el('dock').onchange({target: {dataset: {dockFix: ''}, checked: true}}); await settle();
  assert.equal(writes.dockBody, d0, 'the switch, busy and done, did not draw the preview again');
  assert.ok((writes.dockGroup || 0) + (writes.dockLook || 0) >= 2 && /data-dock-fix checked/.test(look.innerHTML), 'the switches beside it are drawn with the new state');
  assert.equal(box.firstChild.lastChild, group, 'same layout');
  dock = Object.assign({}, dock, {entries: dock.entries.concat([{slug: 'youtube', label: 'YouTube', appId: 'yt', system: false}])});
  await sandbox.loadDock(); await settle();
  assert.equal(writes.dockBody, d0 + 1, 'a new app in the row draws the preview again');

  // Timers: the slideshows are looked at only on Vetro UI and while the page shows; the live countdown not while hidden
  const show = intervals.find(i => i.ms === 500), second = intervals.find(i => i.ms === 1000);
  sandbox.switchPanel('quick'); doc.asked = []; show.f(); assert.deepEqual(doc.asked, [], 'no slideshow work on another page');
  sandbox.switchPanel('vetroui'); doc.hidden = true; doc.asked = []; show.f(); assert.deepEqual(doc.asked, [], 'none while hidden');
  doc.hidden = false; show.f(); assert.deepEqual(doc.asked, ['.tshow'], 'on Vetro UI the slideshows move');
  sandbox.liveUntil = Date.now() + 60000; doc.hidden = true; el('sampleStatus').innerHTML = 'x'; const s0 = writes.sampleStatus; second.f();
  assert.equal(writes.sampleStatus, s0, 'the countdown is not drawn while the page is hidden');
  doc.hidden = false; second.f(); assert.equal(writes.sampleStatus, s0 + 1, 'and is drawn again when it shows');
  sandbox.liveUntil = 0;
  // The About photo is not in the markup: it is set when About opens
  assert.doesNotMatch(html, /<img[^>]*src="data:image\/jpeg/);

  await tvPage();
  console.log('PASS page performance: Quick reads per tab and 30 s reuse, unchanged sections not written, launcher preview kept, timers idle off-page and hidden, TV focus move changes two classes');
})().catch(e => { console.error(e); process.exitCode = 1; });

// ---- TV page ---------------------------------------------------------------------------------------------------------
async function tvPage() {
  const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const script = /<script>\s*([\s\S]*?)<\/script>/.exec(page)[1];
  const count = {screen: 0, tileHtml: 0, tileClass: 0, hero: 0, pin: 0};
  // #screen with the main view's shape: hero, key hints, five tiles, the diagnostics strip, the toast.
  const pin = {hidden: true, _h: ''};
  Object.defineProperty(pin, 'innerHTML', {get() { return this._h; }, set(v) { count.pin++; this._h = v; }});
  const mk = () => { const t = {_c: ''}; Object.defineProperty(t, 'className', {get() { return this._c; }, set(v) { count.tileClass++; this._c = v; }}); Object.defineProperty(t, 'innerHTML', {get() { return ''; }, set() { count.tileHtml++; }}); return t; };
  const screen = {className: '', _h: '', children: null, firstChild: null};
  Object.defineProperty(screen, 'innerHTML', {get() { return this._h; }, set(v) {
    count.screen++; this._h = v; this.firstChild = {};
    if (!/class="tiles"/.test(v)) { this.children = []; return; }
    const tiles = [...v.matchAll(/<div class="(tile(?: [a-z ]+)?)">/g)].map(m => { const t = mk(); t._c = m[1]; return t; });
    const hero = {}; Object.defineProperty(hero, 'outerHTML', {set() { count.hero++; }});
    const diag = {_c: /<div class="(diag[^"]*)">/.exec(v)[1], children: [{}, {innerHTML: ''}, {innerHTML: ''}]};
    Object.defineProperty(diag, 'className', {get() { return this._c; }, set(x) { this._c = x; }});
    this.children = [hero, {lastChild: {innerHTML: ''}}, {children: tiles}, diag, {}];
  }});
  const intervals = [], listeners = {}, sent = [];
  function XHR() {}
  XHR.prototype.open = function (m, u) { this.method = m; this.url = u; };
  XHR.prototype.setRequestHeader = function () {};
  XHR.prototype.send = function () {
    sent.push(this.url); this.status = 200;
    this.responseText = JSON.stringify(/\/auth\/pending$/.test(this.url) ? {code: null} : /\/screen\/controls$/.test(this.url) ? {canControl: true, tiles: {launcher: {state: 'on'}, ui: {state: 'off'}, ads: {state: 'on'}, voice: {state: 'off'}}, update: {configured: true}} : this.method === 'POST' ? {ok: true} :
      {version: '0.5.1', port: 8099, address: '192.168.1.42', root: {mode: 'tv-integration', connected: true}, input: {enabled: false}, launcher: {installed: true, enabled: true, running: true, failures: 0}, memory: {availableMb: 600}});
    this.onload();
  };
  const context = {
    document: {readyState: 'complete', getElementById: id => id === 'pin' ? pin : id === 'stage' ? {style: {}} : id === 'toast' ? {style: {}} : screen, hidden: false, addEventListener: (n, f) => { listeners[n] = f; }},
    window: {innerWidth: 1920, innerHeight: 1080, addEventListener() {}}, XMLHttpRequest: XHR, WebSocket: function () { setImmediate(() => this.onerror()); },
    fetch: async () => ({status: 200}), tizen: {application: {launch: (id, ok) => ok(), getAppsInfo: ok => ok([]), getCurrentApplication: () => ({exit() {}, appInfo: {version: '0.5.1'}})}, package: {getPackagesInfo: ok => ok([])}, systeminfo: {getPropertyValue: (n, ok) => ok({})}, tvinputdevice: {getSupportedKeys: () => []}},
    webapis: {productinfo: {getModel: () => 'QE55Q80A', getFirmware: () => '2310.0'}}, btoa: s => Buffer.from(s).toString('base64'),
    clearTimeout() {}, clearInterval() {}, setInterval: (f, ms) => { intervals.push({f, ms}); return intervals.length; }, setTimeout: (f, ms) => { if (ms === 1500) setImmediate(f); return 0; }
  };
  vm.runInNewContext(script, context);
  for (let i = 0; i < 60; i++) await tick();
  assert.ok(/class="tiles"/.test(screen.innerHTML), 'the tiles are on screen');
  const key = k => listeners.keydown({keyCode: k});
  const base = Object.assign({}, count), tiles = () => screen.children[2].children;
  key(39);
  assert.equal(count.screen, base.screen, 'Right writes no screen');
  assert.equal(count.tileHtml, base.tileHtml, 'and rebuilds no tile');
  assert.equal(count.tileClass - base.tileClass, 2, 'two tiles change class');
  assert.equal(count.hero, base.hero, 'the hero (logo, address) stays');
  assert.deepEqual(tiles().slice(0, 2).map(t => t.className), ['tile', 'tile focus'], 'the focus moved one tile right');
  key(39); key(39); key(39); key(40);
  assert.equal(count.screen, base.screen, 'down to the diagnostics strip: still no screen write');
  assert.match(screen.children[3].className, / focus$/, 'the strip has the focus');
  // The parts end where a full drawing would: draw it whole and compare the classes
  const now = tiles().map(t => t.className), strip = screen.children[3].className;
  context.mainDrawn = null; context.render(context.lastScreen, false);
  assert.equal(count.screen, base.screen + 1);
  assert.deepEqual([...screen.innerHTML.matchAll(/<div class="(tile(?: [a-z ]+)?)">/g)].map(m => m[1]), now, 'the tile classes equal a full drawing');
  assert.equal(/<div class="(diag[^"]*)">/.exec(screen.innerHTML)[1], strip);
  // The pairing check and the PIN countdown: nothing drawn when nothing changed, nothing done while hidden
  const poll = intervals.find(i => i.ms === 2000), pinTick = intervals.find(i => i.ms === 1000 && /paintPairing/.test(String(i.f)));
  const p0 = count.pin, x0 = sent.length; poll.f(); poll.f(); pinTick.f();
  assert.equal(count.pin, p0, 'no code waiting: the PIN slot is not written');
  context.document.hidden = true; poll.f(); pinTick.f();
  assert.equal(sent.length, x0 + 2, 'no pairing check while hidden');
  context.document.hidden = false;
}
