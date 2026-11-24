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
let selected=33, posts=[], wrongReadback=false, failedRead=false, delayNextRead=false, releaseRead;
const sandbox = {
    document:{getElementById:element,querySelectorAll:() => [],querySelector:() => null,addEventListener(){}},
    console, confirm:() => true, setTimeout:() => 1, clearTimeout(){}, setInterval(){},
    fetch:async (url, opts) => {
        let data={};
        if(url==='/inputs') {
            if(failedRead)return {ok:false,json:async()=>({error:'Inventory unavailable'})};
            if(opts&&opts.body){const p=JSON.parse(opts.body);posts.push(p);if(!wrongReadback)selected=p.sourceType;data={ok:true,currentSourceType:selected};}
            else {data={items,currentSourceType:selected,monitor:true,available:true};if(delayNextRead){delayNextRead=false;await new Promise(resolve=>{releaseRead=resolve});}}
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
    assert.deepEqual(posts,[],'loading the page is read-only');
    sandbox.tvSettingsData={items:[],network:{},device:{},ts:Date.now(),scope:''};
    sandbox.settingsSection='sources';
    sandbox.renderTVSettings();
    assert.match(element('settingGroups').innerHTML,/data-input-source="41"[^>]*>USB-C/,'a disconnected USB-C port stays selectable');
    assert.doesNotMatch(element('settingGroups').innerHTML,/HDMI [2-4]/);

    sandbox.runUiOperation=async (_scope,_label,_target,_button,work)=>work(()=>{});
    await sandbox.selectInputChoice(41,element('selectUsb'));
    assert.deepEqual(posts,[{sourceType:41}]);
    assert.equal(sandbox.inputChoices.currentSourceType,41);
    selected=33;await sandbox.loadInputChoices();delayNextRead=true;
    const staleRead=sandbox.loadInputChoices();await tick();
    const selection=sandbox.selectInputChoice(41,element('selectUsb'));await tick();
    assert.equal(selected,41);releaseRead();await staleRead;
    assert.equal(sandbox.inputChoices.currentSourceType,41,'a read from before switching cannot overwrite the confirmed input');
    await selection;assert.equal(sandbox.inputChoices.currentSourceType,41,'the post-selection refresh reads fresh state');
    wrongReadback=true;
    await assert.rejects(sandbox.selectInputChoice(13,element('selectHdmi')),/not confirmed/);
    assert.equal(sandbox.inputChoices.currentSourceType,41,'a rejected readback cannot claim the requested input');
    failedRead=true;
    await sandbox.loadInputChoices();
    assert.doesNotMatch(element('targetKey').innerHTML,/KEY_INPUT_/,'unavailable inventory does not leave stale input choices');
    assert.match(element('settingGroups').innerHTML,/Inventory unavailable/);
    failedRead=false;wrongReadback=false;
    const monitorItems=items;
    items=require('../service/input-sources.js').normalize({TV:{SourceType:0},HDMI2:{SourceType:14}});
    selected=14;await sandbox.loadInputChoices();
    assert.deepEqual(Array.from(element('targetKey').innerHTML.matchAll(/value="(KEY_(?:TV|HDMI[1-4]))"/g),m=>m[1]),['KEY_TV','KEY_HDMI1','KEY_HDMI2','KEY_HDMI3','KEY_HDMI4']);
    assert.doesNotMatch(element('targetKey').innerHTML,/KEY_INPUT_/,'normal TVs use the original remap actions');
    for(const type of [0,13,14,15,16])assert.ok(element('settingGroups').innerHTML.includes('data-input-source="'+type+'"'),'Inputs tab detects default source '+type);
    assert.doesNotMatch(element('settingGroups').innerHTML,/USB-C|DisplayPort/);
    await sandbox.selectInputChoice(16,element('selectHdmi4'));
    assert.equal(sandbox.inputChoices.currentSourceType,16,'the default Inputs tab confirms HDMI 4');
    items=require('../service/input-sources.js').normalize({DISPLAYPORT:{SourceType:33}});
    await sandbox.loadInputChoices();
    assert.match(element('settingGroups').innerHTML,/DisplayPort/,'other monitors retain upstream DisplayPort in the Inputs tab');
    assert.doesNotMatch(element('targetKey').innerHTML,/KEY_INPUT_/,'other monitors keep the original default remap choices');
    items=monitorItems;await sandbox.loadInputChoices();
    assert.match(element('targetKey').innerHTML,/KEY_INPUT_41/);
    assert.doesNotMatch(element('targetKey').innerHTML,/KEY_HDMI[1-4]|KEY_TV/,'the G8 layout replaces default TV keys after detection');
    console.log('PASS input UI: discovered monitor ports in both pickers, disconnected USB-C, explicit selection, readback and unavailable inventory');
})().catch(error=>{console.error(error);process.exitCode=1;});
