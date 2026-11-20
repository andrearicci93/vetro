'use strict';
const assert=require('assert').strict,{MqttClient}=require('../service/mqtt.js'),{MqttBridge,validateConfig}=require('../service/mqtt-bridge.js');
const a=validateConfig({host:'broker'}),b=validateConfig({host:'broker'});assert.notEqual(a.clientId,b.clientId);assert.equal(validateConfig({host:'broker'},a).clientId,a.clientId);
const c=new MqttClient({clientId:'tv',will:{topic:'vetro/tv/availability',payload:'offline',retain:true}});const packet=c._connectPacket();assert.equal(packet[9]&0x24,0x24);assert.ok(packet.includes(Buffer.from('offline')));assert.throws(()=>new MqttClient({will:{topic:'bad/#',payload:'offline'}}));
const publications=[],fake={publish:(...x)=>publications.push(x),close(){this.closed=true}};
const bridge=new MqttBridge(()=>({soctemp_c:50}));bridge.identity='tv-one';bridge.config={topicPrefix:'vetro'};bridge.availabilityTopic='vetro/tv-one/availability';bridge.client=fake;bridge.connected=true;bridge._discover();bridge._publishTelemetry();
const beforeTv=publications.length;bridge.publishTvState({volume:12,muted:false,source:'TV'});const afterFirstTv=publications.length;assert.ok(afterFirstTv>beforeTv);
bridge.publishTvState({volume:12,muted:false,source:'TV'});assert.equal(publications.length,afterFirstTv,'unchanged TV state publishes nothing');
bridge.publishTvState({volume:15,muted:false,source:'TV'});assert.equal(publications.length,afterFirstTv+2,'only changed key is republished');
const configs=publications.filter(x=>x[0].startsWith('homeassistant/'));assert.equal(configs.length,9);for(const [topic,payload] of configs){const d=JSON.parse(payload);assert.ok(d.availability_topic==='vetro/tv-one/availability'||d.availability&&d.availability.some(x=>x.topic==='vetro/tv-one/availability'));assert.equal(d.device.identifiers[0],'tv-one');assert.ok(topic.includes('/tv-one/'));assert.ok(d.state_topic.startsWith('vetro/tv-one/'));}
bridge.stopClient();assert.equal(publications.filter(x=>x[0].startsWith('homeassistant/')&&x[1]==='').length,9);assert.ok(publications.some(x=>x[0]==='vetro/tv-one/availability'&&x[1]==='offline'&&x[2].retain));assert.ok(fake.closed);
console.log('PASS MQTT availability: retained LWT, stable per-TV IDs, isolated state topics, discovery cleanup');
