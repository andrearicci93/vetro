'use strict';

// Sign-in for the dashboard and API.
//
// Without it, any LAN client could use the root-backed routes, and any web page opened by a browser on
// the LAN could post to them. Now:
//  - The TV's own widget (loopback, opaque or no Origin) keeps working with no setup.
//  - Everyone else pairs once with a 6-digit code that only the TV shows (the Vetro app displays it),
//    then carries a random key: an HttpOnly SameSite=Strict cookie for browsers, or
//    "Authorization: Bearer <key>" for scripts. Only SHA-256 hashes of keys are stored.
//  - The Host must be an IP address or localhost (stops DNS rebinding), and a browser Origin must match
//    the Host (stops other sites from using a paired browser's cookie).
//  - App-only mode (no TV adapter, e.g. npm start on a computer) has no device operations and no TV to
//    show a code, so it stays open.

var crypto = require('crypto');
var fs = require('fs');

var STORE_PATH = process.env.VETRO_AUTH_PATH || '/opt/usr/home/owner/share/vetro-auth.json';
var COOKIE = 'vetro_session';
var KEY_DAYS = 365;
var CODE_MS = 2 * 60000;
var MAX_TRIES = 5;
var MAX_SESSIONS = 20;

var sessions = load();
var pending = null;          // {id, code, name, expires, tries}
var lastPairAt = 0;

function load() {
    try { var d = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); return Array.isArray(d.sessions) ? d.sessions : []; }
    catch (e) { return []; }
}
function save() {
    try { fs.writeFileSync(STORE_PATH, JSON.stringify({sessions: sessions}), {mode: 384}); } catch (e) {}
}
function hash(key) { return crypto.createHash('sha256').update(key).digest('hex'); }
function same(a, b) { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); }

function json(res, code, body, headers) {
    var h = {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'};
    Object.keys(headers || {}).forEach(function (k) { h[k] = headers[k]; });
    res.writeHead(code, h);
    res.end(JSON.stringify(body) + '\n');
}

// The fake requests in Vetro's test harness have no socket; real ones always do.
function isLoopback(req) {
    var a = req.socket ? req.socket.remoteAddress : '127.0.0.1';
    return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}
function tvApp(req) {
    var o = (req.headers || {}).origin;
    return isLoopback(req) && (o === undefined || o === 'null');
}
function hostOk(req) {
    var host = String((req.headers || {}).host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    return host === '' || host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^[0-9a-f:]+$/i.test(host);
}
function originOk(req) {
    var o = (req.headers || {}).origin;
    return o === undefined || o === 'null' || o === 'http://' + (req.headers || {}).host;
}

function keyOf(req) {
    var h = req.headers || {};
    var m = /^Bearer\s+([0-9a-f]{64})$/i.exec(h.authorization || '');
    if (m) return m[1];
    m = new RegExp('(?:^|;\\s*)' + COOKIE + '=([0-9a-f]{64})').exec(h.cookie || '');
    return m ? m[1] : null;
}
function sessionOf(req) {
    var key = keyOf(req);
    if (!key) return null;
    var h = hash(key), now = Date.now();
    var s = sessions.filter(function (x) { return same(x.hash, h) && x.expires > now; })[0] || null;
    if (s && now - (s.seen || 0) > 3600000) { s.seen = now; save(); }
    return s;
}

function body(req, cb) {
    var data = '';
    req.on('data', function (c) { data += c; if (data.length > 2048) req.destroy(); });
    req.on('end', function () { var p; try { p = JSON.parse(data || '{}'); } catch (e) { p = {}; } cb(p && typeof p === 'object' ? p : {}); });
}

function startPair(req, res, onPair) {
    var now = Date.now();
    if (now - lastPairAt < 10000) return json(res, 429, {error: 'Wait a few seconds and try again'});
    lastPairAt = now;
    body(req, function (p) {
        var name = String(p.name || 'Browser').replace(/[^\w .()+-]/g, '').slice(0, 40) || 'Browser';
        pending = {id: crypto.randomBytes(16).toString('hex'), code: String(1000000 + crypto.randomBytes(4).readUInt32BE(0) % 1000000).slice(1),
            name: name, expires: now + CODE_MS, tries: 0};
        if (onPair) try { onPair(); } catch (e) {}
        json(res, 200, {id: pending.id, expiresIn: CODE_MS / 1000});
    });
}

function confirmPair(req, res) {
    body(req, function (p) {
        var now = Date.now();
        if (!pending || pending.expires < now || !same(pending.id, p.id)) return json(res, 410, {error: 'This code expired; start again'});
        if (!same(pending.code, String(p.code || '').replace(/\D/g, ''))) {
            if (++pending.tries >= MAX_TRIES) pending = null;
            return json(res, 403, {error: pending ? 'Wrong code' : 'Too many wrong codes; start again'});
        }
        var key = crypto.randomBytes(32).toString('hex');
        sessions.push({hash: hash(key), name: pending.name, created: now, seen: now, expires: now + KEY_DAYS * 86400000});
        sessions = sessions.filter(function (s) { return s.expires > now; }).slice(-MAX_SESSIONS);
        pending = null;
        save();
        json(res, 200, {ok: true, token: key},
            {'set-cookie': COOKIE + '=' + key + '; Max-Age=' + KEY_DAYS * 86400 + '; Path=/; HttpOnly; SameSite=Strict'});
    });
}

function signOut(res, all, current) {
    sessions = all ? [] : sessions.filter(function (s) { return s !== current; });
    save();
    json(res, 200, {ok: true, signedIn: sessions.length}, {'set-cookie': COOKIE + '=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict'});
}

// Returns true when it has answered the request; false lets Vetro's router handle it.
// options.open: no sign-in (app-only mode); options.onPair: called when a pairing starts.
function gate(req, res, url, options) {
    options = options || {};
    var onPair = options.onPair;
    if (!hostOk(req)) return json(res, 403, {error: 'Use the TV\'s IP address'}), true;
    if (options.open) return false;
    var local = tvApp(req);

    if (url === '/auth/pair' && req.method === 'POST') return startPair(req, res, onPair), true;
    if (url === '/auth/confirm' && req.method === 'POST') return confirmPair(req, res), true;
    if (url === '/auth/pending' && req.method === 'GET') {
        if (!local) return json(res, 403, {error: 'TV apps only'}), true;
        var live = pending && pending.expires > Date.now();
        return json(res, 200, live ? {code: pending.code, name: pending.name, expiresIn: Math.round((pending.expires - Date.now()) / 1000)} : {code: null},
            {'Access-Control-Allow-Origin': 'null'}), true;
    }

    if (local) {
        if (url === '/auth/signout-all' && req.method === 'POST') return signOut(res, true), true;
        return false;
    }

    var s = sessionOf(req);
    if (s && !originOk(req)) return json(res, 403, {error: 'Cross-site request refused'}), true;
    if (!s) {
        if ((url === '/' || url === '/index.html') && req.method === 'GET') {
            res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'});
            return res.end(LOGIN), true;
        }
        return json(res, 401, {error: 'Pair this device first: open the dashboard and enter the code shown on the TV'}), true;
    }
    if (url === '/auth/signout' && req.method === 'POST') return signOut(res, false, s), true;
    if (url === '/auth/signout-all' && req.method === 'POST') return signOut(res, true), true;
    if (url === '/auth/devices' && req.method === 'GET') {
        return json(res, 200, {devices: sessions.map(function (x) { return {name: x.name, created: x.created, seen: x.seen, current: x === s}; })}), true;
    }
    return false;
}

// Small bar added to the dashboard: sign out.
var BAR = '<div id="gaAuth" style="position:fixed;right:12px;bottom:12px;z-index:99;font:13px system-ui,sans-serif;background:#191c1f;color:#e2e5e8;border:1px solid #30353a;border-radius:10px;padding:6px 10px;opacity:.9">' +
    '<a href="#" id="gaOut" style="color:#a3c7bd">Sign out</a> · <a href="#" id="gaAll" style="color:#a3c7bd">Sign out all devices</a></div>' +
    '<script>(function(){function post(u){fetch(u,{method:"POST"}).then(function(){location.reload()})}' +
    'document.getElementById("gaOut").onclick=function(e){e.preventDefault();post("/auth/signout")};' +
    'document.getElementById("gaAll").onclick=function(e){e.preventDefault();if(confirm("Sign out every paired browser and script?"))post("/auth/signout-all")};})();</script>';
function decorate(html) { return html.indexOf('</body>') >= 0 ? html.replace('</body>', BAR + '</body>') : html + BAR; }

var LOGIN = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
'<title>Vetro sign-in</title><style>:root{--night:#111315;--deep:#191c1f;--mint:#a3c7bd;--chalk:#e2e5e8;--muted:#a0a6ad}' +
'*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--night);color:var(--chalk);font:16px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;padding:16px}' +
'main{width:100%;max-width:400px}h1{font-size:22px;margin:0 0 6px}p{color:var(--muted);margin:0 0 18px}' +
'input{width:100%;padding:14px;border:0;border-radius:12px;background:var(--deep);color:var(--chalk);font:inherit;font-size:24px;letter-spacing:8px;text-align:center}' +
'input:focus{outline:2px solid var(--mint)}button{width:100%;margin-top:14px;padding:14px;border:0;border-radius:12px;background:var(--mint);color:var(--night);font:inherit;font-weight:700}' +
'.msg{margin-top:14px;color:var(--muted)}.err{color:#ff9b9b}[hidden]{display:none}</style></head><body><main>' +
'<h1>Pair with your TV</h1><p>Vetro controls your TV as root, so each browser pairs once with a code shown on the TV. If no code appears, open the Vetro app on the TV.</p>' +
'<div id="s1"><button id="start">Show a code on the TV</button></div>' +
'<form id="s2" hidden><input id="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000"><button>Pair</button></form>' +
'<div class="msg" id="msg"></div></main><script>' +
'var id,$=function(i){return document.getElementById(i)},say=function(t,e){$("msg").textContent=t;$("msg").className=e?"msg err":"msg"};' +
'function call(u,b){return fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)}).then(function(r){return r.json().then(function(d){if(!r.ok)throw Error(d.error);return d})})}' +
'$("start").onclick=function(){say("Asking the TV…");call("/auth/pair",{name:navigator.platform||"Browser"}).then(function(d){id=d.id;$("s1").hidden=true;$("s2").hidden=false;$("code").focus();say("Enter the 6-digit code now on the TV screen. It expires in 2 minutes.")}).catch(function(e){say(e.message,1)})};' +
'$("s2").onsubmit=function(e){e.preventDefault();call("/auth/confirm",{id:id,code:$("code").value}).then(function(){say("Paired.");location.reload()}).catch(function(e){say(e.message,1);if(/start again/.test(e.message)){$("s1").hidden=false;$("s2").hidden=true}})};' +
'</script></body></html>';

module.exports = {gate: gate, decorate: decorate, tvApp: tvApp, hostOk: hostOk, originOk: originOk, STORE_PATH: STORE_PATH,
    _reset: function () { sessions = []; pending = null; lastPairAt = 0; }};
