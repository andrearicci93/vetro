'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const report=require('../service/diagnostic-report');
(async()=>{
 const secret='PERSONAL_SENTINEL@example.com';
 const poison={username:secret,password:secret,serial:secret,hostname:secret,bootId:secret,token:secret,error:null,unknown:secret};
 const readers={
  platform:()=>({...poison,mode:'tv-integration',running:true,agent:{connected:true,uid:0,pid:123,identity:secret},self:{node:'v12.4.0',pid:123}}),
  device:()=>({...poison,model:'QE50Q80A',firmware:'T-NKM2DEUC-2301.1',realModel:'192.0.2.10'}),
  inventory:()=>({...poison,apps:[{...poison,name:secret,author:secret,appId:'com.samsung.tv.acr',packageId:'com.samsung.tv.acr-service',version:'1.0',disabled:true,onboot:false,dependencies:[{packageId:'org.tizen.test',version:'1.0',token:secret}]}]}),
  settings:()=>({items:[{id:'pictureMode',value:65538,writable:false,error:secret},{id:'backlight',value:secret},{id:'password',value:secret}]}),
  monitor:()=>({...poison,cpu:{percent:4},memory:{totalBytes:1024},telemetry:{hostname:secret,soctemp_c:42},processes:[{...poison,pid:123,ppid:456,name:'acr-service',appId:'com.samsung.tv.acr',cmdline:secret,cpuPercent:2,rssBytes:42}]}),
  network:()=>({services:[{name:secret,mac:secret,ipv4:{Address:secret,Method:'dhcp'},nameserversConfigured:['192.0.2.53']}]}),
  mqtt:()=>({...poison,state:'connected',connected:true,identity:secret,events:[secret],subscriptions:[secret],sent:5}),
  dns:()=>({domains:[secret],enabled:true,applied:false}),
  probe:()=>({probe:{supportedKeys:{ok:true,value:['VolumeUp',secret]},systeminfoBattery:{ok:true,value:poison}},settings:poison}),
  catalog:()=>({items:[{id:'picture-mode',vconfKey:'db/menu/picture/mode',provider:'vconf-dataprovider',value:secret,options:[secret]}]}),
  startup:()=>[{name:'test.service',active:'inactive',bootState:'disabled',description:secret}],
  privacy:()=>({...poison,adId:{psid:secret},agreements:[secret],doNotTrack:1}),
  serviceApis:()=>({tizenObject:false,application:false,secret}),
  hbbtv:()=>{throw Error(secret);},
  launcher:()=>({...poison,installed:true,enabled:true,running:true,samsungHome:false,busy:false,fixTizenTube:true,autorunSwitchedOff:true,failures:2,hasError:true,log:secret,
   apps:{count:11,skipped:[{item:secret,reason:secret}]},entries:[{slug:'tizentube',label:secret,appId:'xvvl3S1TT1.TizenTubeStandalone'},{slug:'x',label:secret,appId:secret}],inputs:[{label:secret}]}),
  quickWins:()=>({wins:{firmware:{status:'on',value:0},multiscreen:{status:'off',running:true},ambient:{status:'partial',running:true,chosen:true,extra:secret}}})
 };
 const d=await report.collect(readers,100);
 const text=JSON.stringify(d);
 assert(!text.includes(secret));assert(!text.includes('192.168.'));assert(!text.includes('"pid"'));assert(!text.includes('"bootId"'));assert(!text.includes('"cmdline"'));
 assert.equal(d.sections.platform.data.rootAgent.uid,0);
 assert.equal(d.sections.platform.data.persistence,'unknown');
 assert.equal(d.sections.inventory.data.apps[0].disabled,true);
 assert.equal(d.sections.settings.data.items[0].value,65538);
 assert.equal(d.sections.settings.data.items.length,2);
 assert.equal(d.sections.monitor.data.telemetry.soctemp_c,42);
 assert.equal(d.sections.startup.data.services[0].bootState,'disabled');
 assert.equal(d.sections.serviceApis.data.tizenObject,false);
 assert.equal(d.sections.hbbtv.status,'unavailable');
 assert.deepEqual(d.sections.launcher.data,{entryCount:2,inputCount:1,appCount:11,skippedCount:1,failures:2,hasError:true,tizenTubeTile:true,installed:true,enabled:true,running:true,samsungHome:false,busy:false,fixTizenTube:true,autorunSwitchedOff:true},'launcher: states and counts only');
 assert.deepEqual(d.sections.quickWins.data,{firmware:{status:'on',running:null,chosen:null},multiscreen:{status:'off',running:true,chosen:null},ambient:{status:'partial',running:true,chosen:true}});
 assert.equal(d.sections.probe.data.supportedKeys.keys[0],'VolumeUp');
 assert.equal(d.sections.network.data.services[0].customDnsConfigured,true);
 const timeout=await report.collect({device:()=>new Promise(()=>{}),inventory:()=>Promise.reject(Error(secret))},10);
 assert.equal(timeout.sections.device.status,'timeout');assert.equal(timeout.sections.inventory.status,'unavailable');
 assert.equal(timeout.sections.mqtt.status,'unavailable');
 // Exercise the browser download handler, including the actual JSON file content.
 const html=require('../service/dashboard')(),script=html.match(/<script>([\s\S]*)<\/script>/)[1];new vm.Script(script);
 const match=script.match(/\$\('downloadDiagnostics'\)\.onclick=([\s\S]*?);\n/);assert(match);
 let saved,clicks=0,status={};const button={disabled:false};
 const context={fetch:async()=>({ok:true,json:async()=>d}),$:id=>id==='diagnosticStatus'?status:button,Blob:class{constructor(parts){saved=parts.join('');}},URL:{createObjectURL:()=> 'blob:local',revokeObjectURL:()=>{}},document:{createElement:()=>({click:()=>clicks++,remove:()=>{}}),body:{appendChild:()=>{}}},setTimeout:()=>{},Error,JSON,Object};
 const fn=vm.runInNewContext('('+match[1]+')',context);fn.call(button);await new Promise(r=>setImmediate(r));
 assert.equal(clicks,1);assert.equal(JSON.parse(saved).schemaVersion,1);assert.equal(button.disabled,false);assert(status.textContent.includes('Nothing was uploaded'));
 context.fetch=async()=>({ok:false});fn.call(button);await new Promise(r=>setImmediate(r));assert.equal(button.disabled,false);assert(status.textContent.includes('Download failed'));assert.equal(clicks,1);
 console.log('PASS diagnostic export: sensitive-field exclusion, technical fields, partial failure, timeout and browser JSON download');
})().catch(e=>{console.error(e);process.exit(1);});
