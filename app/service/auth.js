'use strict';

// Sign-in for the dashboard and API.
//
// Pairing is AUTOMATIC by default (republished 0.5.0): it turns on by itself the first time the Vetro app on the TV is seen
// (a request from the TV with the page's opaque Origin), because that proves the TV can show the code. Until then, and on a
// TV whose page is never recognised (Q8F, Tizen 9, firmware 1300.9), the service behaves like 0.3.5: any device on the home
// network may use the dashboard and API, so nobody is locked out by a code that can never appear. The owner can also choose:
// "Require pairing" on (always) or off (never), in the dashboard (Settings, Developer). The same-origin and rebinding
// checks below apply in every mode.
//
// With pairing on, any LAN client would otherwise be able to use the root-backed routes, and any web page opened by a
// browser on the LAN could post to them. So:
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
var atomicFile = require('./atomic-file.js');
var os = require('os');
var fs = require('fs');
// Regular expressions compiled once at module load, not on every call.
var HOST_PORT_RE = /:\d+$/;
var HOST_BRACKETS_RE = /^\[|\]$/g;
var IPV4_HOST_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
var IPV6_HOST_RE = /^[0-9a-f:]+$/i;
var BEARER_RE = /^Bearer\s+([0-9a-f]{64})$/i;
var PAIR_NAME_CHARS_RE = /[^\w .()+-]/g;
var NON_DIGIT_RE = /\D/g;

var STORE_PATH = process.env.VETRO_AUTH_PATH || '/opt/usr/home/owner/share/vetro-auth.json';
var COOKIE = 'vetro_session';
var PAIR_COOKIE = 'vetro_pair';   // the pairing id, kept by the browser that asked for the code so a reload does not lose it
var SESSION_COOKIE_RE = new RegExp('(?:^|;\\s*)' + COOKIE + '=([0-9a-f]{64})');
var PAIR_COOKIE_RE = new RegExp('(?:^|;\\s*)' + PAIR_COOKIE + '=([0-9a-f]{32})');
var KEY_DAYS = 365;
var CODE_MS = 2 * 60000;
var MAX_TRIES = 5;
var MAX_SESSIONS = 20;

var MODE_PATH = STORE_PATH + '.mode';
var TV_PATH = STORE_PATH + '.tv';
var pairingChoice = loadMode();   // 'auto' (never chosen), 'on' or 'off'
var tvSeen = loadTvSeen();        // the Vetro app on the TV has been recognised at least once
var sessions = load();
var pending = null;          // {id, code, name, expires, tries}
var lastPairAt = 0;

// What the owner chose; the file is written only by an explicit choice, so:
//  - no file: never chosen, 'auto' (also every first-release 0.5.0 install that never touched the switch);
//  - {"enabled": true|false}: the choice (this build also writes "disabled", the opposite, so going back to the first 0.5.0 release reads the same);
//  - first-release 0.5.0 files: {"disabled": true} is off; {"disabled": false} was only written when someone switched pairing back on
//    (or Restore did), so it stays on;
//  - a file that is there but unreadable or not understood: 'on'. It exists because someone chose, and the safe reading
//    wins (the file can be removed to go back to 'auto').
function loadMode() {
    var raw;
    try { raw = fs.readFileSync(MODE_PATH, 'utf8'); }
    catch (e) {
        if (e.code === 'ENOENT') return 'auto';
        console.error('Pairing: could not read ' + MODE_PATH + ' (' + e.message + '); pairing stays on');
        return 'on';
    }
    try {
        var d = JSON.parse(raw);
        if (d && typeof d.enabled === 'boolean') return d.enabled ? 'on' : 'off';
        if (d && typeof d.disabled === 'boolean') return d.disabled ? 'off' : 'on';
    } catch (e) {}
    console.error('Pairing: could not understand ' + MODE_PATH + '; pairing stays on');
    return 'on';
}
function loadTvSeen() {
    try { return JSON.parse(fs.readFileSync(TV_PATH, 'utf8')).seen === true; }
    catch (e) { return false; }
}
// Pairing is required when the owner said so, or (automatic) once the TV app has been seen.
function pairingOn() { return pairingChoice === 'on' || (pairingChoice === 'auto' && tvSeen); }
function pairingMode() { return {enabled: pairingOn(), disabled: !pairingOn(), mode: pairingChoice, tvSeen: tvSeen}; }
function setPairingEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Invalid pairing mode');
    var tmp = MODE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({enabled: enabled, disabled: !enabled}) + '\n', {mode: 384});
    fs.renameSync(tmp, MODE_PATH);
    var read = loadMode();
    if (read !== (enabled ? 'on' : 'off')) throw new Error('Pairing mode was not confirmed');
    pairingChoice = read;
    pending = null;
    return pairingMode();
}
// The Vetro app on the TV reached the service as the TV itself (opaque Origin, TV address): from now on, in automatic mode,
// pairing is required. Kept in a file, so it survives restarts. Not written again once known.
function markTvSeen() {
    if (tvSeen) return;
    tvSeen = true;
    try { atomicFile.write(fs, TV_PATH, JSON.stringify({seen: true}), {mode: 384}); }
    catch (e) { console.error('Pairing: could not save ' + TV_PATH + ' (' + e.message + '); automatic pairing starts again as open after a restart'); }
}

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
    try { atomicFile.write(fs, STORE_PATH, JSON.stringify({sessions: sessions}), {mode: 384}); return null; }
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

// A connection made from this TV itself: loopback (all of 127.0.0.0/8, as some TVs may not use 127.0.0.1 itself), or the TV's own LAN address. Some TVs (The Frame 2025, Tizen 9, #122)
// block apps from loopback, so the TV app reaches the service through the TV's own address instead. The source address
// of a connection from another device is that device's, so only a program running on the TV can come from here, which
// is exactly who may use loopback. Idea and measurements: skjnldsv (#122, #123). The list of the TV's addresses is read
// at most every five seconds; an address that is not on it is not the TV.
var LOOPBACK_RE = /^(::ffff:)?127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/i;
var MAPPED_RE = /^::ffff:/i;
var OWN_TTL_MS = 5000;
var ownCache = {at: 0, list: []};
var interfaces = function () { return os.networkInterfaces(); };
function ownAddresses() {
    var now = Date.now();
    if (now - ownCache.at < OWN_TTL_MS && now >= ownCache.at) return ownCache.list;
    var list = [];
    try {
        var nets = interfaces() || {};
        Object.keys(nets).forEach(function (name) {
            (nets[name] || []).forEach(function (n) { if (n && (n.family === 'IPv4' || n.family === 4) && !n.internal && n.address && n.address !== '0.0.0.0') list.push(n.address); });
        });
    } catch (e) { list = []; }
    ownCache = {at: now, list: list};
    return list;
}
function fromThisTv(address) {
    var a = String(address || '');
    if (a === '::1' || LOOPBACK_RE.test(a)) return true;
    return ownAddresses().indexOf(a.replace(MAPPED_RE, '')) >= 0;
}
// The fake requests in Vetro's test harness have no socket; real ones always do.
function isLoopback(req) {
    return fromThisTv(req.socket ? req.socket.remoteAddress : '127.0.0.1');
}
function tvApp(req) {
    var o = (req.headers || {}).origin;
    return isLoopback(req) && (o === undefined || o === 'null');
}
function hostOk(req) {
    var host = String((req.headers || {}).host || '').replace(HOST_PORT_RE, '').replace(HOST_BRACKETS_RE, '');
    return host === '' || host === 'localhost' || IPV4_HOST_RE.test(host) || IPV6_HOST_RE.test(host);
}
function originOk(req) {
    var o = (req.headers || {}).origin;
    return o === undefined || o === 'null' || o === 'http://' + (req.headers || {}).host;
}

// What the service saw of a refused request: shown on the TV screen, so the next report says why the page was refused
// instead of a bare "Failed to fetch". Only the caller's own address and headers go back to it.
function seenBy(req) {
    var h = req.headers || {};
    return {address: String(req.socket ? req.socket.remoteAddress : '127.0.0.1').slice(0, 64),
        origin: h.origin === undefined ? null : String(h.origin).slice(0, 100), host: String(h.host || '').slice(0, 100)};
}
// The routes the Vetro app on the TV calls. Their refusals can be read by any page (no cookies, no data, only the reason).
var WIDGET_ROUTES = {'/status': true, '/probe': true, '/screen': true, '/auth/pending': true};
function refuse(req, res, url, code, body) {
    var headers = {};
    if (WIDGET_ROUTES[url]) { body.seen = seenBy(req); headers['Access-Control-Allow-Origin'] = '*'; }
    json(res, code, body, headers);
    return true;
}
// The routes the TV page uses for its check; with pairing off they answer it from any address (as in 0.3.5).
// /screen/controls is a read: it only says what the quick controls show and whether this page may change them. The route that
// changes things (POST /screen/control) is deliberately not here: only the TV itself or a paired browser may use it.
var PAGE_ROUTES = {'/status': true, '/probe': true, '/screen': true, '/screen/controls': true};
// The Origin a packaged TV page sends: opaque ("null") on the TVs we know. A TV runtime may instead send its own scheme
// (file:, app:...); 0.3.5 never looked at it, so it is accepted too. A web site's origin is always http(s), and a
// sandboxed frame's is "null", so this lets no web page in that "null" did not already.
var WEB_ORIGIN_RE = /^https?:/i;
function pageOrigin(o) { return o === 'null' || (typeof o === 'string' && o !== '' && !WEB_ORIGIN_RE.test(o)); }

function keyOf(req) {
    var h = req.headers || {};
    var m = BEARER_RE.exec(h.authorization || '');
    if (m) return m[1];
    m = SESSION_COOKIE_RE.exec(h.cookie || '');
    return m ? m[1] : null;
}
function pairIdOf(req) {
    var m = PAIR_COOKIE_RE.exec((req.headers || {}).cookie || '');
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
        var name = String(p.name || 'Browser').replace(PAIR_NAME_CHARS_RE, '').slice(0, 40) || 'Browser';
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
        if (!same(pending.code, String(p.code || '').replace(NON_DIGIT_RE, ''))) {
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
    // Only the TV app sends the opaque Origin from the TV's own address; a program on the TV with no Origin does not count.
    if (local && WIDGET_ROUTES[url] && (req.headers || {}).origin === 'null') markTvSeen();

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
        if (!local) return refuse(req, res, url, 403, {error: 'TV apps only: this request did not come from the TV itself',
            pending: !!(pending && pending.expires > Date.now())});
        var live = pending && pending.expires > Date.now();
        return json(res, 200, live ? {code: pending.code, name: pending.name, expiresIn: Math.round((pending.expires - Date.now()) / 1000)} : {code: null},
            {'Access-Control-Allow-Origin': 'null'}), true;
    }

    if (local) {
        if (url === '/auth/signout-all' && req.method === 'POST') return signOut(res, true), true;
        return false;
    }

    var s = sessionOf(req);
    if (s && !originOk(req)) return refuse(req, res, url, 403, {error: 'Cross-site request refused'});
    if (!s && !pairingOn()) {
        // Pairing off (or not yet automatic) does not turn off the same-origin and rebinding checks. A TV page Origin (opaque, or a non-web scheme)
        // is allowed only on the routes the TV page uses for its check, as in 0.3.5: there the page answers from any
        // address, so a TV whose page is not recognised as the TV itself (Tizen 9 Q8F) still works. Everything else with
        // an opaque Origin is refused.
        var origin = (req.headers || {}).origin;
        if (hostOk(req) && PAGE_ROUTES[url] && pageOrigin(origin)) return false;
        if (!hostOk(req) || !originOk(req) || origin === 'null') {
            return refuse(req, res, url, 403, {error: 'Use an IP address or localhost with a matching browser origin'});
        }
        return false;
    }
    if (!s) {
        // The sign-in page shows the Vetro logo: the icon is public.
        if (url === '/icon.png' && req.method === 'GET') return false;
        if ((url === '/' || url === '/index.html') && req.method === 'GET') {
            res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'});
            return res.end(LOGIN), true;
        }
        return refuse(req, res, url, 401, {error: 'Pair this device first: open the dashboard and enter the code shown on the TV'});
    }
    if (url === '/auth/signout' && req.method === 'POST') return signOut(res, false, s), true;
    if (url === '/auth/signout-all' && req.method === 'POST') return signOut(res, true), true;
    if (url === '/auth/devices' && req.method === 'GET') {
        return json(res, 200, {devices: sessions.map(function (x) { return {name: x.name, created: x.created, seen: x.seen, current: x === s}; })}), true;
    }
    return false;
}

// Sign out, added to the dashboard: one small button at the end of the sidebar footer (the dashboard's own tokens and
// button style), so nothing floats over the toasts. It opens a dialog that asks whether to sign out only this device
// or every device. On a narrow screen, where the footer is hidden, the button joins the bar; without a sidebar it stays at the bottom left.
var BAR = '<div id="gaAuth"><button type="button" id="gaOut" aria-haspopup="dialog">Sign out</button></div>' +
    '<dialog id="gaDlg" aria-labelledby="gaTitle"><div class="gaBox"><h2 id="gaTitle">Sign out of Vetro</h2>' +
    '<p>Do you want to sign out only this browser, or every paired browser and script? Signed-out devices pair again with a code shown on the TV.</p>' +
    '<div class="gaRow"><button type="button" id="gaThis" class="gaMain">Only this device</button><button type="button" id="gaAll">All devices</button><button type="button" id="gaNo">Cancel</button></div>' +
    '<p id="gaMsg" role="status" aria-live="polite"></p></div></dialog>' +
    '<style>#gaAuth{display:flex;flex-wrap:wrap;gap:var(--s1,4px);padding:var(--s3,12px) 0 0}' +
    '#gaAuth button{height:auto;min-height:44px;padding:0 var(--s3,12px);font-size:var(--fs-s,12px);color:var(--muted,#aab8d1);background:transparent}' +
    '#gaAuth button:hover{color:var(--text,#f5f8ff)}' +
    '#gaAuth.loose{position:fixed;left:12px;bottom:12px;z-index:3;padding:0}' +
    '#gaDlg{width:min(440px,calc(100% - 32px));padding:0;border:1px solid var(--border,#344360);border-radius:16px;background:var(--surface,#101c35);color:var(--text,#f5f8ff)}' +
    '#gaDlg::backdrop{background:var(--overlay,rgba(0,8,35,.62))}' +
    '#gaDlg .gaBox{padding:24px;display:grid;gap:12px}#gaDlg h2{margin:0;font-size:20px;font-weight:500}#gaDlg p{margin:0;color:var(--muted,#aab8d1);line-height:1.5}' +
    '#gaDlg .gaRow{display:grid;gap:8px;margin-top:8px}#gaDlg .gaRow button{min-height:44px;width:100%}' +
    '#gaDlg .gaMain{background:var(--action,#123bb5);border-color:var(--action,#123bb5);color:var(--text,#f5f8ff);font-weight:600}' +
    '@media(max-width:620px){#gaAuth{flex-wrap:nowrap;white-space:nowrap;padding:0}}</style>' +
    '<script>(function(){var box=document.getElementById("gaAuth"),side=document.querySelector(".sidebar"),foot=side&&side.querySelector("footer"),dlg=document.getElementById("gaDlg"),msg=document.getElementById("gaMsg");' +
    'if(foot&&getComputedStyle(foot).display!=="none")foot.appendChild(box);else if(side)side.appendChild(box);else box.className="loose";' +
    'function shut(){if(dlg.close)dlg.close();else dlg.removeAttribute("open")}' +
    'function post(u){msg.textContent="";fetch(u,{method:"POST"}).then(function(r){if(!r.ok)throw Error("The TV answered "+r.status);location.reload()}).catch(function(e){msg.textContent="Could not sign out: "+e.message})}' +
    'document.getElementById("gaOut").onclick=function(){msg.textContent="";if(dlg.showModal)dlg.showModal();else dlg.setAttribute("open","");document.getElementById("gaThis").focus()};' +
    'document.getElementById("gaThis").onclick=function(){post("/auth/signout")};' +
    'document.getElementById("gaAll").onclick=function(){post("/auth/signout-all")};' +
    'document.getElementById("gaNo").onclick=shut;' +
    'dlg.onclick=function(e){if(e.target===dlg)shut()};})();</script>';
function decorate(html) { return html.indexOf('</body>') >= 0 ? html.replace('</body>', BAR + '</body>') : html + BAR; }

// The sign-in page uses the dashboard's tokens (design-system/tokens.css, dark) with the same control sizes.
var LOGIN = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content"><meta name="color-scheme" content="dark">' +
'<title>Vetro sign-in</title><style>:root{--bg:#080f23;--surface:#101c35;--raised:#192943;--text:#f5f8ff;--muted:#aab8d1;--border:#344360;--control-border:#7183a2;--action:#123bb5;--action-hover:#0e3095;--link:#8fbaff;--danger:rgb(239,138,128)}' +
'*{box-sizing:border-box}body{margin:0;min-height:100vh;min-height:100svh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:16px;padding:max(16px,env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-right,0px)) max(16px,env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px))}' +
'main{width:100%;max-width:420px;padding:32px;background:var(--surface);border:1px solid var(--border);border-radius:16px}' +
'.brand{display:flex;align-items:center;gap:12px;font-size:22px;font-weight:500;letter-spacing:-.01em;margin:0 0 20px}.brand img{width:44px;height:44px;border-radius:22%;display:block}h1{font-size:24px;line-height:1.15;font-weight:500;letter-spacing:-.02em;margin:0 0 8px}p{color:var(--muted);margin:0 0 24px;font-size:14px}' +
'label{display:block;font-size:14px;color:var(--muted);margin-bottom:8px}' +
'.steps{margin:0 0 20px;padding:0 0 0 20px;color:var(--muted);font-size:14px;line-height:1.6}.steps b,.help b{color:var(--text);font-weight:500}' +
'.help{margin-top:20px;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:var(--raised);color:var(--muted);font-size:14px;line-height:1.5}' +
'input,button{font:inherit;height:44px;border-radius:8px;border:1px solid var(--control-border);width:100%}' +
'input{background:var(--raised);color:var(--text);font-size:24px;letter-spacing:8px;text-align:center;padding:0 16px}' +
'button{margin-top:16px;background:var(--action);border-color:var(--action);color:var(--text);font-weight:600;cursor:pointer}button:hover{background:var(--action-hover);border-color:var(--action-hover)}' +
'#s1 button{margin-top:0}input:focus-visible,button:focus-visible{outline:2px solid var(--link);outline-offset:3px}' +
'.msg{margin-top:16px;min-height:1.5em;font-size:14px;color:var(--muted)}.err{color:var(--danger)}[hidden]{display:none}</style></head><body><main>' +
'<div class="brand"><img src="/icon.png" alt="" width="44" height="44"><span>vetro</span></div>' +
'<h1>Pair with your TV</h1><p>Vetro controls your TV as root, so each browser pairs once with a code shown on the TV screen.</p>' +
'<ol class="steps"><li>Press <b>Show a code on the TV</b>.</li><li>Look at the TV: a 6-digit code appears on the screen.</li><li>Type the code here.</li></ol>' +
'<div id="s1"><button id="start">Show a code on the TV</button></div>' +
'<form id="s2" hidden><label for="code">Code shown on the TV</label><input id="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000"><button>Pair</button></form>' +
'<div class="help" role="note"><b>No code on the TV?</b> Open the <b>Vetro app</b> on the TV (Apps, then Vetro), wait a few seconds and press the button again. The TV has to be on and connected to the same network.</div>' +
'<div class="msg" id="msg" role="status" aria-live="polite"></div></main><script>' +
'var id,wait,$=function(i){return document.getElementById(i)},say=function(t,e){$("msg").textContent=t;$("msg").className=e?"msg err":"msg"};' +
'function call(u,b){return fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)}).then(function(r){return r.json().then(function(d){if(!r.ok){var x=Error(d.error);x.data=d;throw x}return d})})}' +
'function enter(left){$("s1").hidden=true;$("s2").hidden=false;$("code").focus();say("Enter the 6-digit code shown on the TV screen. It expires in "+left+" seconds.")}' +
'function busy(left,mine){clearTimeout(wait);$("start").disabled=true;(function tick(){if(left<=0){$("start").disabled=false;say("The code expired. You can ask for a new one.");return}say((mine?"A code is waiting on the TV. ":"Another device is pairing right now. ")+"You can ask for a new code in "+left+" seconds.");left--;wait=setTimeout(tick,1000)})()}' +
'$("start").onclick=function(){say("Asking the TV…");call("/auth/pair",{name:navigator.platform||"Browser"}).then(function(d){id=d.id;enter(d.expiresIn)}).catch(function(e){if(e.data&&e.data.mine){id=null;enter(e.data.expiresIn)}else if(e.data&&e.data.expiresIn)busy(e.data.expiresIn,false);else say(e.message,1)})};' +
'$("s2").onsubmit=function(e){e.preventDefault();call("/auth/confirm",{id:id,code:$("code").value}).then(function(d){say(d.warning||"Paired.",!!d.warning);setTimeout(function(){location.reload()},d.warning?6000:300)}).catch(function(e){say(e.message,1);if(/start again/.test(e.message)){$("s1").hidden=false;$("s2").hidden=true}})};' +
'fetch("/auth/state").then(function(r){return r.json()}).then(function(d){if(!d.pending)return;if(d.mine)enter(d.expiresIn);else busy(d.expiresIn,false)}).catch(function(){});' +
'</script></body></html>';

// True for the TV itself and for a paired device: who may turn pairing on without locking themselves out.
function trusted(req) { return (tvApp(req) && hostOk(req)) || !!sessionOf(req); }

module.exports = {pendingLive: function () { return !!(pending && pending.expires > Date.now()); }, pairingMode: pairingMode, setPairingEnabled: setPairingEnabled, trusted: trusted, pageOrigin: pageOrigin, MODE_PATH: MODE_PATH, TV_PATH: TV_PATH, gate: gate, decorate: decorate, tvApp: tvApp, fromThisTv: fromThisTv, hostOk: hostOk, originOk: originOk, STORE_PATH: STORE_PATH,
    _reset: function () { sessions = []; pending = null; lastPairAt = 0; },
    _forgetTv: function () { tvSeen = false; },
    _ownAddresses: function (fn) { interfaces = fn || function () { return os.networkInterfaces(); }; ownCache = {at: 0, list: []}; },
    _unthrottle: function () { lastPairAt = 0; }};
