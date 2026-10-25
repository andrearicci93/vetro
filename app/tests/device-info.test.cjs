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
    assert.deepEqual(await info.merge(probe, good, 1000), {model: 'M', receivedAt: 5, tizenVersion: '6.0.0', firmware: 'T-NKM2DEUC-2301.1', firmwareSource: 'service-read'}, 'no firmware posted: the service fills it in');
    assert.deepEqual(await info.merge({model: 'M', firmware: 'T-FROM-WIDGET-1.1'}, good, 1000), {model: 'M', firmware: 'T-FROM-WIDGET-1.1', tizenVersion: '6.0.0'}, 'the widget firmware stays');
    const started = Date.now();
    assert.deepEqual(await info.merge(probe, () => new Promise(() => {}), 80), probe, 'a stuck agent: the probe, unchanged');
    assert.ok(Date.now() - started < 1000, 'and not later than the limit');
    assert.deepEqual(await info.merge(probe, async () => { throw new Error('agent down'); }, 1000), probe, 'an error leaves the probe alone');
    assert.deepEqual(await info.merge(probe, async () => ({exit_code: 1, stdout: ''}), 1000), probe);
    assert.deepEqual(await info.merge({}, async () => ({exit_code: 0, stdout: ''}), 1000), {tizenVersion: null}, 'nothing readable: nothing invented');
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
    console.log('PASS device info: firmware and Tizen version read from /etc, parsed strictly, marked by source');
})().catch(e => { console.error(e); process.exitCode = 1; });
