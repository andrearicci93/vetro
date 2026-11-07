'use strict';
// Upgrading from 0.3.x can leave the old service running on the port. The new one ends it, but only when the holder
// says it is an OLDER Vetro; anything else (tizen-youtube, TizenTube, a newer or equal Vetro) is left alone.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const stale = require('../service/stale-service.js');

function serve(body, cb) {
  const s = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(typeof body === 'string' ? body : JSON.stringify(body)); });
  s.listen(0, '127.0.0.1', () => cb(s, s.address().port));
}
const old035 = {mode: 'app-only', running: false, app: {version: '0.3.5', sourceRevision: null, sourceDirty: null}};

(async () => {
  assert.ok(stale.older('0.3.5', '0.5.0') && stale.older('0.4.9', '0.5.0') && !stale.older('0.5.0', '0.5.0') && !stale.older('0.5.1', '0.5.0') && !stale.older('x', '0.5.0'));

  // /proc parsing: the pid whose fd holds the listening socket's inode.
  const proc = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-proc-'));
  fs.mkdirSync(path.join(proc, 'net'));
  const hex = (8099).toString(16).toUpperCase();
  fs.writeFileSync(path.join(proc, 'net', 'tcp'),
    '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n' +
    '   0: 00000000:' + hex + ' 00000000:0000 0A 00000000:00000000 00:00000000 00000000  5001        0 4242 1 0 0 0\n' +
    '   1: 0100007F:' + hex + ' 0100007F:C000 01 00000000:00000000 00:00000000 00000000  5001        0 9999 1 0 0 0\n' +
    '   2: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  5001        0 7777 1 0 0 0\n');
  fs.writeFileSync(path.join(proc, 'net', 'tcp6'), '  sl  local_address\n');
  fs.mkdirSync(path.join(proc, '321', 'fd'), {recursive: true});
  fs.symlinkSync('socket:[4242]', path.join(proc, '321', 'fd', '7'));
  fs.mkdirSync(path.join(proc, '322', 'fd'), {recursive: true});
  fs.symlinkSync('socket:[9999]', path.join(proc, '322', 'fd', '7')); // an established connection, not the listener
  fs.mkdirSync(path.join(proc, '323', 'fd'), {recursive: true});
  fs.symlinkSync('socket:[7777]', path.join(proc, '323', 'fd', '7')); // another port
  assert.deepStrictEqual(stale.listeningPids(8099, proc), [321]);
  assert.deepStrictEqual(stale.listeningPids(8100, proc), []);

  async function run(body, opts) {
    return new Promise(resolve => serve(body, (s, port) => {
      const kills = [];
      let alive = true;
      stale.endOlderService(port, '0.5.0', Object.assign({
        waitMs: 600,
        listeningPids: () => alive ? [4321] : [],
        kill: (pid, sig) => { kills.push(pid + ':' + sig); if (sig === 'SIGTERM' || sig === 'SIGKILL') alive = !(opts && opts.dies === sig); }
      }, opts && opts.over)).then(r => { s.close(); resolve({r, kills}); });
    }));
  }

  let x = await run(old035, {dies: 'SIGTERM'});
  assert.strictEqual(x.r.ended, true); assert.strictEqual(x.r.version, '0.3.5'); assert.deepStrictEqual(x.kills, ['4321:SIGTERM']);

  x = await run(old035, {dies: 'SIGKILL'});
  assert.strictEqual(x.r.ended, true); assert.strictEqual(x.r.forced, true); assert.deepStrictEqual(x.kills, ['4321:SIGTERM', '4321:SIGKILL']);

  x = await run(old035, {dies: 'never'});
  assert.strictEqual(x.r.ended, false); assert.strictEqual(x.r.reason, 'still-running');

  // Not an older Vetro: never killed.
  x = await run({mode: 'app-only', app: {version: '0.5.0', sourceRevision: 'abc'}});
  assert.strictEqual(x.r.reason, 'not-older'); assert.deepStrictEqual(x.kills, []);
  x = await run({mode: 'tv-integration', app: {version: '0.6.0', sourceRevision: null}});
  assert.strictEqual(x.r.reason, 'not-older'); assert.deepStrictEqual(x.kills, []);
  x = await run({ok: true, app: 'tizentube'});
  assert.strictEqual(x.r.reason, 'not-vetro'); assert.deepStrictEqual(x.kills, []);
  x = await run('<html>TizenTube</html>');
  assert.strictEqual(x.r.reason, 'not-vetro'); assert.deepStrictEqual(x.kills, []);
  x = await run({mode: 'x', app: {version: '0.3.5'}}); // no sourceRevision key: not a Vetro status
  assert.strictEqual(x.r.reason, 'not-vetro'); assert.deepStrictEqual(x.kills, []);

  // Holder unknown, several holders, or the pid is our own: nothing is killed.
  x = await run(old035, {over: {listeningPids: () => []}});
  assert.strictEqual(x.r.reason, 'pid-unknown'); assert.deepStrictEqual(x.kills, []);
  x = await run(old035, {over: {listeningPids: () => [11, 12]}});
  assert.strictEqual(x.r.reason, 'several-holders'); assert.deepStrictEqual(x.kills, []);
  x = await run(old035, {over: {listeningPids: () => [process.pid]}});
  assert.strictEqual(x.r.reason, 'pid-unknown'); assert.deepStrictEqual(x.kills, []);
  x = await run(old035, {over: {kill: () => { const e = new Error('no'); e.code = 'EPERM'; throw e; }}});
  assert.strictEqual(x.r.reason, 'kill-refused'); assert.strictEqual(x.r.error, 'EPERM');

  // Nothing answers on the port.
  const r = await stale.endOlderService(1, '0.5.0', {probe: () => stale.probeVersion(1, '127.0.0.1', 300), listeningPids: () => [4321], kill: () => { throw new Error('must not kill'); }});
  assert.strictEqual(r.reason, 'not-vetro');

  console.log('PASS the service ends only an older Vetro that holds its port');
})().catch(e => { console.log('FAIL stale service: ' + (e && e.stack || e)); process.exit(1); });
