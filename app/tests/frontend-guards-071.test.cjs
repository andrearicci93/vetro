'use strict';
// Regression tests for Wave 2B PR-F (0.7.1): dashboard error/credential/a11y/perf guards,
// TV probe Voice Guide ARIA + roving tabindex, and SVG 1.1 xlink:href compatibility.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const tick = (n = 4) => new Promise(r => {
    let i = 0;
    (function next() { if (++i > n) r(); else setImmediate(next); })();
});

function createNode(id) {
    const attrs = {};
    const node = {
        id: id || '',
        value: '',
        checked: false,
        disabled: false,
        hidden: true,
        textContent: '',
        innerHTML: '',
        className: '',
        dataset: {},
        style: {},
        offsetTop: 0,
        offsetHeight: 0,
        children: [],
        focusedCount: 0,
        focus() { node.focusedCount++; },
        setAttribute(k, v) { attrs[k] = String(v); },
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
        removeAttribute(k) { delete attrs[k]; },
        querySelectorAll() { return []; },
        querySelector() { return null; },
        contains() { return false; }
    };
    return node;
}

function loadDashboard(options) {
    const opts = options || {};
    const html = require('../service/dashboard.js')();
    const nodes = {};
    const fetchCalls = [];
    const windowListeners = {};
    const intervals = [];
    const el = id => nodes[id] || (nodes[id] = createNode(id));

    const sandbox = {
        window: {
            addEventListener(ev, fn) { windowListeners[ev] = fn; },
            matchMedia(q) {
                return {
                    matches: !!(opts.reducedMotion && q === '(prefers-reduced-motion: reduce)'),
                    media: q
                };
            }
        },
        document: {
            getElementById: id => el(id),
            querySelectorAll: () => [],
            querySelector: s => el('q:' + s),
            body: {classList: {contains: () => false, toggle() {}}},
            addEventListener() {},
            activeElement: null,
            hidden: false
        },
        setInterval(fn, ms) { intervals.push({fn, ms}); return intervals.length; },
        setTimeout(fn) { return 1; },
        clearTimeout() {},
        clearInterval() {},
        AbortController,
        console,
        confirm: () => true,
        fetch: async (url, fetchOpts) => {
            fetchCalls.push({url, opts: fetchOpts || {}});
            if (opts.failUrls && opts.failUrls.has(url)) {
                throw new Error('simulated network failure for ' + url);
            }
            let d = {};
            if (opts.responses && opts.responses[url] !== undefined) {
                d = opts.responses[url];
            } else if (url === '/status') {
                d = {agent: {connected: true}, mode: 'tv-integration'};
            } else if (url.startsWith('/apps')) {
                d = {apps: [], summary: {total: 0}};
            } else if (url === '/remap') {
                d = {rules: []};
            } else if (url === '/input') {
                d = {devices: [], status: {policy: {mode: 'off'}, events: []}};
            } else if (url.startsWith('/monitor')) {
                d = {ts: Date.now(), memory: {}, cpu: {cores: []}, processes: [], network: []};
            } else if (url === '/wins') {
                d = {wins: {}};
            }
            return {ok: true, json: async () => d};
        }
    };

    vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], sandbox);
    return {html, sandbox, nodes, el, fetchCalls, windowListeners};
}

let finished = false;
process.on('exit', code => {
    if (code === 0 && !finished) {
        console.error('FAIL frontend-guards-071 exited before async checks finished');
        process.exit(1);
    }
});

(async () => {
    // 1. Dashboard CSS optimization (defer-rendering-heavy-content with contain-intrinsic-size)
    const dashHtml = require('../service/dashboard.js')();
    assert.match(
        dashHtml,
        /\.app-table tbody tr:nth-child\(n\+25\)[^}]*content-visibility:\s*auto;\s*contain-intrinsic-size:\s*auto none auto 2\.75rem/,
        'below-the-fold app rows defer rendering with content-visibility and contain-intrinsic-size'
    );
    console.log('PASS dashboard CSS defers below-the-fold rows with content-visibility + contain-intrinsic-size');

    // 2. winPartial null/missing payload guards
    const d1 = loadDashboard();
    await tick();
    assert.equal(d1.sandbox.winPartial('telemetry', {}), 'some services started again');
    assert.equal(d1.sandbox.winPartial('telemetry', null), 'some services started again');
    assert.equal(d1.sandbox.winPartial('telemetry', {running: 1}), '1 service started again');
    assert.equal(d1.sandbox.winPartial('telemetry', {running: 3}), '3 services started again');
    assert.equal(d1.sandbox.winPartial('firmware', {}), 'some update services are still reachable');
    assert.equal(d1.sandbox.winPartial('firmware', null), 'some update services are still reachable');
    assert.equal(d1.sandbox.winPartial('firmware', {masked: 2, units: 4}), '2 of 4 update services blocked');
    assert.equal(d1.sandbox.winPartial('firmware', {masked: 0, units: 3, value: 0}), 'no update service blocked, Auto update is off');
    console.log('PASS winPartial handles missing/empty telemetry and firmware fields safely');

    // 3. Same-origin credentials on api(), pagehide, and all direct local fetches (not cross-origin GitHub fetches)
    d1.fetchCalls.length = 0;
    await d1.sandbox.api('/status');
    assert.equal(d1.fetchCalls.length, 1);
    assert.equal(d1.fetchCalls[0].opts.credentials, 'same-origin');

    assert.equal(typeof d1.windowListeners.pagehide, 'function', 'pagehide listener is registered on window');
    d1.fetchCalls.length = 0;
    d1.sandbox.inputListening = true;
    d1.windowListeners.pagehide();
    assert.equal(d1.fetchCalls.length, 1);
    assert.equal(d1.fetchCalls[0].url, '/input');
    assert.equal(d1.fetchCalls[0].opts.method, 'POST');
    assert.equal(d1.fetchCalls[0].opts.credentials, 'same-origin');
    assert.equal(d1.fetchCalls[0].opts.keepalive, true);
    for (const [label, re] of [
        ['/diagnostics/download', /fetch\('\/diagnostics\/download'[^;]*credentials:'same-origin'/],
        ['/quick/uninstall', /fetch\('\/quick\/uninstall',\{[^}]*credentials:'same-origin'/],
        ['/plugins/install', /fetch\('\/plugins\/install',\{[^}]*credentials:'same-origin'/],
        ['/status waitForVersion', /fetch\('\/status',\{[^}]*credentials:'same-origin'/],
        ['/update/apply', /fetch\('\/update\/apply',\{[^}]*credentials:'same-origin'/]
    ]) {
        assert.match(dashHtml, re, label + ' fetch includes credentials: same-origin');
    }
    assert.doesNotMatch(dashHtml, /fetch\(url,\{[^}]*credentials:/, 'cross-origin fetches do not force credentials');
    console.log('PASS api(), pagehide, and all direct local fetches include credentials: same-origin');

    // 4. loadWins() /status failure leaves quickData.winsError === null and quickData.root === false
    const dErr = loadDashboard({failUrls: new Set(['/status'])});
    await tick();
    dErr.sandbox.quickData.root = false;
    dErr.sandbox.quickData.winsError = 'stale-error';
    await dErr.sandbox.loadWins();
    assert.equal(dErr.sandbox.quickData.root, false);
    assert.equal(dErr.sandbox.quickData.winsError, null, 'loadWins catches /status failure and keeps quickData.winsError === null');
    console.log('PASS loadWins catches /status failure and leaves quickData.winsError === null');

    // 5. drawMonitor summary preserves #topProcesses after a full process sample
    const sampleProc = {pid: 42, name: 'netflix', cpuPercent: 12.5, rssBytes: 10485760, state: 'S', threads: 2};
    d1.sandbox.drawMonitor({ts: Date.now(), memory: {}, cpu: {cores: []}, network: [], processes: [sampleProc], processCount: 1});
    const fullTopHtml = d1.el('topProcesses').innerHTML;
    assert.ok(fullTopHtml.length > 0 && fullTopHtml.includes('netflix'), 'full sample populates #topProcesses');
    d1.sandbox.drawMonitor({ts: Date.now(), scope: 'summary', memory: {}, cpu: {cores: []}, network: []});
    assert.equal(d1.el('topProcesses').innerHTML, fullTopHtml, 'summary sample preserves #topProcesses once full sample exists');
    console.log('PASS drawMonitor summary preserves cached #topProcesses after full sample');

    // 6. Reduced-motion media query defaults tuner slideshow and showreel() to paused: true
    assert.equal(d1.sandbox.showState.tuner.paused, false, 'default showState.tuner is unpaused when reduced-motion is off');
    const dReduced = loadDashboard({reducedMotion: true});
    await tick();
    assert.equal(dReduced.sandbox.showState.tuner.paused, true, 'showState.tuner defaults to paused under prefers-reduced-motion: reduce');
    dReduced.sandbox.showreel('reduced-demo', [{title: 'Banner', keys: 'OK', text: 'desc', svg: '<svg/>'}], 'Demo');
    assert.equal(dReduced.sandbox.showState['reduced-demo'].paused, true, 'showreel() starts paused under prefers-reduced-motion: reduce');
    console.log('PASS tuner slideshow and showreel() start paused under prefers-reduced-motion: reduce');

    // 7. app/index.html ARIA roles/states + roving tabindex + moveTo().focus()
    const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const indexScript = /<script>\s*([\s\S]*?)<\/script>/.exec(indexHtml)[1];
    const indexNodes = {};
    const indexEl = id => indexNodes[id] || (indexNodes[id] = createNode(id));

    const tilesContainer = createNode('tiles');
    const makeTileNode = i => {
        const tile = createNode('tile-' + i);
        tile.setAttribute('tabindex', i === 0 ? '0' : '-1');
        const top = createNode('top');
        top.children = [createNode('glyph'), createNode('tag')];
        const foot = createNode('foot');
        foot.children = [createNode('sw'), createNode('val')];
        tile.children = [top, createNode('h3'), createNode('p'), foot];
        tile.querySelector = s => s === '.top' ? top : s === '.tag' ? top.children[1] : s === '.foot' ? foot : s === '.sw' || s === '.btn' ? foot.children[0] : s === '.val' ? foot.children[1] : createNode('q:' + s);
        return tile;
    };
    const tileChildren = [0, 1, 2, 3, 4].map(makeTileNode);
    tilesContainer.children = tileChildren;
    const diagNode = createNode('diag');
    diagNode.setAttribute('tabindex', '-1');
    const chips = createNode('chips');
    chips.children = [0, 1, 2, 3, 4, 5].map(() => {
        const chip = createNode('chip');
        chip.children = [createNode('dot'), createNode('b')];
        return chip;
    });
    diagNode.children = [createNode('h4'), chips, createNode('more')];
    diagNode.querySelector = s => s === '.chips' ? chips : createNode('q:' + s);

    const heroNode = createNode('hero');
    const secNode = createNode('sec');
    secNode.lastChild = createNode('sec-span');
    const toastNode = createNode('toast');
    const scr = indexEl('screen');
    scr.firstChild = heroNode;
    scr.children = [heroNode, secNode, tilesContainer, diagNode, toastNode];
    scr.querySelector = sel => {
        if (sel === '.tiles') return tilesContainer;
        if (sel === '.diag') return diagNode;
        return createNode('q:' + sel);
    };

    const indexSandbox = {
        window: {innerWidth: 1920, innerHeight: 1080, addEventListener() {}},
        document: {
            readyState: 'loading',
            getElementById: indexEl,
            addEventListener() {}
        },
        XMLHttpRequest: function () {
            this.open = function () {};
            this.setRequestHeader = function () {};
            this.send = function () {};
        },
        navigator: {},
        location: {href: 'file:///index.html'},
        console,
        setTimeout() { return 1; },
        clearTimeout() {},
        setInterval() { return 1; },
        clearInterval() {},
        Math, Date, JSON, Promise, String, Number, Array, Object, Error
    };

    vm.runInNewContext(indexScript, indexSandbox);
    indexSandbox.report = {settings: {model: 'QE55Q80A', firmware: 'T-NKM2DEUC-2310.0'}, probe: {}, apps: [], packages: []};
    indexSandbox.controls = {
        canControl: true,
        tiles: {
            launcher: {state: 'on', custom: false},
            ui: {state: 'off'},
            ads: {state: 'part', left: 2},
            voice: {state: 'na', why: 'Not available on this TV'}
        },
        update: {configured: true, version: '0.7.1', busy: false, pending: false}
    };
    indexSandbox.lastScreen = {
        version: '0.7.1',
        address: '192.168.1.10',
        port: 8099,
        mode: 'tv-integration',
        root: true,
        launcher: {installed: true, enabled: true, running: true},
        tuner: {installed: false},
        ui: {installed: true, enabled: false},
        checks: []
    };
    indexSandbox.focus = 0;
    indexSandbox.renderMain(indexSandbox.lastScreen);

    assert.match(
        scr.innerHTML,
        /class="tile focus" role="switch" tabindex="0" aria-checked="true"/,
        'focused on toggle tile renders role="switch", tabindex="0", aria-checked="true"'
    );
    assert.match(
        scr.innerHTML,
        /class="tile" role="switch" tabindex="-1" aria-checked="false"/,
        'unfocused off toggle tile renders role="switch", tabindex="-1", aria-checked="false"'
    );
    assert.match(
        scr.innerHTML,
        /class="tile na" role="switch" tabindex="-1" aria-checked="false" aria-disabled="true"/,
        'unavailable toggle tile renders aria-disabled="true" with role="switch"'
    );
    assert.match(
        scr.innerHTML,
        /class="tile" role="button" tabindex="-1">[\s\S]*?<h3>Update Vetro<\/h3>/,
        'update tile renders role="button" without aria-checked'
    );
    assert.doesNotMatch(
        scr.innerHTML,
        /class="tile" role="button"[^>]*aria-checked/,
        'update tile does not carry aria-checked'
    );
    assert.match(
        scr.innerHTML,
        /<div class="diag [^"]*" role="button" tabindex="-1">/,
        'diagnostics row renders role="button" and tabindex="-1"'
    );

    // Incremental update path via moveTo() updates roving tabindex, ARIA attributes, and calls focus()
    indexSandbox.moveTo(2);
    assert.equal(tileChildren[0].getAttribute('tabindex'), '-1', 'previous tile gets tabindex="-1"');
    assert.equal(tileChildren[2].getAttribute('tabindex'), '0', 'target tile gets tabindex="0"');
    assert.equal(tileChildren[2].getAttribute('role'), 'switch', 'toggle tile keeps role="switch"');
    assert.equal(tileChildren[2].getAttribute('aria-checked'), 'false', 'partly-disabled toggle keeps aria-checked="false"');
    assert.equal(tileChildren[3].getAttribute('aria-disabled'), 'true', 'unavailable tile keeps aria-disabled="true"');
    assert.equal(tileChildren[4].getAttribute('role'), 'button', 'update tile keeps role="button"');
    assert.equal(tileChildren[4].getAttribute('aria-checked'), null, 'update tile has no aria-checked');
    assert.equal(tileChildren[2].focusedCount, 1, 'moveTo calls .focus() on the target tile');

    indexSandbox.moveTo(5);
    assert.equal(tileChildren[2].getAttribute('tabindex'), '-1', 'leaving tile clears active tabindex to -1');
    assert.equal(diagNode.getAttribute('tabindex'), '0', 'Diagnostics row gets tabindex="0" when focused');
    assert.equal(diagNode.focusedCount, 1, 'moveTo(5) calls .focus() on Diagnostics row');
    console.log('PASS app/index.html renders ARIA switch/button semantics, roving tabindex, and moveTo().focus()');

    // 8. osd-page.js & tuner-page.js SVG 1.1 xlink:href compatibility and null channel name guard
    const osd = require('../service/osd-page.js');
    const osdSvgs = [osd.volumePreview('left', 50), osd.padPreview(), osd.tasksPreview()];
    osdSvgs.forEach((svg, idx) => {
        assert.ok(svg.includes('<use href="#tvScene" xlink:href="#tvScene"/>'), 'osd preview #' + idx + ' includes both href and xlink:href');
    });
    assert.ok(osd.pageSource().includes('xlink:href="#tvScene"'), 'osd.pageSource() preserves xlink:href');

    const tunerPage = require('../service/tuner-page.js');
    tunerPage.slides().forEach((s, idx) => {
        assert.ok(s.svg.includes('<use href="#tvScene" xlink:href="#tvScene"/>'), 'tuner slide #' + idx + ' includes both href and xlink:href');
    });
    assert.ok(tunerPage.guide(false).includes('<use href="#tvScene" xlink:href="#tvScene"/>'), 'tuner standalone guide includes xlink:href');

    const tunerSource = fs.readFileSync(path.join(__dirname, '..', 'service', 'tuner-page.js'), 'utf8');
    const tunerSandbox = {
        require: id => require(path.join(__dirname, '..', 'service', id)),
        module: {exports: {}},
        exports: {},
        Math, String, Array, Object
    };
    vm.runInNewContext(tunerSource, tunerSandbox);
    const tvLogo = tunerSandbox.logo('TV', 100, 100, 76);
    assert.ok(tvLogo.includes('>T</text>'), 'logo("TV") renders initial T');
    [null, undefined, '', '---', '📺'].forEach(input => {
        const out = tunerSandbox.logo(input, 100, 100, 76);
        assert.ok(out.includes('>T</text>') || out.includes('>TV</text>'), 'logo(' + String(input) + ') falls back cleanly without empty initials');
    });
    console.log('PASS osd-page.js and tuner-page.js include SVG 1.1 xlink:href and safe logo(null) fallback');

    // 9. Round 3 TV-UI guards: prototype keys, SQLite .timeout 5000, XSS escaping, bootAirplay resilience, shardCardSelect fallback
    const keyRouting = require('../service/key-routing.js');
    assert.equal(keyRouting.keyCommand('toString', '/usr/bin/input_keyevent X'), '/usr/bin/input_keyevent X', 'prototype key does not match TUNER_STEPS_ASIDE');
    assert.equal(keyRouting.keyCommand('constructor', '/usr/bin/input_keyevent X'), '/usr/bin/input_keyevent X');

    const quickUninstall = require('../service/quick-uninstall.js');
    assert.doesNotThrow(() => {
        const items = quickUninstall.candidates([{appId: 'org.tizen.netflix-app', packageId: 'toString', removable: true, system: false, show: true}]);
        assert.equal(items.length, 1);
        assert.equal(items[0].packages[0].packageId, 'toString');
    }, 'quick-uninstall handles prototype packageId without TypeError');

    const vetroUi = require('../service/vetro-ui.js');
    assert.deepEqual(
        vetroUi.conflicts([{id: 'r1', enabled: true, trigger: {type: 'physical', value: 'toString'}, actions: []}], vetroUi.UI_RESERVED),
        [],
        'vetro-ui conflicts ignores Object.prototype keys'
    );
    assert.deepEqual(
        Array.from(d1.sandbox.uiConflicts([{id: 'r1', enabled: true, trigger: {type: 'physical', value: 'toString'}, actions: []}], vetroUi.UI_RESERVED)),
        [],
        'inlined dashboard uiConflicts ignores Object.prototype keys'
    );

    const {Controls} = require('../service/screen-controls.js');
    let readStateCalls = 0;
    const sc = new Controls({
        dock: {
            installed: () => true,
            readState: () => { readStateCalls++; return {enabled: true, customApp: null, volumePill: false, numberPad: false, cards: []}; },
            cardsEffective: () => [],
            setKeys: async () => ({}),
            setCards: async list => { assert.deepEqual(list, ['tasks']); return {}; }
        },
        tuner: {installed: () => false, readState: () => ({enabled: false})},
        updater: {status: () => ({configured: false, version: '0.7.1'})},
        agentConnected: () => true,
        pluginRunning: () => true,
        inventory: async () => ({apps: []})
    });
    await sc.read(true);
    assert.equal(readStateCalls, 1, 'Controls.read() calls dock.readState() only once');
    await sc.act({id: 'ui', on: true});

    // Dashboard XSS & prototype key guards in Vetro UI Overview & Tuner
    d1.sandbox.dockData = {
        installed: true,
        enabled: true,
        mode: 'vetro',
        running: true,
        cards: ['shard:evil'],
        cardChoices: ['tasks', 'shard:evil'],
        cardShards: {'shard:evil': '<img src=x onerror=alert(1)>'},
        maxCards: 3,
        entries: []
    };

    d1.sandbox.uiRules = [{id: 'p_proto', enabled: true, trigger: {type: 'physical', value: 'toString'}, actions: [{type: 'key', key: 'KEY_HOME'}]}];
    assert.deepEqual(Array.from(d1.sandbox.tunerKeyConflicts()), [], 'tunerKeyConflicts ignores prototype trigger value');
    d1.sandbox.renderOverview();
    assert.ok(!d1.el('uiOverview').innerHTML.includes('<img src=x onerror=alert(1)>'), 'Shard card label is HTML-escaped in renderOverview');
    assert.ok(d1.el('uiOverview').innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'), 'escaped Shard card label is shown');

    // 10. PackageInformation.totalSize slow-getter circuit-breaker (Tizen 9 IPC freeze guard)
    function makePkgSandbox(stepMs) {
        let now = 10000, sizeReads = 0;
        const FakeDate = {now: () => now};
        const pkgs = [0, 1, 2, 3, 4].map(idx => {
            const o = {id: 'pkg.' + idx, version: '1.' + idx, author: 'dev'};
            Object.defineProperty(o, 'totalSize', {
                enumerable: true,
                get() { sizeReads++; now += stepMs; return (idx + 1) * 1024; }
            });
            return o;
        });
        const sb = {
            window: {innerWidth: 1920, innerHeight: 1080, addEventListener() {}},
            document: {readyState: 'loading', getElementById: () => createNode('pkg'), addEventListener() {}},
            XMLHttpRequest: function () { this.open = function () {}; this.setRequestHeader = function () {}; this.send = function () {}; },
            tizen: {package: {getPackagesInfo: ok => ok(pkgs)}},
            navigator: {},
            location: {href: 'file:///index.html'},
            console,
            setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
            Math, Date: FakeDate, JSON, Promise, String, Number, Array, Object, Error
        };
        vm.runInNewContext(indexScript, sb);
        sb.report = {probe: {}, apps: [], packages: [], settings: {}};
        return {sb, getSizeReads: () => sizeReads};
    }
    const slowPkg = makePkgSandbox(515);
    const slowCount = await slowPkg.sb.later[1]();
    assert.equal(slowCount, 5);
    assert.equal(slowPkg.getSizeReads(), 1, 'slow PackageInformation.totalSize stops getter reads after first slow call');
    assert.equal(slowPkg.sb.report.packages[0].totalSize, 1024, 'first sample retains measured totalSize');
    for (let i = 1; i < 5; i++) {
        assert.equal(slowPkg.sb.report.packages[i].totalSize, null, 'remaining packages skip slow totalSize getter');
        assert.equal(slowPkg.sb.report.packages[i].id, 'pkg.' + i);
        assert.equal(slowPkg.sb.report.packages[i].version, '1.' + i);
        assert.equal(slowPkg.sb.report.packages[i].author, 'dev');
    }
    const fastPkg = makePkgSandbox(0);
    await fastPkg.sb.later[1]();
    assert.equal(fastPkg.getSizeReads(), 5, 'fast PackageInformation.totalSize reads all packages');
    assert.deepEqual(Array.from(fastPkg.sb.report.packages.map(x => x.totalSize)), [1024, 2048, 3072, 4096, 5120]);
    console.log('PASS Round 3 frontend/TV-UI guards: prototype keys, XSS escaping, Controls.read single read, Tizen 9 totalSize freeze guard');

    finished = true;
})().catch(e => {
    console.error(e);
    process.exit(1);
});
