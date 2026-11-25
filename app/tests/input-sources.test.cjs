'use strict';
const assert = require('assert').strict;
const sources = require('../service/input-sources.js');
const catalog = require('../service/dock-catalog.js');

// Sanitized G85SB cache shape, including non-display camera and media tiles.
// Names and media identifiers below are synthetic; no raw device data is kept.
const HDMI_ICON = '/usr/apps/com.samsung.tv.theme-resource/shared/res/VD_ICONS/i_icon_device_m_microhdmi.svg';
const PC_ICON = '/usr/apps/com.samsung.tv.theme-resource/shared/res/VD_ICONS/i_icon_device_m_pc.svg';
const G8 = {
    HDMI1: {SourceType: 13, ConnectionState: true, IconPath: HDMI_ICON},
    DISPLAYPORT: {SourceType: 33, ConnectionState: true, EditName: 'PC', IconPath: PC_ICON},
    USB_C: {SourceType: 41, ConnectionState: false, DetectedName: 'PC', IconPath: PC_ICON},
    USBCAM: {SourceType: 67, ConnectionState: true},
    'DLNA/uuid:example': {SourceType: 56, DetectedName: 'Private media server'}
};
const cacheLine = value => 'CACHE|' + Buffer.from(JSON.stringify(value)).toString('base64');
const readback = type => '[memory] memory/system/source_type = Int32: ' + type + '\n';
const G8_READ = cacheLine(G8) + '\n' + cacheLine(G8) + '\n' + readback(33);
const normalized = sources.normalize(G8);
assert.deepEqual(normalized.map(x => [x.sourceType, x.label, x.family]), [[13, 'HDMI', 'hdmi'], [33, 'DisplayPort', 'displayport'], [41, 'USB-C', 'usbc']]);
assert.deepEqual(normalized.map(x => x.key), ['KEY_INPUT_13', 'KEY_INPUT_33', 'KEY_INPUT_41']);
assert.equal(normalized[2].connected, false, 'a disconnected USB-C port remains selectable');
assert.deepEqual(normalized.map(x => x.sourceIcon), [HDMI_ICON, PC_ICON, PC_ICON], 'native SVG icons are kept');
assert.equal(sources.typeForKey('KEY_INPUT_41'), 41);
assert.equal(sources.typeForKey('KEY_INPUT_41;echo'), null);
assert.deepEqual(Object.keys(sources.mergeCaches(G8)), ['HDMI1', 'DISPLAYPORT', 'USB_C'], 'network media metadata is not exposed');
assert.equal(sources.mergeCaches({USB_C:{SourceType:41,UsbDevicePath:'/private/device'}}).USB_C.UsbDevicePath,undefined,'unrelated USB metadata is not retained');
assert.equal(sources.parseCurrent('memory/system/source_type, value = 41 (Int32)\n'), 41);
assert.equal(sources.parseCurrent('unrelated value = 41'), null);
assert.equal(sources.parseCurrent(readback(-1)), -1, 'unknown foreground state is not invented as TV');
assert.deepEqual(sources.normalize({HDMI1: {DetectedName: 'Console'}}).map(x => x.sourceType), [0,13,14,15,16], 'ordinary TVs retain their legacy physical-port fallback');
assert.equal(sources.normalize({HDMI1: {DetectedName: 'Console'}})[1].name, 'Console');
assert.deepEqual(sources.normalize({DISPLAYPORT: {SourceType: 999}}).map(x=>x.sourceType),[0,13,14,15,16], 'an invalid partial monitor inventory keeps the upstream defaults');
assert.equal(sources.sourceIconOk('/tmp/secret.svg'), false);
assert.equal(sources.sourceIconOk('/usr/apps/pkg/../secret.svg'), false);
assert.equal(sources.sourceIconOk('/usr/apps/pkg/bad;command.svg'), false);
assert.equal(sources.sourceIconOk(PC_ICON), true);
assert.ok(sources.command({family:'hdmi',sourceType:13,sourceIcon:HDMI_ICON,label:"HDMI's input"}).includes("--switch-source 13 'HDMI'\\''s input'"),'source names are shell quoted');

// Both Home caches are merged, rather than stopping at the first partial one.
const merged = catalog.parse('S|' + Buffer.from(JSON.stringify({HDMI1: G8.HDMI1})).toString('base64') + '\nS|' +
    Buffer.from(JSON.stringify({DISPLAYPORT:G8.DISPLAYPORT, USB_C:G8.USB_C})).toString('base64'));
const dockInputs = catalog.sourceEntries(merged, {useSourceImages:false});
assert.deepEqual(dockInputs.map(x => x.appId), ['source:13','source:33','source:41']);
assert.ok(dockInputs.every(x => x.icon === null), 'optional launcher artwork stays off');
const artwork='/usr/apps/com.samsung.tv.theme-resource/shared/res/VD_ICONS/hdmi-tile.png';
const withArtwork=catalog.sourceEntries({sources:Object.assign({},G8,{HDMI1:Object.assign({},G8.HDMI1,{LauncherUnfocusedIconPath:artwork})})},{useSourceImages:true});
assert.equal(withArtwork.find(x=>x.appId==='source:13').icon,artwork,'optional tile artwork keeps its original priority independently of the launch icon');
assert.equal(withArtwork.find(x=>x.appId==='source:13').sourceIcon,HDMI_ICON);
assert.deepEqual(catalog.inputsTsv({inputs:dockInputs}).trim().split('\n').slice(1).map(x => x.split('\t')[9]), [HDMI_ICON,PC_ICON,PC_ICON], 'native switch icons travel independently in column 10');
const row = catalog.build(Object.assign(merged, {order:['s/source.layer.hdmi@HDMI1','s/source.layer.hdmi@HDMI4']}), {showHomeSources:true});
assert.equal(row.entries.filter(x=>x.key==='source:13').length, 1, 'a monitor Home-row HDMI tile resolves by identity, not array position');
assert.equal(row.entries.some(x=>x.key==='source:16'), false, 'a phantom Home HDMI port is omitted');

const longCache = Object.assign({}, G8, {unrelated:{padding:'x'.repeat(10000)}});
const parsedRead = sources.parseRead(cacheLine(longCache)+'\n'+cacheLine({USB_C:G8.USB_C})+'\n'+readback(33));
assert.equal(parsedRead.currentSourceType,33);
assert.deepEqual(sources.normalize(parsedRead.sources).map(x=>x.sourceType),[13,33,41]);

function device(options={}) {
    const calls=[];let reads=0;
    const execute=async cmd=>{
        calls.push(cmd);
        if(cmd.includes('.sourceCache')) return {exit_code:0,stdout:G8_READ};
        if(cmd.includes('echo ICON_')) return {exit_code:0,stdout:options.noIcons?'':'ICON_0\nICON_1\nICON_2\nICON_3\n'};
        if(cmd.includes(' --switch-source ')) return {exit_code:options.failedLaunch?1:0,stdout:''};
        if(cmd.startsWith('buxton2ctl')) {reads++;return {exit_code:0,stdout:readback(options.stays ?33:reads<2?33:41)};}
        throw Error('Unexpected command');
    };
    return {execute,calls};
}
(async()=>{
    const d=device(), list=await sources.read(d.execute);
    assert.deepEqual(list.items.map(x=>x.label),['HDMI','DisplayPort','USB-C']);
    assert.equal(list.monitor,true);assert.equal(list.currentSourceType,33);
    const ports={HDMI1:G8.HDMI1,DISPLAYPORT:G8.DISPLAYPORT,USB_C:G8.USB_C};
    const camera=Object.assign({},ports,{USBCAM:G8.USBCAM});
    const unplugged=Object.assign({},ports,{USBCAM:{SourceType:67,ConnectionState:false}});
    for(const caches of [[ports,ports],[ports,camera],[camera,ports],[unplugged,camera],[ports,ports]]) {
        const read=await sources.read(async command=>({exit_code:0,stdout:command.includes('.sourceCache')
            ?caches.map(cacheLine).join('\n')+'\n'+readback(33):'ICON_0\nICON_1\nICON_2\nICON_3\n'}));
        assert.equal(read.monitor,true,'camera enumeration in either Home cache cannot change the physical layout');
        assert.deepEqual(read.items.map(x=>x.key),['KEY_INPUT_13','KEY_INPUT_33','KEY_INPUT_41']);
        const parsed=catalog.parse(caches.map(cache=>'S|'+Buffer.from(JSON.stringify(cache)).toString('base64')).join('\n'));
        assert.deepEqual(catalog.sourceEntries(parsed,{}).map(x=>x.appId),['source:13','source:33','source:41'],
            'launcher discovery remains stable when a camera appears, disappears or disconnects');
    }
    const selected=await sources.select(d.execute,41);
    assert.equal(selected.ok,true);assert.equal(selected.currentSourceType,41);
    assert.ok(d.calls.some(c=>c.includes("--switch-source 41 'USB-C' '"+PC_ICON+"'")));
    assert.ok(d.calls.some(c=>c.includes('/native/dock/tvlauncher-dotnet.dll')));
    const same=device({stays:true});await sources.select(same.execute,33);
    assert.ok(same.calls.some(c=>c.includes(' --switch-source ')), 'the last physical id can survive while an app is in front: selecting it still launches tv-viewer');
    const invalid=device();await assert.rejects(sources.select(invalid.execute,16),/not available/);
    assert.equal(invalid.calls.some(c=>c.includes(' --switch-source ')),false,'unsupported HDMI 4 is never sent');
    const noIcon=device({noIcons:true});await assert.rejects(sources.select(noIcon.execute,41),/icon is missing/);
    assert.equal(noIcon.calls.some(c=>c.includes(' --switch-source ')),false);
    const failed=device({failedLaunch:true});await assert.rejects(sources.select(failed.execute,41),/selection failed/);
    const stays=device({stays:true});await assert.rejects(sources.select(stays.execute,41),/did not confirm/,'launch rc 0 is not switch success');
    const fallback=await sources.read(async()=>({exit_code:0,stdout:'not a cache'}));
    assert.equal(fallback.available,false);
    assert.deepEqual(fallback.items.map(x=>x.key),['KEY_TV','KEY_HDMI1','KEY_HDMI2','KEY_HDMI3','KEY_HDMI4'],'an unreadable cache does not remove the upstream default keys');
    await assert.rejects(sources.select(async()=>({exit_code:0,stdout:'not a cache'}),13,{monitor:true}),/inventory is unavailable/,'a previously detected G8 does not fall back to TV inputs');
    console.log('PASS physical inputs: G8 HDMI/DisplayPort/USB-C, source icons, merged caches and verified native switching');
})().catch(e=>{console.error(e);process.exitCode=1});
