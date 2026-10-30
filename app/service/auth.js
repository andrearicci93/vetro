'use strict';

// Sign-in for the dashboard and API.
//
// Without it, any LAN client could use the root-backed routes, and any web page opened by a browser on
// the LAN could post to them. Now:
//  - The TV's own widget (loopback, opaque or no Origin) keeps working with no setup.
//  - Everyone else pairs once with a 6-digit code that only the TV shows (the Vetro app displays it),
//    then carries a random key: an HttpOnly SameSite=Strict cookie for browsers, or
//    "Authorization: Bearer <key>" for scripts. Only SHA-256 hashes of keys are stored.
//  - A browser Origin must match the Host on pairing and on every paired request (stops other web pages
//    from starting a pairing or using a paired browser's cookie). The no-key bypass for TV apps also
//    requires Host to be an IP address or localhost, so a rebound hostname never counts as the TV itself.
//    Paired LAN clients may use any host name (tv.local, a router name, Home Assistant).
//  - One pairing at a time: while a code is live, new pairing requests are refused, so nobody can cancel
//    someone else's pairing or keep popping the code up on the TV.
//  - App-only mode (no TV adapter, e.g. npm start on a computer) has no device operations and no TV to
//    show a code, so it stays open.

var crypto = require('crypto');
var fs = require('fs');

var STORE_PATH = process.env.VETRO_AUTH_PATH || '/opt/usr/home/owner/share/vetro-auth.json';
var COOKIE = 'vetro_session';
var PAIR_COOKIE = 'vetro_pair';   // the pairing id, kept by the browser that asked for the code so a reload does not lose it
var KEY_DAYS = 365;
var CODE_MS = 2 * 60000;
var MAX_TRIES = 5;
var MAX_SESSIONS = 20;

var sessions = load();
var pending = null;          // {id, code, name, expires, tries}
var lastPairAt = 0;

// A missing file just means nothing is paired yet; any other failure is logged, since it signs everyone out.
function load() {
    try { var d = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); return Array.isArray(d.sessions) ? d.sessions : []; }
    catch (e) {
        if (e.code !== 'ENOENT') console.error('Sign-in: could not read ' + STORE_PATH + ' (' + e.message + '); every device must pair again');
        return [];
    }
}
// Returns null, or the reason the keys could not be written (also logged).
function save() {
    try { fs.writeFileSync(STORE_PATH, JSON.stringify({sessions: sessions}), {mode: 384}); return null; }
    catch (e) { console.error('Sign-in: could not save ' + STORE_PATH + ' (' + e.message + ')'); return e.message; }
}
function live(now) { return sessions.filter(function (s) { return s.expires > now; }); }
var FULL = 'This TV already has ' + MAX_SESSIONS + ' paired devices. Sign one out, or use Sign out all devices, before pairing another.';
function hash(key) { return crypto.createHash('sha256').update(key).digest('hex'); }
// Constant-time compare. crypto.timingSafeEqual is missing on Node 4.4 (Tizen 5.5), so fall back to XOR.
function same(a, b) {
    a = Buffer.from(String(a)); b = Buffer.from(String(b));
    if (a.length !== b.length) return false;
    if (crypto.timingSafeEqual) return crypto.timingSafeEqual(a, b);
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
}

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
function pairIdOf(req) {
    var m = new RegExp('(?:^|;\\s*)' + PAIR_COOKIE + '=([0-9a-f]{32})').exec((req.headers || {}).cookie || '');
    return m ? m[1] : null;
}
// True when this request comes from the browser that started the pairing that is still waiting.
function ownsPending(req, now) {
    var id = pairIdOf(req);
    return !!(pending && pending.expires > now && id && same(pending.id, id));
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
    // A waiting code is never replaced, not even for the browser that asked for it: that browser resumes it (see /auth/state).
    if (pending && pending.expires > now) {
        var left = Math.ceil((pending.expires - now) / 1000);
        return json(res, 429, {error: ownsPending(req, now) ? 'The code is already on the TV screen. Enter it, or wait ' + left + ' seconds for a new one.' :
            'Another device is pairing right now. Try again in ' + left + ' seconds.', expiresIn: left, mine: ownsPending(req, now)});
    }
    if (now - lastPairAt < 10000) return json(res, 429, {error: 'Wait a few seconds and try again'});
    if (live(now).length >= MAX_SESSIONS) return json(res, 409, {error: FULL});
    lastPairAt = now;
    body(req, function (p) {
        var name = String(p.name || 'Browser').replace(/[^\w .()+-]/g, '').slice(0, 40) || 'Browser';
        pending = {id: crypto.randomBytes(16).toString('hex'), code: String(1000000 + crypto.randomBytes(4).readUInt32BE(0) % 1000000).slice(1),
            name: name, expires: now + CODE_MS, tries: 0};
        if (onPair) try { onPair(); } catch (e) {}
        json(res, 200, {id: pending.id, expiresIn: CODE_MS / 1000},
            {'set-cookie': PAIR_COOKIE + '=' + pending.id + '; Max-Age=' + CODE_MS / 1000 + '; Path=/auth; HttpOnly; SameSite=Strict'});
    });
}

function confirmPair(req, res) {
    body(req, function (p) {
        var now = Date.now();
        var pid = p.id || pairIdOf(req);
        if (!pending || pending.expires < now) return json(res, 410, {error: 'This code expired; start again'});
        if (!pid || !same(pending.id, pid)) return json(res, 410, {error: 'This code was asked for by another browser or tab; start again'});
        if (!same(pending.code, String(p.code || '').replace(/\D/g, ''))) {
            if (++pending.tries >= MAX_TRIES) pending = null;
            return json(res, 403, {error: pending ? 'Wrong code' : 'Too many wrong codes; start again'});
        }
        sessions = live(now);
        if (sessions.length >= MAX_SESSIONS) { pending = null; return json(res, 409, {error: FULL}); }
        var key = crypto.randomBytes(32).toString('hex');
        sessions.push({hash: hash(key), name: pending.name, created: now, seen: now, expires: now + KEY_DAYS * 86400000});
        pending = null;
        var failed = save(), reply = {ok: true, token: key};
        if (failed) reply.warning = 'Paired, but the key could not be saved on the TV (' + failed + '): this device will have to pair again after the service restarts.';
        json(res, 200, reply,
            {'set-cookie': [COOKIE + '=' + key + '; Max-Age=' + KEY_DAYS * 86400 + '; Path=/; HttpOnly; SameSite=Strict',
                PAIR_COOKIE + '=; Max-Age=0; Path=/auth; HttpOnly; SameSite=Strict']});
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
    // App-only mode has no TV adapter and no TV to show a code; it keeps the host check.
    if (options.open) return hostOk(req) ? false : (json(res, 403, {error: 'Use an IP address or localhost'}), true);
    // The TV-app bypass needs an IP or localhost Host: a rebound hostname on loopback must still pair.
    var local = tvApp(req) && hostOk(req);

    if ((url === '/auth/pair' || url === '/auth/confirm') && req.method === 'POST') {
        if (!originOk(req)) return json(res, 403, {error: 'Cross-site request refused'}), true;
        return (url === '/auth/pair' ? startPair(req, res, onPair) : confirmPair(req, res)), true;
    }
    // What the sign-in page needs after a reload: is a code waiting, and was it asked for by this browser?
    if (url === '/auth/state' && req.method === 'GET') {
        var t = Date.now(), live0 = pending && pending.expires > t;
        return json(res, 200, {pending: !!live0, mine: ownsPending(req, t), expiresIn: live0 ? Math.ceil((pending.expires - t) / 1000) : 0}), true;
    }
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

// Sign out, added to the dashboard: two small buttons at the end of the sidebar footer (the dashboard's own tokens and
// button style), so nothing floats over the toasts. On a narrow screen, where the footer is hidden, they join the bar; without a sidebar they stay at the bottom left.
var BAR = '<div id="gaAuth"><button type="button" id="gaOut">Sign out</button><button type="button" id="gaAll">Sign out all devices</button></div>' +
    '<style>#gaAuth{display:flex;flex-wrap:wrap;gap:var(--s1,4px);padding:var(--s3,12px) 0 0}' +
    '#gaAuth button{height:32px;padding:0 var(--s3,12px);font-size:var(--fs-s,12px);color:var(--muted,#aab8d1);background:transparent}' +
    '#gaAuth button:hover{color:var(--text,#f5f8ff)}' +
    '#gaAuth.loose{position:fixed;left:12px;bottom:12px;z-index:3;padding:0}' +
    '@media(max-width:620px){#gaAuth{flex-wrap:nowrap;white-space:nowrap;padding:0}}</style>' +
    '<script>(function(){var box=document.getElementById("gaAuth"),side=document.querySelector(".sidebar"),foot=side&&side.querySelector("footer");' +
    'if(foot&&getComputedStyle(foot).display!=="none")foot.appendChild(box);else if(side)side.appendChild(box);else box.className="loose";' +
    'function post(u){fetch(u,{method:"POST"}).then(function(){location.reload()})}' +
    'document.getElementById("gaOut").onclick=function(){post("/auth/signout")};' +
    'document.getElementById("gaAll").onclick=function(){if(confirm("Sign out every paired browser and script?"))post("/auth/signout-all")};})();</script>';
function decorate(html) { return html.indexOf('</body>') >= 0 ? html.replace('</body>', BAR + '</body>') : html + BAR; }

// The sign-in page uses the dashboard's tokens (design-system/tokens.css, dark) with the same control sizes.
var LOGIN = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark">' +
'<title>Vetro sign-in</title><style>:root{--bg:#080f23;--surface:#101c35;--raised:#192943;--text:#f5f8ff;--muted:#aab8d1;--border:#344360;--action:#123bb5;--action-hover:#0e3095;--link:#8fbaff;--danger:rgb(239,138,128)}' +
'*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:16px}' +
'main{width:100%;max-width:420px;padding:32px;background:var(--surface);border:1px solid var(--border);border-radius:16px}' +
'.brand{font-size:14px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0 0 16px}h1{font-size:24px;line-height:1.15;font-weight:500;letter-spacing:-.02em;margin:0 0 8px}p{color:var(--muted);margin:0 0 24px;font-size:14px}' +
'label{display:block;font-size:14px;color:var(--muted);margin-bottom:8px}' +
'input,button{font:inherit;height:44px;border-radius:8px;border:1px solid var(--border);width:100%}' +
'input{background:var(--raised);color:var(--text);font-size:24px;letter-spacing:8px;text-align:center;padding:0 16px}' +
'button{margin-top:16px;background:var(--action);border-color:var(--action);color:var(--text);font-weight:600;cursor:pointer}button:hover{background:var(--action-hover);border-color:var(--action-hover)}' +
'#s1 button{margin-top:0}input:focus-visible,button:focus-visible{outline:2px solid var(--link);outline-offset:3px}' +
'.msg{margin-top:16px;min-height:1.5em;font-size:14px;color:var(--muted)}.err{color:var(--danger)}[hidden]{display:none}</style></head><body><main>' +
'<div class="brand">Vetro</div>' +
'<h1>Pair with your TV</h1><p>Vetro controls your TV as root, so each browser pairs once with a code shown on the TV. If no code appears, open the Vetro app on the TV.</p>' +
'<div id="s1"><button id="start">Show a code on the TV</button></div>' +
'<form id="s2" hidden><label for="code">Code shown on the TV</label><input id="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000"><button>Pair</button></form>' +
'<div class="msg" id="msg" role="status" aria-live="polite"></div></main><script>' +
'var id,wait,$=function(i){return document.getElementById(i)},say=function(t,e){$("msg").textContent=t;$("msg").className=e?"msg err":"msg"};' +
'function call(u,b){return fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)}).then(function(r){return r.json().then(function(d){if(!r.ok){var x=Error(d.error);x.data=d;throw x}return d})})}' +
'function enter(left){$("s1").hidden=true;$("s2").hidden=false;$("code").focus();say("Enter the 6-digit code shown on the TV screen. It expires in "+left+" seconds.")}' +
'function busy(left,mine){clearTimeout(wait);$("start").disabled=true;(function tick(){if(left<=0){$("start").disabled=false;say("The code expired. You can ask for a new one.");return}say((mine?"A code is waiting on the TV. ":"Another device is pairing right now. ")+"You can ask for a new code in "+left+" seconds.");left--;wait=setTimeout(tick,1000)})()}' +
'$("start").onclick=function(){say("Asking the TV…");call("/auth/pair",{name:navigator.platform||"Browser"}).then(function(d){id=d.id;enter(d.expiresIn)}).catch(function(e){if(e.data&&e.data.mine){id=null;enter(e.data.expiresIn)}else if(e.data&&e.data.expiresIn)busy(e.data.expiresIn,false);else say(e.message,1)})};' +
'$("s2").onsubmit=function(e){e.preventDefault();call("/auth/confirm",{id:id,code:$("code").value}).then(function(d){say(d.warning||"Paired.",!!d.warning);setTimeout(function(){location.reload()},d.warning?6000:300)}).catch(function(e){say(e.message,1);if(/start again/.test(e.message)){$("s1").hidden=false;$("s2").hidden=true}})};' +
'fetch("/auth/state").then(function(r){return r.json()}).then(function(d){if(!d.pending)return;if(d.mine)enter(d.expiresIn);else busy(d.expiresIn,false)}).catch(function(){});' +
'</script></body></html>';

module.exports = {gate: gate, decorate: decorate, tvApp: tvApp, hostOk: hostOk, originOk: originOk, STORE_PATH: STORE_PATH,
    _reset: function () { sessions = []; pending = null; lastPairAt = 0; },
    _unthrottle: function () { lastPairAt = 0; }};
