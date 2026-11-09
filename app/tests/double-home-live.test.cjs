'use strict';
const assert = require('assert').strict;
const fs = require('fs');
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

    let calls = 0;
    const options = {pid:4242,dll:"/package path/quote'/tvlauncher-dotnet.dll",runDir:'/home/owner',
        file:'/home/owner/tvlauncher-double-home.tsv',execute:async (command, timeout)=>{
            calls++;
            assert.equal(timeout,15000);
            // Parse the real shell arguments without executing dotnet.
            const parsed = spawnSync('/bin/sh',['-c',command.replace('/usr/bin/dotnet',
                "python3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))'")],{encoding:'utf8'});
            assert.equal(parsed.status,0,parsed.stderr);
            const args=JSON.parse(parsed.stdout);
            assert.equal(args[0],options.dll);
            assert.equal(args[1],'--apply-double-home');
            assert.deepEqual(args.slice(3),['--dir',options.runDir,'--double-home-settings',options.file]);
            const request=Buffer.from(args[2],'base64').toString();
            assert.match(request,/^v1\t[a-f0-9]{32}\t4242\tapp\tGlassHome1\.Home\n$/);
            return {exit_code:0,stdout:'double-home-applied '+request.split('\t')[1]+'\n'};
        }};
    const originalOpen=fs.openSync, originalWrite=fs.writeFileSync;
    try {
        // App-context filesystem access is denied, as it is on affected TVs.
        // Delivery must still succeed entirely through the root executor.
        fs.openSync=fs.writeFileSync=()=>{throw Object.assign(Error('EACCES'),{code:'EACCES'});};
        await live.apply(glass,options);
    } finally {fs.openSync=originalOpen;fs.writeFileSync=originalWrite;}
    assert.equal(calls,1);
    await assert.rejects(live.apply(glass,{...options,pid:0}),/could not be identified/);
    assert.equal(calls,1,'invalid process does not execute');
    await assert.rejects(live.apply(glass,{...options,execute:undefined}),/root launcher connection/);
    await assert.rejects(live.apply(glass,{...options,execute:async()=>({exit_code:0,stdout:'double-home-applied stale'})}),/did not confirm/);
    await assert.rejects(live.apply(glass,{...options,execute:async()=>({exit_code:2,stderr:'EACCES from helper'})}),/EACCES from helper/);
    await assert.rejects(live.apply(glass,{...options,execute:async()=>({timed_out:true})}),/timed out/);
    await assert.rejects(live.apply(glass,{...options,execute:async()=>{throw Error('root disconnected');}}),/root disconnected/);
    // Tizen's dotnet host can append GC diagnostics after the helper's reply.
    // Keep the acknowledgement exact while allowing unrelated runtime lines.
    const gc = '[GC_INFO] GC_Start #1: Gen(0), Time(11281885 ms), Reason(0)\n' +
        '[GC_INFO] GC_End #1: Gen(0), Time(11281886 ms)\n';
    const withOutput = change => ({...options,execute:async(command,timeout)=>{
        const result = await options.execute(command,timeout);
        result.stdout = change(result.stdout);
        return result;
    }});
    for (const change of [reply=>reply+gc,reply=>gc+reply,reply=>(gc+reply+gc).replace(/\n/g,'\r\n')]) {
        await live.apply(glass,withOutput(change));
    }
    for (const change of [
        ()=>gc,
        reply=>'echo: '+reply+gc,
        reply=>reply.trim()+' trailing text\n'+gc,
        reply=>reply.slice(0,-2)+'\n'+gc,
        reply=>reply.replace(/[a-f0-9]{32}/,'0'.repeat(32))+gc,
        reply=>reply+reply+gc,
        reply=>reply+'double-home-applied '+'0'.repeat(32)+'\n'+gc,
    ]) await assert.rejects(live.apply(glass,withOutput(change)),/did not confirm/);
    const failedWithReply = withOutput(reply=>reply+gc);
    const failedExecute = failedWithReply.execute;
    failedWithReply.execute = async(command,timeout)=>({...await failedExecute(command,timeout),exit_code:2,stderr:'helper failed'});
    await assert.rejects(live.apply(glass,failedWithReply),/helper failed/);
    console.log('PASS live double-press save, rollback, unchanged Home ownership, root delivery under app EACCES and exact acknowledgement');
})().catch(error=>{console.error(error);process.exitCode=1;});
