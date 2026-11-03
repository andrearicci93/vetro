'use strict';
const assert=require('assert').strict,path=require('path'),load=require('./service-harness.cjs');
const drain=()=>new Promise(r=>setImmediate(r));
(async()=>{
 const timers=[],cleared=new Set();let ready=false,restores=0,wins=0,dock=0,release;
 const service=load(path.resolve(__dirname,'..'),{dependencies:{'./build-info.js':{rootMethod:'remote-pc',inputRuntime:'tizen55',readOnly:false,automaticRestore:false,restorePreferences:true}},setInterval:fn=>{timers.push(fn);return fn},clearInterval:id=>cleared.add(id)});
 const c=service.context;c.clearInterval=id=>cleared.add(id);c.platform={status:()=>({agent:{connected:ready}})};
 c.dnsFilter.restore=()=>{restores++;if(restores===1)return new Promise((resolve,reject)=>{release=()=>reject(Error('boot still settling'))});return Promise.resolve({enabled:true,applied:true})};
 c.wins.boot=async()=>{wins++;if(wins===1)throw Error('boot still settling');return []};
 c.dock.supervise=async()=>{dock++};c.restoreInput=()=>{};
 c.inventory=()=>{throw Error('Startup flags must remain untouched')};
 const tick=async()=>{timers.filter(t=>!cleared.has(t)).forEach(t=>t());await drain()};
 for(let i=0;i<90;i++)await tick();
 assert.equal(restores,0);assert.equal(wins,0);assert.equal(c.dnsRestoreAttempts,0,'waiting for root does not consume retries');
 ready=true;await tick();for(let i=0;i<5;i++)await tick();assert.equal(restores,1,'slow restore cannot overlap another attempt');release();await drain();await tick();await tick();
 assert.equal(restores,2);assert.equal(wins,2);assert.ok(dock>0);
 assert.equal(c.AUTOMATIC_RESTORE,false);assert.equal(c.PREFERENCE_RESTORE,true);assert.equal(c.bridge.connected,false);
 console.log('PASS saved preferences: late root, retry after startup failure, no overlapping restores, no MQTT or startup flag mutations in manual mode');
})().catch(e=>{console.error(e);process.exitCode=1});
