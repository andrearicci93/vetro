'use strict';
const assert=require('assert').strict,fs=require('fs'),vm=require('vm'),EventEmitter=require('events');
let socket,tlsOptions,ping;
class Socket extends EventEmitter{constructor(){super();this.writes=[];}setNoDelay(){}setTimeout(t){this.timeout=t;}write(b){this.writes.push(b);}end(){}destroy(){this.destroyed=true;}}
const net={isIP:require('net').isIP,connect:()=>socket=new Socket()},tls={connect:o=>{tlsOptions=o;return socket=new Socket()}};
const ctx=vm.createContext({module:{exports:{}},Buffer,require:n=>n==='net'?net:tls,setInterval:fn=>{ping=fn;return 1},clearInterval:()=>{}});
vm.runInContext(fs.readFileSync(require.resolve('../service/mqtt.js'),'utf8'),ctx);
const Client=ctx.module.exports.MqttClient;
const c=new Client({host:'broker'}),messages=[],subscriptions=[],errors=[];c.on('message',m=>messages.push(m)).on('subscribed',s=>subscriptions.push(s)).on('error',e=>errors.push(e));
c.on('connect',()=>c.subscribe('in'));
c.connect();socket.emit('connect');
// CONNACK coalesced with a retained QoS 1 command; packet ID 7 must be ACK'd.
const pub=Buffer.from([0x33,7,0,2,105,110,0,7,120]);
socket.emit('data',Buffer.concat([Buffer.from([0x20,2,0,0]),pub]));
assert.equal(messages.length,1);assert.equal(messages[0].retained,true);assert.equal(messages[0].payload.toString(),'x');
assert.ok(socket.writes.some(b=>b.equals(Buffer.from([0x40,2,0,7]))));
const sub=socket.writes.find(b=>(b[0]>>4)===8),id=sub.readUInt16BE(2);
socket.emit('data',Buffer.from([0x90,3,id>>8,id&255,0]));assert.equal(subscriptions[0].accepted,true);
c.unsubscribe('in');const unsub=socket.writes[socket.writes.length-1];assert.equal(unsub[0],0xa2);socket.emit('data',Buffer.from([0xb0,2,unsub[2],unsub[3]]));
c.publish('state','ready',{retain:true});assert.equal(socket.writes[socket.writes.length-1][0],0x31);
// Fragmented message is delivered once, after the complete payload arrives.
const p=Buffer.from([0x30,5,0,2,105,110,122]);socket.emit('data',p.subarray(0,3));assert.equal(messages.length,1);socket.emit('data',p.subarray(3));assert.equal(messages.length,2);
ping();socket.emit('data',Buffer.from([0xd0,0]));ping();ping();assert.match(errors[errors.length-1].message,/keepalive/);assert.equal(c._socket,null);
const secure=new Client({host:'broker.example',tls:true,ca:'test-ca'});secure.connect();assert.equal(tlsOptions.rejectUnauthorized,true);assert.equal(tlsOptions.servername,'broker.example');assert.equal(tlsOptions.ca,'test-ca');socket.emit('secureConnect');assert.equal(socket.writes.length,1);secure.close();
const malformed=new Client();malformed.on('error',e=>errors.push(e));malformed.connect();socket.emit('data',Buffer.from([0x30,0]));assert.match(errors[errors.length-1].message,/CONNACK/);assert.equal(malformed._socket,null);
console.log('PASS MQTT framing: coalesced and fragmented packets, retained QoS1 ACK, SUBACK, verified TLS and keepalive failure');
