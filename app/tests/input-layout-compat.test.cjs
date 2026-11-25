'use strict';
const assert = require('assert').strict;
const sources = require('../service/input-sources.js');
const catalog = require('../service/dock-catalog.js');

const icon = '/usr/apps/com.samsung.tv.theme-resource/shared/res/VD_ICONS/i_icon_device_m_pc.svg';
const g8 = {HDMI1:{SourceType:13,IconPath:icon},DISPLAYPORT:{SourceType:33,IconPath:icon},USB_C:{SourceType:41,IconPath:icon,ConnectionState:false}};
const defaults = [0,13,14,15,16], keys = ['KEY_TV','KEY_HDMI1','KEY_HDMI2','KEY_HDMI3','KEY_HDMI4'];
const cases = [
    {name:'G8 three-port inventory',cache:g8,monitor:true,ids:[13,33,41]},
    {name:'G8 with an enumerated USB camera',cache:Object.assign({},g8,{USBCAM:{SourceType:67,ConnectionState:true}}),monitor:true,ids:[13,33,41]},
    {name:'G8 with a disconnected cached camera',cache:Object.assign({},g8,{USBCAM:{SourceType:67,ConnectionState:false}}),monitor:true,ids:[13,33,41]},
    {name:'G8 with a camera activity entry',cache:Object.assign({},g8,{'USBCAM/0':{SourceType:67}}),monitor:true,ids:[13,33,41]},
    {name:'unrecognized camera identity remains unknown',cache:Object.assign({},g8,{USBCAM:{SourceType:900}}),ids:defaults.concat(33)},
    {name:'ordinary TV with a USB camera',cache:{TV:{SourceType:0},USBCAM:{SourceType:67}},ids:defaults},
    {name:'same ports with activity suffixes',cache:{'HDMI1/0':g8.HDMI1,'DP/0':g8.DISPLAYPORT,'USB-C/0':g8.USB_C},monitor:true,ids:[13,33,41]},
    {name:'same physical configuration with a different HDMI identity',cache:{HDMI2:{SourceType:14,IconPath:icon},DISPLAYPORT:g8.DISPLAYPORT,USB_C:g8.USB_C},monitor:true,ids:[14,33,41]},
    {name:'ordinary TV',cache:{TV:{SourceType:0},HDMI2:{SourceType:14,EditName:'Console'}},ids:defaults},
    {name:'empty TV cache',cache:{},ids:defaults},
    {name:'legacy DisplayPort monitor',cache:{'HDMI2/0':{SourceType:14},DISPLAYPORT:g8.DISPLAYPORT},ids:defaults.concat(33)},
    {name:'DisplayPort alone',cache:{DISPLAYPORT:g8.DISPLAYPORT},ids:defaults.concat(33)},
    {name:'HDMI and USB-C without DP',cache:{HDMI1:g8.HDMI1,USB_C:g8.USB_C},ids:defaults},
    {name:'otherwise matching monitor with two HDMI ports',cache:Object.assign({},g8,{HDMI2:{SourceType:14}}),ids:defaults.concat(33)},
    {name:'otherwise matching device with a TV input',cache:Object.assign({},g8,{TV:{SourceType:0}}),ids:defaults.concat(33)},
    {name:'invalid DP metadata',cache:Object.assign({},g8,{DISPLAYPORT:{SourceType:999}}),ids:defaults},
    {name:'inconsistent HDMI port identity',cache:Object.assign({},g8,{HDMI1:{SourceType:14}}),ids:defaults.concat(33)},
    {name:'network media does not change the physical layout',cache:Object.assign({},g8,{'DLNA/uuid:example':{SourceType:56}}),monitor:true,ids:[13,33,41]},
    {name:'unknown additional source prevents a false match',cache:Object.assign({},g8,{OtherInput:{SourceType:900}}),ids:defaults.concat(33)},
    {name:'USB media is separate from the USB-C display input',cache:Object.assign({},g8,{'USB/example-media':{SourceType:900}}),monitor:true,ids:[13,33,41]}
];
function device(cache,initial=0) {
    let current=initial;
    const commands=[];
    const selected=()=> '[memory] memory/system/source_type = Int32: '+current+'\n';
    return {commands,execute:async command=>{
        commands.push(command);
        if(command.includes('.sourceCache'))return {exit_code:0,stdout:(cache===null?'':'CACHE|'+Buffer.from(JSON.stringify(cache)).toString('base64')+'\n')+selected()};
        if(command.includes('echo ICON_'))return {exit_code:0,stdout:Array.from({length:16},(_,i)=>'ICON_'+i).join('\n')};
        if(command.startsWith('buxton2ctl'))return {exit_code:0,stdout:selected()};
        const native=/^\/usr\/bin\/input_keyevent (XF86DiscretSourceTV|XF86DiscretHDMI([1-4]))$/.exec(command);
        if(native){current=native[2]?12+Number(native[2]):0;return {exit_code:0,stdout:''};}
        const source=/ --switch-source (\d+) /.exec(command);
        if(source){current=Number(source[1]);return {exit_code:0,stdout:''};}
        throw Error('Unexpected execution boundary');
    }};
}
(async()=>{
    for(const c of cases){
        const d=device(c.cache),inventory=await sources.read(d.execute);
        assert.equal(inventory.monitor,!!c.monitor,c.name+': layout classification');
        assert.deepEqual(inventory.items.map(x=>x.sourceType),c.ids,c.name+': API list');
        const dock=catalog.sourceEntries({sources:c.cache},{});
        assert.deepEqual(dock.map(x=>Number(x.appId.slice(7))),c.ids,c.name+': launcher agrees with API');
        assert.deepEqual(inventory.items.filter(x=>x.key).map(x=>x.key),c.monitor?c.ids.map(n=>'KEY_INPUT_'+n):keys.concat(c.ids.includes(33)?['KEY_DISPLAYPORT']:[]),c.name+': default remap methods are preserved');
        if(c.monitor){
            assert.deepEqual(inventory.items.map(x=>x.label),['HDMI','DisplayPort','USB-C']);
            assert.equal(inventory.items[2].connected,false,'a disconnected physical USB-C port still identifies the layout');
        }else assert.ok(dock.every(x=>x.sourceIcon===null),'nonmatching devices retain the original native icon fallback');
    }
    for(const type of defaults){
        const d=device({TV:{SourceType:0},HDMI1:{SourceType:13}});
        const result=await sources.select(d.execute,type);
        assert.equal(result.currentSourceType,type);
        assert.ok(d.commands.includes('/usr/bin/input_keyevent '+(type===0?'XF86DiscretSourceTV':'XF86DiscretHDMI'+(type-12))));
        assert.ok(!d.commands.some(c=>c.includes('--switch-source')),'default TV selections retain the original native-key method');
    }
    for(const [cache,start,target] of [[g8,33,41],[{TV:{SourceType:0}},0,16]]){
        const d=device(cache,start),changed=await sources.select(d.execute,target);
        assert.equal(changed.previousSourceType,start,'capture the actual source before selection');
        const restored=await sources.select(d.execute,changed.previousSourceType);
        assert.equal(restored.previousSourceType,target);
        assert.equal(restored.currentSourceType,start,'the same bounded interface verifies restoration for both layouts');
    }
    const missing=device(null,14),fallback=await sources.read(missing.execute);
    assert.equal(fallback.available,false);
    assert.equal(fallback.currentSourceType,14,'default fallback still reads actual current state');
    assert.deepEqual(fallback.items.map(x=>x.key),keys);
    assert.equal((await sources.select(missing.execute,16)).currentSourceType,16,'a default TV does not require a source cache to select HDMI 4');
    const known=device(null);
    await assert.rejects(sources.select(known.execute,13,{monitor:true}),/inventory is unavailable/);
    assert.ok(!known.commands.some(c=>c.startsWith('/usr/bin/input_keyevent')),'a known G8 never injects default TV keys after losing its inventory');
    const tv=device({TV:{SourceType:0}});
    await assert.rejects(sources.select(tv.execute,41),/not available/);
    const artwork='/opt/share/webappservice/apps_icon/source/console.png';
    const decorated=catalog.sourceEntries({sources:{TV:{SourceType:0,IconPath:artwork},HDMI1:{SourceType:13,IconPath:artwork}}},{useSourceImages:true});
    assert.equal(decorated[0].icon,null,'the original TV tile keeps its generic artwork');
    assert.equal(decorated[1].icon,artwork,'original non-package artwork paths remain supported');
    const dp=device({DISPLAYPORT:g8.DISPLAYPORT});
    await sources.select(dp.execute,33);
    assert.ok(dp.commands.some(c=>c.includes('r_icon_device_s_dpport.png')),'other monitors retain the original DisplayPort icon and native request');
    console.log('PASS input compatibility matrix: exact three-port layout only, 20 device configurations, upstream defaults and original TV key dispatch');
})().catch(e=>{console.error(e);process.exitCode=1});
