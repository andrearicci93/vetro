'use strict';
// Keep TV-Store's service starting with the TV: the real module, its shell run by a real sh against a fake sqlite3 that keeps the flag
// of A2STVStore.sdbservice in a file (empty file: TV-Store's service is not registered) and refuses a command about any other app.
// Nothing here was tried on a TV.
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path');
const {execFileSync} = require('child_process');
const {TvStoreOnboot, CHECK_MS} = require('../service/tvstore-onboot.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-tvstore-onboot-'));
const bin = path.join(dir, 'bin'), FLAG = path.join(dir, 'flag'), WRITES = path.join(dir, 'writes'), WRONG = path.join(dir, 'wrong'), CHOICE = path.join(dir, 'choice.json');
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, 'sqlite3'), `#!/bin/sh
for a in "$@"; do sql="$a"; done
case "$sql" in
  *"app_id='A2STVStore.sdbservice'"*) ;;
  *) echo "another app: $sql" >> "${WRONG}"; exit 1 ;;
esac
case "$sql" in
  "SELECT app_onboot FROM"*) cat "${FLAG}" ;;
  "BEGIN IMMEDIATE; UPDATE package_app_info SET app_onboot='true' WHERE"*) echo true >> "${WRITES}"; printf true > "${FLAG}" ;;
  "BEGIN IMMEDIATE; UPDATE package_app_info SET app_onboot='false' WHERE"*) echo false >> "${WRITES}"; printf false > "${FLAG}" ;;
  *) echo "unknown: $sql" >> "${WRONG}"; exit 1 ;;
esac
`, {mode: 0o755});

const setFlag = v => fs.writeFileSync(FLAG, v);
const writes = () => (fs.existsSync(WRITES) ? fs.readFileSync(WRITES, 'utf8') : '').split('\n').filter(Boolean);
const choice = () => JSON.parse(fs.readFileSync(CHOICE, 'utf8'));
let down = false;
const execute = command => {
    if (down) return Promise.reject(new Error('The TV agent is not connected'));
    assert.match(command, /^echo \S+ \| base64 -d \| sh$/);
    return Promise.resolve({exit_code: 0, stdout: execFileSync('/bin/sh', ['-c', command], {env: {PATH: bin + ':/usr/bin:/bin'}}).toString()});
};
const fresh = () => { fs.rmSync(CHOICE, {force: true}); fs.rmSync(WRITES, {force: true}); down = false; return new TvStoreOnboot({execute, file: CHOICE}); };

(async () => {
    try {
        // TV-Store is not on the TV: nothing to show; a choice made anyway is kept and says why it is not done.
        setFlag('');
        let t = fresh();
        assert.deepEqual(await t.read(), {status: 'unknown', installed: false, flag: null});
        assert.equal(await t.tick(), null, 'not chosen: no TV call, nothing written');
        let r = await t.apply(true);
        assert.equal(r.status, 'partial'); assert.equal(r.installed, false);
        assert.equal(choice().on, true); assert.equal(writes().length, 0);
        assert.equal((await t.apply(false)).status, 'off', 'off is read back as off, also without TV-Store');

        // The firmware dropped the flag: off until chosen, then set once, then left alone while it is on.
        setFlag('false'); t = fresh();
        assert.deepEqual(await t.read(), {status: 'off', installed: true, flag: 'false'});
        assert.equal(await t.tick(), null, 'not chosen: the flag is not touched');
        assert.equal(fs.readFileSync(FLAG, 'utf8'), 'false');
        r = await t.apply(true);
        assert.equal(r.status, 'on'); assert.equal(r.wrote, true);
        assert.deepEqual(choice(), {on: true, changed: true});
        assert.deepEqual(writes(), ['true']);
        assert.equal((await t.tick()).status, 'on');
        assert.deepEqual(writes(), ['true'], 'a flag that is on is not written');
        r = await t.apply(true);
        assert.equal(r.wrote, false); assert.deepEqual(writes(), ['true'], 'twice changes nothing');

        // An update of TV-Store registers the service again, with the flag off: the next look puts it back.
        setFlag('false');
        assert.equal((await t.read()).status, 'partial');
        assert.equal((await t.tick()).status, 'on');
        assert.deepEqual(writes(), ['true', 'true']);
        assert.ok(CHECK_MS >= 10 * 60000 && CHECK_MS <= 60 * 60000, 'looked at every few minutes, not every few seconds');

        // Off puts the flag back to the firmware's value, because Vetro was the one that turned it on, and stops looking.
        r = await t.apply(false);
        assert.equal(r.status, 'off'); assert.equal(r.wrote, true);
        assert.equal(fs.readFileSync(FLAG, 'utf8'), 'false');
        assert.deepEqual(choice(), {on: false, changed: false});
        assert.equal(await t.tick(), null);
        assert.equal(fs.readFileSync(FLAG, 'utf8'), 'false');

        // A firmware that keeps the flag by itself: Vetro never wrote it, so off leaves it as the firmware has it.
        setFlag('true'); t = fresh();
        assert.equal((await t.read()).status, 'off');
        r = await t.apply(true);
        assert.equal(r.status, 'on'); assert.equal(r.wrote, false); assert.equal(writes().length, 0);
        r = await t.apply(false);
        assert.equal(r.status, 'off'); assert.equal(r.wrote, false);
        assert.equal(fs.readFileSync(FLAG, 'utf8'), 'true'); assert.equal(writes().length, 0);

        // The TV does not answer: the choice is saved anyway, the timer never throws.
        setFlag('false'); t = fresh(); down = true;
        await assert.rejects(t.apply(true), /did not answer|not connected/);
        assert.equal(choice().on, true, 'saved before asking the TV');
        assert.equal(await t.tick(), null);
        down = false;
        assert.equal((await t.tick()).status, 'on', 'and done once the TV answers');

        // The save itself failing is said, and nothing is written.
        setFlag('false');
        const bad = new TvStoreOnboot({execute, file: path.join(dir, 'no', 'such', 'dir', 'choice.json')});
        await assert.rejects(bad.apply(true), /could not be saved/);
        assert.equal(fs.readFileSync(FLAG, 'utf8'), 'false');

        // No command was about another app.
        assert.equal(fs.existsSync(WRONG) ? fs.readFileSync(WRONG, 'utf8') : '', '');
        console.log('ok');
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
})().catch(e => { console.error(e); process.exit(1); });
