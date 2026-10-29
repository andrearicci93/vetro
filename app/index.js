// The TV screen. BASE, SERVICE_DOWN_HINT and NO_ADDRESS_HINT come from index.html, which holds everything that names the port.
var ICON = 'icon.png';
var IDLE_MS = 300000;
var LOADER_DELAY_MS = 100;
var report = {probe: {}, apps: [], packages: [], settings: {}};
var delivered = false, running = false, idleTimer = null, loaderTimer = null;
// The service keeps running without this page; a resident page only holds memory.
function leave() { try { tizen.application.getCurrentApplication().exit(); } catch (e) {} }
// Every probe gets a time limit: a Tizen call whose callback never fires must not leave the screen on "Checking".
function attempt(name, fn, limit) {
  limit = limit || 8000;
  return new Promise(function (resolve) {
    var done = false, timer = setTimeout(function () { finish({ok: false, error: 'no answer in ' + Math.round(limit / 1000) + ' s'}); }, limit);
    function finish(r) { if (done) return; done = true; clearTimeout(timer); report.probe[name] = r; resolve(); }
    try {
      Promise.resolve(fn()).then(function (v) { finish({ok: true, value: v}); },
        function (e) { finish({ok: false, error: String(e && e.message || e)}); });
    } catch (e) { finish({ok: false, error: String(e && e.message || e)}); }
  });
}
// A public-level certificate may not get the on-boot start honored, so the page starts the service itself.
function launchService() {
  return cb(function (ok, ko) { tizen.application.launch('vetrotvapp.svc', ok, ko); });
}
function reach(tries) {
  return fetch(BASE + '/status').then(function (r) { return r.status; }, function (e) {
    if (tries <= 1) throw e;
    return new Promise(function (resolve) { setTimeout(resolve, 1500); }).then(function () { return reach(tries - 1); });
  });
}
function cb(call) { return new Promise(function (ok, ko) { call(ok, ko); }); }
function sendReport() {
  return new Promise(function (resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', BASE + '/probe', true);
    xhr.timeout = 10000;
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function () {
      var result;
      try { result = JSON.parse(xhr.responseText); } catch (e) { return reject(new Error('Response is not JSON')); }
      if (xhr.status !== 200 || result.ok !== true) return reject(new Error('Report rejected: HTTP ' + xhr.status));
      resolve({status: xhr.status, persisted: result.persisted});
    };
    xhr.onerror = function () { reject(new Error('Report send failed')); };
    xhr.ontimeout = function () { reject(new Error('Report send timeout')); };
    xhr.send(JSON.stringify(report));
  });
}
// What the TV screen shows: one small JSON read. The launcher check inside it can take a few seconds.
function readScreen() {
  return new Promise(function (resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', BASE + '/screen', true);
    xhr.timeout = 12000;
    xhr.onload = function () {
      var d;
      try { d = JSON.parse(xhr.responseText); } catch (e) { return reject(new Error('Response is not JSON')); }
      if (xhr.status !== 200 || !d || d.error) return reject(new Error('HTTP ' + xhr.status));
      resolve(d);
    };
    xhr.onerror = function () { reject(new Error('Service unreachable')); };
    xhr.ontimeout = function () { reject(new Error('Service timeout')); };
    xhr.send();
  });
}
function tryConnect(port) {
  return new Promise(function (resolve, reject) {
    var ws = new WebSocket('ws://127.0.0.1:' + port + '/api/v2/channels/samsung.remote.control?name=' + btoa('Vetro'));
    var t = setTimeout(function () { try { ws.close(); } catch (e) {} reject(new Error('timeout')); }, 4000);
    ws.onopen = function () { clearTimeout(t); ws.close(); resolve('open'); };
    ws.onerror = function () { clearTimeout(t); reject(new Error('refused')); };
  });
}
var jobs = [
  ['serviceLaunch', launchService],
  ['tizenObject', function () { return typeof tizen !== 'undefined'; }],
  ['webapisObject', function () { return typeof webapis !== 'undefined'; }],
  ['supportedKeys', function () { return tizen.tvinputdevice.getSupportedKeys().map(function (k) { return k.name; }); }],
  ['apps', function () { return cb(function (ok, ko) { tizen.application.getAppsInfo(ok, ko); }).then(function (a) {
      report.apps = a.map(function (x) { return {id: x.id, name: x.name, packageId: x.packageId, show: x.show}; });
      return a.length; }); }],
  ['packages', function () { return cb(function (ok, ko) { tizen.package.getPackagesInfo(ok, ko); }).then(function (p) {
      report.packages = p.map(function (x) { return {id: x.id, version: x.version, totalSize: x.totalSize, author: x.author}; });
      return p.length; }); }],
  ['productinfo', function () {
      ['getModel', 'getRealModel', 'getFirmware', 'getModelCode', 'getLocalSet', 'getSmartTVServerType'].forEach(function (m) {
        var id = {getModel: 'model', getRealModel: 'realModel', getFirmware: 'firmware', getModelCode: 'modelCode',
          getLocalSet: 'localSet', getSmartTVServerType: 'smartHubServer'}[m];
        try { report.settings[id] = webapis.productinfo[m](); } catch (e) {}
      });
      return Object.keys(report.settings).length; }],
  ['systeminfoBattery', function () { return cb(function (ok, ko) { tizen.systeminfo.getPropertyValue('BUILD', ok, ko); }); }],
  ['remoteApi8001', function () { return tryConnect(8001); }],
  ['serviceReach', function () { return reach(8); }, 25000]
];

// ---- the screen -------------------------------------------------------------------------------------------
var ICONS = {
  ok: '<svg class="ic" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="none" stroke="#7fcba0" stroke-width="3"/><path d="M11.5 20.5l6 6 11-12.5" fill="none" stroke="#7fcba0" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  warn: '<svg class="ic" viewBox="0 0 40 40"><path d="M20 4.5l17 29.5H3z" fill="none" stroke="#e2b867" stroke-width="3" stroke-linejoin="round"/><path d="M20 15v9" stroke="#e2b867" stroke-width="3.6" stroke-linecap="round"/><circle cx="20" cy="29" r="2.1" fill="#e2b867"/></svg>',
  bad: '<svg class="ic" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="none" stroke="#ef8a80" stroke-width="3"/><path d="M13.5 13.5l13 13M26.5 13.5l-13 13" stroke="#ef8a80" stroke-width="3.6" stroke-linecap="round"/></svg>',
  na: '<svg class="ic" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="none" stroke="#aab8d1" stroke-width="3" stroke-dasharray="5 5"/></svg>',
  wait: '<svg class="ic" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="none" stroke="#aab8d1" stroke-width="3" stroke-dasharray="5 5"/></svg>',
  off: '<svg class="ic" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="none" stroke="#aab8d1" stroke-width="3"/><path d="M12 20h16" stroke="#aab8d1" stroke-width="3.6" stroke-linecap="round"/></svg>'
};
function esc(v) { return String(v).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); }
function probeOk(name) { return !!(report.probe[name] && report.probe[name].ok); }
function appVersion() { try { return tizen.application.getCurrentApplication().appInfo.version || null; } catch (e) { return null; } }

// One check: [state, name, value, hint, token, tokenState]. state is ok | warn | bad | off | na. The token is the
// short form for the support line; it is upper case (and coloured) when something is wrong.
function checks(d) {
  var out = [], root, api, apiMissing = [], mem, l, i;
  if (!d) {
    out.push(['bad', 'Service', 'Not answering', SERVICE_DOWN_HINT, 'SVC DOWN', 'bad']);
  } else {
    var av = appVersion(), mismatch = av && d.version && av !== d.version;
    out.push(mismatch ? ['warn', 'Service', 'Version differs', 'The app is ' + esc(av) + ' and the service is ' + esc(d.version) + '. Reinstall Vetro so both match.', 'SVC ' + d.version + '/APP ' + av, 'warn']
      : ['ok', 'Service', 'Running', 'Port ' + esc(d.port), 'svc ok']);
  }
  if (!d) out.push(['na', 'Root access', 'Unknown', null, 'root ?']);
  else if (d.root.connected) out.push(['ok', 'Root access', 'Connected', null, 'root ok']);
  else if (d.root.mode === 'app-only') out.push(['warn', 'Root access', 'Not available', 'This is the app-only package. Features that need root are off.', 'ROOT NO', 'warn']);
  else out.push(['bad', 'Root access', 'Not connected', 'Features that need root are off. Restart the TV; if it stays like this, reinstall the root package.', 'ROOT DOWN', 'bad']);
  root = !!(d && d.root.connected);
  if (!d || !root) out.push(['na', 'Remote input', d ? 'Needs root' : 'Unknown', null, 'input ?']);
  else if (!d.input.enabled) out.push(['off', 'Remote input', 'Off', null, 'input off']);
  else if (d.input.connected) out.push(['ok', 'Remote input', 'Filtering', null, 'input ok']);
  else out.push(['bad', 'Remote input', 'Remote not found', 'The saved remote is not connected. Open Remote in the dashboard.', 'INPUT LOST', 'bad']);
  l = d && d.launcher;
  if (!d) out.push(['na', 'Launcher', 'Unknown', null, 'launcher ?']);
  else if (!l.installed) out.push(['na', 'Launcher', 'Not included', null, 'launcher n/a']);
  else if (!l.enabled) out.push(['off', 'Launcher', 'Off', null, 'launcher off']);
  else if (l.running === true) out.push(['ok', 'Launcher', 'Running', null, 'launcher ok']);
  else if (l.running === false) out.push(['bad', 'Launcher', l.failures ? 'Failed to start' : 'Not running',
    (l.failures ? 'Tried ' + esc(l.failures) + ' times. ' : '') + 'Open the Launcher tab in the dashboard and read the error.', 'LAUNCHER FAIL' + (l.failures ? ' x' + l.failures : ''), 'bad']);
  else out.push(['warn', 'Launcher', 'Cannot check', 'It needs root access to be checked.', 'LAUNCHER ?', 'warn']);
  ['tizenObject', 'webapisObject', 'apps', 'packages'].forEach(function (k) { if (!probeOk(k)) apiMissing.push(k.replace('Object', '')); });
  api = apiMissing.length ? ['warn', 'TV APIs', 'Limited', 'Not available: ' + esc(apiMissing.join(', ')) + '.', 'API ' + apiMissing.join('/'), 'warn'] : ['ok', 'TV APIs', 'Available', null, 'api ok'];
  out.push(api);
  mem = d && d.memory && d.memory.availableMb;
  if (typeof mem !== 'number') out.push(['na', 'Memory', 'Unknown', null, 'mem ?']);
  else if (mem < 200) out.push(['warn', 'Memory', mem + ' MB free', 'Low. The TV may feel slow.', 'MEM ' + mem + 'M', 'warn']);
  else out.push(['ok', 'Memory', mem + ' MB free', null, 'mem ' + mem + 'M']);
  return out;
}

function cell(c) {
  var cls = c[0] === 'bad' || c[0] === 'warn' || c[0] === 'na' || c[0] === 'wait' ? ' ' + c[0] : '';
  var value = esc(c[2]) + (c[3] && c[0] === 'ok' ? ' <span>&middot; ' + c[3] + '</span>' : '');
  return '<div class="c' + cls + '">' + ICONS[c[0]] + '<div><div class="n">' + esc(c[1]) + '</div><div class="v">' + value + '</div>' +
    (c[3] && c[0] !== 'ok' ? '<div class="h">' + c[3] + '</div>' : '') + '</div></div>';
}

var WAITING = [['Service', 'Starting'], ['Root access', 'Checking'], ['Remote input', 'Checking'], ['Launcher', 'Checking'], ['TV APIs', 'Checking'], ['Memory', 'Checking']];
function render(d, waiting) {
  var list = waiting ? WAITING.map(function (w) { return ['wait', w[0], w[1], null, '']; }) : checks(d), bad = 0, warn = 0, state, label, sum, device = report.settings, model, firmware, line, version, pin = d && typeof d.pin === 'string' ? d.pin : '';
  list.forEach(function (c) { if (waiting) return; if (c[0] === 'bad') bad++; else if (c[0] === 'warn') warn++; });
  if (waiting) { state = 'wait'; label = 'Checking'; sum = 'Checking'; }
  else if (!d) { state = 'bad'; label = 'Not responding'; sum = 'The service is down'; }
  else if (bad) { state = 'bad'; label = 'Needs attention'; sum = bad + (bad === 1 ? ' problem' : ' problems'); }
  else if (warn) { state = 'warn'; label = 'Running, with limits'; sum = warn + (warn === 1 ? ' thing to check' : ' things to check'); }
  else { state = 'ok'; label = 'Running in the background'; sum = 'All good. You can close this screen, Vetro keeps running without it.'; }
  version = (d && d.version) || appVersion();
  model = device.realModel || device.model;
  firmware = device.firmware ? String(device.firmware).split('-').pop() : null;   // T-NKM2DEUC-2310.0 -> 2310.0
  line = [esc('V' + (version || '?'))].concat(model ? [esc(model + (firmware ? ' ' + firmware : ''))] : []);
  if (!waiting) list.forEach(function (c) { line.push(c[5] ? '<em' + (c[5] === 'warn' ? ' class="w"' : '') + '>' + esc(c[4]) + '</em>' : esc(c[4])); });
  var addr = d && d.address ? 'http://' + d.address + ':' + d.port : null;
  var cells = '';
  list.forEach(function (c) { cells += cell(c); });
  document.getElementById('screen').innerHTML =
    '<div class="hero"><img src="' + ICON + '" alt="Vetro"><div><h1>Vetro</h1><div class="meta">' +
    (version ? 'Version ' + esc(version) : '') + (model ? ' &middot; ' + esc(model) : '') + (firmware ? ' &middot; firmware ' + esc(firmware) : '') +
    '</div><div class="state ' + (state === 'ok' ? '' : state) + '">' + ICONS[state] + esc(label) + '</div></div>' +
    '<div class="dash"><div class="dh"><small>DASHBOARD</small><div class="pin" id="pin"' + (pin ? '' : ' hidden') + '>PIN<b>' + esc(pin) + '</b></div></div>' +
    '<div class="url' + (addr ? '' : ' off') + '">' + (addr ? esc(addr) : 'Address unavailable') + '</div>' +
    '<p>' + (addr ? 'Open it on a phone or computer on the same network.' : waiting ? 'Vetro is checking the TV. The address appears in a few seconds.' : NO_ADDRESS_HINT) + '</p></div></div>' +
    '<div class="panel ' + (bad ? 'bad' : warn ? 'warn' : '') + '"><div class="ph"><h2>Diagnostics</h2><div class="sum ' + (state === 'ok' ? '' : state) + '" id="sum">' + esc(sum) + '</div></div>' +
    '<div class="grid">' + cells + '</div>' +
    '<div class="share"><div class="t">Asking for help? Read out or photograph this line.</div><code>' + (waiting ? 'Collecting the details&hellip;' : line.join(' &middot; ')) + '</code></div>' +
    '<div class="keys"><span><i>OK</i>Check again</span><span><i>Back</i>Close</span></div></div>';
}
function fit() {
  var k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080), s = document.getElementById('stage');
  if (s && s.style) s.style.transform = 'scale(' + k + ')';
}

// ---- run ----------------------------------------------------------------------------------------------------
function resetIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(leave, IDLE_MS);
}
// Shows how far the checks are, so a slow TV reads as working and not as stuck.
function progress(done) {
  var el = document.getElementById('sum');
  if (el) el.textContent = done + ' of ' + jobs.length + ' checks done';
}
function showLoaderLater() {
  var stage = document.getElementById('stage');
  clearTimeout(loaderTimer);
  stage.className = '';
  loaderTimer = setTimeout(function () {
    stage.className = 'slow';
  }, LOADER_DELAY_MS);
}
// The checks don't depend on each other, so they run at the same time: a stuck one costs its own time limit, not
// everyone's. Keys are created in job order so the report reads the same whichever check finishes first.
function runChecks() {
  var done = 0;
  jobs.forEach(function (j) {
    report.probe[j[0]] = null;
  });
  progress(done);
  return Promise.all(jobs.map(function (j) {
    return attempt(j[0], j[1], j[2]).then(function () {
      done++;
      progress(done);
    });
  }));
}
function run() {
  if (running) return Promise.resolve();
  running = true; delivered = false;
  report = {probe: {}, apps: [], packages: [], settings: {}};
  render(null, true);
  showLoaderLater();
  return runChecks()
    .then(function () { return sendReport().then(function () { delivered = true; }, function () {}); })
    .then(function () { return readScreen().catch(function () { return null; }); })
    .then(function (d) { render(d, false); }, function () { render(null, false); })
    .then(function () { running = false; });
}
document.addEventListener('visibilitychange', function () { if (document.hidden && delivered) leave(); });
document.addEventListener('keydown', function (e) {
  var k = e && e.keyCode;
  resetIdle();
  if (k === 10009 || k === 27) leave();
  else if (k === 13) run();
});
window.addEventListener('resize', fit);
fit();
resetIdle();
run();
