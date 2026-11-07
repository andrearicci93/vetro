'use strict';
// Ad-free YouTube: opens Samsung's own YouTube app with a script added to its page (ad blocking, Shorts, SponsorBlock, DeArrow).
// Nothing is installed on the TV: the app is started with a proxy and a trust store of its own, both owned by this plugin.
// See README.md for what runs, what is written, and how to undo it. Plain ES5.
//
// Two ways in: the Open button, and (when switched on) Samsung's own YouTube button, by adding the same flags to the row
// that tile reads (tile.js). The row is only ever patched while everything it needs is up, and is put back when anything is
// not, when the plugin is switched off, and when Vetro stops. If Vetro dies without a chance to do that, the proxy list ends
// in direct:// so YouTube still opens.

var fs = require('fs');
var path = require('path');
var proxyLib = require('./proxy.js');
var setup = require('./setup.js');
var tile = require('./tile.js');
var scriptLib = require('./userscript.js');

var PROXY_HOST = '127.0.0.2', DEFAULT_PORT = 8101;
var TICK_MS = 60 * 1000, SETUP_EVERY_MS = 24 * 3600 * 1000, SCRIPT_RETRY_MS = 5 * 60 * 1000;

var PAGE = '<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{font:15px system-ui;margin:16px;max-width:42rem}h2{margin:0 0 4px}.row{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}' +
    'button{font:inherit;padding:8px 14px}table{border-collapse:collapse;margin:8px 0;width:100%}td{padding:4px 8px 4px 0;vertical-align:top}' +
    'td:first-child{opacity:.7;white-space:nowrap}#msg{min-height:1.4em;margin:8px 0}.err{color:#c0392b}small{opacity:.75;display:block;margin-top:14px;line-height:1.45}' +
    'label.sw{display:flex;gap:10px;align-items:flex-start;margin:14px 0 4px}label.sw input{margin-top:3px;width:18px;height:18px}#tilenote{opacity:.75;margin:0 0 8px 28px;min-height:1.2em}</style>' +
    '<body><h2>Ad-free YouTube</h2><div>Samsung’s own YouTube app, with ads, Shorts and sponsor segments handled.</div>' +
    '<div class="row"><button id="open">Open YouTube</button><button id="close">Close YouTube</button></div><div id="msg"></div>' +
    '<label class="sw"><input type="checkbox" id="tile"><span><b>Samsung’s YouTube button opens this</b><br>The Home tile, the remote’s YouTube key and voice start the patched app. ' +
    'If Vetro is not running, YouTube still opens, just without the patches.</span></label><div id="tilenote"></div>' +
    '<table><tr><td>Certificate</td><td id="s_setup">…</td></tr><tr><td>Script</td><td id="s_script">…</td></tr>' +
    '<tr><td>Proxy</td><td id="s_proxy">…</td></tr><tr><td>Pages patched</td><td id="s_pages">…</td></tr></table>' +
    '<div class="row"><button id="clean">Remove certificate and files</button></div>' +
    '<small>The first start makes a certificate that only this YouTube app trusts (the TV does not) and downloads the script once, ' +
    'checked against a fixed SHA-256. The script is <b>TizenTube</b> by reisxd (GPL-3.0); sponsor segments come from the ' +
    '<b>SponsorBlock</b> database (sponsor.ajay.app, CC BY-NC-SA 4.0). Unofficial: YouTube’s terms do not allow ad blocking.</small>' +
    '<script>' +
    'function $(i){return document.getElementById(i)}' +
    'function say(t,bad){var m=$("msg");m.textContent=t;m.className=bad?"err":""}' +
    'function post(p,b){return fetch(p,{method:"POST",headers:{"Content-Type":"text/plain"},body:JSON.stringify(b||{})}).then(function(r){return r.json()})}' +
    'var busy=false;' +
    'function show(d){$("s_setup").textContent=d.setup==="ready"?"ready":d.setup==="working"?"setting up…":d.setup==="nocobalt"?"Samsung YouTube not found":d.setup==="error"?"error: "+d.error:"not made yet";' +
    '$("s_script").textContent=d.script==="ready"?"TizenTube "+d.scriptVersion:d.script==="error"?"error: "+d.scriptError:"not downloaded yet";' +
    '$("s_proxy").textContent=d.proxy==="up"?"listening on "+d.proxyAddress:d.proxyError?"error: "+d.proxyError:"stopped";' +
    '$("s_pages").textContent=d.pages?d.pages+(d.lastPage?" (last "+d.lastPage+")":""):"none yet";' +
    'if(!busy){$("tile").checked=!!d.tileOn}' +
    '$("tilenote").textContent=d.tileState==="on"?"On.":d.tileState==="waiting"?"Waiting: "+d.tileNote:d.tileState==="unsupported"||d.tileState==="error"?d.tileNote:""}' +
    'function poll(){fetch("status").then(function(r){return r.json()}).then(show).catch(function(){})}' +
    '$("open").onclick=function(){say("Preparing and starting… the first time takes up to a minute.");post("open").then(function(d){say(d.ok?(d.warning||"YouTube is starting on the TV."):d.error,!d.ok||!!d.warning);poll()})};' +
    '$("close").onclick=function(){post("close").then(function(){say("YouTube closed.");poll()})};' +
    '$("tile").onchange=function(){busy=true;var on=$("tile").checked;say(on?"Preparing…":"Switching off…");post("tile",{on:on}).then(function(d){busy=false;say(d.ok?"":d.error,!d.ok);poll()},function(){busy=false})};' +
    '$("clean").onclick=function(){if(!confirm("Remove the certificate, the downloaded script and the copy of YouTube’s files?"))return;post("cleanup").then(function(d){say(d.ok?"Removed.":d.error,!d.ok);poll()})};' +
    'poll();setInterval(poll,3000);' +
    '</script></body>';

module.exports = function (ctx) {
    var cfg = ctx.config.get();
    var PORT = typeof cfg.port === 'number' && cfg.port % 1 === 0 && cfg.port >= 1024 && cfg.port < 65536 ? cfg.port : DEFAULT_PORT;
    var script = new scriptLib.UserScript(setup.CACHE);
    var logLines = [], preparing = null, alive = false, timer = null;
    var tileOn = cfg.tile === true;
    var lastSetup = 0, nextScriptTry = 0;
    var st = { setup: 'idle', error: null, script: 'idle', scriptError: null, proxyError: null, pages: 0, lastPage: null, tileState: 'off', tileNote: '' };

    function log(m) { logLines.push(new Date().toISOString().slice(11, 19) + ' ' + m); if (logLines.length > 150) logLines.shift(); }
    function exec(shell, ms) { return ctx.execute(setup.wrap(shell), ms); }
    function noop() {}

    function saveConfig(patch) {
        var c = ctx.config.get();
        Object.keys(patch).forEach(function (k) { c[k] = patch[k]; });
        try { ctx.config.set(c); } catch (e) { log('config not saved: ' + e.message); }
    }

    function readLeaf() {
        try {
            var key = fs.readFileSync(path.join(setup.DIR, 'leaf.key'));
            var cert = fs.readFileSync(path.join(setup.DIR, 'leaf.crt'), 'utf8') + fs.readFileSync(path.join(setup.DIR, 'ca.crt'), 'utf8');
            return { key: key, cert: cert };
        } catch (e) { return null; }
    }
    function contentThere() { try { return fs.statSync(path.join(setup.CONTENT, 'ssl', 'certs')).isDirectory(); } catch (e) { return false; } }

    var proxy = proxyLib.createProxy({
        host: PROXY_HOST, port: PORT, log: log,
        leaf: readLeaf,
        script: function () { return script.load(); },
        onPage: function () { st.pages++; st.lastPage = new Date().toISOString().slice(11, 19); }
    });

    function listen() {
        return new Promise(function (resolve, reject) {
            proxy.listen(function (e) {
                if (e) { st.proxyError = e.code === 'EADDRINUSE' ? 'port ' + PORT + ' is in use (put {"port": 8123} in config.json to change it)' : e.message; reject(new Error(st.proxyError)); }
                else { st.proxyError = null; resolve(); }
            });
        });
    }

    function runSetup() {
        st.setup = 'working'; st.error = null;
        return exec(setup.setupScript(), 90000).then(function (r) {
            var out = String((r && r.stdout) || '');
            if (/^nocobalt$/m.test(out)) { st.setup = 'nocobalt'; throw new Error('Samsung’s YouTube app was not found on this TV'); }
            if (!/^ready$/m.test(out)) { st.setup = 'error'; st.error = String((r && r.stderr) || out || 'setup failed').slice(0, 200); throw new Error(st.error); }
            st.setup = 'ready'; lastSetup = Date.now();
        }, function (e) { if (st.setup === 'working') { st.setup = 'error'; st.error = e.message; } throw e; });
    }

    function runScript() {
        return new Promise(function (resolve, reject) {
            script.ensure(function (e) {
                if (e) { st.script = 'error'; st.scriptError = e.message; nextScriptTry = Date.now() + SCRIPT_RETRY_MS; reject(e); }
                else { st.script = 'ready'; st.scriptError = null; resolve(); }
            });
        });
    }

    // Certificate, script, proxy, in that order. The script is not essential: without it the proxy only tunnels and YouTube
    // runs unpatched, so its failure is reported as a warning. Concurrent callers share one run.
    // Resolves to {warning}; rejects when there is no certificate setup or no proxy.
    function prepare() {
        if (preparing) return preparing;
        log('preparing');
        var warning = null;
        preparing = runSetup().then(function () { return runScript().catch(function (e) { warning = 'The script could not be downloaded (' + e.message + '): YouTube opens without the patches.'; }); })
            .then(function () { return proxy.listening() ? null : listen(); })
            .then(function () { preparing = null; log(warning ? 'ready, without the script' : 'ready'); return { warning: warning }; },
                function (e) { preparing = null; log('prepare failed: ' + e.message); throw e; });
        return preparing;
    }

    // Why the row may not be patched right now ('' when it may).
    function blocker() {
        if (!tileOn) return 'switched off';
        if (!proxy.listening()) return st.proxyError ? st.proxyError : 'the proxy is not running';
        if (!readLeaf() || !contentThere()) return 'the certificate is not ready';
        if (!script.load()) return 'the script is not downloaded yet';
        return '';
    }

    // Everything that changes the row goes through this queue, one job at a time, so a slow patch can never land after a restore.
    var queue = Promise.resolve();
    function serial(fn) { var r = queue.then(fn, fn); queue = r.then(noop, noop); return r; }

    // Makes the row match what is wanted: patched when tile is on and everything is up, original otherwise. Idempotent.
    // The decision is taken when the job runs, not when it is asked for; calls made while one is waiting share it.
    var waiting = null, restoreTries = 0, retryTimer = null;
    function reconcile() {
        if (waiting) return waiting;
        waiting = serial(function () {
            waiting = null;
            var why = alive ? blocker() : 'the plugin is off';
            var job = why ? tile.restore(exec) : tile.apply(exec, PROXY_HOST, PORT);
            return job.then(function (state) {
                if (why) {
                    st.tileState = tileOn && alive ? 'waiting' : 'off'; st.tileNote = tileOn ? why : '';
                    if (state === 'error' || state === 'raced' || state === 'patched' || state === 'stuck') {
                        log('row restore: ' + state);
                        // The flags are still there. Try again soon, a few times; the direct:// fallback keeps YouTube opening meanwhile.
                        if (restoreTries++ < 5 && !retryTimer) {
                            retryTimer = setTimeout(function () { retryTimer = null; reconcile(); }, 5000);
                            if (retryTimer.unref) retryTimer.unref();
                        }
                    } else restoreTries = 0;
                    return state;
                }
                restoreTries = 0;
                if (state === 'patched') { if (st.tileState !== 'on') log('Samsung’s YouTube button now opens the patched app'); st.tileState = 'on'; st.tileNote = ''; }
                else if (state === 'absent') { st.tileState = 'unsupported'; st.tileNote = 'This TV has no entry for Samsung’s YouTube app that can be changed.'; }
                else if (state === 'foreign') { st.tileState = 'unsupported'; st.tileNote = 'Samsung’s YouTube settings are not in the expected form: left as they are.'; }
                else { st.tileState = 'error'; st.tileNote = 'The TV’s app list could not be updated (' + state + '); trying again.'; log('row: ' + state); }
                return state;
            }, function (e) { st.tileState = 'error'; st.tileNote = 'Could not reach the TV’s app list: ' + e.message; log('row: ' + e.message); return 'error'; });
        });
        return waiting;
    }

    // Once a minute while the button is on: keeps the proxy up, renews what expires, retries a failed download, and puts the row
    // right again if Samsung rewrote it (an app update does).
    function tick() {
        if (!alive || !tileOn) return;
        var chain = Promise.resolve();
        if (Date.now() - lastSetup > SETUP_EVERY_MS && !preparing) chain = chain.then(function () { return runSetup().catch(function (e) { log('setup: ' + e.message); }); });
        if (!script.load() && Date.now() > nextScriptTry && contentThere()) chain = chain.then(function () { return runScript().catch(noop); });
        chain.then(function () { if (!proxy.listening() && readLeaf() && script.load()) return listen().catch(function (e) { log('proxy: ' + e.message); }); })
            .then(function () { return reconcile(); }).catch(function (e) { log('tick: ' + e.message); });
    }

    function json(res, code, body) { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }

    function readJson(req, cb) {
        var data = '', done = false;
        function end(v) { if (!done) { done = true; cb(v); } }
        req.on('data', function (c) { data += c; if (data.length > 2048) { req.destroy(); end({}); } });
        req.on('end', function () { var v; try { v = JSON.parse(data || '{}'); } catch (e) { v = {}; } end(v && typeof v === 'object' ? v : {}); });
        req.on('error', function () { end({}); });
    }

    function snapshot() {
        var have = script.load(), s = proxy.stats();
        return { setup: st.setup, error: st.error, script: have ? 'ready' : st.script, scriptVersion: scriptLib.VERSION, scriptError: st.scriptError,
            proxy: proxy.listening() ? 'up' : 'down', proxyAddress: PROXY_HOST + ':' + PORT, proxyError: st.proxyError, pages: st.pages, lastPage: st.lastPage,
            tileOn: tileOn, tileState: st.tileState, tileNote: st.tileNote, tunnels: s.tunnels, opened: s.opened, live: s.live };
    }

    return {
        // Starts the proxy when a certificate and script from an earlier run are there (a YouTube that was left open keeps
        // working after Vetro restarts), and brings the row in line: patched when the button is on, original otherwise.
        // A first run does nothing until the page asks.
        start: function () {
            alive = true;
            if (timer) clearInterval(timer);
            timer = setInterval(function () { try { tick(); } catch (e) { log('tick: ' + e.message); } }, TICK_MS);
            if (timer.unref) timer.unref();
            var ready = readLeaf() && script.load() ? listen().catch(function (e) { log('start: ' + e.message); }) : Promise.resolve();
            ready.then(function () { return tileOn && !(readLeaf() && script.load() && contentThere()) ? prepare().catch(function (e) { log('start: ' + e.message); }) : null; })
                .then(function () { return reconcile(); }).catch(function (e) { log('start: ' + e.message); });
        },
        // Puts the row back first: with the plugin off nothing is there to answer the proxy. A YouTube that is open keeps running
        // (its proxy list falls back to a direct connection), so nothing is closed here.
        stop: function () {
            alive = false;
            if (timer) { clearInterval(timer); timer = null; }
            // The proxy stays up until the row is back (a YouTube started in between still finds it), then stops listening.
            var shut = function () { if (!alive) proxy.close(); };
            reconcile().then(shut, shut);
            var late = setTimeout(shut, 30000);
            if (late.unref) late.unref();
        },
        status: function () { return { running: alive, proxy: proxy.listening(), setup: st.setup, script: script.load() ? scriptLib.VERSION : null, tile: st.tileState }; },

        route: function (req, res, sub) {
            if (sub === 'ui' && req.method === 'GET') {
                res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
                res.end(PAGE);
                return true;
            }
            if (sub === 'status' && req.method === 'GET') { json(res, 200, snapshot()); return true; }
            if (sub === 'log' && req.method === 'GET') { json(res, 200, { log: logLines }); return true; }
            if (req.method !== 'POST') return false;
            if (sub === 'open') {
                var warning = null;
                prepare().then(function (r) { warning = r.warning; return ctx.execute(setup.launchScript(PROXY_HOST, PORT), 25000); }).then(function (r) {
                    var out = String((r && r.stdout) || '');
                    if (!/successfully launched/.test(out)) throw new Error('YouTube did not start: ' + out.replace(/\s+/g, ' ').slice(0, 120));
                    log('YouTube started');
                    json(res, 200, warning ? { ok: true, warning: warning } : { ok: true });
                }).catch(function (e) { json(res, 200, { ok: false, error: e.message }); });
                return true;
            }
            if (sub === 'close') {
                ctx.execute(setup.closeScript(), 15000).then(function () { json(res, 200, { ok: true }); }, function (e) { json(res, 200, { ok: false, error: e.message }); });
                return true;
            }
            if (sub === 'tile') {
                readJson(req, function (body) {
                    if (typeof body.on !== 'boolean') { json(res, 200, { ok: false, error: 'Send {"on": true|false}' }); return; }
                    tileOn = body.on;
                    saveConfig({ tile: tileOn });
                    var go = tileOn ? prepare().then(noop, function (e) { log('tile: ' + e.message); }) : Promise.resolve();
                    go.then(function () { return reconcile(); }).then(function () { json(res, 200, { ok: true, state: st.tileState, note: st.tileNote }); },
                        function (e) { json(res, 200, { ok: false, error: e.message }); });
                });
                return true;
            }
            if (sub === 'cleanup') {
                // The row first, in line with every other change to it: it points at files that are about to go.
                tileOn = false; saveConfig({ tile: false });
                serial(function () {
                    return tile.restore(exec).then(function (state) {
                        if (state !== 'original' && state !== 'absent' && state !== 'foreign') throw new Error('Samsung’s YouTube button could not be put back (' + state + '): nothing was removed');
                        proxy.close(true); script.forget();
                        return ctx.execute(setup.cleanupScript(), 30000);
                    });
                }).then(function () { st.setup = 'idle'; st.script = 'idle'; st.tileState = 'off'; st.tileNote = ''; lastSetup = 0; json(res, 200, { ok: true }); },
                    function (e) { json(res, 200, { ok: false, error: e.message }); });
                return true;
            }
            return false;
        }
    };
};
