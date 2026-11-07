'use strict';
// Another app holds the service's port (8099 is also where tizen-youtube and TizenTube listen). The service must not
// end: auto-restart would only bring it back into the same error. It says what is wrong, and listens once the port is free.
const assert = require('assert');
const net = require('net');
const path = require('path');
const http = require('http');
const spawn = require('child_process').spawn;

const blocker = net.createServer();
blocker.listen(0, '0.0.0.0', function () {
  const port = blocker.address().port;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'service', 'main.js')], {
    env: Object.assign({}, process.env, {VETRO_PORT: String(port), VETRO_LISTEN_RETRY_MS: '300', VETRO_BIND_HOST: '0.0.0.0'}),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '', err = '', exited = null, released = false;
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { err += d; });
  child.on('exit', code => { exited = code; });
  const deadline = Date.now() + 15000;
  const timer = setInterval(function () {
    if (Date.now() > deadline || exited !== null) { done(new Error('service ended or did not come up; exit=' + exited + '\n' + err + out)); return; }
    if (!released && /cannot listen on port/.test(err)) {
      assert.ok(new RegExp(String(port)).test(err), 'the message names the port');
      assert.ok(/EADDRINUSE/.test(err), 'the message names the reason');
      released = true;
      blocker.close();
    }
    if (released && /VETRO listening on/.test(out)) {
      // The retry took the port once it was free: something answers on it.
      http.get({host: '127.0.0.1', port: port, path: '/status'}, function (res) { res.resume(); done(null); }).on('error', done);
    }
  }, 100);
  let finished = false;
  function done(e) {
    if (finished) return; finished = true;
    clearInterval(timer);
    child.kill('SIGKILL');
    if (e) { console.log('FAIL port busy: ' + e.message); process.exit(1); }
    console.log('PASS the service survives a busy port and listens when it is free');
    process.exit(0);
  }
});
