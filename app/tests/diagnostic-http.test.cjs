'use strict';
const assert=require('assert'),vm=require('vm'),path=require('path');
const service=require('./service-harness.cjs')(path.resolve(__dirname,'..'));
vm.runInContext(`
state={settings:{model:'Q80A',firmware:'2301.1',serial:'private-serial'}};
inventory=function(){return Promise.resolve({apps:[]});};
tvSettings.read=function(){return Promise.resolve({items:[]});};
tvSettings.readNetwork=function(){return Promise.resolve({services:[]});};
menuSettings.load=function(){return Promise.resolve({items:[]});};
monitor.snapshot=function(){return Promise.resolve({processes:[]});};
monitor.startup=function(){return Promise.resolve([]);};
dnsFilter.status=function(){return Promise.resolve({enabled:false});};
hbbtv.read=function(){return Promise.reject(Error('private-error'));};
privacy.read=function(){return Promise.resolve({});};
`,service.context);
function request(method,url){return new Promise(resolve=>{const headers={};const res={setHeader:(k,v)=>headers[k.toLowerCase()]=v,writeHead:(status,h)=>{res.code=status;Object.assign(headers,h);},end:text=>resolve({code:res.code,headers,data:JSON.parse(text)})};service.router({method,url:url||'/diagnostics/download',headers:{}},res);});}
(async()=>{const [a,b]=await Promise.all([request('GET'),request('GET')]);assert.equal(a.code,200);assert.equal(a.headers['cache-control'],'no-store');assert.equal(a.headers['content-disposition'],'attachment; filename="vetro-diagnostics.json"');assert.equal(a.data.format,'vetro-diagnostics');assert.equal(a.data.sections.device.data.model,'Q80A');assert.equal(a.data.sections.hbbtv.status,'unavailable');assert(!JSON.stringify(a.data).includes('private-'));assert.deepEqual(a.data,b.data);assert.equal((await request('POST')).code,405);assert.deepEqual([a.data.sections.components.status,a.data.sections.components.reason],['unavailable','not-requested'],'component details only on request');const more=await request('GET','/diagnostics/download?components=1');assert.equal(more.code,200);assert.equal(more.data.sections.components.status,'ok');assert.equal(more.data.sections.components.data.requested,true);const [p1,p2]=await Promise.all([request('GET'),request('GET','/diagnostics/download?components=1')]);assert.equal(p1.data.sections.components.status,'unavailable');assert.equal(p2.data.sections.components.status,'ok','a plain download and a detailed one do not share a report');console.log('PASS diagnostic HTTP download: attachment, no cache, concurrent requests, redaction and GET only');})().catch(e=>{console.error(e);process.exitCode=1;});
