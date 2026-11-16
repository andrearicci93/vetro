'use strict';
const {launchCommand}=require('../service/dock-catalog.js').hbbtvLink;
const assert=require('assert').strict,remap=require('../service/remap.js');
const r={id:'mqtt',trigger:{type:'mqtt',value:'vetro/command',payload:'apri'},actions:[{type:'launch',appId:'app.ui'}]};
const rules=remap.validateRules([r]);assert.equal(remap.resolve(rules,'mqtt','vetro/command','apri').length,1);assert.equal(remap.resolve(rules,'mqtt','vetro/command','altro').length,0);
assert.throws(()=>remap.validateRules([Object.assign({},r,{trigger:{type:'mqtt',value:'any/#'}})]));
assert.throws(()=>remap.validateRules([Object.assign({},r,{actions:[{type:'mqtt',topic:'vetro/command',payload:'apri'}]})]),/loop/);
assert.throws(()=>remap.validateRules([r,{id:'other',trigger:{type:'http',value:'test'},actions:[{type:'mqtt',topic:'vetro/command',payload:'apri'}]}]),/loop/);
console.log('PASS MQTT rules: exact topic and payload, wildcard rejection and cross-rule loop prevention');

(async()=>{
 const path=require('path'),platform=require('../service/platform.js'),commands=[];
 platform.execute=c=>{commands.push(c);return Promise.resolve({exit_code:0,stdout:''});};
 const {context}=require('./service-harness.cjs')(path.resolve(__dirname,'..'));
 const sent=[];context.bridge.publish=(topic,payload)=>sent.push({topic,payload});
 context.remapStore.rules=remap.validateRules([{id:'in',trigger:{type:'mqtt',value:'command',payload:'go'},actions:[{type:'launch',appId:'selected.ui'},{type:'mqtt',topic:'state',payload:'opened'}]}]);
 context.bridge.onMessage({topic:'command',payload:Buffer.from('wrong')});await context.actionQueue;assert.equal(commands.length,0);
 context.bridge.onMessage({topic:'command',payload:Buffer.from('go')});await context.actionQueue;
 assert.deepEqual(commands,[launchCommand('selected.ui')]);assert.deepEqual(sent,[{topic:'state',payload:'opened'}]);
 context.bridge.onMessage({topic:'command',payload:Buffer.from('go')});await context.actionQueue;assert.equal(commands.length,1,'burst is throttled');
 context.bridge.publish=()=>{throw Error('MQTT disconnected')};await assert.rejects(context.runActions([{type:'mqtt',topic:'out',payload:'x'}]),/disconnected/);
 console.log('PASS automatic MQTT trigger: exact payload, selected native app, MQTT action, burst limit and explicit disconnected failure');
})().catch(e=>{console.error(e);process.exitCode=1});
