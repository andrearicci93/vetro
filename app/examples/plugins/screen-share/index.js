'use strict';
// Screen share: a live view of the TV picture (video and on-screen graphics) as a page in the dashboard.
//
// The picture comes from the helper in assets/ (capture/ in the Vetro repo): Samsung's scaler capture, JPEG-encoded and
// served as MJPEG on 127.0.0.1 only. This file starts it on demand (as root, through ctx.execute) and passes its
// answers through to the plugin page; the helper exits by itself 30 s after the last viewer leaves.
// Protected video (HDCP, DRM) is refused by the TV and shows as black.
//
// Based on zabique/vetro, branch fork/extras (https://github.com/zabique/vetro), MIT License: app/service/screen-capture.js.
// Plain ES5 for the TV's Node 4.4: no arrow functions, no promise.finally, no Buffer.from.

var http = require('http');
var qs = require('querystring');

var DEFAULT_PORT = 8097, UNIT = 'vetro-screen-share', IDLE_SECONDS = 30, DEFAULT_FPS = 15, DEFAULT_SIZE = '1280x720';
var DLL = 'TvCapture.dll';
var CONTROLS = ['fps', 'q', 'w', 'h', 'size'];        // the only request parameters that reach the helper

function toBase64(text) {
    return (Buffer.from && Buffer.from !== Uint8Array.from ? Buffer.from(text) : new Buffer(text)).toString('base64');
}
function wrap(script) { return 'echo ' + toBase64(script) + ' | base64 -d | sh'; }

// Starts the helper unless it already listens. dll is the path ctx.asset gave: no quote can be in it.
function startScript(dll, PORT) {
    if (/['"\\$`\n]/.test(dll)) throw new Error('unexpected characters in the helper path');
    var cmd = 'exec /usr/bin/dotnet "' + dll + '" --serve ' + PORT + ' --fps ' + DEFAULT_FPS + ' --size ' + DEFAULT_SIZE + ' --idle-exit ' + IDLE_SECONDS;
    return [
        'if netstat -ltn 2>/dev/null | grep -q "127.0.0.1:' + PORT + ' "; then echo running; exit 0; fi',
        '[ -f "' + dll + '" ] || { echo missing; exit 0; }',
        'systemctl reset-failed ' + UNIT + '.service >/dev/null 2>&1',
        'systemd-run --unit=' + UNIT + ' --collect -p StandardOutput=null -p StandardError=null /bin/sh -c \'' + cmd + '\' >/dev/null 2>&1 || ' +
            'setsid nohup /bin/sh -c \'' + cmd + '\' </dev/null >/dev/null 2>&1 &',
        'echo started'
    ].join('\n');
}

// "?fps=15&size=1280x720" -> "?fps=15&size=1280x720" with only the known controls and only short digit/x values.
function controlsFrom(reqUrl) {
    var q = qs.parse(String(reqUrl || '').split('?')[1] || ''), keep = [];
    CONTROLS.forEach(function (k) {
        var v = q[k];
        if (typeof v === 'string' && /^[0-9x]{1,9}$/.test(v)) keep.push(k + '=' + v);
    });
    return keep.length ? '?' + keep.join('&') : '';
}

var PAGE = '<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{font:15px system-ui;margin:16px}#v{display:block;max-width:100%;background:#000;border-radius:8px;min-height:120px}' +
    '.row{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;margin:12px 0}label{display:flex;gap:6px;align-items:center}' +
    '#s{opacity:.75;min-height:1.4em}button,select{font:inherit;padding:6px 10px}</style>' +
    '<body><div class="row"><button id="go">Start</button><button id="stop" hidden>Stop</button>' +
    '<label>Size <select id="size"><option>640x360</option><option selected>1280x720</option><option>1920x1080</option></select></label>' +
    '<label>Frames/s <select id="fps"><option>5</option><option>10</option><option selected>15</option><option>24</option></select></label>' +
    '<label>Quality <select id="q"><option>50</option><option selected>80</option><option>92</option></select></label></div>' +
    '<img id="v" alt="TV screen" hidden><div id="s">Press Start to look at the TV screen.</div>' +
    '<script>' +
    'var v=document.getElementById("v"),go=document.getElementById("go"),stop=document.getElementById("stop"),s=document.getElementById("s"),timer=null;' +
    'function val(id){return document.getElementById(id).value}' +
    'function say(t){s.textContent=t}' +
    'function status(){fetch("status").then(function(r){return r.json()}).then(function(d){' +
    'if(d.running===false){say("The helper is not running.");return}' +
    'say((d.error?d.error+" · ":"")+d.width+"x"+d.height+" · "+d.fps+" frames/s"+(d.protect===1?" · protected content: the TV shows black":""))' +
    '}).catch(function(){say("No answer from the TV.")})}' +
    'function play(){v.hidden=false;stop.hidden=false;go.textContent="Apply";say("Starting…");' +
    'v.src="stream?fps="+val("fps")+"&q="+val("q")+"&size="+val("size")+"&t="+Date.now();' +
    'clearInterval(timer);timer=setInterval(status,2000)}' +
    'function halt(){clearInterval(timer);timer=null;v.removeAttribute("src");v.hidden=true;stop.hidden=true;go.textContent="Start";say("Stopped. The helper exits by itself in a few seconds.")}' +
    'go.onclick=play;stop.onclick=halt;v.onerror=function(){if(timer){say("The picture could not be started. Is the helper installed?")}};' +
    '</script></body>';

module.exports = function (ctx) {
    var starting = null, alive = false;
    // The helper's port can be changed in this plugin's config.json ({"port": 8123}) if 8097 is taken.
    var cfg = ctx.config.get(), PORT = typeof cfg.port === 'number' && cfg.port % 1 === 0 && cfg.port >= 1024 && cfg.port < 65536 ? cfg.port : DEFAULT_PORT;

    function json(res, code, body) {
        res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(body));
    }

    // Concurrent callers share one start. Resolves to 'running' | 'started', rejects when the helper is not usable.
    function startHelper() {
        if (starting) return starting;
        var script;
        try { script = startScript(ctx.asset(DLL), PORT); } catch (e) { return Promise.reject(e); }
        starting = ctx.execute(wrap(script), 15000).then(function (r) {
            starting = null;
            var out = String((r && r.stdout) || '');
            if (/^missing$/m.test(out)) throw new Error('The helper ' + DLL + ' is missing: install the plugin again');
            return /^started$/m.test(out) ? 'started' : 'running';
        }, function (e) { starting = null; throw e; });
        return starting;
    }

    // Passes one helper path (/stream, /status, /frame.jpg) through to res. With start, a helper that is down is started and
    // the connection retried for about ten seconds (dotnet takes ~2 s to come up); without, the caller gets {running:false}.
    function pass(sub, res, start) {
        var tries = 0, done = false, up = null;
        function reply(code, obj) { if (done) return; done = true; json(res, code, obj); }
        res.on('close', function () { done = true; if (up) up.abort(); });
        // A stream runs as long as someone watches; older Node servers drop quiet sockets after two minutes.
        if (start && typeof res.setTimeout === 'function') res.setTimeout(0);
        function attempt() {
            if (done) return;
            up = http.get({ host: '127.0.0.1', port: PORT, path: sub }, function (r) {
                if (done) { r.destroy(); return; }
                done = true;
                res.writeHead(r.statusCode || 502, { 'content-type': r.headers['content-type'] || 'application/octet-stream',
                    'cache-control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
                r.pipe(res);
            });
            up.on('error', function () {
                if (done) return;
                if (!start) return reply(200, { running: false });
                if (++tries > 20) return reply(503, { error: 'The live view did not start' });
                if (tries === 1) startHelper().catch(function (e) { reply(503, { error: e.message }); });
                setTimeout(attempt, 500);
            });
        }
        attempt();
    }

    function quit() {
        var r = http.get({ host: '127.0.0.1', port: PORT, path: '/quit' }, function (x) { x.resume(); });
        r.on('error', function () { /* not running */ });
        r.setTimeout(2000, function () { r.abort(); });
    }

    return {
        start: function () { alive = true; },
        stop: function () { alive = false; quit(); },
        status: function () { return { running: alive, helper: DLL }; },

        route: function (req, res, sub) {
            if (req.method !== 'GET') return false;
            if (sub === 'ui') {
                res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
                res.end(PAGE);
                return true;
            }
            if (sub === 'stream') { pass('/stream' + controlsFrom(req.url), res, true); return true; }
            if (sub === 'frame') { pass('/frame.jpg' + controlsFrom(req.url), res, true); return true; }
            if (sub === 'status') { pass('/status', res, false); return true; }
            return false;
        }
    };
};
