'use strict';
// A Shard's card in the Control center, on the service side: the saved choice, what the launcher is started with, and the two routes
// the launcher calls (text, always answered).
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path');
const { Dock, hexLabel, cleanCards } = require('../service/dock.js');
const { PluginHost } = require('../service/plugin-host.js');
const launcher = require('../service/plugin-launcher.js');

const hex = s => Buffer.from(s).toString('hex');
const HOME_DATA = ['F|csfs', 'O|d/webapp@aaa', 'R|' + hex('aaa') + '|' + hex('YouTube') + '|' + hex('com.samsung.tv.cobalt-yt') + '|0'].join('\n');
function res() { const r = { code: 0, head: null, body: null, headersSent: false, setHeader() {}, writeHead(c, h) { r.code = c; r.head = h; r.headersSent = true; }, end(b) { r.body = b; } }; return r; }
function json(r, obj, code) { r.code = code || 200; r.headersSent = true; r.body = obj; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const keepAlive = setInterval(() => {}, 1000);

function fixture() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-dockcard-'));
    const dir = path.join(tmpDir, 'dock');
    fs.mkdirSync(path.join(dir, 'res'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tvlauncher-dotnet.dll'), 'x'); fs.writeFileSync(path.join(dir, 'res', 'glass_tile.png'), 'x');
    const tv = { scripts: [], running: false, starts: 0, clock: 1000000 };
    const execute = async function (cmd) {
        tv.scripts.push(cmd);
        const script = /^echo \S+ \| base64 -d \| sh$/.test(cmd) ? Buffer.from(cmd.split(' ')[1], 'base64').toString() : cmd;
        if (script.includes('vconftool get')) return { exit_code: 0, stdout: 'x, value = 0 (Int32)\n' };
        if (script.includes('vconftool set')) return { exit_code: 0, stdout: '' };
        if (script.includes('.appLayerCache')) return { exit_code: 0, stdout: HOME_DATA };
        if (script.includes('setsid nohup')) { tv.starts++; tv.running = true; return { exit_code: 0, stdout: 'started\n' }; }
        if (script.includes('kill -9') && !script.includes('echo "dock=')) { tv.running = false; return { exit_code: 0, stdout: '' }; }
        if (script.includes('echo "dock=')) return { exit_code: 0, stdout: (tv.running ? 'dock=4242' : 'dock=') + '\nhome=0\nlog:\n\n' };
        if (/^for p in /.test(script)) return { exit_code: 0, stdout: '' };
        return { exit_code: 0, stdout: '' };
    };
    const dock = new Dock({ execute, dir, stateFile: path.join(tmpDir, 'state.json'), appsFile: path.join(tmpDir, 'apps.tsv'), port: 8099,
        sleep: async ms => { tv.clock += ms; }, now: () => tv.clock, uptime: () => 100000 });
    const host = new PluginHost({ dir: path.join(tmpDir, 'p'), external: false, stableMs: 10,
        services: { agentConnected: () => true, json, readJson: (req, r, cb) => cb(JSON.parse(req.body)) } });
    host.cardReadMs = 80; host.cardActionMs = 150;
    host.register(launcher.definition(dock, { tickMs: 20 }));
    dock.setShards(host);
    return { dock, host, tv, tmpDir };
}
const shardDef = (id, label, inst) => ({ id, apiVersion: 1, defaultEnabled: true, controlCenter: label ? { label } : undefined, create() { return inst; } });
const lights = () => ({ card() { return { rows: [{ id: 'living', label: 'Living room', value: 'on', ticked: true }, { id: 'kitchen', label: 'Kitchen' }], note: '2 lights' }; },
    cardSelect(id) { return { ok: id !== 'kitchen', note: id === 'kitchen' ? 'Lamp offline' : undefined }; } });
const get = (f, url) => { const r = res(); f.host.handle({ method: 'GET', url, headers: {} }, r, url.split('?')[0], json); return r; };
const post = (f, url) => { const r = res(); f.host.handle({ method: 'POST', url, headers: {} }, r, url.split('?')[0], json); return r; };

(async function () {
    // names: a saved list keeps "shard:<id>" for any well-formed id; at most three, once each; nothing else
    assert.deepEqual(cleanCards(['tasks', 'shard:home-assistant', 'shard:home-assistant', 'shard:Bad', 'shard:', 'shard:a', 'x', 'audio', 'picture']), ['tasks', 'shard:home-assistant', 'audio']);
    // the label on the command line: bytes outside [A-Za-z0-9.-] as =HH, so no quote, space, comma, colon or % ever reaches a shell or systemd
    assert.equal(hexLabel('Home Assistant'), 'Home=20Assistant');
    assert.equal(hexLabel('a_b=c:d,e%f"g\'h$i`j'), 'a=5Fb=3Dc=3Ad=2Ce=25f=22g=27h=24i=60j');
    assert.equal(hexLabel('Café ☀'), 'Caf=C3=A9=20=E2=98=80');
    assert.ok(/^[A-Za-z0-9.=-]*$/.test(hexLabel('any \u0000\n\t text ✓')));

    // one running Shard with a card: it can be chosen, saved, and the launcher is started with it
    const f = fixture();
    f.host.register(shardDef('home-assistant', 'Home Assistant', lights()));
    f.host.start();
    await f.dock.enable();
    assert.deepEqual(f.dock.cardChoices(), ['tasks', 'audio', 'picture', 'sleep', 'shard:home-assistant']);
    assert.deepEqual(f.dock.cardShards(), { 'shard:home-assistant': 'Home Assistant' });
    await assert.rejects(f.dock.setCards(['shard:nothing']), /Unknown card/, 'a Shard that is not there');
    await assert.rejects(f.dock.setCards(['shard:BAD']), /Unknown card/);
    await assert.rejects(f.dock.setCards(['tasks', 'audio', 'picture', 'shard:home-assistant']), /At most 3/);
    await f.dock.setCards(['tasks', 'shard:home-assistant']);
    assert.deepEqual(f.dock.readState().cards, ['tasks', 'shard:home-assistant']);
    assert.equal(f.dock.cardsArg(f.dock.readState()), 'tasks,shard:home-assistant:Home=20Assistant');
    const start = f.tv.scripts.filter(c => /setsid nohup|systemd-run/.test(Buffer.from((/^echo (\S+)/.exec(c) || [])[1] || '', 'base64').toString() + c)).pop();
    assert.match(Buffer.from(start.split(' ')[1], 'base64').toString(), / --cards tasks,shard:home-assistant:Home=20Assistant( |$)/, 'the launcher is restarted with the card');
    assert.equal(f.dock.cardsShown(), true, 'and remembers what it was started with');
    assert.equal((await f.dock.status()).cards.join(), 'tasks,shard:home-assistant');
    assert.deepEqual((await f.dock.status()).cardsPaused, []);

    // the Shard goes off: the card is not shown, the choice stays saved, the dashboard says so
    f.host.setEnabled('home-assistant', false);
    assert.deepEqual(f.dock.readState().cards, ['tasks', 'shard:home-assistant'], 'saved');
    assert.deepEqual(f.dock.cardsEffective(f.dock.readState()), ['tasks']);
    assert.equal(f.dock.cardsArg(f.dock.readState()), 'tasks');
    assert.equal(f.dock.cardsShown(), false, 'the running launcher still has the card: it must be restarted');
    let st = await f.dock.status();
    assert.deepEqual(st.cards, ['tasks']); assert.ok(!st.cardChoices.includes('shard:home-assistant'));
    assert.deepEqual(st.cardsPaused, [{ card: 'shard:home-assistant', label: 'Home Assistant', why: 'The Shard is switched off' }]);
    // another choice made meanwhile keeps the paused one behind it
    await f.dock.setCards(['audio']);
    assert.deepEqual(f.dock.readState().cards, ['audio', 'shard:home-assistant']);
    // the Control center switched off drops it from the list, but "on" again (the TV screen's tile) brings the last choice back
    await f.dock.setCards([]);
    assert.deepEqual(f.dock.readState().cards, []);
    assert.deepEqual(f.dock.readState().lastCards, ['audio', 'shard:home-assistant']);
    f.host.setEnabled('home-assistant', true);
    await f.dock.setCards(f.dock.readState().lastCards);
    assert.deepEqual(f.dock.cardsEffective(f.dock.readState()), ['audio', 'shard:home-assistant']);
    f.host.setEnabled('home-assistant', false);
    await f.dock.setCards(f.dock.readState().lastCards);      // while it is off, the saved name is still accepted
    assert.deepEqual(f.dock.readState().cards, ['audio', 'shard:home-assistant']);
    // paused cards never take a place that the cards just chosen need
    await f.dock.setCards(['tasks', 'audio', 'picture']);
    assert.deepEqual(f.dock.readState().cards, ['tasks', 'audio', 'picture']);
    // gone altogether
    await f.dock.setCards(['tasks']); f.host.setEnabled('home-assistant', true); await f.dock.setCards(['tasks', 'shard:home-assistant']);
    f.host.stop(); f.host.entries = Object.create(null); f.host.order = [];
    assert.equal((await f.dock.status()).cardsPaused[0].why, 'The Shard is not installed');
    assert.equal(f.dock.cardsArg(f.dock.readState()), 'tasks');

    // restarting the launcher when a Shard's card comes or goes (the same listener as the claimed tiles), only when the cards differ
    const g = fixture();
    g.host.register(shardDef('home-assistant', 'Home Assistant', lights()));
    g.dock.patchState({ enabled: true, cards: ['tasks', 'shard:home-assistant'], shownCards: 'tasks' });
    g.host.start();
    assert.equal(g.dock.cardsShown(), false, 'the launcher runs without the card the Shard now offers');
    await sleep(1800);
    assert.ok(g.tv.starts >= 1, 'the launcher was restarted for it');
    assert.equal(g.dock.readState().shownCards, 'tasks,shard:home-assistant:Home=20Assistant');
    const before = g.tv.starts;
    g.host.setEnabled('home-assistant', true); g.host.setEnabled('home-assistant', false); g.host.setEnabled('home-assistant', true);
    await sleep(1800);
    assert.equal(g.tv.starts - before <= 1, true, 'switching it off and on again does not restart the launcher more than once');
    g.host.stop();

    // the routes: text, always 200, whatever the Shard does
    const h = fixture();
    let behaviour = 'ok';
    h.host.register(shardDef('home-assistant', 'Home Assistant', {
        card() { if (behaviour === 'throws') throw new Error('boom'); if (behaviour === 'hangs') return new Promise(() => {}); return lights().card(); },
        cardSelect(id) { return lights().cardSelect(id); }
    }));
    h.host.start();
    let r = get(h, '/plugins/launcher/api/card?plugin=home-assistant');
    await sleep(20);
    assert.equal(r.code, 200); assert.equal(r.head['content-type'], 'text/plain; charset=utf-8');
    assert.equal(r.body, 'status\tok\nnote\t2 lights\nchoosable\t1\nrow\tliving\tLiving room\ton\t1\nrow\tkitchen\tKitchen\t\t0\n');
    r = post(h, '/plugins/launcher/api/card-select?plugin=home-assistant&row=living'); await sleep(40);
    assert.match(r.body, /^status\tok\nresult\tok\n/); assert.match(r.body, /row\tliving\tLiving room\ton\t1\n/);
    r = post(h, '/plugins/launcher/api/card-select?plugin=home-assistant&row=kitchen'); await sleep(40);
    assert.match(r.body, /^status\tok\nresult\tfail\nnote\tLamp offline\n/, 'a refusal: the note, and the rows are still there');
    assert.match(r.body, /row\tliving/);
    r = post(h, '/plugins/launcher/api/card-select?plugin=home-assistant&row=bad%20id'); await sleep(20);
    assert.match(r.body, /^status\tunavailable\nresult\tfail\n/);
    r = get(h, '/plugins/launcher/api/card?plugin=nothing'); await sleep(20);
    assert.equal(r.code, 200); assert.equal(r.body, 'status\tunavailable\nnote\tNo such card\nchoosable\t0\n');
    r = get(h, '/plugins/launcher/api/card'); await sleep(20);
    assert.match(r.body, /^status\tunavailable/, 'no plugin given');
    r = get(h, '/plugins/launcher/api/card?plugin=%E0%A4%A'); await sleep(20);
    assert.match(r.body, /^status\tunavailable/, 'a broken escape is just unavailable');
    behaviour = 'throws'; r = get(h, '/plugins/launcher/api/card?plugin=home-assistant'); await sleep(20);
    assert.equal(r.code, 200); assert.equal(r.body, 'status\tunavailable\nnote\tboom\nchoosable\t0\n');
    behaviour = 'hangs'; r = get(h, '/plugins/launcher/api/card?plugin=home-assistant'); await sleep(200);
    assert.match(r.body, /^status\tunavailable\nnote\tThe Shard did not answer in time/);
    h.host.setEnabled('home-assistant', false);
    r = get(h, '/plugins/launcher/api/card?plugin=home-assistant'); await sleep(20);
    assert.equal(r.body, 'status\tunavailable\nnote\tNot running\nchoosable\t0\n');
    r = post(h, '/plugins/launcher/api/card?plugin=home-assistant'); await sleep(20);
    assert.equal(r.code, 404, 'a route answers only the method it is for');
    h.host.stop();

    clearInterval(keepAlive);
    console.log('dock-card: ok');
})().catch(e => { console.error(e); process.exit(1); });
