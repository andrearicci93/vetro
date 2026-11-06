'use strict';
// Firmware and Tizen version read by the service when the widget's probe never arrived (#17, #25).
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const info = require('../service/device-info.js'), report = require('../service/diagnostic-report.js');

// parse(): the shapes real TVs report, and refusals
assert.deepEqual(info.parse('Version=T-NKM2DEUC-2301.1;\nTizen=Tizen6/TV 6.0.0 (arm)\n'), {firmware: 'T-NKM2DEUC-2301.1', tizenVersion: '6.0.0'});
assert.equal(info.parse('Version=T-PTMCDEUC-0090-2220.4;').firmware, 'T-PTMCDEUC-0090-2220.4', 'the four-digit group some 2023 firmware carries');
assert.equal(info.parse('Version=T-KSU2EBDEUC-1720.7;').firmware, 'T-KSU2EBDEUC-1720.7');
assert.equal(info.parse('Version=T-PTMWWC-1720.7').firmware, 'T-PTMWWC-1720.7', 'the trailing semicolon is optional');
['Version=192.0.2.10;', 'Version=https://example.test/x;', 'Version=T-ABC-1.1;rm -rf /', 'Version=;', 'Model=T-NKM2DEUC;'].forEach(bad =>
    assert.equal(info.parse(bad).firmware, null, 'refused: ' + bad));
assert.deepEqual(info.parse(''), {firmware: null, tizenVersion: null});
assert.deepEqual(info.parse(null), {firmware: null, tizenVersion: null});
assert.equal(info.parse('Tizen=something without numbers').tizenVersion, null);
assert.equal(info.parse('Version=T-A1-1.1;\nVersion=T-NKM2DEUC-2301.1;').firmware, 'T-A1-1.1' , 'first line wins');

(async function () {
    // The generated script, run for real against temp files in place of /etc
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-devinfo-'));
    try {
        fs.writeFileSync(path.join(dir, 'prd_info.ini'), '[Version]\nModel=T-NKM2DEUC;\nVersion=T-NKM2DEUC-2301.1;\nBuild=TIZEN-TRUNK2021;\n\n[Build]\nVersion=SHOULD-NOT-BE-READ;\n');
        fs.writeFileSync(path.join(dir, 'tizen-release'), 'Tizen6/TV 6.0.0 (arm)\nVERSION = 6.0.0\n');
        const run = async cmd => {
            const b64 = /^echo (\S+) \| base64 -d \| sh$/.exec(cmd);
            const script = Buffer.from(b64[1], 'base64').toString().split('/etc/').join(dir + '/');
            const r = cp.spawnSync('sh', ['-c', script], {encoding: 'utf8'});
            return {exit_code: r.status, stdout: r.stdout};
        };
        assert.deepEqual(await info.read(run), {firmware: 'T-NKM2DEUC-2301.1', tizenVersion: '6.0.0'}, 'only the [Version] section is read');
        assert.ok(!/\b(rm|mv|cp|tee|chmod|kill)\b|>\s*\/(?!dev\/null)/.test(info.script()), 'read-only script');
        fs.rmSync(path.join(dir, 'prd_info.ini'));
        assert.deepEqual(await info.read(run), {firmware: null, tizenVersion: '6.0.0'}, 'a missing file gives null, not an error');
        fs.rmSync(path.join(dir, 'tizen-release'));
        assert.deepEqual(await info.read(run), {firmware: null, tizenVersion: null});
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
    await assert.rejects(info.read(async () => ({exit_code: 1, stdout: ''})), /unavailable/);
    await assert.rejects(info.read(async () => ({exit_code: 0, timed_out: true, stdout: ''})), /unavailable/);

    // merge(): it only ever adds to the widget's probe, and never waits longer than it was given
    const good = async () => ({exit_code: 0, stdout: 'Version=T-NKM2DEUC-2301.1;\nTizen=Tizen6/TV 6.0.0 (arm)\n'});
    const probe = {model: 'M', receivedAt: 5};
    assert.deepEqual(await info.merge(probe, good, 1000), {model: 'M', receivedAt: 5, tizenVersion: '6.0.0', tizenVersionSource: 'service-read', firmware: 'T-NKM2DEUC-2301.1', firmwareSource: 'service-read'}, 'no firmware posted: the service fills it in');
    assert.deepEqual(await info.merge({model: 'M', firmware: 'T-FROM-WIDGET-1.1'}, good, 1000), {model: 'M', firmware: 'T-FROM-WIDGET-1.1', tizenVersion: '6.0.0', tizenVersionSource: 'service-read'}, 'the widget firmware stays');
    const started = Date.now();
    assert.deepEqual(await info.merge(probe, () => new Promise(() => {}), 80), Object.assign({}, probe, {tizenVersion: null, tizenVersionSource: 'unknown'}), 'a stuck agent: the probe, version unknown');
    assert.ok(Date.now() - started < 1000, 'and not later than the limit');
    assert.deepEqual(await info.merge(probe, async () => { throw new Error('agent down'); }, 1000), Object.assign({}, probe, {tizenVersion: null, tizenVersionSource: 'unknown'}), 'an error leaves the probe alone, version unknown');
    assert.deepEqual(await info.merge(probe, async () => ({exit_code: 1, stdout: ''}), 1000), Object.assign({}, probe, {tizenVersion: null, tizenVersionSource: 'unknown'}));
    assert.deepEqual(await info.merge({}, async () => ({exit_code: 0, stdout: ''}), 1000), {tizenVersion: null, tizenVersionSource: 'unknown'}, 'nothing readable: nothing invented');

    // Tizen version from the public platform capability the widget posts: works without root (app-only package)
    const down = async () => { throw new Error('no root agent'); };
    const widgetOnly = await info.merge({model: 'M', platformVersion: '9.0'}, down, 1000);
    assert.equal(widgetOnly.tizenVersion, '9.0', 'two-part versions are accepted');
    assert.equal(widgetOnly.tizenVersionSource, 'widget-capability');
    assert.equal((await info.merge({platformVersion: '10.0'}, down, 1000)).tizenVersion, '10.0', 'two-digit major');
    assert.equal((await info.merge({platformVersion: '6.5.0.1'}, down, 1000)).tizenVersion, '6.5.0.1', 'four parts');
    assert.equal((await info.merge({platformVersion: '6.5'}, good, 1000)).tizenVersion, '6.5', 'the widget capability wins over the file');
    assert.equal((await info.merge({platformVersion: '6.5'}, good, 1000)).tizenVersionSource, 'widget-capability');
    const junk = await info.merge({platformVersion: 'https://x/6.5'}, down, 1000);
    assert.deepEqual([junk.tizenVersion, junk.tizenVersionSource], [null, 'unknown'], 'a value of the wrong shape is dropped, not exported');
    assert.equal((await info.merge({platformVersion: 7}, down, 1000)).tizenVersion, null, 'not a string: dropped');
    assert.equal((await info.merge({platformVersion: 'junk'}, good, 1000)).tizenVersionSource, 'service-read', 'a bad widget value falls back to the file');
    assert.equal(info.parse('Tizen=Tizen release 10.0 (arm)').tizenVersion, '10.0', 'a two-part version in /etc/tizen-release');
    assert.equal(info.merge(probe, () => { throw new Error('sync'); }, 1000) instanceof Promise, true, 'never throws synchronously');

    // In the report: where the firmware came from, and nothing else gets through
    const now = Math.floor(Date.now() / 1000);
    const dev = d => report.projectors.device(d);
    assert.deepEqual(
        (({firmware, firmwareSource, tizenVersion}) => ({firmware, firmwareSource, tizenVersion}))(dev({firmware: 'T-NKM2DEUC-2301.1', firmwareSource: 'service-read', tizenVersion: '6.0.0', receivedAt: now})),
        {firmware: 'T-NKM2DEUC-2301.1', firmwareSource: 'service-read', tizenVersion: '6.0.0'});
    assert.equal(dev({firmware: 'T-X-1.1', receivedAt: now}).firmwareSource, 'widget-probe', 'a value from the widget stays marked as such');
    assert.equal(dev({receivedAt: now}).firmwareSource, null, 'no firmware, no source');
    assert.equal(dev({firmware: 'T-X-1.1', tizenVersion: '192.0.2.10'}).tizenVersion, null, 'only a version number passes');
    assert.equal(dev({tizenVersion: 'https://x'}).tizenVersion, null);
    assert.deepEqual((({tizenVersion, tizenVersionSource}) => ({tizenVersion, tizenVersionSource}))(dev({tizenVersion: '9.0', tizenVersionSource: 'widget-capability'})), {tizenVersion: '9.0', tizenVersionSource: 'widget-capability'});
    assert.deepEqual((({tizenVersion, tizenVersionSource}) => ({tizenVersion, tizenVersionSource}))(dev({})), {tizenVersion: null, tizenVersionSource: 'unknown'}, 'no data: the report says unknown');
    assert.equal(dev({tizenVersion: '9.0', tizenVersionSource: '<script>'}).tizenVersionSource, 'service-read', 'the source is one of a fixed list');
    // The model from the TV's local API (127.0.0.1:8001/api/v2/), when the widget posted none (#101)
    const api = JSON.stringify({device: {modelName: 'QN77S95CAFXZA', model: '23_PONTUSM_QTV', ip: '192.0.2.10', id: 'uuid:secret', wifiMac: 'aa:bb'}, uri: 'http://192.0.2.10:8001/api/v2/'});
    assert.deepEqual(info.parseApi(api), {modelName: 'QN77S95CAFXZA'}, 'only the model name is kept');
    ['<b>x</b>', 'uuid:1234-5678', '192.0.2.10', '', 'ab'].forEach(bad =>
        assert.equal(info.parseApi(JSON.stringify({device: {modelName: bad}})).modelName, null, 'refused: ' + bad));
    assert.deepEqual(info.parseApi('not json'), {modelName: null});
    assert.deepEqual(info.parseApi(null), {modelName: null});
    const urls = [];
    const get = async (url, ms) => { urls.push([url, ms]); return api; };
    const fromApi = await info.merge({receivedAt: 5}, down, 1000, get);
    assert.equal(fromApi.realModel, 'QN77S95CAFXZA');
    assert.equal(fromApi.modelSource, 'service-api');
    assert.deepEqual(urls, [['http://127.0.0.1:8001/api/v2/', 3000]], 'loopback only, with a time limit');
    assert.equal(JSON.stringify(fromApi).includes('192.0.2.10'), false, 'no address comes along');
    urls.length = 0;
    const widgetModel = await info.merge({model: 'QE55Q80A'}, down, 1000, get);
    assert.equal(widgetModel.realModel, undefined, 'the widget model is not replaced');
    assert.equal(widgetModel.modelSource, undefined);
    assert.equal(urls.length, 0, 'and the API is not asked');
    assert.equal((await info.merge({}, down, 1000, async () => { throw new Error('refused'); })).realModel, undefined, 'API down: nothing invented');
    const t0 = Date.now();
    const both = await info.merge({}, () => new Promise(() => {}), 80, () => new Promise(() => {}));
    assert.ok(Date.now() - t0 < 1000, 'a stuck agent and a stuck API: still within the limit');
    assert.equal(both.tizenVersionSource, 'unknown');
    const stuckAgent = await info.merge({}, () => new Promise(() => {}), 80, get);
    assert.equal(stuckAgent.realModel, 'QN77S95CAFXZA', 'a stuck root agent does not cost the API model');
    // httpGet against a real local server: body, time limit, size cap
    const http = require('http');
    const srv = http.createServer((req, res) => {
        if (req.url === '/slow') return;
        if (req.url === '/big') { res.end('x'.repeat(70000)); return; }
        res.end(api);
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + srv.address().port;
    assert.equal(await info.httpGet(base + '/api/v2/', 1000), api);
    await assert.rejects(info.httpGet(base + '/slow', 100), /timeout/);
    await assert.rejects(info.httpGet(base + '/big', 1000), /too large/);
    srv.close();
    // In the report: where the model came from
    assert.equal(dev({realModel: 'QN77S95CAFXZA', modelSource: 'service-api'}).modelSource, 'service-api');
    assert.equal(dev({model: 'QE55Q80A'}).modelSource, 'widget-probe');
    assert.equal(dev({}).modelSource, null, 'no model, no source');
    assert.equal(dev({model: 'QE55Q80A', modelSource: '<x>'}).modelSource, 'widget-probe', 'the source is one of a fixed list');
    console.log('PASS device info: firmware and Tizen version read from /etc, parsed strictly, marked by source; model from the local API');
})().catch(e => { console.error(e); process.exitCode = 1; });
