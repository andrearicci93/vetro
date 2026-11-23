'use strict';
const assert=require('assert').strict,fs=require('fs'),vm=require('vm'),EventEmitter=require('events');
const {Store,decode}=require('../service/tv-state.js');
assert.deepEqual(decode('{"volume":7,"muted":true,"sourceType":0}'),{power:null,volume:7,muted:true,source:'TV',sourceType:0});
assert.equal(decode('{"volume":0,"muted":false,"sourceType":13}').source,'HDMI1');
assert.deepEqual(decode('{"volume":101,"muted":1,"sourceType":99}'),{power:null,volume:null,muted:null,source:null,sourceType:99});
for (const [power,screen,expected] of [[0,1,'on'],[2,0,'standby'],[1,0,null],[2,1,null]]) {
 assert.equal(decode(JSON.stringify({nativePowerState:power,nativeScreenState:screen})).power,expected);
}
assert.throws(()=>decode('native error'));
let calls=0,command;
const store=new Store(async c=>{calls++;command=c;return {exit_code:0,stdout:'{"volume":0,"muted":false,"sourceType":0}'};});
(async()=>{
 const [a,b]=await Promise.all([store.read(),store.read()]);assert.equal(calls,1);assert.equal(a,b);
 assert.match(command,/dotnet .*TvState\.dll/);assert.equal(a.volume,0);assert.equal(a.muted,false);
 await assert.rejects(new Store(async()=>({exit_code:1,stdout:''})).read(),/unavailable/);
 let sent=[];
 class Client extends EventEmitter{connect(){}close(){}publish(t,p,o){sent.push({topic:t,payload:p,retain:o&&o.retain});}subscribe(){}}
 const context=vm.createContext({module:{exports:{}},require:m=>m==='fs'?{readFileSync:()=>'{"host":"broker","clientId":"test-tv"}'}:{MqttClient:Client},setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){}});
 vm.runInContext(fs.readFileSync(require.resolve('../service/mqtt-bridge.js'),'utf8'),context);
 const bridge=new context.module.exports.MqttBridge(()=>({error:1}));bridge.start();bridge.client.emit('connect');
 const powerConfig=JSON.parse(sent.find(x=>x.topic.endsWith('/power/config')).payload);
 assert.equal(powerConfig.device_class,'enum');
 assert.deepEqual(powerConfig.options,['On','Standby']);
 assert.equal(powerConfig.value_template,'{{ value | capitalize }}');
 const mute=JSON.parse(sent.find(x=>x.topic.endsWith('/muted/config')).payload);
 assert.equal(mute.availability_mode,'all');assert.equal(mute.payload_off,'OFF');assert.equal(mute.availability.length,2);
 sent=[];bridge.publishTvState({power:'standby'});
 assert(sent.some(x=>x.topic.endsWith('/power')&&x.payload==='standby'&&x.retain));
 sent=[];bridge.publishTvState(a);
 assert(sent.some(x=>x.topic.endsWith('/power/availability')&&x.payload==='offline'));
 assert(sent.some(x=>x.topic.endsWith('/volume')&&x.payload==='0'&&x.retain));
 assert(sent.some(x=>x.topic.endsWith('/muted')&&x.payload==='OFF'));
 assert(sent.some(x=>x.topic.endsWith('/source')&&x.payload==='TV'));
 sent=[];bridge.publishTvState({volume:9,muted:null,source:null});
 assert(sent.some(x=>x.topic.endsWith('/muted/availability')&&x.payload==='offline'));
 assert(sent.some(x=>x.topic.endsWith('/muted')&&x.payload===''&&x.retain),'unavailable reads delete stale retained state');
 assert(sent.some(x=>x.topic.endsWith('/volume/availability')&&x.payload==='online'));
 const oldClient=bridge.client;bridge.stopClient();sent=[];bridge.publishTvState(a);assert.equal(sent.length,0);
 console.log('PASS native MQTT states: real parsing, zero/false values, shared reads, per-entity availability and stale-state cleanup');
})().catch(e=>{console.error(e);process.exitCode=1;});
