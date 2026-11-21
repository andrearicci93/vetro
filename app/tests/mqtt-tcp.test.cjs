'use strict';
const assert=require('assert').strict,net=require('net'),{MqttBridge}=require('../service/mqtt-bridge.js');
(async()=>{
 let stream=Buffer.alloc(0),commands=0,discovery=0,connection;
 const observed=[];
 const server=net.createServer(s=>{connection=s;s.on('data',chunk=>{
 stream=Buffer.concat([stream,chunk]);
 while(stream.length>=2){let n=0,m=1,i=1,d;do{if(i>=stream.length)return;d=stream[i++];n+=(d&127)*m;m*=128;}while(d&128);if(stream.length<i+n)return;
 const type=stream[0]>>4,flags=stream[0]&15,body=stream.subarray(i,i+n);stream=stream.subarray(i+n);
 if(type===1){assert.equal(body[7]&0x24,0x24,'retained LWT in CONNECT');assert.ok(body.includes(Buffer.from('offline')));assert.ok(body.includes(Buffer.from('vetro-user')));assert.ok(body.includes(Buffer.from('test-password')));s.write(Buffer.from([0x20,2,0,0]));}
 if(type===8){const id=body.readUInt16BE(0);s.write(Buffer.from([0x90,3,id>>8,id&255,0]));const topic=Buffer.from('commands'),payload=Buffer.from('go'),publishBody=Buffer.concat([Buffer.from([0,topic.length]),topic,payload]);s.write(Buffer.concat([Buffer.from([0x31,publishBody.length]),publishBody]));s.write(Buffer.concat([Buffer.from([0x30,publishBody.length]),publishBody]));}
 if(type===3){const t=body.subarray(2,2+body.readUInt16BE(0)).toString();if(t.startsWith('homeassistant/')){assert.equal(flags&1,1);discovery++;}observed.push(t);}
 }
 });});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const bridge=new MqttBridge(()=>({soctemp_c:50,uptime_s:120}),m=>{assert.equal(m.payload.toString(),'go');commands++;});
 try{bridge.setTopics(['commands']);bridge.start();bridge.configure({enabled:true,host:'127.0.0.1',port:server.address().port,username:'vetro-user',password:'test-password',topicPrefix:'vetro'});
 const until=Date.now()+3000;while((commands<1||discovery<5)&&Date.now()<until)await new Promise(r=>setTimeout(r,10));
 assert.equal(commands,1,'retained command rejected, live command delivered');assert.equal(discovery,10);assert.ok(observed.includes('vetro/'+bridge.identity+'/soctemp-c'));assert.equal(bridge.connected,true);assert.equal(bridge.status().subscriptions[0].status,'active');
 console.log('PASS MQTT TCP broker fixture: authenticated CONNECT, real subscriptions, retained discovery, metrics and automatic message delivery');
 }finally{bridge.stop();if(connection)connection.destroy();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
