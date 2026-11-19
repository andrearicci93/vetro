'use strict';
const assert=require('assert').strict,fs=require('fs'),vm=require('vm'),EventEmitter=require('events');
class Client extends EventEmitter{constructor(){super();this.subs=[];this.unsubs=[];}connect(){}close(){}subscribe(t){this.subs.push(t);}unsubscribe(t){this.unsubs.push(t);}publish(topic,payload,opts){this.last={topic,payload,opts};}}
const writes=[];const ctx=vm.createContext({module:{exports:{}},require:n=>n==='fs'?{readFileSync:()=>{throw Error('absent')},writeFileSync:(...a)=>writes.push(a),chmodSync:()=>{},renameSync:(...a)=>writes.push(a)}:{MqttClient:Client},setInterval:()=>1,clearInterval:()=>{},setTimeout:()=>2,clearTimeout:()=>{}});
vm.runInContext(fs.readFileSync(require.resolve('../service/mqtt-bridge.js'),'utf8'),ctx);
const {validateConfig,publicConfig,saveConfig,MqttBridge}=ctx.module.exports;
const config=validateConfig({host:'192.168.1.10',username:'vetro'}, {password:'secret'});assert.equal(config.password,'secret');assert.equal(publicConfig(config).password,undefined);assert.equal(publicConfig(config).hasPassword,true);
assert.equal(validateConfig({host:'broker',password:''},config).password,'');assert.throws(()=>validateConfig({host:'http://broker'}));assert.throws(()=>validateConfig({host:'broker',port:0}));assert.throws(()=>validateConfig({host:'broker',topicPrefix:'any/#'}));assert.equal(validateConfig({host:'',enabled:false}).enabled,false);
saveConfig(config);assert.equal(writes[0][2].mode,0o600);assert.equal(writes[1].length,2);
let received=0;const b=new MqttBridge(()=>({}),()=>received++);b.start();b.configure(config);assert.equal(b.connected,false);b.setTopics(['commands']);const c=b.client;c.emit('connect');assert.equal(b.connected,true);assert.equal(b.status().subscriptions[0].status,'pending');c.emit('subscribed',{topic:'commands',accepted:true});assert.equal(b.status().subscriptions[0].status,'active');
for(const opts of [{retained:true},{duplicate:true},{}])c.emit('message',Object.assign({topic:'commands',payload:Buffer.from('secret-payload')},opts));assert.equal(received,1);assert.equal(JSON.stringify(b.status()).includes('secret-payload'),false);
b.publish('state','active');assert.equal(c.last.topic,'state');assert.ok(c.last.opts===undefined);
b.setTopics(['commands','extra']);assert.equal(b.client,c,'topic change while connected updates subscriptions in place without reconnecting');assert.deepEqual(c.subs,['commands','extra']);assert.equal(b.status().subscriptions.length,2);
b.setTopics(['extra']);assert.deepEqual(c.unsubs,['commands']);assert.deepEqual(Array.from(b.status().subscriptions,s=>s.topic),['extra']);
b.stop();assert.equal(b.connected,false);assert.throws(()=>b.publish('state','active'),/disconnected/);
console.log('PASS MQTT config: redaction, retained password, validation, atomic private storage, confirmed connection and stale-message rejection');
