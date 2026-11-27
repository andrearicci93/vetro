'use strict';
// End-to-end tests for configurable Back:hold across dock.js, volume-keys.js, key-routing.js, vetro-ui.js,
// main.js, settings-backup.js, diagnostic-report.js, and dashboard.js.
const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const EventEmitter = require('events');

const root = path.resolve(__dirname, '..');
const {Dock} = require('../service/dock.js');
const vk = require('../service/volume-keys.js');
const kr = require('../service/key-routing.js');
const ui = require('../service/vetro-ui.js');
const backup = require('../service/settings-backup.js');
const report = require('../service/diagnostic-report.js');
const makeDashboard = require('../service/dashboard.js');

(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-backhold-'));
    try {
        // 1. dock.js: state, startScript, tellIdle 6 args, and keysChanged ordering in setIdleScreen
        const stateFile = path.join(tmp, 'state.json');
        let pipeLive = true;
        const callOrder = [];
        const d = new Dock({
            dir: path.join(root, 'native', 'dock'),
            stateFile,
            appsFile: path.join(tmp, 'apps.tsv'),
            inputsFile: path.join(tmp, 'inputs.tsv'),
            customAppsFile: path.join(tmp, 'custom.tsv'),
            execute: async cmd => {
                callOrder.push({type: 'exec', cmd});
                return {exit_code: 0, stdout: pipeLive && cmd.indexOf('echo "idle ') >= 0 ? 'live\n' : ''};
            },
            onVolumeChange: () => {
                callOrder.push({type: 'keysChanged'});
                return Promise.resolve();
            }
        });
        const origStatus = d.status.bind(d);
        d.status = opts => {
            callOrder.push({type: 'status'});
            return origStatus(opts);
        };

        assert.equal(d.readState().idleBackHoldMode, 'off');
        assert.equal(d.readState().idleBackHoldDock, false);
        assert.ok(!d.startScript().includes('--idle-back-hold'), 'off idleMode omits --idle-back-hold');

        d.patchState({enabled: true});
        await d.setIdleScreen({mode: 'clock', backHoldMode: 'minimize', backHoldDock: true});
        const keysIdx = callOrder.findIndex(x => x.type === 'keysChanged');
        const statusIdx = callOrder.findIndex(x => x.type === 'status');
        assert.ok(keysIdx >= 0 && statusIdx > keysIdx, 'keysChanged runs BEFORE status() when backHold turns on');
        assert.ok(callOrder.some(x => x.type === 'exec' && x.cmd.includes('echo "idle clock 0 0 0 minimize 1" >&3')));
        const script = d.startScript();
        assert.ok(script.includes('--idle-mode clock --idle-back-hold minimize --idle-back-hold-dock'), 'startScript carries --idle-back-hold and --idle-back-hold-dock');

        // Switching minimize -> force-close keeps prevBackHold === nextBackHold === true (no redundant keysChanged)
        callOrder.length = 0;
        await d.setIdleScreen({backHoldMode: 'force-close', backHoldDock: false});
        assert.equal(callOrder.filter(x => x.type === 'keysChanged').length, 0, 'minimize -> force-close does not trigger keysChanged');
        assert.ok(!d.startScript().includes('--idle-back-hold-dock'), 'startScript omits --idle-back-hold-dock when false');

        // Switching force-close -> off triggers keysChanged before status()
        callOrder.length = 0;
        await d.setIdleScreen({backHoldMode: 'off'});
        assert.equal(callOrder.filter(x => x.type === 'keysChanged').length, 1);
        assert.ok(callOrder.findIndex(x => x.type === 'keysChanged') < callOrder.findIndex(x => x.type === 'status'));

        // Custom mode never activates backHold in startScript
        d.patchState({enabled: false, customApp: 'com.example.home', idleMode: 'clock', idleBackHoldMode: 'minimize', idleBackHoldDock: true});
        assert.ok(!d.startScript().includes('--idle-back-hold'), 'customApp omits --idle-back-hold');

        // Fallback refreshOr path also calls keysChanged() when backHold toggles
        d.patchState({enabled: true, customApp: null, idleMode: 'clock', idleBackHoldMode: 'off'});
        pipeLive = false;
        d.refreshOr = async () => ({ok: true});
        callOrder.length = 0;
        await d.setIdleScreen({backHoldMode: 'minimize'});
        assert.equal(callOrder.filter(x => x.type === 'keysChanged').length, 1);
        assert.ok(callOrder.findIndex(x => x.type === 'keysChanged') < callOrder.findIndex(x => x.type === 'status'));

        // 2. volume-keys.js + key-routing.js: single-shot backhold, ENXIO -> XF86Back, no repeat timer
        assert.ok(kr.dockWordCommand('backhold').includes("echo 'backhold' >&3"));
        assert.equal(vk.reinjectCommand('XF86Back'), '/usr/bin/input_keyevent XF86Back');
        assert.deepEqual(vk.withTokens(['68'], {backHold: true}), ['68', '1:hold', '158:hold']);
        assert.deepEqual(vk.withTokens(['1', '158:hold'], {backHold: true}), ['1', '158:hold']);

        const BH = {backHold: true};
        assert.equal(vk.wants({code: 1, action: 'hold', decision: 'blocked'}, BH), true);
        assert.equal(vk.wants({code: 158, action: 'up', decision: 'blocked'}, BH), true);
        assert.equal(vk.wants({code: 1, action: 'down', decision: 'hold-wait'}, BH), false);
        assert.equal(vk.wants({code: 1, action: 'down', decision: 'blocked'}, BH), false);
        assert.equal(vk.wants({code: 1, action: 'repeat', decision: 'blocked'}, BH), false);

        const written = [], reinjected = [];
        const rep = vk.repeater({write: (p, t) => written.push(t), reinject: k => reinjected.push(k)});
        await rep.event({code: 1, action: 'hold', decision: 'blocked'}, BH);
        assert.equal(rep.active(), false, 'no repeat timer started for backhold');
        await new Promise(r => setTimeout(r, 450));
        assert.deepEqual(written, ['backhold\n'], 'single-shot backhold only');
        await rep.event({code: 1, action: 'up', decision: 'blocked'}, BH);
        assert.deepEqual(written, ['backhold\n'], 'up does not send another backhold');

        const nxReinj = [];
        const repNx = vk.repeater({
            write: () => { const e = new Error('no reader'); e.code = 'ENXIO'; throw e; },
            reinject: k => { nxReinj.push(k); }
        });
        await repNx.event({code: 158, action: 'hold', decision: 'blocked'}, BH);
        assert.deepEqual(nxReinj, ['XF86Back'], 'ENXIO reinjects XF86Back');

        // 3. vetro-ui.js: UI_BACK_HOLD_KEYS, reservedKeys, keysOf, needs, keysWhen
        assert.equal(ui.UI_BACK_HOLD_KEYS.length, 2);
        assert.deepEqual(ui.keysOf('backhold').map(k => k.code), ['1', '158']);
        const resLive = ui.reservedKeys({enabled: true, idleMode: 'clock', idleBackHoldMode: 'minimize'});
        assert.deepEqual(resLive, [
            {code: '1', label: 'Back', owner: 'backhold', name: 'Hold Back', hold: true, live: true},
            {code: '158', label: 'Back', owner: 'backhold', name: 'Hold Back', hold: true, live: true}
        ]);
        assert.equal(ui.reservedKeys({enabled: true, idleMode: 'off', idleBackHoldMode: 'minimize'})[0].live, false);
        assert.equal(ui.reservedKeys({mode: 'custom', customApp: 'x.y', idleMode: 'clock', idleBackHoldMode: 'force-close'})[0].live, false);
        assert.deepEqual(ui.needs('backhold', {enabled: false, idleMode: 'off'}, null), ['launcher', 'idle']);
        assert.deepEqual(ui.needs('backhold', {enabled: true, idleMode: 'clock'}, {status: {preference: {enabled: false}, policy: {mode: 'off'}}}), ['interception']);
        assert.deepEqual(ui.needs('backhold', {enabled: true, idleMode: 'clock'}, {status: {preference: {enabled: true}, policy: {mode: 'observe'}}}), ['listening']);
        assert.deepEqual(ui.needs('backhold', {enabled: true, idleMode: 'clock'}, {status: {preference: {enabled: true}, policy: {mode: 'filter'}}}), []);
        assert.deepEqual(ui.keysWhen({enabled: false, idleMode: 'clock', idleBackHoldMode: 'minimize'}, 'vetro').map(k => k.code), ['1', '158']);
        assert.deepEqual(ui.keysWhen({enabled: false, idleMode: 'clock', idleBackHoldMode: 'minimize'}, 'custom'), []);
        new Function(ui.pageSource());

        // 4. main.js integration: keyFlags(), vetroUiInput(), physical.onEvent, GET /remap
        {
            const load = require('./service-harness.cjs');
            const starts = [];
            let disk = JSON.stringify({rules: [{id: 'physical_1', enabled: true, trigger: {type: 'physical', value: '1'}, actions: [{type: 'launch', appId: 'example.back'}]}]});
            let pending = null;
            const commands = [];
            class Bridge {
                constructor(execute, onEvent, hooks) { this.onEvent = onEvent; this.hooks = hooks; this.current = {mode: 'off', connected: false}; }
                inventory() { return Promise.resolve([{name: 'Smart Control', node: '/dev/input/event5', unique: true, selectable: true}]); }
                status() { return {policy: this.current, events: []}; }
                stop() { this.current = {mode: 'off', connected: false}; if (this.hooks && this.hooks.onStop) this.hooks.onStop(); }
                async start(device, mode, tokens) { starts.push({device, mode, tokens}); this.current = {mode, connected: true, device: 'Smart Control', node: device}; return this.status(); }
            }
            const deps = {
                fs: {readFileSync: p => p.endsWith('vetro-remap.json') ? disk : '', existsSync: () => false, writeFileSync: (p, s) => { pending = s; }, renameSync() { disk = pending; }, unlinkSync() {}},
                './physical-input.js': {Bridge},
                './platform.js': {start() {}, status: () => ({agent: {connected: true}}), execute: cmd => { commands.push(cmd); return Promise.resolve({exit_code: 0, stdout: ''}); }}
            };
            if (process.platform === 'win32') {
                const realUpdater = require('../service/updater.js');
                deps['./updater.js'] = Object.assign({}, realUpdater, {
                    Updater: function (opts) {
                        return new realUpdater.Updater(Object.assign({}, opts, {installDir: '/tmp/vetro-app', workDir: '/tmp/vetro-work'}));
                    }
                });
            }
            const svc = load(root, {dependencies: deps, setInterval: () => ({unref() {}})});
            let dockState = {enabled: true, customApp: null, volumePill: false, numberPad: false, idleMode: 'clock', idleBackHoldMode: 'minimize', idleBackHoldDock: false};
            svc.context.dock.readState = () => dockState;
            assert.deepEqual(JSON.parse(JSON.stringify(svc.context.keyFlags())), {volume: false, pad: false, backHold: true});
            const started = await svc.context.vetroUiInput();
            assert.equal(started, true);
            assert.deepEqual(Array.from(starts[0].tokens), ['1', '158:hold'], 'user rule keeps 1 plain, 158 gets :hold');

            // hold on 158 goes to backhold (NOT user rule), hold-wait does not trigger Remapper
            svc.context.physical.onEvent({code: 158, action: 'down', decision: 'hold-wait'});
            svc.context.physical.onEvent({code: 158, action: 'hold', decision: 'blocked'});
            svc.context.physical.onEvent({code: 158, action: 'up', decision: 'blocked'});
            await new Promise(r => setTimeout(r, 40));
            assert.ok(commands.some(c => c.includes("echo 'backhold' >&3")), '158:hold sends backhold to launcher');
            assert.ok(!commands.some(c => c.includes('example.back')));

            // GET /remap exposes locked Back hold keys
            const remapRes = await new Promise(resolve => {
                const req = new EventEmitter(); req.method = 'GET'; req.url = '/remap';
                svc.router(req, {writeHead() {}, end(s) { resolve(JSON.parse(s)); }});
                req.emit('end');
            });
            assert.deepEqual(remapRes.reserved.map(k => ({code: k.code, hold: k.hold, live: k.live})), [
                {code: '1', hold: true, live: true},
                {code: '158', hold: true, live: true}
            ]);

            // Turning backHold off stops auto-started interception when no user rules exist
            await new Promise(resolve => {
                const req = new EventEmitter(); req.method = 'POST'; req.url = '/remap';
                svc.router(req, {writeHead() {}, end() { resolve(); }});
                req.emit('data', Buffer.from(JSON.stringify({rules: []})));
                req.emit('end');
            });
            dockState = {enabled: true, customApp: null, volumePill: false, numberPad: false, idleMode: 'clock', idleBackHoldMode: 'off', idleBackHoldDock: false};
            await svc.context.vetroUiInput();
            assert.equal(JSON.parse(disk).input.enabled, false, 'auto interception turns off when backHold turns off');
        }

        // 5. settings-backup.js & diagnostic-report.js
        const built = backup.build({dock: {enabled: true, idleMode: 'aurora', idleAutoDock: true, idlePictureOffMin: 5, idleSuppressScreensaver: true, idleBackHoldMode: 'force-close', idleBackHoldDock: true}});
        assert.equal(built.sections.launcher.idleBackHoldMode, 'force-close');
        assert.equal(built.sections.launcher.idleBackHoldDock, true);
        const parsed = backup.parse(JSON.stringify(built));
        assert.equal(parsed.sections.launcher.idleBackHoldMode, 'force-close');
        assert.equal(report.projectors.launcher({idleBackHoldMode: 'minimize', idleBackHoldDock: true}).idleBackHoldMode, 'minimize');
        assert.equal(report.projectors.input({backHoldKey: true}).backHoldKey, true);

        // 6. dashboard.js: tokens, balanced HTML, XSS escaping, Empty TV Hold Back UI, unified partial onchange
        const html = makeDashboard();
        const tokens = fs.readFileSync(path.join(root, 'design-system', 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        const rootBlock = /:root \{([\s\S]*?)\n\}/.exec(tokens)[1];
        const squash = t => t.replace(/\s+/g, '');
        rootBlock.split(';').map(x => x.trim()).filter(Boolean).forEach(p => assert.ok(squash(html).includes(squash(p)), 'token unchanged: ' + p.slice(0, 40)));
        assert.doesNotMatch(html, /border-top:\s*[2-9]px solid var\(--(accent|ok|warn|danger)/);
        assert.doesNotMatch(html, /border-top-color/);
        const body = html.slice(html.indexOf('<body'), html.indexOf('<script>'));
        const count = re => (body.match(re) || []).length;
        for (const tag of ['section', 'div', 'nav', 'aside', 'main', 'header', 'footer', 'details', 'table']) {
            assert.equal(count(new RegExp('<' + tag + '\\b', 'g')), count(new RegExp('</' + tag + '>', 'g')), '<' + tag + '> tags are balanced');
        }
        const scriptSrc = html.match(/<script>([\s\S]*?)<\/script>/)[1];
        new vm.Script(scriptSrc);

        const nodes = {};
        const el = id => nodes[id] || (nodes[id] = {id, value: '', hidden: true, textContent: '', innerHTML: '', disabled: false, checked: false, focus() {}});
        const calls = [];
        let dashDock = {installed: true, enabled: true, mode: 'vetro', running: true, idleMode: 'off', idleAutoDock: false, idlePictureOffMin: 0, idleSuppressScreensaver: false, idleBackHoldMode: 'off', idleBackHoldDock: false, entries: [], inputs: []};
        let dashInput = {devices: [], status: {policy: {mode: 'off', connected: false}, preference: {enabled: false}, events: []}};
        let dashRemap = {rules: [{id: 'physical_1', enabled: true, trigger: {type: 'physical', value: '1'}, actions: [{type: 'launch', appId: '<img src=x onerror=alert(1)>'}]}], reserved: [], interception: {auto: false, problem: '<script>bad</script>'}};
        const sb = {
            document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}},
            console, setTimeout() { return 1; }, clearTimeout() {}, setInterval() {}, confirm: () => true,
            fetch: async (url, opts) => {
                const bodyObj = opts && opts.body ? JSON.parse(opts.body) : null;
                calls.push({url, body: bodyObj});
                if (url === '/dock' && !bodyObj) return {ok: true, json: async () => dashDock};
                if (url === '/dock' && bodyObj.action === 'idleScreen') {
                    if (bodyObj.mode !== undefined) dashDock.idleMode = bodyObj.mode;
                    if (bodyObj.autoDock !== undefined) dashDock.idleAutoDock = bodyObj.autoDock;
                    if (bodyObj.pictureOffMin !== undefined) dashDock.idlePictureOffMin = bodyObj.pictureOffMin;
                    if (bodyObj.suppressScreensaver !== undefined) dashDock.idleSuppressScreensaver = bodyObj.suppressScreensaver;
                    if (bodyObj.backHoldMode !== undefined) dashDock.idleBackHoldMode = bodyObj.backHoldMode;
                    if (bodyObj.backHoldDock !== undefined) dashDock.idleBackHoldDock = bodyObj.backHoldDock;
                    return {ok: true, json: async () => dashDock};
                }
                if (url === '/input') return {ok: true, json: async () => dashInput};
                if (url === '/remap') return {ok: true, json: async () => dashRemap};
                if (url.startsWith('/apps')) return {ok: true, json: async () => ({apps: [], summary: {total: 0}})};
                return {ok: true, json: async () => ({})};
            }
        };
        vm.runInNewContext(scriptSrc, sb);
        const tick = async (n) => { for (let i = 0; i < (n || 4); i++) await new Promise(r => setImmediate(r)); };
        await tick();
        await sb.loadVetroUi(); await tick();

        // When iMode === 'off', Hold Back controls are visible, both disabled, with Needs Backdrop style on chip and muted note
        let dockHtml = el('dockBody').innerHTML;
        assert.match(dockHtml, /<select data-dock-idle-backhold[^>]* disabled>/);
        assert.match(dockHtml, /data-dock-idle-backhold-dock[^>]* disabled/);
        assert.match(dockHtml, /Needs Backdrop style on/);
        assert.match(dockHtml, /Turn on Backdrop style above to use Hold Back\./);

        // When iMode !== 'off' and iBackMode === 'off', select enabled, switch disabled
        sb.dockData = dashDock = Object.assign({}, dashDock, {idleMode: 'clock', idleBackHoldMode: 'off'});
        sb.renderDock();
        dockHtml = el('dockBody').innerHTML;
        assert.doesNotMatch(dockHtml, /<select data-dock-idle-backhold[^>]* disabled>/);
        assert.match(dockHtml, /data-dock-idle-backhold-dock[^>]* disabled/);

        // When iBackMode !== 'off', shows uiNeeds callout and XSS-escaped Remapper conflict warning
        sb.dockData = dashDock = Object.assign({}, dashDock, {idleBackHoldMode: 'minimize'});
        sb.renderDock();
        dockHtml = el('dockBody').innerHTML;
        assert.doesNotMatch(dockHtml, /data-dock-idle-backhold-dock[^>]* disabled/);
        assert.match(dockHtml, /The remote interception is off, so Back goes to Samsung/);
        assert.ok(!dockHtml.includes('<script>bad</script>') && dockHtml.includes('&lt;script&gt;bad&lt;/script&gt;'), 'interception problem is escaped');
        assert.ok(!dockHtml.includes('<img src=x') && dockHtml.includes('&lt;img src=x onerror=alert(1)&gt;'), 'Remapper conflict appId is escaped');

        // Unified partial onchange handlers do NOT clobber sibling fields
        const dockCalls = () => calls.filter(c => c.url === '/dock' && c.body).map(c => c.body);
        calls.length = 0;
        await el('dock').onchange({target: {dataset: {dockIdleMode: ''}, value: 'aurora'}}); await tick();
        await el('dock').onchange({target: {dataset: {dockIdleAutodock: ''}, checked: true}}); await tick();
        await el('dock').onchange({target: {dataset: {dockIdlePotoff: ''}, value: '10'}}); await tick();
        await el('dock').onchange({target: {dataset: {dockIdleNoscreensaver: ''}, checked: true}}); await tick();
        await el('dock').onchange({target: {dataset: {dockIdleBackhold: ''}, value: 'force-close'}}); await tick();
        await el('dock').onchange({target: {dataset: {dockIdleBackholdDock: ''}, checked: true}}); await tick();
        assert.deepEqual(Array.from(dockCalls()), [
            {action: 'idleScreen', mode: 'aurora'},
            {action: 'idleScreen', autoDock: true},
            {action: 'idleScreen', pictureOffMin: 10},
            {action: 'idleScreen', suppressScreensaver: true},
            {action: 'idleScreen', backHoldMode: 'force-close'},
            {action: 'idleScreen', backHoldDock: true}
        ]);
        assert.match(sb.operationEntries[0].message, /Hold Back: force close \+ Dock/);

        console.log('PASS back-hold: dock, volume-keys, key-routing, vetro-ui, main.js, backup, diagnostics, dashboard');
    } finally {
        fs.rmSync(tmp, {recursive: true, force: true});
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
