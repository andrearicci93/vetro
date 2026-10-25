'use strict';
const assert=require('assert').strict,qw=require('../service/quick-wins.js');
// A small TV. Scripts are interpreted by their effect, never run.
function tv(start){
 const s=Object.assign({autoupdate:1,ms:false,msRun:true,amb:false,ambRun:false,failSet:false,keep:true,ambStays:false,telRun:8,telStays:0,calls:[]},start);
 const execute=async cmd=>{const sh=Buffer.from(cmd.split(' ')[1],'base64').toString();s.calls.push(sh);
  if(sh.includes('echo "AU|'))return {exit_code:0,stdout:'AU|value = '+s.autoupdate+' (Int32)\nMS|'+(s.ms?1:0)+'\nMR|'+(s.msRun?1:0)+'\nAR|'+(s.ambRun?1:0)+'\nTB|'+(s.telBrakes||0)+'\nTR|'+s.telRun+'\n'};
  if(sh.startsWith('vconftool get'))return {exit_code:0,stdout:'value = '+s.autoupdate+' (Int32)\n'};
  const set=/vconftool set -f -t int \S+ (-?\d+)/.exec(sh);if(set){if(s.failSet)return {exit_code:1,stderr:'denied',stdout:''};if(s.keep||Number(set[1])===1)s.autoupdate=Number(set[1]);return {exit_code:0,stdout:''};}
  if(sh.includes('touch '+qw.MULTISCREEN_FLAG)){s.ms=true;if(/app_launcher -t com.samsung.tv.multiscreen/.test(sh))s.msRun=false;}
  if(sh.includes('rm -f '+qw.MULTISCREEN_FLAG))s.ms=false;
  if(/^touch \/opt\/usr\/share\/systemd\/system\/canalysis-daemon/.test(sh)){s.telBrakes=3;s.telRun=s.telStays;s.telOffRuns=(s.telOffRuns||0)+1;}
  if(/^rm -f \/opt\/usr\/share\/systemd\/system\/canalysis-daemon/.test(sh)){s.telBrakes=0;s.telRun=8;}
  if(/up \|\| echo down/.test(sh))return {exit_code:0,stdout:s.ambRun?'up\n':'down\n'};
  if(/systemctl stop screend;.*kill -9.*systemctl start screend/s.test(sh)&&s.ambRun&&!s.ambStays){s.ambRun=false;s.screendCycles=(s.screendCycles||0)+1;}
  if(/app_launcher -f org.tizen.ambientapp/.test(sh))s.ambRun=true;
  return {exit_code:0,stdout:''};};
 return {s,execute};
}
function store(){let data=null;return {readFileSync(){if(data===null)throw Error('absent');return data},writeFileSync(f,t){data=t},renameSync(){},get data(){return data}};}
const noWait=()=>Promise.resolve();
(async()=>{
 // Reading
 assert.deepEqual(qw.parse('AU|value = 0 (Int32)\nMS|1\nMR|0\nAR|1\nnoise'),{autoupdate:0,multiscreenFlag:true,multiscreenRunning:false,ambientRunning:true,telemetryBrakes:null,telemetryRunning:null});
 assert.deepEqual(qw.parse('TB|3\nTR|2'),{autoupdate:null,multiscreenFlag:null,multiscreenRunning:null,ambientRunning:null,telemetryBrakes:3,telemetryRunning:2});
 assert.deepEqual(qw.parse('AU|Error: no such key'),{autoupdate:null,multiscreenFlag:null,multiscreenRunning:null,ambientRunning:null,telemetryBrakes:null,telemetryRunning:null},'what cannot be read stays unknown');
 let t=tv(),io=store(),w=new qw.Wins(t.execute,{fs:io,sleep:noWait,bootId:()=>'boot-1'});
 let st=await w.read();assert.deepEqual([st.wins.firmware.status,st.wins.multiscreen.status,st.wins.ambient.status],['off','off','off']);assert.equal(st.wins.telemetry.status,'off');

 // Auto update: 1 -> 0 with readback, the old value is kept and comes back
 let r=await w.apply('firmware',true);assert.equal(r.changed,true);assert.equal(t.s.autoupdate,0);assert.equal((await w.read()).wins.firmware.status,'on');
 assert.equal(JSON.parse(io.data).autoupdatePrevious,1);
 assert.equal((await w.apply('firmware',true)).changed,false,'already off');
 r=await w.apply('firmware',false);assert.equal(t.s.autoupdate,1);assert.equal(r.changed,true);
 assert.ok(t.s.calls.every(c=>!/softwareupdate\/(enabled|updatenow|osupgrade)/.test(c)),'only the auto update key is touched');
 // A TV that does not keep the value: the previous one is restored and the error says so
 t=tv({keep:false});w=new qw.Wins(t.execute,{fs:store(),sleep:noWait});
 await assert.rejects(w.apply('firmware',true),/did not keep.*previous value restored/);assert.equal(t.s.autoupdate,1);
 t=tv({failSet:true});w=new qw.Wins(t.execute,{fs:store(),sleep:noWait});
 await assert.rejects(w.apply('firmware',true),/denied|restore not confirmed|boom|unavailable/);

 // MultiScreen: one file, owned by the app's group, the app is stopped now, nothing is replaced
 t=tv();io=store();w=new qw.Wins(t.execute,{fs:io,sleep:noWait});
 r=await w.apply('multiscreen',true);assert.equal(r.status,'on');assert.equal(t.s.ms,true);assert.equal(t.s.msRun,false);
 const script=t.s.calls.find(c=>c.includes('touch '+qw.MULTISCREEN_FLAG));
 assert.ok(script.includes('chown owner:system_share '+qw.MULTISCREEN_FLAG),'the file belongs to the app owner, not root');
 assert.ok(!/not_support|multiview_low_memory/.test(script),'only the preload tag is written');
 r=await w.apply('multiscreen',false);assert.equal(t.s.ms,false);assert.equal(r.status,'off');
 assert.ok(!t.s.calls.some(c=>/app_launcher -s com\.samsung\.tv\.multiscreen/.test(c)),'undo does not start the app: Multi View starts it when asked');

 // Ambient: stopped now, remembered for every boot; the undo uses Samsung\'s own background launch
 t=tv({ambRun:true});io=store();w=new qw.Wins(t.execute,{fs:io,sleep:noWait,bootId:()=>'boot-1'});
 r=await w.apply('ambient',true);assert.equal(r.status,'on');assert.equal(t.s.ambRun,false);assert.equal(JSON.parse(io.data).ambient,true);
 t.s.ambRun=true;assert.equal((await w.read()).wins.ambient.status,'partial','chosen but running again');
 t.s.ambRun=false;r=await w.apply('ambient',false);assert.equal(t.s.ambRun,true);assert.equal(JSON.parse(io.data).ambient,false);
 assert.ok(t.s.calls.some(c=>c.includes('launchstyle background __APPFW_LAUNCH_TYPE_IDENTIFIER__ bg')&&!/launchstyle coldboot/.test(c)),'background launch, as ambient_start.sh does');
 t=tv({ambRun:true,ambStays:true});w=new qw.Wins(t.execute,{fs:store(),sleep:noWait});
 await assert.rejects(w.apply('ambient',true),/still running/);

 // After a boot: waits for the firmware to start AmbientApp, stops it once, and does not repeat in the same boot
 t=tv({ambRun:false});io=store();w=new qw.Wins(t.execute,{fs:io,sleep:async()=>{if(++waited===3)t.s.ambRun=true;},bootId:()=>'boot-7'});let waited=0;
 w.remember('ambient',true);
 let did=await w.boot(null);assert.deepEqual(did,['ambient']);assert.equal(t.s.ambRun,false);assert.equal(waited,3,'polled until the app showed up');
 assert.equal(t.s.screendCycles,1,'screend is stopped, the app killed, screend started again: once');
 assert.ok(t.s.calls.every(c=>!/app_launcher -t org\.tizen\.ambientapp/.test(c)),'a plain stop is not used: screend would start the app again');
 const before=t.s.calls.length;t.s.ambRun=true;did=await w.boot(null);assert.deepEqual(did,[]);assert.equal(t.s.calls.length,before,'same boot id: nothing more to do');assert.equal(t.s.ambRun,true,'a manual start later is left alone');
 // It gives up when the app never starts
 t=tv({ambRun:false});w=new qw.Wins(t.execute,{fs:store(),sleep:noWait,bootId:()=>'boot-8'});w.remember('ambient',true);
 did=await w.boot(null);assert.deepEqual(did,[]);assert.ok(t.s.calls.length<=40,'bounded polling');
 // A build that does not offer Ambient ignores a choice saved by an earlier one
 t=tv({ambRun:true});w=new qw.Wins(t.execute,{fs:store(),sleep:noWait,bootId:()=>'boot-9',skipAmbient:true});w.remember('ambient',true);
 assert.deepEqual(await w.boot(null),[]);assert.equal(t.s.ambRun,true);assert.equal(t.s.calls.length,0);

 // Telemetry: brake files and stops now, the DNS entry is added once and removed only if Vetro added it, the stop is repeated at boot
 function fakeDns(start){const d={enabled:false,applied:false,domains:['ads.example.com'],calls:[]};Object.assign(d,start);
  d.status=async()=>({enabled:d.enabled,applied:d.applied,domains:d.domains.slice()});
  d.apply=async(en,dom)=>{d.calls.push([en,dom.slice()]);d.enabled=en;d.applied=en;d.domains=dom.slice();return d.status();};return d;}
 let dns=fakeDns({enabled:true,applied:true});t=tv();io=store();w=new qw.Wins(t.execute,{fs:io,sleep:noWait,bootId:()=>'boot-t1',dns});
 r=await w.apply('telemetry',true);assert.equal(r.status,'on');assert.equal(r.dns,'blocked');assert.equal(t.s.telRun,0);assert.equal(t.s.telBrakes,3);
 assert.deepEqual(dns.domains,['ads.example.com',qw.TELEMETRY_HOST]);assert.equal(JSON.parse(io.data).telemetry,true);assert.equal(JSON.parse(io.data).telemetryDns,true);
 const off=t.s.calls.find(c=>/^touch /.test(c));
 assert.ok(off.includes('/opt/usr/share/systemd/system/canalysis-daemon')&&off.includes('/opt/usr/share/systemd/system/pisa-service'),'the units\' own brake files');
 assert.ok(/for u in [^;]*contents-recognition-service[^;]*kpi-logging[^;]*; do systemctl stop/.test(off),'viewing-data and logging services are stopped');
 assert.ok(/contents-ui-detector-service/.test(off)&&/contents-ui-det /.test(off)&&/contents-ott-de /.test(off),'the picture detectors are stopped, including the one a recogniser starts without a unit');
 assert.ok(!/systemctl (mask|disable)|rm -rf|\/usr\/lib/.test(off),'nothing on the system image, nothing masked');
 assert.equal((await w.read()).wins.telemetry.dnsBlocked,true);
 t.s.telRun=2;assert.equal((await w.read()).wins.telemetry.status,'partial','chosen but running again');
 t.s.telRun=0;r=await w.apply('telemetry',false);assert.equal(r.dns,'removed');assert.deepEqual(dns.domains,['ads.example.com']);assert.equal(t.s.telBrakes,0,'brake files removed');assert.equal(JSON.parse(io.data).telemetry,false);
 assert.ok(t.s.calls.some(c=>/^rm -f /.test(c)&&/for u in [^;]*pisa-service[^;]*; do systemctl start/.test(c)&&!/systemctl start data-service/.test(c)),'undo starts the services again, data-service comes back by itself');
 // A host the user saved on their own is left alone, a filter that is switched off only gets the entry saved
 dns=fakeDns({domains:[qw.TELEMETRY_HOST]});t=tv();io=store();w=new qw.Wins(t.execute,{fs:io,sleep:noWait,dns});
 r=await w.apply('telemetry',true);assert.equal(r.dns,'saved');assert.equal(dns.calls.length,0,'already saved: no write');
 r=await w.apply('telemetry',false);assert.equal(r.dns,'unchanged');assert.deepEqual(dns.domains,[qw.TELEMETRY_HOST],'not added by Vetro, so not removed');
 dns=fakeDns({enabled:false});t=tv();w=new qw.Wins(t.execute,{fs:store(),sleep:noWait,dns});
 r=await w.apply('telemetry',true);assert.equal(r.dns,'saved');assert.equal(dns.enabled,false,'the switch for the filter is not turned on behind the user\'s back');assert.ok(dns.domains.includes(qw.TELEMETRY_HOST));
 // A filter that fails does not undo the services; collectors that come back are reported
 t=tv();w=new qw.Wins(t.execute,{fs:store(),sleep:noWait,dns:{status:async()=>{throw Error('x')},apply:async()=>{throw Error('x')}}});
 r=await w.apply('telemetry',true);assert.equal(r.dns,'failed');assert.equal(r.status,'on');
 t=tv({telStays:3});w=new qw.Wins(t.execute,{fs:store(),sleep:noWait});await assert.rejects(w.apply('telemetry',true),/3 collectors started again/);
 // After a boot: stopped twice (late starters), once per boot, only when chosen
 t=tv();io=store();let slept=[];w=new qw.Wins(t.execute,{fs:io,sleep:async ms=>{slept.push(ms)},bootId:()=>'boot-t2',skipAmbient:true});
 assert.deepEqual(await w.boot(null),[]);assert.equal(t.s.telOffRuns||0,0,'not chosen: untouched');
 w.remember('telemetry',true);assert.deepEqual(await w.boot(null),['telemetry']);assert.equal(t.s.telOffRuns,2);assert.ok(slept.includes(45000),'second pass 45 s later');
 assert.deepEqual(await w.boot(null),[]);assert.equal(t.s.telOffRuns,2,'same boot id: nothing more');
 w=new qw.Wins(t.execute,{fs:io,sleep:noWait,bootId:()=>'boot-t3',skipAmbient:true});assert.deepEqual(await w.boot(null),['telemetry']);assert.equal(t.s.telOffRuns,4,'next boot: again');
 // HbbTV is enforced through its own control, only when the user chose it
 const calls=[];const fake={enforce:async()=>{calls.push('enforce');return {stopped:true};}};
 t=tv();w=new qw.Wins(t.execute,{fs:store(),sleep:noWait,bootId:()=>'b'});
 assert.deepEqual(await w.boot(fake),[]);assert.equal(calls.length,0,'not chosen: untouched');
 w.remember('hbbtv',true);assert.deepEqual(await w.boot(fake),['hbbtv']);
 // Misuse
 await assert.rejects(w.apply('nope',true),/Unknown/);await assert.rejects(w.apply('firmware','yes'),/Invalid/);
 assert.throws(()=>w.remember('firmware',true),/Unknown/);
 console.log('PASS quick wins: auto update, MultiScreen preload, AmbientApp and data-collection services at boot, all reversible');
})().catch(e=>{console.error(e);process.exitCode=1});
