'use strict';
const assert = require('assert').strict;
const fs = require('fs'), os = require('os'), path = require('path');
const {Dock} = require('../service/dock.js');

(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-home-state-'));
    try {
        for (const original of ['malformed', 'null', '[]', '"not an object"']) {
            const stateFile = path.join(dir, 'state.json');
            fs.writeFileSync(stateFile, original);
            const dock = new Dock({stateFile, appsFile: path.join(dir, 'apps.tsv')});
            let rebuilt = false, applied = false, probed = false;
            dock.installed = () => true;
            dock.writeCatalog = async () => { rebuilt = true; };
            dock.status = async () => dock.readState();
            dock.probe = async () => { probed = true; return {running: true, pid: 4242}; };
            dock.applyDoubleHome = async () => { applied = true; };
            await assert.rejects(dock.setHomeShortcut(null), /Cannot read launcher preferences/);
            await assert.rejects(dock.setDoubleHome({enabled: false, mode: 'shortcut', appId: null}), /Cannot read launcher preferences/);
            assert.equal(fs.readFileSync(stateFile, 'utf8'), original, 'the unreadable preference file is preserved');
            assert.equal(rebuilt, false, 'no runtime list is changed');
            assert.equal(probed, false, 'no live launcher request is started');
            assert.equal(applied, false, 'no live gesture setting is changed');
            assert.equal(dock.busy, false, 'a rejected save does not retain the change lock');
        }
        console.log('PASS Home settings reject unreadable preferences without changing saved state or runtime lists');
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
})().catch(e => { console.error(e); process.exitCode = 1; });
