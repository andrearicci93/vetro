'use strict';
const assert = require('assert').strict, vm = require('vm');
const html = require('../service/dashboard.js')();
const nodes = {}, element = id => nodes[id] || (nodes[id] = {
    value:'', hidden:true, textContent:'', innerHTML:'', disabled:false, focus(){}, setAttribute(){}
});
let items = [
    {sourceType:13,label:'HDMI',key:'KEY_INPUT_13'},
    {sourceType:33,label:'DisplayPort',key:'KEY_INPUT_33'},
    {sourceType:41,label:'USB-C',key:'KEY_INPUT_41',connected:false}
];
let selected=33, failedRead=false;
const sandbox = {
    document:{getElementById:element,querySelectorAll:() => [],querySelector:() => null,addEventListener(){}},
    console, confirm:() => true, setTimeout:() => 1, clearTimeout(){}, setInterval(){},
    fetch:async (url, opts) => {
        let data={};
        if(url==='/inputs') {
            if(failedRead)return {ok:false,json:async()=>({error:'Inventory unavailable'})};
            assert.ok(!opts || !opts.body, 'inventory loading never writes to the TV');
            data={items,currentSourceType:selected,monitor:true,available:true};
        } else if(url.startsWith('/apps')) data={apps:[],summary:{total:0}};
        else if(url==='/remap')data={rules:[],reserved:[]};
        else if(url.startsWith('/monitor'))data={ts:Date.now(),memory:{},cpu:{cores:[]},processes:[],network:[]};
        return {ok:true,json:async()=>data};
    }
};
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], sandbox);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
    for(let i=0;i<4;i++)await tick();
    await sandbox.loadInputChoices();
    const keyOptions=element('targetKey').innerHTML;
    for(const key of ['KEY_INPUT_13','KEY_INPUT_33','KEY_INPUT_41'])assert.ok(keyOptions.includes(key));
    assert.doesNotMatch(keyOptions,/KEY_HDMI[1-4]|KEY_TV/);
    assert.equal(element('mqttKey').innerHTML,keyOptions,'MQTT and remote shortcuts share the same discovered choices');
    sandbox.tvSettingsData={items:[],network:{},device:{},ts:Date.now(),scope:''};
    sandbox.settingsSection='sources';
    sandbox.renderTVSettings();
    assert.match(element('settingGroups').innerHTML,/Available inputs: HDMI · DisplayPort · USB-C/,'a disconnected USB-C port stays in the inventory');
    assert.doesNotMatch(element('settingGroups').innerHTML,/data-input-source/,'the input inventory is read-only');
    assert.doesNotMatch(element('settingGroups').innerHTML,/HDMI [2-4]/);

    failedRead=true;
    await sandbox.loadInputChoices();
    assert.doesNotMatch(element('targetKey').innerHTML,/KEY_INPUT_/,'unavailable inventory does not leave stale input choices');
    assert.match(element('settingGroups').innerHTML,/Inventory unavailable/);
    failedRead=false;
    const monitorItems=items;
    items=require('../service/input-sources.js').normalize({TV:{SourceType:0},HDMI2:{SourceType:14}});
    selected=14;await sandbox.loadInputChoices();
    assert.deepEqual(Array.from(element('targetKey').innerHTML.matchAll(/value="(KEY_(?:TV|HDMI[1-4]))"/g),m=>m[1]),['KEY_TV','KEY_HDMI1','KEY_HDMI2','KEY_HDMI3','KEY_HDMI4']);
    assert.doesNotMatch(element('targetKey').innerHTML,/KEY_INPUT_/,'normal TVs use the original remap actions');
    assert.match(element('settingGroups').innerHTML,/Available inputs: TV · HDMI 1 · HDMI 2 · HDMI 3 · HDMI 4/,'Inputs tab detects the default layout');
    assert.doesNotMatch(element('settingGroups').innerHTML,/USB-C|DisplayPort/);
    items=require('../service/input-sources.js').normalize({DISPLAYPORT:{SourceType:33}});
    await sandbox.loadInputChoices();
    assert.match(element('settingGroups').innerHTML,/DisplayPort/,'other monitors retain upstream DisplayPort in the Inputs tab');
    assert.doesNotMatch(element('targetKey').innerHTML,/KEY_INPUT_/,'other monitors keep the original default remap choices');
    items=monitorItems;await sandbox.loadInputChoices();
    assert.match(element('targetKey').innerHTML,/KEY_INPUT_41/);
    assert.doesNotMatch(element('targetKey').innerHTML,/KEY_HDMI[1-4]|KEY_TV/,'the G8 layout replaces default TV keys after detection');
    console.log('PASS input UI: discovered monitor ports in both pickers, disconnected USB-C, read-only inventory and unavailable caches');
})().catch(error=>{console.error(error);process.exitCode=1;});
