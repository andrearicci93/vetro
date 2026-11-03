'use strict';
const assert=require('assert').strict,{Store,decode}=require('../service/tv-settings.js');
assert.equal(decode('yi 45 0\n'),45);assert.throws(()=>decode('ii 4 -1'),/unavailable/);assert.throws(()=>decode('garbage'));
(async()=>{
 let value=45,sets=[],commands=[];
 const s=new Store(async c=>{commands.push(c);if(c.includes('SetContrast')){value=+c.match(/SetContrast yi (\d+) 0/)[1];sets.push(value);return {stdout:'i 0',exit_code:0};}return {stdout:'yi '+value+' 0',exit_code:0};});
 await assert.rejects(s.write({id:'arbitrary;cmd',value:44,expected:45}));await assert.rejects(s.write({id:'contrast',value:51,expected:45}));assert.equal(commands.length,0);
 await assert.rejects(s.write({id:'contrast',value:44,expected:42}),/changed/);assert.deepEqual(sets,[]);
 const changed=await s.write({id:'contrast',value:44,expected:45});assert.equal(changed.verified,true);assert.equal(value,44);
 let phase=0;const rollback=new Store(async c=>{if(c.includes('SetContrast')){phase++;return {stdout:'i 0',exit_code:0};}return {stdout:'yi '+(phase===1?40:45)+' 0',exit_code:0};});
 await assert.rejects(rollback.write({id:'contrast',value:44,expected:45}),/restore confirmed/);assert.equal(phase,2);assert.equal(rollback.busy,false);
 let film=1;const f=new Store(async c=>{if(c.includes('SetFilmmakerAutoMode')){assert.match(c,/SetFilmmakerAutoMode i [01]$/);film=+c.slice(-1);return {stdout:'i 0',exit_code:0};}return {stdout:'ii '+film+' 0',exit_code:0};});await f.write({id:'filmmakerAuto',value:0,expected:1});assert.equal(film,0);await assert.rejects(f.write({id:'localDimming',value:0,expected:2}),/Invalid/);
 const restricted=new Store(async()=>{throw Error('No mutation expected')},{tizen55:true});for(const id of ['localDimming','blurReduction','judderReduction','ledClearMotion'])await assert.rejects(restricted.write({id,value:1,expected:0}),/hardware verification/);
 const unchanged=new Store(async c=>c.includes('SetContrast')?{exit_code:0,stdout:'i -1'}:{exit_code:0,stdout:'yi 45 0'});await assert.rejects(unchanged.write({id:'contrast',value:44,expected:45}),/restore confirmed/);
 console.log('PASS TV settings: whitelist, status decoding, bounds, stale values, read-after-write and verified rollback');
})().catch(e=>{console.error(e);process.exitCode=1});

(async()=>{
 const {parseIntrospect,parseIntrospectXml,ITEMS}=require('../service/tv-settings.js');
 const method=(n,i,o)=>`  <method name="${n}">\n`+[...i].map(c=>`   <arg type="${c}" direction="in"/>\n`).join('')+[...o].map(c=>`   <arg type="${c}" direction="out"/>\n`).join('')+`  </method>\n`;
 const xml=(extra='',blur='iy',led='ii')=>`<node>\n <interface name="org.freedesktop.DBus.Peer">\n  <method name="Ping"/>\n </interface>\n <interface name="org.tizen.tv.avoc.AvOutputControl">\n`+method('GetBlurReduction','i','ii')+method('SetBlurReduction',blur,'i')+method('GetJuddlerReduction','i','ii')+method('SetJuddlerReduction','iy','i')+method('GetLedClearMotion','i','ii')+method('SetLedClearMotion',led,'i')+method('GetHdmiBlackLevel','i','ii')+extra+method('GetBacklight','i','ii')+method('SetBacklight','ii','i')+` </interface>\n</node>\n`;
 const x=parseIntrospectXml(xml());assert.equal(x.count,9);assert.equal(x.methods.SetBlurReduction.input,'iy');assert.equal(x.methods.GetBlurReduction.reply,'ii');assert.equal(x.methods.Ping,undefined);assert.equal(parseIntrospectXml('').count,0);
 const table='NAME                              TYPE      SIGNATURE RESULT/VALUE FLAGS\norg.tizen.tv.avoc.AvOutputControl interface -         -            -\n.GetBlurReduction                 method    i         ii           -\n.SetBlurReduction                 method    iy        i            -\n';
 assert.equal(parseIntrospect(table).methods.SetBlurReduction.input,'iy');assert.equal(parseIntrospect(table.replace('.SetBlurReduction','.SetBlurRed…')).count,0);
 const gated=ITEMS.filter(x=>x.gated);assert.deepEqual(gated.map(x=>x.id),['blurReduction','judderReduction','ledClearMotion','hdmiBlackLevel']);
 const values={};let calls=[];
 const fake=(xmlText,tableText='',failXml=false)=>new Store(async c=>{calls.push(c);
  if(c.includes('introspect')){if(c.includes('--xml-interface'))return failXml?{stdout:'',stderr:'unknown option',exit_code:1}:{stdout:xmlText,exit_code:0};return {stdout:tableText,exit_code:0};}
  const set=/Set(\w+) (\w+) (\d+) ?(\d*)$/.exec(c);if(set&&!c.includes(';')){values[set[1]]=+set[3];return {stdout:'i 0',exit_code:0};}
  let out='';c.split('; ').forEach(p=>{const m=/^echo __(\w+)__$/.exec(p);if(m)out+='__'+m[1]+'__\n';const g=/Get(\w+) /.exec(p);if(g&&!/^echo/.test(p))out+='ii '+(values[g[1]]??3)+' 0\n';});
  return c.includes(';')?{stdout:out,exit_code:0}:{stdout:'ii '+(values[/Get(\w+) /.exec(c)[1]]??3)+' 0',exit_code:0};});
 const s=fake(xml());const read=await s.read();
 const byId=Object.fromEntries(read.items.map(x=>[x.id,x]));
 assert.equal(byId.blurReduction.writable,true);assert.equal(byId.blurReduction.access,'firmware');assert.equal(byId.blurReduction.probe,'confirmed');
 assert.equal(byId.hdmiBlackLevel.writable,false);assert.equal(byId.hdmiBlackLevel.probe,'missing');assert.match(byId.hdmiBlackLevel.readOnlyReason,/does not offer/);
 assert.equal(byId.backlight.writable,true);assert.equal(byId.backlight.access,'verified');assert.equal(byId.backlight.probe,'confirmed');
 assert.equal(byId.sharpness.probe,'missing');assert.equal(byId.sharpness.writable,true,'a missing method on an old control is reported, not blocked');
 assert.deepEqual(read.api,{status:'ok',methods:9});
 await s.read();assert.equal(calls.filter(c=>c.includes('introspect')).length,1,'method list is fetched once');
 await assert.rejects(s.write({id:'hdmiBlackLevel',value:1,expected:3}),/not confirmed/);
 calls=[];const ok=await s.write({id:'blurReduction',value:7,expected:3});assert.equal(ok.verified,true);assert.ok(calls.some(c=>/SetBlurReduction iy 7 0$/.test(c)));
 await assert.rejects(s.write({id:'blurReduction',value:11,expected:7}));
 const led=await fake(xml()).read();assert.deepEqual(led.items.find(x=>x.id==='ledClearMotion').options,['Off','On','Auto']);
 const mismatch=await fake(xml('','iy','iy')).read();assert.equal(mismatch.items.find(x=>x.id==='ledClearMotion').probe,'signature-mismatch');
 const oldMismatch=await fake(xml().replace(method('SetBacklight','ii','i'),method('SetBacklight','y','i'))).read();assert.equal(oldMismatch.items.find(x=>x.id==='backlight').writable,false);
 const fromTable=await fake('',table,true).read();assert.equal(fromTable.api.status,'ok');assert.equal(fromTable.items.find(x=>x.id==='blurReduction').probe,'confirmed');assert.equal(fromTable.items.find(x=>x.id==='judderReduction').probe,'missing');
 const none=await fake('','',true).read();assert.equal(none.api.status,'unavailable');assert.equal(none.items.find(x=>x.id==='blurReduction').writable,false);assert.equal(none.items.find(x=>x.id==='backlight').writable,true);assert.equal(none.items.find(x=>x.id==='backlight').probe,null);
 const fresh=new Store(async()=>({stdout:'',exit_code:0}));await assert.rejects(fresh.write({id:'ledClearMotion',value:1,expected:0}),/not confirmed/);
 console.log('PASS TV settings: firmware-derived controls are written only after this TV confirms the exact D-Bus signature');
})().catch(e=>{console.error(e);process.exitCode=1});
