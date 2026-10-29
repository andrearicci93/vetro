// Vetro's TV screen: starts the background service, collects what only the TV's web APIs can see and sends it to the
// service as the probe report, then shows what the service says about itself. Must run on Chromium M47 (Tizen 3.0,
// the oldest engine config.xml allows): ES5 only (tests/tv-compat.test.cjs). BASE, SERVICE_DOWN_HINT and
// NO_ADDRESS_HINT come from index.html, which holds everything that names the port; everything else stays inside
// this function, out of the page's global scope.
(function () {
  'use strict';

  var ICON = 'icon.png';
  // The page lays out at 1920x1080 and is scaled to whatever the TV gives it.
  var STAGE_WIDTH = 1920;
  var STAGE_HEIGHT = 1080;
  var IDLE_MS = 300000;
  // Samsung's TV guideline: show a loading indicator once loading takes 100 ms or longer.
  var LOADER_DELAY_MS = 100;
  var CHECK_TIMEOUT_MS = 8000;
  // The service can take a while to start: up to 8 tries 1.5 s apart.
  var SERVICE_REACH_TRIES = 8;
  var SERVICE_RETRY_MS = 1500;
  var SERVICE_REACH_TIMEOUT_MS = 25000;
  var REMOTE_API_TIMEOUT_MS = 4000;
  var REPORT_TIMEOUT_MS = 10000;
  // The launcher check inside /screen can take a few seconds.
  var SCREEN_TIMEOUT_MS = 12000;
  var LOW_MEMORY_MB = 200;
  var KEY_OK = 13;
  var KEY_ESCAPE = 27;
  var KEY_BACK = 10009;
  // webapis.productinfo method -> report.settings key, which service/diagnostic-report.js reads.
  var PRODUCT_INFO = {
    getModel: 'model',
    getRealModel: 'realModel',
    getFirmware: 'firmware',
    getModelCode: 'modelCode',
    getLocalSet: 'localSet',
    getSmartTVServerType: 'smartHubServer'
  };
  // The probes behind the "TV APIs" tile.
  var API_PROBES = ['tizenObject', 'webapisObject', 'apps', 'packages'];
  var HTML_ESCAPES = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'};

  var report = newReport();
  var delivered = false;
  var running = false;
  var idleTimer = null;
  var loaderTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function newReport() {
    return {probe: {}, apps: [], packages: [], settings: {}};
  }

  // The service keeps running without this page; a resident page only holds memory.
  function leave() {
    try {
      tizen.application.getCurrentApplication().exit();
    } catch (e) {}
  }

  function callback(call) {
    return new Promise(function (resolve, reject) {
      call(resolve, reject);
    });
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function errorText(error) {
    return String(error && error.message || error);
  }

  function esc(value) {
    return String(value).replace(/[&<>"]/g, function (c) {
      return HTML_ESCAPES[c];
    });
  }

  function appVersion() {
    try {
      return tizen.application.getCurrentApplication().appInfo.version || null;
    } catch (e) {
      return null;
    }
  }

  // --- Checks ---

  // A public-level certificate may not get the on-boot start honored, so the page starts the service itself.
  function launchService() {
    return callback(function (ok, fail) {
      tizen.application.launch('vetrotvapp.svc', ok, fail);
    });
  }

  function reachService(tries) {
    return fetch(BASE + '/status').then(function (response) {
      return response.status;
    }, function (error) {
      if (tries <= 1) throw error;
      return wait(SERVICE_RETRY_MS).then(function () {
        return reachService(tries - 1);
      });
    });
  }

  function readApps() {
    return callback(function (ok, fail) {
      tizen.application.getAppsInfo(ok, fail);
    }).then(function (apps) {
      report.apps = apps.map(function (app) {
        return {id: app.id, name: app.name, packageId: app.packageId, show: app.show};
      });
      return apps.length;
    });
  }

  function readPackages() {
    return callback(function (ok, fail) {
      tizen.package.getPackagesInfo(ok, fail);
    }).then(function (packages) {
      report.packages = packages.map(function (pkg) {
        return {id: pkg.id, version: pkg.version, author: pkg.author};
      });
      return packages.length;
    });
  }

  function readProductInfo() {
    Object.keys(PRODUCT_INFO).forEach(function (method) {
      try {
        report.settings[PRODUCT_INFO[method]] = webapis.productinfo[method]();
      } catch (e) {}
    });
    return Object.keys(report.settings).length;
  }

  function readBuild() {
    return callback(function (ok, fail) {
      tizen.systeminfo.getPropertyValue('BUILD', ok, fail);
    });
  }

  function connectRemoteApi(port) {
    return new Promise(function (resolve, reject) {
      var socket = new WebSocket('ws://127.0.0.1:' + port + '/api/v2/channels/samsung.remote.control?name=' + btoa('Vetro'));
      var timer = setTimeout(function () {
        try {
          socket.close();
        } catch (e) {}
        reject(new Error('timeout'));
      }, REMOTE_API_TIMEOUT_MS);
      socket.onopen = function () {
        clearTimeout(timer);
        socket.close();
        resolve('open');
      };
      socket.onerror = function () {
        clearTimeout(timer);
        reject(new Error('refused'));
      };
    });
  }

  // key is the report's probe key, which service/diagnostic-report.js reads.
  var CHECKS = [
    {key: 'serviceLaunch', run: launchService},
    {key: 'tizenObject', run: function () { return typeof tizen !== 'undefined'; }},
    {key: 'webapisObject', run: function () { return typeof webapis !== 'undefined'; }},
    {key: 'supportedKeys', run: function () { return tizen.tvinputdevice.getSupportedKeys().map(function (k) { return k.name; }); }},
    {key: 'apps', run: readApps},
    {key: 'packages', run: readPackages},
    {key: 'productinfo', run: readProductInfo},
    {key: 'systeminfoBattery', run: readBuild},
    {key: 'remoteApi8001', run: function () { return connectRemoteApi(8001); }},
    {key: 'serviceReach', timeoutMs: SERVICE_REACH_TIMEOUT_MS, run: function () { return reachService(SERVICE_REACH_TRIES); }}
  ];

  // Every check gets a time limit: a Tizen call whose callback never fires must not leave the screen on "Checking".
  function attempt(check) {
    var limit = check.timeoutMs || CHECK_TIMEOUT_MS;
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        finish({ok: false, error: 'no answer in ' + Math.round(limit / 1000) + ' s'});
      }, limit);
      function finish(result) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        report.probe[check.key] = result;
        resolve();
      }
      try {
        Promise.resolve(check.run()).then(function (value) {
          finish({ok: true, value: value});
        }, function (error) {
          finish({ok: false, error: errorText(error)});
        });
      } catch (e) {
        finish({ok: false, error: errorText(e)});
      }
    });
  }

  // The checks don't depend on each other, so they run at the same time: a stuck one costs its own time limit, not
  // everyone's. Keys are created in check order so the report reads the same whichever check finishes first.
  function runChecks() {
    var done = 0;
    CHECKS.forEach(function (check) {
      report.probe[check.key] = null;
    });
    showProgress(done);
    return Promise.all(CHECKS.map(function (check) {
      return attempt(check).then(function () {
        done++;
        showProgress(done);
      });
    }));
  }

  // --- Service ---

  function requestJson(method, path, timeoutMs, body) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(method, BASE + path, true);
      xhr.timeout = timeoutMs;
      if (body !== undefined) xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.onload = function () {
        var result;
        try {
          result = JSON.parse(xhr.responseText);
        } catch (e) {
          return reject(new Error('Response is not JSON'));
        }
        if (xhr.status !== 200) return reject(new Error('HTTP ' + xhr.status));
        resolve(result);
      };
      xhr.onerror = function () {
        reject(new Error('Service unreachable'));
      };
      xhr.ontimeout = function () {
        reject(new Error('Service timeout'));
      };
      xhr.send(body === undefined ? undefined : JSON.stringify(body));
    });
  }

  function sendReport() {
    return requestJson('POST', '/probe', REPORT_TIMEOUT_MS, report).then(function (result) {
      if (result.ok !== true) throw new Error('Report rejected');
    });
  }

  // What the screen shows about the service, the dashboard address included: one small JSON read.
  function readScreen() {
    return requestJson('GET', '/screen', SCREEN_TIMEOUT_MS).then(function (screen) {
      if (!screen || screen.error) throw new Error('No screen facts');
      return screen;
    });
  }

  // --- Diagnostics tiles ---

  var ICONS = {
    ok: '<svg class="ic" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="none" stroke="rgb(127, 203, 160)" stroke-width="3"/><path d="M11.5 20.5l6 6 11-12.5" fill="none" stroke="rgb(127, 203, 160)" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    warn: '<svg class="ic" viewBox="0 0 40 40"><path d="M20 4.5l17 29.5H3z" fill="none" stroke="rgb(226, 184, 103)" stroke-width="3" stroke-linejoin="round"/><path d="M20 15v9" stroke="rgb(226, 184, 103)" stroke-width="3.6" stroke-linecap="round"/><circle cx="20" cy="29" r="2.1" fill="rgb(226, 184, 103)"/></svg>',
    bad: '<svg class="ic" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="none" stroke="rgb(239, 138, 128)" stroke-width="3"/><path d="M13.5 13.5l13 13M26.5 13.5l-13 13" stroke="rgb(239, 138, 128)" stroke-width="3.6" stroke-linecap="round"/></svg>',
    na: '<svg class="ic" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="none" stroke="rgb(170, 184, 209)" stroke-width="3" stroke-dasharray="5 5"/></svg>',
    wait: '<svg class="ic" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="none" stroke="rgb(170, 184, 209)" stroke-width="3" stroke-dasharray="5 5"/></svg>',
    off: '<svg class="ic" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="none" stroke="rgb(170, 184, 209)" stroke-width="3"/><path d="M12 20h16" stroke="rgb(170, 184, 209)" stroke-width="3.6" stroke-linecap="round"/></svg>'
  };

  // What the tiles show while the checks run.
  var WAITING_TILES = [['Service', 'Starting'], ['Root access', 'Checking'], ['Remote input', 'Checking'], ['Launcher', 'Checking'], ['TV APIs', 'Checking'], ['Memory', 'Checking']];
  // States that give a tile its own look (index.css .c.<state>); ok and off use the plain tile.
  var MARKED_STATES = ['bad', 'warn', 'na', 'wait'];

  // state: ok | warn | bad | off | na | wait. hint is HTML. token is the tile's short form on the support line;
  // tokenState (warn | bad) shows it upper case and coloured when something is wrong.
  function tile(state, name, value, hint, token, tokenState) {
    return {state: state, name: name, value: value, hint: hint, token: token, tokenState: tokenState};
  }

  function probeOk(key) {
    return !!(report.probe[key] && report.probe[key].ok);
  }

  function serviceTile(d) {
    var app;
    if (!d) return tile('bad', 'Service', 'Not answering', SERVICE_DOWN_HINT, 'SVC DOWN', 'bad');
    app = appVersion();
    if (app && d.version && app !== d.version) {
      return tile('warn', 'Service', 'Version differs', 'The app is ' + esc(app) + ' and the service is ' + esc(d.version) + '. Reinstall Vetro so both match.', 'SVC ' + d.version + '/APP ' + app, 'warn');
    }
    return tile('ok', 'Service', 'Running', 'Port ' + esc(d.port), 'svc ok');
  }

  function rootTile(d) {
    if (!d) return tile('na', 'Root access', 'Unknown', null, 'root ?');
    if (d.root.connected) return tile('ok', 'Root access', 'Connected', null, 'root ok');
    if (d.root.mode === 'app-only') return tile('warn', 'Root access', 'Not available', 'This is the app-only package. Features that need root are off.', 'ROOT NO', 'warn');
    return tile('bad', 'Root access', 'Not connected', 'Features that need root are off. Restart the TV; if it stays like this, reinstall the root package.', 'ROOT DOWN', 'bad');
  }

  function inputTile(d) {
    if (!d) return tile('na', 'Remote input', 'Unknown', null, 'input ?');
    if (!d.root.connected) return tile('na', 'Remote input', 'Needs root', null, 'input ?');
    if (!d.input.enabled) return tile('off', 'Remote input', 'Off', null, 'input off');
    if (d.input.connected) return tile('ok', 'Remote input', 'Filtering', null, 'input ok');
    return tile('bad', 'Remote input', 'Remote not found', 'The saved remote is not connected. Open Remote in the dashboard.', 'INPUT LOST', 'bad');
  }

  function launcherTile(d) {
    var launcher = d && d.launcher;
    var tries;
    if (!d) return tile('na', 'Launcher', 'Unknown', null, 'launcher ?');
    if (!launcher.installed) return tile('na', 'Launcher', 'Not included', null, 'launcher n/a');
    if (!launcher.enabled) return tile('off', 'Launcher', 'Off', null, 'launcher off');
    if (launcher.running === true) return tile('ok', 'Launcher', 'Running', null, 'launcher ok');
    if (launcher.running === false) {
      tries = launcher.failures;
      return tile('bad', 'Launcher', tries ? 'Failed to start' : 'Not running',
        (tries ? 'Tried ' + esc(tries) + ' times. ' : '') + 'Open the Launcher tab in the dashboard and read the error.',
        'LAUNCHER FAIL' + (tries ? ' x' + tries : ''), 'bad');
    }
    return tile('warn', 'Launcher', 'Cannot check', 'It needs root access to be checked.', 'LAUNCHER ?', 'warn');
  }

  function apiTile() {
    var missing = API_PROBES.filter(function (key) {
      return !probeOk(key);
    }).map(function (key) {
      return key.replace('Object', '');
    });
    if (!missing.length) return tile('ok', 'TV APIs', 'Available', null, 'api ok');
    return tile('warn', 'TV APIs', 'Limited', 'Not available: ' + esc(missing.join(', ')) + '.', 'API ' + missing.join('/'), 'warn');
  }

  function memoryTile(d) {
    var mb = d && d.memory && d.memory.availableMb;
    if (typeof mb !== 'number') return tile('na', 'Memory', 'Unknown', null, 'mem ?');
    if (mb < LOW_MEMORY_MB) return tile('warn', 'Memory', mb + ' MB free', 'Low. The TV may feel slow.', 'MEM ' + mb + 'M', 'warn');
    return tile('ok', 'Memory', mb + ' MB free', null, 'mem ' + mb + 'M');
  }

  // d: the service's /screen reply, or null when it didn't answer.
  function tiles(d) {
    return [serviceTile(d), rootTile(d), inputTile(d), launcherTile(d), apiTile(), memoryTile(d)];
  }

  function waitingTiles() {
    return WAITING_TILES.map(function (w) {
      return tile('wait', w[0], w[1], null, '');
    });
  }

  // --- Screen ---

  function countState(list, state) {
    return list.filter(function (t) {
      return t.state === state;
    }).length;
  }

  // The headline: state pill, its label and the Diagnostics summary.
  function verdict(d, waiting, list) {
    var bad = countState(list, 'bad');
    var warn = countState(list, 'warn');
    var panel = bad ? 'bad' : warn ? 'warn' : '';
    if (waiting) return {state: 'wait', label: 'Checking', sum: 'Checking', panel: panel};
    if (!d) return {state: 'bad', label: 'Not responding', sum: 'The service is down', panel: panel};
    if (bad) return {state: 'bad', label: 'Needs attention', sum: bad + (bad === 1 ? ' problem' : ' problems'), panel: panel};
    if (warn) return {state: 'warn', label: 'Running, with limits', sum: warn + (warn === 1 ? ' thing to check' : ' things to check'), panel: panel};
    return {state: 'ok', label: 'Running in the background', sum: 'All good. You can close this screen, Vetro keeps running without it.', panel: panel};
  }

  // Model and firmware come from the TV itself, so they show even when the service is down.
  function device(d) {
    var settings = report.settings;
    return {
      version: (d && d.version) || appVersion(),
      model: settings.realModel || settings.model,
      // T-NKM2DEUC-2310.0 -> 2310.0
      firmware: settings.firmware ? String(settings.firmware).split('-').pop() : null
    };
  }

  function tileHtml(t) {
    var marked = MARKED_STATES.indexOf(t.state) !== -1 ? ' ' + t.state : '';
    var value = esc(t.value) + (t.hint && t.state === 'ok' ? ' <span>&middot; ' + t.hint + '</span>' : '');
    var hint = t.hint && t.state !== 'ok' ? '<div class="h">' + t.hint + '</div>' : '';
    return '<div class="c' + marked + '">' + ICONS[t.state] +
      '<div><div class="n">' + esc(t.name) + '</div><div class="v">' + value + '</div>' + hint + '</div></div>';
  }

  function tokenHtml(t) {
    if (!t.tokenState) return esc(t.token);
    return '<em' + (t.tokenState === 'warn' ? ' class="w"' : '') + '>' + esc(t.token) + '</em>';
  }

  // The one line a user can read out or photograph when asking for help.
  function supportLine(info, list, waiting) {
    var parts = [esc('V' + (info.version || '?'))];
    if (waiting) return 'Collecting the details&hellip;';
    if (info.model) parts.push(esc(info.model + (info.firmware ? ' ' + info.firmware : '')));
    return parts.concat(list.map(tokenHtml)).join(' &middot; ');
  }

  function metaHtml(info) {
    return (info.version ? 'Version ' + esc(info.version) : '') +
      (info.model ? ' &middot; ' + esc(info.model) : '') +
      (info.firmware ? ' &middot; firmware ' + esc(info.firmware) : '');
  }

  function stateClass(state) {
    return state === 'ok' ? '' : state;
  }

  function dashboardHtml(d, waiting) {
    var address = d && d.address ? 'http://' + d.address + ':' + d.port : null;
    // Reserved for the PIN of 0.4.0: hidden until the service sends one.
    var pin = d && typeof d.pin === 'string' ? d.pin : '';
    var text = address ? 'Open it on a phone or computer on the same network.' : waiting ? 'Vetro is checking the TV. The address appears in a few seconds.' : NO_ADDRESS_HINT;
    return '<div class="dash"><div class="dh"><small>DASHBOARD</small><div class="pin" id="pin"' + (pin ? '' : ' hidden') + '>PIN<b>' + esc(pin) + '</b></div></div>' +
      '<div class="url' + (address ? '' : ' off') + '">' + (address ? esc(address) : 'Address unavailable') + '</div>' +
      '<p>' + text + '</p></div>';
  }

  function heroHtml(d, waiting, info, v) {
    return '<div class="hero"><img src="' + ICON + '" alt="Vetro"><div><h1>Vetro</h1><div class="meta">' + metaHtml(info) + '</div>' +
      '<div class="state ' + stateClass(v.state) + '">' + ICONS[v.state] + esc(v.label) + '</div></div>' +
      dashboardHtml(d, waiting) + '</div>';
  }

  function panelHtml(info, list, waiting, v) {
    return '<div class="panel ' + v.panel + '"><div class="ph"><h2>Diagnostics</h2><div class="sum ' + stateClass(v.state) + '" id="sum">' + esc(v.sum) + '</div></div>' +
      '<div class="grid">' + list.map(tileHtml).join('') + '</div>' +
      '<div class="share"><div class="t">Asking for help? Read out or photograph this line.</div><code>' + supportLine(info, list, waiting) + '</code></div>' +
      '<div class="keys"><span><i>OK</i>Check again</span><span><i>Back</i>Close</span></div></div>';
  }

  // d: the service's /screen reply (null: it didn't answer). waiting: the checks are still running.
  function render(d, waiting) {
    var list = waiting ? waitingTiles() : tiles(d);
    var v = verdict(d, waiting, list);
    var info = device(d);
    $('screen').innerHTML = heroHtml(d, waiting, info, v) + panelHtml(info, list, waiting, v);
  }

  // Shows how far the checks are, so a slow TV reads as working and not as stuck.
  function showProgress(done) {
    var sum = $('sum');
    if (sum) sum.textContent = done + ' of ' + CHECKS.length + ' checks done';
  }

  function showLoaderLater() {
    var stage = $('stage');
    clearTimeout(loaderTimer);
    stage.className = '';
    loaderTimer = setTimeout(function () {
      stage.className = 'slow';
    }, LOADER_DELAY_MS);
  }

  function fit() {
    var scale = Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT);
    var stage = $('stage');
    if (stage && stage.style) stage.style.transform = 'scale(' + scale + ')';
  }

  // --- Run ---

  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(leave, IDLE_MS);
  }

  // A report the service refused leaves delivered false, so the page stays open for diagnosis.
  function deliverReport() {
    return sendReport().then(function () {
      delivered = true;
    }, function () {});
  }

  function readScreenOrNull() {
    return readScreen().then(null, function () {
      return null;
    });
  }

  function run() {
    if (running) return Promise.resolve();
    running = true;
    delivered = false;
    report = newReport();
    render(null, true);
    showLoaderLater();
    return runChecks()
      .then(deliverReport)
      .then(readScreenOrNull)
      .then(function (d) {
        render(d, false);
      }, function () {
        render(null, false);
      })
      .then(function () {
        running = false;
      });
  }

  function onKey(event) {
    var key = event && event.keyCode;
    resetIdle();
    if (key === KEY_BACK || key === KEY_ESCAPE) leave();
    else if (key === KEY_OK) run();
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && delivered) leave();
  });
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', fit);
  fit();
  resetIdle();
  run();
})();
