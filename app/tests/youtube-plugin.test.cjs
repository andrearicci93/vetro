'use strict';
// The YouTube plugin (examples/plugins/youtube): the parts that need no TV. The page rewrite, the hand-written HTTPS client
// pieces, the proxy's tunnel and its local script route (through a real TLS handshake), the shell scripts, the pinned script.
const assert = require('assert').strict;
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), tls = require('tls');
const cp = require('child_process');
const crypto = require('crypto');

const dir = path.join(__dirname, '..', 'examples', 'plugins', 'youtube');
const client = require(path.join(dir, 'tls-client.js'));
const inject = require(path.join(dir, 'inject.js'));
const proxyLib = require(path.join(dir, 'proxy.js'));
const setup = require(path.join(dir, 'setup.js'));
const us = require(path.join(dir, 'userscript.js'));
const { PassThrough } = require('stream');

// --- chunked bodies, however the bytes are cut
{
  const wire = Buffer.from('5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n');
  for (let cut = 1; cut < wire.length; cut++) {
    const out = new PassThrough(), got = [];
    out.on('data', c => got.push(c));
    const d = new client.Dechunk(out);
    d.write(wire.slice(0, cut)); d.write(wire.slice(cut));
    assert.equal(Buffer.concat(got).toString(), 'hello world', 'cut at ' + cut);
  }
  const out = new PassThrough(); let ended = false; out.on('end', () => { ended = true; }); out.resume();
  new client.Dechunk(out).write(Buffer.from('1 ;ext=1\r\nx\r\n0 \r\n\r\n'));
  assert.equal(ended, false, 'end comes asynchronously');
  setImmediate(() => assert.equal(ended, true, 'a chunk extension with OWS is tolerated and the body ends'));
  // bad chunk delimiter and overlong chunk header abort cleanly
  let badErr = null;
  new client.Dechunk({ writable: true, destroyed: false, write() {}, end() {}, abort(e) { badErr = e; } }).write(Buffer.from('1\r\nxXX'));
  assert.match(String(badErr && badErr.message), /bad chunk delimiter/);
  let longErr = null;
  new client.Dechunk({ writable: true, destroyed: false, write() {}, end() {}, abort(e) { longErr = e; } }).write(Buffer.from('1'.repeat(1025)));
  assert.match(String(longErr && longErr.message), /chunk header too long/);
}

// --- response head
{
  const p = client.parseHead('HTTP/1.1 200 OK\r\nContent-Type: text/html  \r\nSet-Cookie: a=1\r\nset-cookie: b=2\r\nTransfer-Encoding: chunked\r\nConnection: close\r\nAlt-Svc: h3=":443"');
  assert.equal(p.status, 200);
  assert.equal(p.chunked, true);
  assert.deepEqual(p.headers['set-cookie'], ['a=1', 'b=2']);
  assert.equal(p.headers['transfer-encoding'], undefined);
  assert.equal(p.headers.connection, undefined);
  assert.equal(p.headers['content-type'], 'text/html');
  const dup = client.parseHead('HTTP/1.1 200 OK\r\nContent-Length: 5\r\nContent-Length: 5');
  assert.equal(dup.length, 5);
  assert.equal(dup.headers['content-length'], '5', 'duplicate identical content-length is normalized to scalar');
  assert.equal(client.parseHead('garbage').status, 0);
}

// --- request head: hop headers dropped, no header injection, length always declared
{
  const head = client.buildRequest({ method: 'POST', path: '/x?y=1', identity: true, noCache: true, headers: {
    Host: 'www.youtube.com', 'Accept-Encoding': 'gzip', Connection: 'keep-alive', 'Transfer-Encoding': 'chunked', 'Content-Length': '999',
    'If-None-Match': '"abc"', 'If-Modified-Since': 'Wed, 21 Oct 2015 07:28:00 GMT', Range: 'bytes=0-10',
    'X-Evil': 'a\r\nInjected: yes', Cookie: ['a=1', 'b=2'] } }, 4);
  assert.match(head, /^POST \/x\?y=1 HTTP\/1\.1\r\n/);
  assert.match(head, /\r\naccept-encoding: identity\r\n/);
  assert.doesNotMatch(head, /gzip/);
  assert.doesNotMatch(head, /if-none-match|if-modified-since|range:/i, 'noCache strips conditional/range headers');
  assert.doesNotMatch(head, /Injected/i);
  assert.doesNotMatch(head, /999/);
  assert.match(head, /\r\ncontent-length: 4\r\n/);
  assert.match(head, /\r\nconnection: close\r\n\r\n$/);
  assert.match(head, /cookie: a=1\r\ncookie: b=2\r\n/);
  assert.doesNotMatch(client.buildRequest({ method: 'GET', path: '/', headers: {} }, 0), /content-length/);
  assert.match(client.buildRequest({ method: 'GET', path: '/x', headers: { 'If-None-Match': '"v1"' } }, 0), /if-none-match: "v1"/i);
}

// --- sandbox UI (no confirm()), setup symlink guard & atomic setup / teardown poll
{
  const s = setup.setupScript();
  assert.ok(s.includes('[ -L "$D" ] && rm -f "$D"; mkdir -p "$D"'), 'setup removes $D symlink before mkdir');
  assert.ok(s.includes('mv "$C.tmp" "$C"') && s.includes('mv leaf.key.tmp leaf.key; mv leaf.crt.tmp leaf.crt'), 'setup swaps content and leaf certs atomically');
  const launch = setup.launchScript('127.0.0.2', 8101);
  assert.ok(launch.includes('app_launcher -t ') && launch.includes('app_launcher -k ') && launch.includes('yt_up'), 'launchScript polls process exit and escalates to -k');
  assert.ok(!launch.includes('sed -n 4p'), 'launchScript does not rely on positional cmdline arg #4');
  // yt_up() detects Tizen 9 base64-encoded __AUL_APPID__ / shifted USERDATA and excludes ytkids/yttv
  {
    const fnEnd = launch.indexOf('\nyt_wait()');
    const fnBody = launch.slice(0, fnEnd);
    const fakeProc = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-yt-proc-'));
    const posixProc = fakeProc.split(path.sep).join('/');
    const probe = (tokens, comm) => {
      const pidDir = path.join(fakeProc, '15319');
      fs.rmSync(pidDir, { recursive: true, force: true });
      fs.mkdirSync(pidDir, { recursive: true });
      fs.writeFileSync(path.join(pidDir, 'cmdline'), Buffer.from(tokens.join('\0') + '\0'));
      if (comm) fs.writeFileSync(path.join(pidDir, 'comm'), comm + '\n');
      const shScript = fnBody.split('/proc/[0-9]*/cmdline').join(posixProc + '/[0-9]*/cmdline') + '\nyt_up\n';
      return cp.spawnSync('sh', ['-c', shScript]).status === 0;
    };
    const b64 = s => Buffer.from(s).toString('base64');
    // shell subshell with /bin/sh -c "...com.samsung.tv.cobalt-yt..." must never self-match
    assert.equal(probe(['/bin/sh', '-c', 'app_launcher -t com.samsung.tv.cobalt-yt -u 5001']), false, 'sh -c subshell without comm must not self-match');
    assert.equal(probe(['/bin/sh', '-c', 'app_launcher -t com.samsung.tv.cobalt-yt -u 5001'], 'sh'), false, 'sh -c subshell with comm=sh must not self-match');
    assert.equal(probe(['busybox', 'sh', '-c', 'com.samsung.tv.cobalt-yt'], 'busybox'), false, 'busybox subshell must not self-match');
    // Tizen 9: USERDATA shifted past arg #4 and __AUL_APPID__ base64-encoded
    assert.equal(probe(['/usr/apps/com.samsung.tv.cobalt/bin/cobalt_launcher', '__APP_SVC_OP_TYPE__', 'x', 'http://tizen.org/appcontrol/operation/default',
      '__AUL_EX_CHECK_HYBRID_TO_NATIVE', '1', '__AUL_APPID__', b64('com.samsung.tv.cobalt-yt'), 'USERDATA', b64(' --dial_name=YouTube --use_eden')], 'cobalt_launcher'), true, 'Tizen 9 shifted USERDATA + base64 APPID');
    // Tizen 9 bare launch without USERDATA (base64 __AUL_APPID__ only)
    assert.equal(probe(['/usr/apps/com.samsung.tv.cobalt/bin/cobalt_launcher', '__AUL_APPID__', b64('com.samsung.tv.cobalt-yt')], 'cobalt_launcher'), true, 'Tizen 9 base64 APPID without USERDATA');
    // Legacy plaintext cmdline
    assert.equal(probe(['/usr/bin/cobalt', 'com.samsung.tv.cobalt-yt'], 'cobalt'), true, 'plaintext appId detected');
    // Exclusions: ytkids and yttv (both base64 and plaintext) must NOT match
    assert.equal(probe(['/usr/apps/com.samsung.tv.cobalt/bin/cobalt_launcher', '__AUL_APPID__', b64('com.samsung.tv.cobalt-ytkids'), 'USERDATA', b64(' --dial_name=YouTubeKids')], 'cobalt_launcher'), false, 'ytkids excluded');
    assert.equal(probe(['/usr/apps/com.samsung.tv.cobalt/bin/cobalt_launcher', '__AUL_APPID__', b64('com.samsung.tv.cobalt-yttv')], 'cobalt_launcher'), false, 'yttv excluded');
    assert.equal(probe(['/usr/bin/cobalt', 'com.samsung.tv.cobalt-ytkids'], 'cobalt'), false, 'plaintext ytkids excluded');
    // Cold-start teardown gate: app_launcher -t is inside if yt_up
    assert.match(launch, /if yt_up; then\n\s+app_launcher -t /);
    fs.rmSync(fakeProc, { recursive: true, force: true });
  }
  const ytFactory = require(path.join(dir, 'index.js'));
  const yt = ytFactory({ config: { get: () => ({ tile: false, port: 0 }), set: () => {} }, execute: () => Promise.resolve({ exit_code: 0, stdout: 'ready\n' }) });
  let ui = '';
  yt.route({ method: 'GET' }, { writeHead() {}, end(x) { ui = x; } }, 'ui');
  assert.doesNotMatch(ui, /\bconfirm\(/, 'sandboxed iframe UI must not use window.confirm');
  assert.match(ui, /document\.hidden/);
}

// --- the page rewrite
{
  assert.equal(inject.isTvPage('/tv'), true);
  assert.equal(inject.isTvPage('/tv/'), true);
  assert.equal(inject.isTvPage('/tv?launch=menu'), true);
  assert.equal(inject.isTvPage('/tv/?launch=menu'), true);
  assert.equal(inject.isTvPage('/tv#start'), true);
  assert.equal(inject.isTvPage('/tv/#start'), true);
  assert.equal(inject.isTvPage('/tv_config?x=1'), false);
  assert.equal(inject.isTvPage('/tvx'), false);
  assert.equal(inject.isTvPage('/tv/watch'), false);
  const tag = inject.scriptTag('1.2.3');
  assert.equal(tag, '<script src="/vetro-youtube/userscript.js?v=1.2.3"></script>');
  const r = inject.rewritePage('<html><meta http-equiv="Content-Security-Policy" content="x"><body>hi</body></html>', tag);
  assert.equal(r.injected, true);
  assert.equal(r.html, '<html><body>hi' + tag + '</body></html>');
  const rUpper = inject.rewritePage('<html><meta http-equiv=Content-Security-Policy content="x"><BODY>hi<script>var s="</body>";</script></BODY ></html>', tag);
  assert.equal(rUpper.injected, true);
  assert.equal(rUpper.html, '<html><BODY>hi<script>var s="</body>";</script>' + tag + '</BODY ></html>');
  const r2 = inject.rewritePage('<p>no body</p>', tag);
  assert.equal(r2.injected, false);
  assert.ok(r2.html.endsWith(tag), 'the tag is still added');
  // a "$&" in the page must not be read as a replacement pattern
  assert.equal(inject.rewritePage('<body>$&</body>', tag).html, '<body>$&' + tag + '</body>');
  const h = inject.pageHeaders({ 'content-security-policy': 'default-src none', 'content-length': '5', 'content-encoding': 'gzip', 'alt-svc': 'h3', etag: '"1"', 'last-modified': 'x', expires: '0', 'cache-control': 'public', 'x-a': '1' }, 42);
  assert.deepEqual(Object.keys(h).sort(), ['cache-control', 'content-length', 'content-security-policy', 'x-a']);
  assert.equal(h['content-length'], 42);
  assert.equal(h['cache-control'], 'no-store, no-cache, must-revalidate');
  assert.equal(h['content-security-policy'], inject.CSP, 'Cobalt needs a CSP header, so there is always one');
  assert.match(inject.CSP, /connect-src \* ws: wss: data: blob:/);
  assert.deepEqual(inject.passHeaders({ 'alt-svc': 'h3', a: '1' }), { a: '1' });
}

// --- the shell scripts parse, and say what they promise
{
  const s = setup.setupScript();
  assert.equal(cp.spawnSync('sh', ['-n'], { input: s }).status, 0, 'setup script is valid sh');
  assert.match(s, /echo ready/);
  assert.match(s, /echo nocobalt/);
  assert.match(s, /chmod 600 ca\.key leaf\.key/, 'the CA key is not readable by others');
  assert.doesNotMatch(s, /\/etc\/|update-ca|trust anchor|ssl\/certs\/\$\{?H/, 'the TV\'s own trust store is never touched');
  assert.match(setup.launchScript('127.0.0.2', 8101), /USERDATA ' --base_url=https:\/\/www\.youtube\.com\/tv --dial_name=YouTube --use_eden --start_frag=#start --proxy=127\.0\.0\.2:8101,direct:\/\/ --content=\/opt\/usr\/home\/owner\/share\/vyt'/);
  assert.equal(cp.spawnSync('sh', ['-n'], { input: setup.launchScript('127.0.0.2', 8101) }).status, 0);
  assert.equal(cp.spawnSync('sh', ['-n'], { input: setup.cleanupScript() }).status, 0);
  assert.match(setup.cleanupScript(), /rm -rf "\/opt\/usr\/home\/owner\/share\/vetro-youtube" "\/opt\/usr\/home\/owner\/share\/vyt"/);
  assert.ok(setup.CONTENT.length <= 40, 'the content path stays short: Samsung passes the app at most 127 characters of flags');
  const round = cp.spawnSync('sh', ['-c', setup.wrap('echo "a b" \'c\'')]).stdout.toString();
  assert.equal(round, 'a b c\n', 'wrap() carries a script through unchanged');
}

// --- the pinned script: only the exact bytes are accepted
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-yt-'));
  const u = new us.UserScript(tmp);
  assert.equal(u.load(), null);
  fs.writeFileSync(path.join(tmp, 'userscript-' + us.VERSION + '.js'), 'alert(1)');
  assert.equal(u.load(), null, 'a file that does not match the SHA-256 is not used');
  assert.match(us.SHA256, /^[0-9a-f]{64}$/);
  assert.equal(us.sha256(Buffer.from('abc')), crypto.createHash('sha256').update('abc').digest('hex'));
  assert.match(us.URL_PATH, new RegExp('@' + us.VERSION.replace(/\./g, '\\.') + '/'), 'the download names one exact version');
  assert.doesNotMatch(us.URL_PATH, /latest|@\^|@~/);
  // concurrent ensure() deduplicates in-flight downloads
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-yt-dedup-'));
  const u2 = new us.UserScript(tmp2);
  let fetchCalls = 0;
  const origFetch = client.fetchBuffer;
  client.fetchBuffer = function (h, p, m, cb) { fetchCalls++; setTimeout(() => cb(new Error('offline')), 20); };
  let errs = 0;
  u2.ensure(() => { errs++; });
  u2.ensure(() => { errs++; });
  setTimeout(() => { client.fetchBuffer = origFetch; assert.equal(fetchCalls, 1, 'concurrent ensure deduplicates fetchBuffer'); assert.equal(errs, 2); }, 80);
}

// --- the proxy: a tunnel to anywhere, and the plugin's own script served over TLS on youtube.com
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-yt-tls-'));
  const run = (args) => { const r = cp.spawnSync('openssl', args, { cwd: tmp }); if (r.status !== 0) throw new Error(String(r.stderr)); };
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '2', '-subj', '/CN=Test CA',
    '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign']);
  run(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'leaf.key', '-subj', '/CN=www.youtube.com', '-out', 'leaf.csr']);
  fs.writeFileSync(path.join(tmp, 'ext'), 'subjectAltName=DNS:www.youtube.com\nbasicConstraints=CA:FALSE\n');
  run(['x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'leaf.crt', '-days', '2', '-extfile', 'ext']);
  const leaf = { key: fs.readFileSync(path.join(tmp, 'leaf.key')), cert: fs.readFileSync(path.join(tmp, 'leaf.crt'), 'utf8') + fs.readFileSync(path.join(tmp, 'ca.crt'), 'utf8') };

  let scriptNow = { body: Buffer.from('console.log("patched")'), version: '9' };
  const logs = [];
  // port 0: ask the OS, then read it back from a probe listener
  const probe = net.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const p2 = proxyLib.createProxy({ host: '127.0.0.1', port, log: m => logs.push(m), leaf: () => leaf, script: () => scriptNow });
  await new Promise((res, rej) => p2.listen(e => e ? rej(e) : res()));
  assert.equal(p2.listening(), true);

  function connect(target) {
    return new Promise((resolve, reject) => {
      const s = net.connect(port, '127.0.0.1', () => s.write('CONNECT ' + target + ' HTTP/1.1\r\nHost: ' + target + '\r\n\r\n'));
      s.once('data', d => resolve({ s, head: d.toString() }));
      s.on('error', reject);
    });
  }

  // tunnel: bytes go through untouched
  const echo = net.createServer(c => c.on('data', d => c.write(Buffer.concat([Buffer.from('echo:'), d])))); await new Promise(r => echo.listen(0, '127.0.0.1', r));
  const t = await connect('127.0.0.1:' + echo.address().port);
  assert.match(t.head, /^HTTP\/1\.1 200 Connection Established/);
  t.s.write('ping');
  assert.equal(await new Promise(r => t.s.once('data', d => r(d.toString()))), 'echo:ping');
  t.s.destroy(); echo.close();

  // anything that is not CONNECT is refused
  const bad = await new Promise(r => { const s = net.connect(port, '127.0.0.1', () => s.write('GET http://x/ HTTP/1.1\r\n\r\n')); s.once('data', d => { r(d.toString()); s.destroy(); }); });
  assert.match(bad, /^HTTP\/1\.1 502/);

  // youtube.com: TLS with the leaf, and the script is served from the proxy itself (no network)
  const y = await connect('www.youtube.com:443');
  assert.match(y.head, /^HTTP\/1\.1 200/);
  const secure = tls.connect({ socket: y.s, servername: 'www.youtube.com', ca: fs.readFileSync(path.join(tmp, 'ca.crt')) });
  await new Promise((res, rej) => { secure.on('secureConnect', res); secure.on('error', rej); });
  secure.write('GET /vetro-youtube/userscript.js?v=9 HTTP/1.1\r\nHost: www.youtube.com\r\nConnection: close\r\n\r\n');
  const reply = await new Promise(r => { let b = ''; secure.on('data', d => { b += d; }); secure.on('end', () => r(b)); secure.on('close', () => r(b)); });
  assert.match(reply, /^HTTP\/1\.1 200 OK/);
  assert.match(reply, /content-type: application\/javascript/i);
  assert.match(reply, /console\.log\("patched"\)$/);

  // a host that is not YouTube is never answered by the local routes
  const y2 = await connect('www.youtube.com:443');
  const secure2 = tls.connect({ socket: y2.s, servername: 'www.youtube.com', ca: fs.readFileSync(path.join(tmp, 'ca.crt')) });
  await new Promise((res, rej) => { secure2.on('secureConnect', res); secure2.on('error', rej); });
  secure2.write('GET /vetro-youtube/userscript.js HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n');
  const reply2 = await new Promise(r => { let b = ''; secure2.on('data', d => { b += d; }); secure2.on('end', () => r(b)); secure2.on('close', () => r(b)); });
  assert.match(reply2, /^HTTP\/1\.1 421/);

  // without the script the proxy does not open youtube.com at all: plain tunnel, the app runs unpatched
  scriptNow = null;
  const echo2 = net.createServer(c => c.end('x')); await new Promise(r => echo2.listen(0, '127.0.0.1', r));
  const y3 = await connect('127.0.0.1:' + echo2.address().port);
  assert.match(y3.head, /^HTTP\/1\.1 200/);
  y3.s.destroy(); echo2.close();
  assert.equal(p2.stats().opened, 2);

  p2.close();
  assert.equal(p2.listening(), false);
  console.log('youtube plugin: ok');
})().catch(e => { console.error(e); process.exit(1); });
