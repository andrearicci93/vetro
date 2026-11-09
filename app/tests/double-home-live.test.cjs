'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const {Dock} = require('../service/dock.js');
const live = require('../service/home-double-press.js');
const initial = {enabled: false, mode: 'shortcut', appId: null};
const glass = {enabled: true, mode: 'app', appId: 'GlassHome1.Home'};
const other = {enabled: true, mode: 'app', appId: 'Other.Home'};

function fixture(enabled = true) {
    const state = {enabled, customApp: null, doubleHome: {...initial}, homeShortcut: {appId:'Tile.Home',label:'Tile'}, autorunWas:1};
    const dock = Object.create(Dock.prototype), applied = [], writes = [];
    dock.readState = () => JSON.parse(JSON.stringify(state));
    dock.patchState = patch => { writes.push(patch); Object.assign(state, patch); };
    dock.status = async () => dock.readState();
    dock.probe = async () => ({running: true, pid: 4242});
    dock.shortcutCheck = async () => ({ok: true});
    dock.applyDoubleHome = async (value, pid) => {
        assert.equal(pid, 4242);
        applied.push(value);
    };
    for (const name of ['launch','enable','disable','writeCatalog','stopDock']) dock[name] = () => {throw Error('Unexpected launcher operation: '+name);};
    return {dock, state, applied, writes};
}

(async () => {
    const f = fixture(), originalShortcut = {...f.state.homeShortcut};
    f.dock.applyDoubleHome = async (value, pid) => {
        assert.equal(pid, 4242);
        assert.notDeepEqual(f.state.doubleHome, value, 'runtime confirms before persistent state changes');
        f.applied.push(value);
    };
    for (const value of [glass, other, {enabled:true,mode:'shortcut',appId:null}, initial]) {
        const status = await f.dock.setDoubleHome(value);
        assert.deepEqual(status.doubleHome, value);
        assert.equal(status.enabled, true);
        assert.equal(status.customApp, null);
        assert.deepEqual(status.homeShortcut, originalShortcut);
        assert.equal(status.autorunWas, 1);
        assert.equal(f.dock.busy, false);
    }
    assert.equal(f.applied.length, 4, 'enable, destination change, shortcut and disable apply without restart');
    const off = fixture(false);
    await off.dock.setDoubleHome(glass);
    assert.deepEqual(off.state.doubleHome, glass);
    assert.deepEqual(off.applied, [], 'off saves for next launch');
    const custom = fixture(false); custom.state.customApp = 'Custom.Home';
    await custom.dock.setDoubleHome(glass);
    assert.equal(custom.state.customApp, 'Custom.Home');
    assert.deepEqual(custom.applied, [], 'custom Home remains independent');

    const failed = fixture();
    failed.dock.applyDoubleHome = async value => {failed.applied.push(value); if(failed.applied.length === 1) throw Error('confirmation timed out');};
    await assert.rejects(failed.dock.setDoubleHome(glass), /confirmation timed out/);
    assert.deepEqual(failed.applied, [glass, initial], 'a possibly applied request is explicitly restored');
    assert.deepEqual(failed.state.doubleHome, initial);
    assert.equal(failed.dock.busy, false);
    const disk = fixture(); disk.dock.patchState = () => {throw Error('disk full');};
    await assert.rejects(disk.dock.setDoubleHome(glass), /disk full/);
    assert.deepEqual(disk.applied, [glass, initial], 'persistence failure restores the running setting');
    const missing = fixture(); missing.dock.probe = async () => ({running:false,pid:null});
    await assert.rejects(missing.dock.setDoubleHome(glass), /not running/);
    assert.deepEqual(missing.applied, []);
    assert.deepEqual(missing.writes, []);
    const unavailable = fixture(); unavailable.dock.shortcutCheck = async () => ({ok:false});
    await assert.rejects(unavailable.dock.setDoubleHome(glass), /installed, enabled/);
    assert.deepEqual(unavailable.applied, []);
    const pending = fixture(); let release;
    pending.dock.applyDoubleHome = () => new Promise(resolve => {release=resolve;});
    const first = pending.dock.setDoubleHome(glass);
    await assert.rejects(pending.dock.setDoubleHome(other), /in progress/);
    await new Promise(resolve => setImmediate(resolve)); release(); await first;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-double-live-'));
    let reader;
    try {
        const fifo = path.join(tmp, 'control'), file = path.join(tmp, 'setting.tsv');
        assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
        const start = Date.now();
        await assert.rejects(live.apply(glass, {pid:4242,file,fifo}), /ENXIO/);
        assert.ok(Date.now() - start < 1000, 'absent reader never blocks');
        assert.equal(fs.existsSync(file), false);
        reader = fs.openSync(fifo, fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
        let clock = 0, polls = 0, request;
        const options = {pid:4242,file,fifo,now:()=>clock,timeoutMs:200,sleep:async ms=>{
            clock += ms; polls++;
            if (polls === 1) {
                const bytes = Buffer.alloc(128), n = fs.readSync(reader, bytes);
                assert.equal(bytes.subarray(0,n).toString(), 'reload-double-home\n');
                request = fs.readFileSync(file,'utf8');
                assert.match(request,/^v1\t[a-f0-9]{32}\t4242\tapp\tGlassHome1\.Home\n$/);
                fs.writeFileSync(file+'.applied',request.replace('\t4242\t','\t4241\t'));
            } else if (polls === 2) {
                fs.writeFileSync(file+'.applied',request.replace(/\t[a-f0-9]{32}\t/,'\t'+'0'.repeat(32)+'\t'));
            } else fs.writeFileSync(file+'.applied',request);
        }};
        await live.apply(glass,options);
        assert.equal(polls,3,'wrong process and stale nonce do not confirm a save');
        assert.equal(fs.existsSync(file),false,'successful requests are removed');
        clock=0; options.sleep=async ms=>{clock+=ms;};
        await assert.rejects(live.apply(other,options), /did not confirm/);
        assert.equal(fs.existsSync(file),false,'timed-out requests cannot apply later');
        fs.closeSync(reader);reader=undefined;
        const ordinary = path.join(tmp,'ordinary');fs.writeFileSync(ordinary,'unchanged');
        await assert.rejects(live.apply(glass,{pid:4242,file,fifo:ordinary}), /control pipe/);
        assert.equal(fs.readFileSync(ordinary,'utf8'),'unchanged');
        const link=path.join(tmp,'link');fs.symlinkSync(ordinary,link);
        await assert.rejects(live.apply(glass,{pid:4242,file,fifo:link}), /ELOOP/);
    } finally {
        if(reader!==undefined)fs.closeSync(reader);
        fs.rmSync(tmp,{recursive:true,force:true});
    }
    console.log('PASS live double-press save, rollback, unchanged Home ownership, bounded FIFO delivery and exact acknowledgement');
})().catch(error=>{console.error(error);process.exitCode=1;});
