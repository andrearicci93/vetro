'use strict';
// The YouTube plugin as a whole (examples/plugins/youtube/index.js), run for real against a scratch folder, a real sqlite3 file,
// the real setup script (openssl) and the real proxy. Only the TV's own places are swapped: the plugin's files are copied with the
// TV paths, the proxy address and the timers rewritten. What must hold: the row is patched only while the proxy, certificate and
// script are all there, it is put back whenever one is not, Samsung rewriting it is repaired, and stopping always restores it.
const assert = require('assert').strict;
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const cp = require('child_process');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', 'examples', 'plugins', 'youtube');
const ORIGINAL = '--base_url=https://www.youtube.com/tv --dial_name=YouTube --use_eden --start_frag=#start';
const WRAPPER = '9Ur5IzDKqV.TizenYouTube', KEY = null;
const REST = ORIGINAL.replace('--base_url=https://www.youtube.com/tv ', '');
const BODY = 'console.log("userscript")';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timed out: ' + what); await sleep(50); } }
function freePort() { return new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); }); }

async function stage(opts) {
  opts = opts || {};
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-yt-flow-')));
  const D = path.join(root, 'vy'), C = path.join(root, 'vyt'), db = path.join(root, 'pkg.db'), cobalt = path.join(root, 'cobalt'), plug = path.join(root, 'plugin'), bin = path.join(root, 'bin');
  fs.mkdirSync(path.join(cobalt, 'content', 'ssl', 'certs'), { recursive: true }); fs.mkdirSync(path.join(cobalt, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(cobalt, 'content', 'ssl', 'certs', 'aaaa.0'), 'x'); fs.writeFileSync(path.join(cobalt, 'lib', 'libcobalt.so'), 'x');
  fs.mkdirSync(plug); fs.mkdirSync(bin);
  for (const n of ['chown', 'app_launcher']) { fs.writeFileSync(path.join(bin, n), n === 'chown' ? '#!/bin/sh\nexit 0\n' : '#!/bin/sh\necho "$@" >> ' + path.join(root, 'launches') + '\necho "... successfully launched pid = 1"\n'); fs.chmodSync(path.join(bin, n), 0o755); }
  const port = await freePort();
  const esc = s => s.replace(/\//g, '\\/');
  for (const f of fs.readdirSync(SRC).filter(f => f.endsWith('.js'))) {
    let t = fs.readFileSync(path.join(SRC, f), 'utf8');
    t = t.split('/opt/usr/home/owner/share/vyt').join(C).split('\\/opt\\/usr\\/home\\/owner\\/share\\/vetro-youtube').join(esc(D)).split('/opt/usr/home/owner/share/vetro-youtube').join(D)
      .split('/opt/dbspace/.webappservice.db').join(db).split('/usr/apps/com.samsung.tv.cobalt/content/app/cobalt').join(cobalt)
      .split('127\\.0\\.0\\.2').join('127\\.0\\.0\\.1').split('127.0.0.2').join('127.0.0.1')
      .replace('MAX_VALUE = 127', 'MAX_VALUE = 4000').replace('DEFAULT_PORT = 8101', 'DEFAULT_PORT = ' + port).replace('TICK_MS = 60 * 1000', 'TICK_MS = 250')
      .replace(/var SHA256 = '[0-9a-f]+'/, "var SHA256 = '" + crypto.createHash('sha256').update(BODY).digest('hex') + "'");
    fs.writeFileSync(path.join(plug, f), t);
  }
  const rows = opts.rows || [[WRAPPER, KEY, ORIGINAL]];
  const sql = 'CREATE TABLE widgetinfo (id INTEGER PRIMARY KEY, tizen_id TEXT, pkgname TEXT, reserved_string_6 TEXT);' +
    rows.map(r => "INSERT INTO widgetinfo(tizen_id, reserved_string_6) VALUES('" + r[0] + "','" + r[2] + "');").join('');
  cp.spawnSync('sqlite3', [db], { input: sql });
  const cfgFile = path.join(root, 'config.json');
  if (opts.config) fs.writeFileSync(cfgFile, JSON.stringify(opts.config));
  const gate = { ms: 0, started: 0 };                        // slows every command down, to make a patch and a stop overlap
  const ctx = {
    id: 'youtube', dir: path.join(root, 'ctxdir'),
    config: { get() { try { return JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch (e) { return {}; } }, set(v) { fs.writeFileSync(cfgFile, JSON.stringify(v)); } },
    execute(cmd) {
      if (gate.ms) gate.started++;
      return new Promise((resolve) => setTimeout(resolve, gate.ms)).then(() => new Promise((resolve) => {
        cp.execFile('sh', ['-c', cmd], { env: Object.assign({}, process.env, { PATH: bin + ':' + process.env.PATH }), maxBuffer: 8 << 20 }, (err, stdout, stderr) => resolve({ exit_code: err ? err.code || 1 : 0, stdout, stderr }));
      }));
    }
  };
  const plugin = require(path.join(plug, 'index.js'))(ctx);
  const row = () => cp.spawnSync('sqlite3', [db, "select reserved_string_6 from widgetinfo where tizen_id='" + WRAPPER + "';"]).stdout.toString().trim();
  const setRow = v => cp.spawnSync('sqlite3', [db, "update widgetinfo set reserved_string_6='" + v + "' where tizen_id='" + WRAPPER + "';"]);
  const cfg = () => ctx.config.get();
  const seedScript = () => { fs.mkdirSync(path.join(D, 'cache'), { recursive: true }); fs.writeFileSync(path.join(D, 'cache', 'userscript-' + require(path.join(plug, 'userscript.js')).VERSION + '.js'), BODY); };
  function call(sub, method, body) {
    return new Promise((resolve) => {
      const chunks = [];
      const req = { method: method || 'GET', headers: {}, on(ev, fn) { if (ev === 'data' && body) setImmediate(() => fn(Buffer.from(JSON.stringify(body)))); if (ev === 'end') setImmediate(() => setImmediate(() => fn())); return req; }, destroy() {} };
      const res = { headersSent: false, writeHead(c) { res.code = c; res.headersSent = true; }, end(b) { resolve({ code: res.code, body: b ? JSON.parse(b) : null }); } };
      const handled = plugin.route(req, res, sub);
      if (handled === false) resolve({ code: 404, body: null });
    });
  }
  const status = () => call('status').then(r => r.body);
  return { gate, root, D, C, db, port, plugin, row, setRow, cfg, call, status, seedScript, ctx, cobalt, patched: () => row().includes('--proxy=127.0.0.1:' + port + ',direct://') };
}

(async () => {
  // A. First use: switching the button on does everything (certificate, content copy, script, proxy) and patches the row.
  {
    const s = await stage();
    s.plugin.start();
    assert.equal(s.row(), ORIGINAL, 'nothing is patched before anything is switched on');
    s.seedScript();
    const on = await s.call('tile', 'POST', { on: true });
    assert.equal(on.body.ok, true, JSON.stringify(on.body));
    assert.equal(on.body.state, 'on', JSON.stringify(on.body));
    assert.equal(s.patched(), true);
    assert.equal(s.row().startsWith(REST + ' --proxy='), true);
    assert.equal(s.cfg().tile, true, 'the choice is saved');
    for (const f of ['ca.crt', 'ca.key', 'leaf.crt', 'leaf.key']) assert.ok(fs.existsSync(path.join(s.D, f)), f);
    assert.ok(fs.readdirSync(path.join(s.C, 'ssl', 'certs')).length >= 2, 'the authority is in the copy\'s trust store');
    assert.equal(fs.readdirSync(path.join(s.cobalt, 'content', 'ssl', 'certs')).length, 1, 'the original YouTube files are untouched');
    const st = await s.status();
    assert.equal(st.proxy, 'up'); assert.equal(st.tileState, 'on');

    // Samsung rewrites the row (an app update does): the next check puts the flags back.
    s.setRow(ORIGINAL + ' --samsung-update');
    await until(() => s.patched(), 4000, 'row repaired after Samsung rewrote it');
    assert.equal(s.row().startsWith(REST + ' --samsung-update --proxy='), true, 'Samsung\'s new value is kept, ours is added to it');

    // Switching the plugin off restores the row exactly.
    s.plugin.stop();
    await until(() => s.row() === ORIGINAL + ' --samsung-update', 4000, 'row restored on stop');
    assert.equal((await s.status()).proxy, 'down');
  }

  // B. A row left patched by a crash is healed when the button is off.
  {
    const s = await stage({ config: { tile: false } });
    s.setRow(ORIGINAL + ' --proxy=127.0.0.1:' + s.port + ',direct:// --content=' + s.C + '');
    assert.equal(s.patched(), true);
    s.plugin.start();
    await until(() => s.row() === ORIGINAL, 4000, 'stale row healed');
    s.plugin.stop();
  }

  // C. Button on, but the script cannot be had: the row stays original and says why; with the script it patches by itself.
  {
    const s = await stage({ config: { tile: true } });
    // Everything but the script, which would have to come from the network: make that fail fast.
    const us = require(path.join(s.root, 'plugin', 'userscript.js'));
    const client = require(path.join(s.root, 'plugin', 'tls-client.js'));
    client.fetchBuffer = (h, p, m, cb) => cb(new Error('offline'));
    s.plugin.start();
    await until(async () => (await s.status()).setup === 'ready', 8000, 'setup done');
    await sleep(600);
    assert.equal(s.row(), ORIGINAL, 'never patched without the script');
    let st = await s.status();
    assert.equal(st.tileState, 'waiting'); assert.match(st.tileNote, /script/);
    s.seedScript(); us.UserScript;                           // the script becomes available
    await until(() => s.patched(), 6000, 'patched once the script is there');
    s.plugin.stop();
    await until(() => s.row() === ORIGINAL, 4000, 'restored');
  }

  // D. A TV without Samsung's row, and a row in a form we do not know: nothing is written, the page says so.
  {
    let s = await stage({ rows: [['someone.else', KEY, 'x']], config: { tile: true } });
    s.seedScript(); s.plugin.start();
    await until(async () => (await s.status()).tileState === 'unsupported', 8000, 'unsupported');
    assert.match((await s.status()).tileNote, /no entry/);
    s.plugin.stop();
    s = await stage({ rows: [[WRAPPER, KEY, 'something else entirely']], config: { tile: true } });
    s.seedScript(); s.plugin.start();
    await until(async () => (await s.status()).tileState === 'unsupported', 8000, 'foreign');
    assert.equal(s.row(), 'something else entirely');
    s.plugin.stop();
  }

  // E. Open launches YouTube through the proxy with Samsung's own flags; the plugin never closes YouTube when it stops.
  {
    const s = await stage();
    s.seedScript(); s.plugin.start();
    const r = await s.call('open', 'POST', {});
    assert.equal(r.body.ok, true, JSON.stringify(r.body));
    const launches = fs.readFileSync(path.join(s.root, 'launches'), 'utf8');
    assert.match(launches, /-s com\.samsung\.tv\.cobalt-yt -u 5001 USERDATA  --base_url=https:\/\/www\.youtube\.com\/tv --dial_name=YouTube --use_eden --start_frag=#start --proxy=127\.0\.0\.1:\d+,direct:\/\/ --content=/);
    assert.equal(s.row(), ORIGINAL, 'Open alone does not touch the row');
    const before = fs.readFileSync(path.join(s.root, 'launches'), 'utf8').split('\n').length;
    s.plugin.stop();
    await sleep(500);
    assert.equal(fs.readFileSync(path.join(s.root, 'launches'), 'utf8').split('\n').length, before, 'stopping the plugin closes nothing');
  }

  // F. Cleanup puts the row back first and only then deletes files; a failure to restore deletes nothing.
  {
    const s = await stage();
    s.seedScript(); s.plugin.start();
    await s.call('tile', 'POST', { on: true });
    assert.equal(s.patched(), true);
    const c = await s.call('cleanup', 'POST', {});
    assert.equal(c.body.ok, true, JSON.stringify(c.body));
    assert.equal(s.row(), ORIGINAL);
    assert.equal(fs.existsSync(s.D), false, 'the files are gone');
    assert.equal(s.cfg().tile, false);
    s.plugin.stop();
    const s2 = await stage();
    s2.seedScript(); s2.plugin.start();
    await s2.call('tile', 'POST', { on: true });
    fs.chmodSync(s2.db, 0o444);                              // the update will fail
    cp.spawnSync('sqlite3', [s2.db, 'select 1']);
    s2.ctx.execute = () => Promise.reject(new Error('agent gone'));
    const c2 = await s2.call('cleanup', 'POST', {});
    assert.equal(c2.body.ok, false, 'cleanup refuses when it cannot put the row back');
    assert.ok(fs.existsSync(s2.D), 'and deletes nothing');
    fs.chmodSync(s2.db, 0o644);
    s2.plugin.stop();
  }

  // G. Bad input to the routes is answered, never thrown.
  {
    const s = await stage();
    s.plugin.start();
    assert.equal((await s.call('tile', 'POST', { on: 'yes' })).body.ok, false);
    assert.equal((await s.call('nothing', 'POST', {})).code, 404);
    assert.equal((await s.call('open', 'DELETE')).code, 404);
    s.plugin.stop();
  }
  // H. A patch that is still running when the plugin is switched off must not land after the restore.
  {
    const s = await stage({ config: { tile: true } });
    s.seedScript(); s.plugin.start();
    await until(() => s.patched(), 8000, 'patched');
    s.setRow(ORIGINAL);                                       // Samsung rewrites it; the next check starts a patch
    s.gate.ms = 700;
    await until(() => s.gate.started > 0, 4000, 'a patch started');
    s.plugin.stop();
    s.gate.ms = 0;
    await sleep(3500);
    assert.equal(s.row(), ORIGINAL, 'the row ends original, not patched: ' + s.row());
    assert.equal((await s.status()).proxy, 'down');
  }

  // I. Samsung adds a flag after ours, or the value takes a form we will not edit while our flags are in it.
  {
    const s = await stage();
    s.seedScript(); s.plugin.start();
    await s.call('tile', 'POST', { on: true });
    s.setRow(ORIGINAL + ' --proxy=127.0.0.1:' + s.port + ',direct:// --content=' + s.C + ' --newflag=1');
    const c = await s.call('cleanup', 'POST', {});
    assert.equal(c.body.ok, true, JSON.stringify(c.body));
    assert.equal(s.row(), ORIGINAL + ' --newflag=1', 'our flags are cut out wherever they are');
    s.plugin.stop();
    const s2 = await stage();
    s2.seedScript(); s2.plugin.start();
    await s2.call('tile', 'POST', { on: true });
    s2.setRow(ORIGINAL + ' --proxy=127.0.0.1:' + s2.port + ',direct:// --content=' + s2.C + ' --x="a b"');
    const c2 = await s2.call('cleanup', 'POST', {});
    assert.equal(c2.body.ok, false, 'a row with our flags that cannot be edited stops the cleanup');
    assert.ok(fs.existsSync(s2.D), 'and nothing is deleted');
    s2.plugin.stop();
  }
  // J. A link planted where the setup writes (the user the apps run as could leave one) is removed, never followed.
  {
    const s = await stage();
    s.seedScript(); s.plugin.start();
    await s.call('tile', 'POST', { on: true });
    const setupLib = require(path.join(s.root, 'plugin', 'setup.js'));
    const env = Object.assign({}, process.env, { PATH: path.join(s.root, 'bin') + ':' + process.env.PATH });
    const caBefore = fs.readFileSync(path.join(s.D, 'ca.key'), 'utf8');
    fs.unlinkSync(path.join(s.D, 'leaf.key')); fs.symlinkSync(path.join(s.D, 'ca.key'), path.join(s.D, 'leaf.key'));
    fs.unlinkSync(path.join(s.D, 'content.stamp')); fs.symlinkSync('/nonexistent-target', path.join(s.D, 'content.stamp'));
    const r = cp.spawnSync('sh', ['-c', setupLib.setupScript()], { env, encoding: 'utf8' });
    assert.match(r.stdout, /^ready$/m, r.stderr);
    assert.equal(fs.lstatSync(path.join(s.D, 'leaf.key')).isSymbolicLink(), false, 'leaf.key is a real file again');
    assert.equal(fs.lstatSync(path.join(s.D, 'content.stamp')).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(path.join(s.D, 'ca.key'), 'utf8').includes('PRIVATE KEY'), true);
    assert.ok(fs.statSync(path.join(s.D, 'cache')).isDirectory(), 'the script cache folder exists');
    s.plugin.stop();
  }
  console.log('youtube flow: ok');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
