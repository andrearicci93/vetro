'use strict';
// A port chosen in Apps2Samsung lives in the package's files, not in build-info.js. A self-update swaps the service and
// the page for ones built for the default port, but never config.xml: the service reads the port from there, so it stays
// where the user put it, and the updater then keeps it in every file it installs.
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), net = require('net');
const spawn = require('child_process').spawn;
const {packagePort} = require('../service/updater.js');

const xml = port => '<widget>\n    <access origin="http://127.0.0.1:' + port + '" subdomains="false"/>\n    <access origin="ws://127.0.0.1:8001" subdomains="false"/>\n</widget>';
assert.equal(packagePort(xml(9123)), 9123);
assert.equal(packagePort(xml(8099)), null, 'the default port is not a choice');
assert.equal(packagePort(fs.readFileSync(path.join(__dirname, '..', 'config.xml'), 'utf8')), null, 'the package as built here');
assert.equal(packagePort(xml(80)), null); assert.equal(packagePort(xml(8001)), null); assert.equal(packagePort(xml(70000)), null);
assert.equal(packagePort(''), null); assert.equal(packagePort(null), null);
assert.equal(packagePort('<access origin="ws://127.0.0.1:8001"/><access origin="https://127.0.0.1:9123"/>'), null, 'only the page\'s own http origin counts');

// The TV page does the same for itself, and keeps Apps2Samsung's phrase as its fallback.
const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.ok(/x\.open\('GET', 'config\.xml', false\)/.test(page) && /if \(m\) BASE = m\[1\];/.test(page), 'the page reads its port from config.xml');

// The real service, as a self-update leaves it: files built for the default port beside a config.xml with the chosen one.
const free = net.createServer();
free.listen(0, '127.0.0.1', function () {
    const port = free.address().port;
    free.close(function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-port-'));
        fs.mkdirSync(path.join(root, 'service'));
        fs.readdirSync(path.join(__dirname, '..', 'service')).filter(n => /\.js$/.test(n)).forEach(n => fs.copyFileSync(path.join(__dirname, '..', 'service', n), path.join(root, 'service', n)));
        fs.writeFileSync(path.join(root, 'config.xml'), xml(port));
        const env = Object.assign({}, process.env, {VETRO_BIND_HOST: '127.0.0.1', VETRO_UPDATE_DIR: path.join(root, 'update')});
        delete env.VETRO_PORT;
        const child = spawn(process.execPath, [path.join(root, 'service', 'main.js')], {env, stdio: ['ignore', 'pipe', 'pipe']});
        let out = '', err = '', finished = false;
        child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
        const deadline = Date.now() + 15000;
        const timer = setInterval(function () {
            if (Date.now() > deadline) return done(new Error('the service did not listen on the port of config.xml\n' + err + out));
            http.get({host: '127.0.0.1', port: port, path: '/status'}, function (res) {
                let body = ''; res.on('data', d => { body += d; }); res.on('end', function () {
                    try { assert.equal(JSON.parse(body).app.port, port, 'the updater is told the port too'); done(null); } catch (e) { done(e); }
                });
            }).on('error', function () { /* not up yet */ });
        }, 200);
        child.on('exit', code => done(new Error('the service ended: ' + code + '\n' + err + out)));
        function done(e) {
            if (finished) return; finished = true;
            clearInterval(timer); child.kill('SIGKILL');
            try { fs.rmSync(root, {recursive: true, force: true}); } catch (_) {}
            if (e) { console.log('FAIL package port: ' + e.message); process.exit(1); }
            console.log('PASS package port: read from config.xml, the default left alone, the service listens on it after a swap');
            process.exit(0);
        }
    });
});
