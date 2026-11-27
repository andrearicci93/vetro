'use strict';
// Bar size: a saved percent goes to the dock as --dock-scale, 100 (and anything unknown) starts it as before. Synthetic state.
const assert = require('assert').strict;
const fs = require('fs'), os = require('os'), path = require('path');
const {Dock} = require('../service/dock.js');
const settings = require('../service/settings-backup.js');

(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-scale-'));
    const file = path.join(tmp, 'vetro-dock.json');
    const d = new Dock({execute: async () => ({exit_code: 0, stdout: ''}), stateFile: file, dir: tmp, appsFile: path.join(tmp, 'apps.tsv')});
    fs.writeFileSync(file, JSON.stringify({enabled: true}));
    assert.equal(d.readState().dockScale, 100);
    assert.doesNotMatch(d.startScript(), /--dock-scale/, 'default: the dock starts as before');
    fs.writeFileSync(file, JSON.stringify({enabled: true, dockScale: 130}));
    assert.match(d.startScript(), / --dock-scale 130 /);
    fs.writeFileSync(file, JSON.stringify({enabled: true, dockScale: 1500}));
    assert.equal(d.readState().dockScale, 100, 'an unknown size reads as 100');
    fs.writeFileSync(file, JSON.stringify({enabled: false, customApp: 'org.example.app', dockScale: 130}));
    assert.doesNotMatch(d.startScript(), /--dock-scale/, 'custom mode draws no bar');
    fs.writeFileSync(file, JSON.stringify({enabled: false}));
    await assert.rejects(d.setDockScale(120), /Invalid value/);
    await d.setDockScale(115);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).dockScale, 115, 'saved while the launcher is off');
    assert.equal(settings.build({dock: {enabled: true, dockScale: 115}}).sections.launcher.dockScale, 115, 'the Settings file keeps it');
    console.log('PASS bar size: start argument, default and unknown values, custom mode, saved state, Settings file');
})().catch(e => { console.error(e); process.exit(1); });
