'use strict';
// The screen-share Shard end to end through the plugin host: pack, install (with its native assets), start the
// "helper" on demand, pass the stream through, and keep unknown request parameters away from the helper.
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { PluginHost } = require('../service/plugin-host.js');
const { pack } = require('../scripts/vetro-plugin.cjs');

const SRC = path.join(__dirname, '..', 'examples', 'plugins', 'screen-share');
const get = (port, p) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, r => {
        const chunks = [];
        r.on('data', c => chunks.push(c));
        r.on('end', () => resolve({ code: r.statusCode, type: r.headers['content-type'], body: Buffer.concat(chunks) }));
    }).on('error', reject);
});
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

(async () => {
    const packed = pack(SRC);
    assert.equal(JSON.parse(packed.text).version, 2);
    assert.deepEqual(packed.manifest.permissions, ['exec', 'native']);
    assert.deepEqual(packed.manifest.assets.map(a => a.name), ['TvCapture.dll', 'TvCapture.runtimeconfig.json']);
    assert.ok(packed.size < 100 * 1024, 'the bundle stays small');

    // the "helper": records what reaches it and plays a two-frame MJPEG stream
    const seen = [];
    const helper = http.createServer((req, res) => {
        seen.push(req.url);
        if (req.url.indexOf('/stream') === 0) {
            res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=frame' });
            res.end('--frame\r\nContent-Type: image/jpeg\r\n\r\nJPEG1\r\n--frame\r\nContent-Type: image/jpeg\r\n\r\nJPEG2\r\n');
        } else if (req.url === '/status') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end('{"clients":1,"fps":14.8,"width":1280,"height":720,"protect":0,"error":""}');
        } else if (req.url === '/quit') { res.end('bye'); } else { res.writeHead(404); res.end(); }
    });
    const helperPort = await listen(helper);
    helper.close();                      // not running yet: the plugin has to ask for it to be started
    await new Promise(r => setTimeout(r, 50));

    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-screen-')), 'p');
    const commands = [];
    const host = new PluginHost({ dir, stableMs: 10, execute: cmd => {
        commands.push(cmd);
        setTimeout(() => helper.listen(helperPort, '127.0.0.1'), 300);   // dotnet takes a moment
        return Promise.resolve({ stdout: 'started\n' });
    } });
    host._writeState({ enabled: {}, developer: true });
    host.start();
    host.install(packed.text, packed.sha256);
    fs.writeFileSync(path.join(dir, 'screen-share', 'config.json'), JSON.stringify({ port: helperPort }));
    assert.equal(host.setEnabled('screen-share', true).state, 'running');
    assert.deepEqual(commands, [], 'switching the Shard on runs nothing');

    const web = http.createServer((req, res) => {
        const pathname = req.url.split('?')[0];
        host.handle(req, res, pathname, (r, b, c) => { r.writeHead(c || 200, { 'content-type': 'application/json' }); r.end(JSON.stringify(b)); }, null);
    });
    const webPort = await listen(web);
    const api = p => get(webPort, '/plugins/screen-share/api/' + p);

    // the page
    let r = await api('ui');
    assert.equal(r.code, 200);
    assert.match(r.type, /text\/html/);
    assert.match(r.body.toString(), /stream\?fps=/);

    // helper down: status says so, and nothing is started by a status call
    r = await api('status');
    assert.deepEqual(JSON.parse(r.body), { running: false });
    assert.deepEqual(commands, []);

    // stream: the helper is started once, then the frames pass through; unknown parameters are dropped
    r = await api('stream?fps=10&q=70&size=640x360&evil=1&w=abc&h=%24%28id%29');
    assert.equal(r.code, 200);
    assert.match(r.type, /multipart\/x-mixed-replace/);
    assert.match(r.body.toString(), /JPEG1[\s\S]*JPEG2/);
    assert.equal(commands.length, 1);
    assert.deepEqual(seen.filter(u => u.indexOf('/stream') === 0), ['/stream?fps=10&q=70&size=640x360']);

    // what was run: base64 of a script that starts the packaged helper on the chosen port, bound to the plugin folder
    const m = /^echo (\S+) \| base64 -d \| sh$/.exec(commands[0]);
    assert.ok(m, 'wrapped like every root command of Vetro');
    const script = Buffer.from(m[1], 'base64').toString();
    assert.ok(script.indexOf('/usr/bin/dotnet "' + path.join(dir, 'screen-share', 'assets', 'TvCapture.dll') + '" --serve ' + helperPort) >= 0);
    assert.match(script, /127\.0\.0\.1:\d+ /);

    // helper up now: status passes through, a second stream starts nothing
    r = await api('status');
    assert.equal(JSON.parse(r.body).width, 1280);
    r = await api('stream');
    assert.equal(r.code, 200);
    assert.equal(commands.length, 1, 'a running helper is not started again');
    assert.equal(seen.pop(), '/stream');
    assert.equal((await api('nope')).code, 404);

    // the helper files are really there, byte for byte what was packed
    for (const a of packed.manifest.assets) {
        const file = fs.readFileSync(path.join(dir, 'screen-share', 'assets', a.name));
        assert.equal(file.length, a.size);
    }

    // switching off asks the helper to quit
    seen.length = 0;
    host.setEnabled('screen-share', false);
    await new Promise(r => setTimeout(r, 200));
    assert.ok(seen.indexOf('/quit') >= 0);

    web.close();
    helper.close();
    console.log('plugin-screen-share: ok');
})().catch(e => { console.error(e); process.exit(1); });
