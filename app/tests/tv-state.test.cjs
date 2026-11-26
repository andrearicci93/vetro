'use strict';
const assert=require('assert').strict,fs=require('fs'),vm=require('vm'),EventEmitter=require('events');
const {Store,decode,decodeVconf,decodeChannel,decodePower,READ}=require('../service/tv-state.js');
// TvState.dll's line (the fallback)
assert.deepEqual(decode('{"volume":7,"muted":true,"sourceType":0}'),{volume:7,muted:true,source:'TV',sourceType:0});
assert.equal(decode('{"volume":0,"muted":false,"sourceType":13}').source,'HDMI1');
assert.equal(decode('{"volume":0,"muted":false,"sourceType":33}').source,'DisplayPort','DisplayPort on Samsung monitors (#215)');
assert.equal(decode('{"volume":0,"muted":false,"sourceType":41}').source,'USB-C','USB-C on the Odyssey OLED G8 (#314)');
assert.deepEqual(decode('{"volume":101,"muted":1,"sourceType":99}'),{volume:null,muted:null,source:null,sourceType:99});
assert.throws(()=>decode('native error'));
// buxton2ctl's lines, as the Q80A printed them on 2026-11-21
const vconf=['[memory] memory/system/source_type = Int32: 0','[memory] memory/org.tizen.tv-viewer/mute_status = Boolean: False',
 '[system] file/private/sound/volume/Master = Int32: 14','[system] file/private/sound/volume/MasterMuteOn = Int32: 0','[memory] memory/pm/state = Int32: 1'].join('\n');
assert.deepEqual(decodeVconf(vconf),{volume:14,muted:false,source:'TV',sourceType:0});
assert.equal(decodeVconf(vconf.replace('Boolean: False','Boolean: True')).muted,true,'muted by the TV\'s own key (tv-viewer / volume-app)');
assert.equal(decodeVconf(vconf.replace('MasterMuteOn = Int32: 0','MasterMuteOn = Int32: 1')).muted,true,'muted through the audio API');
assert.equal(decodeVconf(vconf.replace('Int32: 0\n','Int32: 15\n')).source,'HDMI3');
assert.equal(decodeVconf(vconf.replace('Master = Int32: 14','Master = Int32: 140')).volume,null,'out of range');
assert.equal(decodeVconf('Get: Layer \'memory\' Key \'x\': No such file or directory\n'),null,'nothing read');
// deviced's power state: 1 and 2 on, 3 screen off (Picture Off, Q80A 2026-11-19), 4 and 5 standby, anything else unknown
for (const [v,e] of [[1,'on'],[2,'on'],[3,'standby'],[4,'standby'],[5,'standby'],[0,null],[9,null],[-1,null]]) assert.equal(decodePower('[memory] memory/pm/state = Int32: '+v+'\n'),e,'pm/state '+v);
assert.equal(decodePower(''),null);assert.equal(decodePower('Get: Layer \'memory\' Key \'memory/pm/state\': No such file or directory\n'),null);
assert.match(READ,/memory\/pm\/state/);
assert.match(READ,/buxton2ctl/);assert.doesNotMatch(READ,/dotnet/,'the usual read starts no dotnet process');
// the tuner's channel file, only from the running tuner
const ch='TUNER|3999\nCHANNEL|{"number":21,"name":"Rai 4","tvPlus":false,"pid":3999,"at":1}';
assert.deepEqual(decodeChannel(ch),{number:21,name:'Rai 4',tvPlus:false});
assert.equal(decodeChannel(ch.replace('"pid":3999','"pid":12')),null,'a file left by another tuner');
assert.equal(decodeChannel('TUNER|3999\nCHANNEL|'),null,'a tuner that wrote no channel yet');
assert.equal(decodeChannel('CHANNEL|{"number":1,"name":"A","pid":3}'),null,'no running tuner');
assert.equal(decodeChannel('TUNER|3\nCHANNEL|{"number":1,"name":"A"'),null,'a cut file');
let calls=0,commands=[];
const store=new Store(async c=>{calls++;commands.push(c);return {exit_code:0,stdout:vconf+'\n'+ch+'\n'};});
(async()=>{
 const [a,b]=await Promise.all([store.read(),store.read()]);assert.equal(calls,1);assert.equal(a,b);
 assert.match(commands[0],/buxton2ctl/);assert.equal(a.power,'on');assert.equal(a.volume,14);assert.equal(a.muted,false);assert.deepEqual(a.channel,{number:21,name:'Rai 4',tvPlus:false});
 const hdmi=await new Store(async()=>({exit_code:0,stdout:vconf.replace('Int32: 0\n','Int32: 13\n')+'\n'+ch})).read();
 assert.equal(hdmi.source,'HDMI1');assert.equal((await new Store(async()=>({exit_code:0,stdout:vconf.replace('pm/state = Int32: 1','pm/state = Int32: 3')})).read()).power,'standby');assert.equal(hdmi.channel,null,'no channel when the input is not TV');
 // no buxton2ctl: the DLL reads the audio and the input; the channel still comes from the first read
 const seen=[];const old=await new Store(async c=>{seen.push(c);return /dotnet/.test(c)?{exit_code:0,stdout:'{"volume":3,"muted":false,"sourceType":0}'}:{exit_code:0,stdout:ch};}).read();
 assert.equal(old.power,null,'no power reading without buxton2ctl: the entity is unavailable');assert.equal(seen.length,2);assert.match(seen[1],/dotnet .*TvState\.dll/);assert.equal(old.volume,3);assert.equal(old.channel.number,21);
 await assert.rejects(new Store(async()=>({exit_code:1,stdout:''})).read(),/unavailable/);
 await assert.rejects(new Store(async()=>({exit_code:0,timed_out:true,stdout:''})).read(),/unavailable/);
 let sent=[];
 class Client extends EventEmitter{connect(){}close(){}publish(t,p,o){sent.push({topic:t,payload:p,retain:o&&o.retain});}subscribe(){}}
 const context=vm.createContext({module:{exports:{}},require:m=>m==='fs'?{readFileSync:()=>'{"host":"broker","clientId":"test-tv"}'}:{MqttClient:Client},setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){}});
 vm.runInContext(fs.readFileSync(require.resolve('../service/mqtt-bridge.js'),'utf8'),context);
 const bridge=new context.module.exports.MqttBridge(()=>({error:1}));bridge.start();bridge.client.emit('connect');
 const powerConf=JSON.parse(sent.find(x=>x.topic.endsWith('/power/config')).payload);
 assert.equal(powerConf.device_class,'enum');assert.deepEqual(powerConf.options,['On','Standby']);assert.equal(powerConf.value_template,'{{ value | capitalize }}');assert.equal(powerConf.availability.length,2);
 const mute=JSON.parse(sent.find(x=>x.topic.endsWith('/muted/config')).payload);
 assert.equal(mute.availability_mode,'all');assert.equal(mute.payload_off,'OFF');assert.equal(mute.availability.length,2);
 const chConf=JSON.parse(sent.find(x=>x.topic.endsWith('/channel/config')).payload);
 assert.equal(chConf.name,'Channel');assert.match(chConf.json_attributes_topic,/\/channel-attrs$/);assert.equal(chConf.availability.length,2);
 assert(sent.some(x=>x.topic.endsWith('/channel/availability')&&x.payload==='offline'),'Channel starts unavailable');
 sent=[];bridge.publishTvState(a);
 assert(sent.some(x=>x.topic.endsWith('/power')&&x.payload==='on'&&x.retain));assert(sent.some(x=>x.topic.endsWith('/power/availability')&&x.payload==='online'));
 assert(sent.some(x=>x.topic.endsWith('/volume')&&x.payload==='14'&&x.retain));
 assert(sent.some(x=>x.topic.endsWith('/muted')&&x.payload==='OFF'));
 assert(sent.some(x=>x.topic.endsWith('/source')&&x.payload==='TV'));
 assert(sent.some(x=>x.topic.endsWith('/channel')&&x.payload==='21 Rai 4'&&x.retain));
 assert.deepEqual(JSON.parse(sent.find(x=>x.topic.endsWith('/channel-attrs')).payload),{number:21,name:'Rai 4',tv_plus:false});
 assert(sent.some(x=>x.topic.endsWith('/channel/availability')&&x.payload==='online'));
 sent=[];bridge.publishTvState(a);
 assert(!sent.some(x=>/\/channel/.test(x.topic)),'the same channel is not published again');
 sent=[];bridge.publishTvState({volume:14,muted:false,source:'DisplayPort',channel:a.channel});
 assert(sent.some(x=>x.topic.endsWith('/source')&&x.payload==='DisplayPort'));
 assert(sent.some(x=>x.topic.endsWith('/channel')&&x.payload===''&&x.retain),'the channel is cleared away from TV');
 assert(sent.some(x=>x.topic.endsWith('/channel/availability')&&x.payload==='offline'));
 sent=[];bridge.publishTvState({volume:14,muted:false,source:'TV',power:'standby'});
 assert(sent.some(x=>x.topic.endsWith('/power')&&x.payload==='standby'&&x.retain));
 sent=[];bridge.publishTvState({volume:9,muted:null,source:null});
 assert(sent.some(x=>x.topic.endsWith('/power/availability')&&x.payload==='offline'),'no power reading: unavailable');
 assert(sent.some(x=>x.topic.endsWith('/muted/availability')&&x.payload==='offline'));
 assert(sent.some(x=>x.topic.endsWith('/muted')&&x.payload===''&&x.retain),'unavailable reads delete stale retained state');
 assert(sent.some(x=>x.topic.endsWith('/volume/availability')&&x.payload==='online'));
 const oldClient=bridge.client;bridge.stopClient();sent=[];bridge.publishTvState(a);assert.equal(sent.length,0);
 console.log('PASS native MQTT states: vconf reads without dotnet (DLL fallback), mute from the TV key, DisplayPort, the tuner\'s Channel only on TV and on change, per-entity availability and stale-state cleanup');
})().catch(e=>{console.error(e);process.exitCode=1;});
