'use strict';
// The proxy and the HTTPS client of the YouTube plugin against a fake YouTube (a local TLS server): headers far bigger than
// Node 12's limit, chunked bodies, the /tv rewrite end to end, and hostile or broken peers. The process must survive all of it:
// the plugin runs inside Vetro, and one uncaught exception there would take Vetro down.
const assert = require('assert').strict;
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), tls = require('tls'), cp = require('child_process');
process.on('uncaughtException', e => { console.error('UNCAUGHT', e); process.exit(2); });
process.on('unhandledRejection', e => { console.error('UNHANDLED', e); process.exit(2); });

const dir = path.join(__dirname, '..', 'examples', 'plugins', 'youtube');
const client = require(path.join(dir, 'tls-client.js'));
const proxyLib = require(path.join(dir, 'proxy.js'));
const inject = require(path.join(dir, 'inject.js'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const free = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-yt-proxy-'));
const run = a => { const r = cp.spawnSync('openssl', a, { cwd: tmp }); if (r.status !== 0) throw new Error(String(r.stderr)); };
run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '2', '-subj', '/CN=Test CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign']);
run(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'leaf.key', '-subj', '/CN=www.youtube.com', '-out', 'leaf.csr']);
fs.writeFileSync(path.join(tmp, 'ext'), 'subjectAltName=DNS:www.youtube.com\nbasicConstraints=CA:FALSE\n');
run(['x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'leaf.crt', '-days', '2', '-extfile', 'ext']);
const CA = fs.readFileSync(path.join(tmp, 'ca.crt'));
const leaf = { key: fs.readFileSync(path.join(tmp, 'leaf.key')), cert: fs.readFileSync(path.join(tmp, 'leaf.crt'), 'utf8') + CA.toString() };

(async () => {
  // The fake YouTube. What it answers is chosen by the request path.
  const HTML = '<html><head><meta http-equiv="Content-Security-Policy" content="default-src none"></head><body>TV</body></html>';
  let seen = [], floodSent = 0, upOpen = 0;
  const upstream = tls.createServer(leaf, sock => {
    sock.on('error', () => {});
    upOpen++; sock.on('close', () => { upOpen--; });
    let buf = '';
    sock.on('data', d => {
      buf += d.toString('latin1');
      const i = buf.indexOf('\r\n\r\n'); if (i < 0) return;
      const head = buf.slice(0, i), first = head.split('\r\n')[0], p = first.split(' ')[1];
      seen.push(head);
      const big = 'x-big: ' + 'a'.repeat(20000) + '\r\n';          // 20 KB header: over Node 12's 8 KB limit
      if (p.indexOf('/tv') === 0) {
        const half = Math.floor(HTML.length / 2);
        sock.end('HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\ncontent-security-policy: default-src none\r\nalt-svc: h3=":443"\r\ntransfer-encoding: chunked\r\nset-cookie: a=1\r\nset-cookie: b=2\r\n' + big + '\r\n' +
          half.toString(16) + '\r\n' + HTML.slice(0, half) + '\r\n' + (HTML.length - half).toString(16) + '\r\n' + HTML.slice(half) + '\r\n0\r\n\r\n');
      } else if (p === '/plain') {
        sock.end('HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-length: 5\r\n' + big + '\r\nhello');
      } else if (p === '/echo') {
        sock.end('HTTP/1.1 200 OK\r\ncontent-length: ' + head.length + '\r\n\r\n' + head);
      } else if (p === '/garbage') { sock.end('this is not http at all'); }
      else if (p === '/cut') { sock.write('HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n5\r\nhel'); setTimeout(() => sock.destroy(), 50); }
      else if (p === '/hang') { /* never answers */ }
      else if (p === '/short') sock.end('HTTP/1.1 200 OK\r\ncontent-length: 5\r\n\r\nhel');
      else if (p === '/continue') sock.end('HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 103 Early Hints\r\nlink: x\r\n\r\nHTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok');
      else if (p === '/nominated') sock.end('HTTP/1.1 200 OK\r\nconnection: x-secret\r\nx-secret: 1\r\nx-keep: 2\r\ncontent-length: 0\r\n\r\n');
      else if (p === '/204') sock.write('HTTP/1.1 204 No Content\r\nx-a: b\r\n\r\n');                  // keeps the socket open: the client must not wait for more
      else if (p === '/stall') sock.write('HTTP/1.1 200 OK\r\ncontent-length: 100\r\n\r\nabc');           // headers, a few bytes, then silence
      else if (p === '/flood') {
        const piece = Buffer.alloc(65536, 97); let sent = 0; const total = 40 * 1024 * 1024;
        sock.write('HTTP/1.1 200 OK\r\ncontent-length: ' + total + '\r\n\r\n');
        const pump = () => { while (sent < total) { sent += piece.length; floodSent = sent; if (!sock.write(piece)) { sock.once('drain', pump); return; } } sock.end(); };
        pump();
      }
      else if (p === '/flood-chunked') {
        const piece = Buffer.alloc(65536, 98); let sent = 0; const total = 40 * 1024 * 1024;
        sock.write('HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n');
        const pump = () => { while (sent < total) { sent += piece.length; floodSent = sent; const a = sock.write('10000\r\n'), b = sock.write(piece), c = sock.write('\r\n'); if (!(a && b && c)) { sock.once('drain', pump); return; } } sock.end('0\r\n\r\n'); };
        pump();
      }
      else sock.end('HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\n\r\n');
    });
  });
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  const upPort = upstream.address().port;
  // The client dials the real name; here it is sent to the fake, trusting only the test authority.
  const realConnect = tls.connect;
  tls.connect = function (o) { return realConnect.call(tls, { host: '127.0.0.1', port: upPort, servername: o.servername, ca: CA }); };
  const realNet = net.connect;                         // a plain tunnel to "www.youtube.com" must not leave this machine
  net.connect = function (p, h) { return h === 'www.youtube.com' ? realNet.call(net, upPort, '127.0.0.1') : realNet.apply(net, arguments); };
  const appTls = o => realConnect.call(tls, o);       // the test acting as the YouTube app keeps the real one

  // --- the client alone
  const get = (p, extra) => new Promise((res, rej) => client.request(Object.assign({ host: 'www.youtube.com', method: 'GET', path: p, headers: { host: 'www.youtube.com' }, timeout: 1500 }, extra || {}), null,
    (e, r) => { if (e) return rej(e); const parts = []; r.body.on('data', c => parts.push(c)); r.body.on('end', () => res({ status: r.status, headers: r.headers, body: Buffer.concat(parts).toString() })); r.body.on('error', rej); }));
  let r = await get('/plain');
  assert.equal(r.status, 200); assert.equal(r.body, 'hello'); assert.equal(r.headers['x-big'].length, 20000, 'a 20 KB header is read (Node 12 itself refuses it)');
  r = await get('/tv?x=1');
  assert.equal(r.body, HTML, 'a chunked body is rebuilt');
  assert.deepEqual(r.headers['set-cookie'], ['a=1', 'b=2']);
  await assert.rejects(get('/garbage'), /not an HTTP response|closed before/);
  await assert.rejects(get('/hang', { timeout: 300 }), /timeout/);
  await assert.rejects(get('/cut'), /cut short/, 'a chunked body that stops early is an error, not a quiet end');
  await assert.rejects(get('/short'), /cut short/, 'a body shorter than its content-length is an error');
  r = await get('/continue');
  assert.equal(r.status, 200); assert.equal(r.body, 'ok', '100 Continue and 103 Early Hints are skipped, the real answer is returned');
  r = await get('/nominated');
  assert.equal(r.headers['x-secret'], undefined, 'a header named in Connection is not passed on'); assert.equal(r.headers['x-keep'], '2');
  r = await get('/204');
  assert.equal(r.status, 204); assert.equal(r.body, '', '204 has no body and the client does not wait for the socket to close');
  r = await get('/echo', { method: 'HEAD' }).catch(e => e);
  assert.ok(r.status === 200 || r instanceof Error);
  { const before = upOpen; await assert.rejects(get('/stall', { timeout: 300 }), /cut short|timeout/); await sleep(150); assert.ok(upOpen <= before, 'a stalled upstream is closed after the timeout: ' + upOpen + ' open'); }
  assert.equal(client.buildRequest({ method: 'GET', path: '/', headers: { host: 'a', connection: 'x-secret, close', 'x-secret': '1', 'x-keep': '2' } }, 0).includes('x-secret'), false, 'request: header named in Connection is dropped');

  // a slow reader must slow the upstream down, not fill memory
  for (const route of ['/flood', '/flood-chunked']) {
    floodSent = 0;
    const got = await new Promise((resolve, reject) => client.request({ host: 'www.youtube.com', method: 'GET', path: route, headers: { host: 'www.youtube.com' }, timeout: 20000 }, null, (e, rr) => {
      if (e) return reject(e);
      setTimeout(() => {
        const heldBack = floodSent;
        assert.ok(heldBack < 24 * 1024 * 1024, route + ': the upstream was stopped while nobody read (' + heldBack + ' bytes sent of 40 MB)');
        let n = 0; rr.body.on('data', c => { n += c.length; }); rr.body.on('end', () => resolve(n)); rr.body.on('error', reject);
      }, 600);
    }));
    assert.equal(got, 40 * 1024 * 1024, route + ': everything arrives once the reader starts');
  }
  r = await get('/echo');
  assert.match(r.body, /^GET \/echo HTTP\/1\.1\r\nhost: www\.youtube\.com\r\nconnection: close$/);

  // --- the proxy, end to end
  const port = await free(), logs = [];
  let script = { body: Buffer.from('/*script*/'), version: '7' };
  let pages = 0;
  const proxy = proxyLib.createProxy({ host: '127.0.0.1', port, log: m => logs.push(m), leaf: () => leaf, script: () => script, onPage: () => { pages++; }, maxConnections: 60 });
  await new Promise((res, rej) => proxy.listen(e => e ? rej(e) : res()));
  const open = target => new Promise((resolve, reject) => { const s = net.connect(port, '127.0.0.1', () => s.write('CONNECT ' + target + ' HTTP/1.1\r\nHost: ' + target + '\r\n\r\n')); s.once('data', d => resolve({ s, head: d.toString() })); s.on('close', () => resolve({ s, head: '' })); s.on('error', reject); });
  const viaProxy = async (rawRequest) => {
    const c = await open('www.youtube.com:443');
    const t = appTls({ socket: c.s, servername: 'www.youtube.com', ca: CA });
    await new Promise((res, rej) => { t.on('secureConnect', res); t.on('error', rej); });
    t.write(rawRequest);
    return await new Promise(res => { let b = Buffer.alloc(0); t.on('data', d => { b = Buffer.concat([b, d]); }); t.on('close', () => res(b.toString())); t.on('end', () => res(b.toString())); setTimeout(() => res(b.toString()), 4000); });
  };
  let out = await viaProxy('GET /tv?launch=menu HTTP/1.1\r\nHost: www.youtube.com\r\nAccept-Encoding: gzip\r\nConnection: close\r\n\r\n');
  assert.match(out, /^HTTP\/1\.1 200 OK/);
  assert.ok(out.includes('<script src="/vetro-youtube/userscript.js?v=7"></script></body>'), 'the script tag is in the page');
  assert.ok(!out.includes('content="default-src none"'), 'the page\'s own CSP meta is gone');
  assert.ok(out.toLowerCase().includes('content-security-policy: ' + inject.CSP.toLowerCase()), 'our CSP is the only one');
  assert.ok(!out.toLowerCase().includes('alt-svc'), 'no QUIC hint reaches the app');
  assert.ok(/set-cookie: a=1/i.test(out) && /set-cookie: b=2/i.test(out), 'cookies pass through');
  assert.equal(pages, 1);
  assert.match(seen[seen.length - 1], /accept-encoding: identity/i, 'the /tv page is asked for uncompressed so it can be edited');
  out = await viaProxy('GET /plain HTTP/1.1\r\nHost: www.youtube.com\r\nAccept-Encoding: gzip\r\nConnection: close\r\n\r\n');
  assert.match(out, /^HTTP\/1\.1 200 OK/); assert.ok(out.endsWith('hello')); assert.match(seen[seen.length - 1], /accept-encoding: gzip/i, 'everything else is passed as the app asked');
  assert.equal(pages, 1, 'only /tv is rewritten');
  out = await viaProxy('POST /echo HTTP/1.1\r\nHost: www.youtube.com\r\nContent-Length: 4\r\nConnection: close\r\n\r\nabcd');
  assert.match(out, /^HTTP\/1\.1 200/);
  out = await viaProxy('GET /garbage HTTP/1.1\r\nHost: www.youtube.com\r\nConnection: close\r\n\r\n');
  assert.match(out, /^HTTP\/1\.1 502/, 'a broken upstream becomes a 502, not a hang or a crash');
  out = await viaProxy('GET /cut HTTP/1.1\r\nHost: www.youtube.com\r\nConnection: close\r\n\r\n');
  assert.ok(!/^HTTP\/1\.1 200[\s\S]*\r\n0\r\n\r\n$/.test(out), 'a cut body is never presented as complete');
  // a CONNECT that arrives in pieces is still one CONNECT
  { const got = await new Promise((resolve, reject) => { const sk = net.connect(port, '127.0.0.1', () => { sk.write('CON'); setTimeout(() => sk.write('NECT www.youtube.com:443 HTTP/1.1\r\nHo'), 60); setTimeout(() => sk.write('st: x\r\n\r\n'), 120); }); sk.once('data', d => { sk.destroy(); resolve(d.toString()); }); sk.on('error', reject); });
    assert.match(got, /^HTTP\/1\.1 200/, 'split CONNECT: ' + got); }
  // closing before a start finished leaves nothing listening
  { const p2 = await free(); const px = proxyLib.createProxy({ host: '127.0.0.1', port: p2, log() {}, leaf: () => leaf, script: () => script });
    px.listen(() => {}); px.close(); await sleep(150);
    assert.equal(px.listening(), false); const alive = await new Promise(res => { const c2 = net.connect(p2, '127.0.0.1'); c2.on('connect', () => { c2.destroy(); res(true); }); c2.on('error', () => res(false)); });
    assert.equal(alive, false, 'listen() then close() leaves no server behind'); }

  // --- hostile and broken peers: nothing may throw (the process-wide handlers above would end the test)
  const junk = [Buffer.from('\x00\x01\x02garbage'), Buffer.from('CONNECT\r\n\r\n'), Buffer.from('CONNECT a:99999 HTTP/1.1\r\n\r\n'), Buffer.from('CONNECT [::1]:443 HTTP/1.1\r\n\r\n'),
    Buffer.from('CONNECT ' + 'a'.repeat(10000) + ':443 HTTP/1.1\r\n\r\n'), Buffer.from('GET http://example.com/ HTTP/1.1\r\n\r\n'), Buffer.alloc(0)];
  for (const j of junk) await new Promise(res => { const s = net.connect(port, '127.0.0.1', () => { s.write(j); setTimeout(() => { s.destroy(); res(); }, 40); }); s.on('error', () => res()); s.on('data', () => {}); });
  for (let i = 0; i < 40; i++) { const s = net.connect(port, '127.0.0.1'); s.on('error', () => {}); setTimeout(() => s.destroy(), i % 5); }
  // TLS junk after a good CONNECT, a client that vanishes mid-request, one that sends half a request
  { const c = await open('www.youtube.com:443'); c.s.write(Buffer.from('this is not a TLS hello at all')); await sleep(80); c.s.destroy(); }
  { const c = await open('www.youtube.com:443'); const t = appTls({ socket: c.s, servername: 'www.youtube.com', ca: CA }); await new Promise(res => t.on('secureConnect', res)); t.write('GET /hang HTTP/1.1\r\nHost: www.youtube.com\r\n\r\n'); await sleep(80); t.destroy(); }
  { const c = await open('www.youtube.com:443'); const t = appTls({ socket: c.s, servername: 'www.youtube.com', ca: CA }); await new Promise(res => t.on('secureConnect', res)); t.write('POST /x HTTP/1.1\r\nHost: www.youtube.com\r\nContent-Length: 100\r\n\r\nabc'); await sleep(80); t.destroy(); }
  // a request line the HTTP parser refuses, and a Host that is not YouTube
  { const out2 = await viaProxy('NOT HTTP\r\n\r\n'); assert.ok(typeof out2 === 'string'); }
  assert.match(await viaProxy('GET /tv HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n'), /^HTTP\/1\.1 421/);
  // a tunnel to a host that does not exist: the client's connection is closed, nothing throws
  { const c = await open('nonexistent.invalid:443').catch(() => null); assert.equal(c && c.head, '', 'no answer, the connection is closed'); }
  await sleep(300);

  // --- connection cap
  const socks = [];
  for (let i = 0; i < 100; i++) { const s = net.connect(port, '127.0.0.1'); s.on('error', () => {}); socks.push(s); }
  await sleep(600);
  assert.ok(proxy.stats().refused > 0, 'connections beyond the cap are refused');
  assert.ok(proxy.stats().live <= 60, 'and never exceed it: ' + proxy.stats().live);
  socks.forEach(s => s.destroy());
  await sleep(400);
  assert.ok(proxy.stats().live < 20, 'closed connections are forgotten: ' + proxy.stats().live);
  const again = await open('127.0.0.1:' + upPort);
  assert.match(again.head, /^HTTP\/1\.1 200/, 'the proxy still works after all of that');
  again.s.destroy();

  // --- the certificate or the script going away turns the proxy into a plain tunnel
  script = null;
  const ev = await open('www.youtube.com:443');
  ev.s.destroy();
  assert.match(ev.head, /^HTTP\/1\.1 200/);
  proxy.close();
  assert.equal(proxy.listening(), false);
  upstream.close();
  console.log('youtube proxy: ok');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
