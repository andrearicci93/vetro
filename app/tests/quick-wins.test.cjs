'use strict';
const assert=require('assert').strict,qw=require('../service/quick-wins.js');
// A small TV. Scripts are interpreted by their effect, never run.
const PARSEINFO='#!/bin/bash\nRepo=$(grep Build= /etc/prd_info.ini)\necho "__REPO__" > /proc/target_version\n';
function tv(start){
 const s=Object.assign({autoupdate:1,fwsvc:1,fwMasked:{},fwActive:{},markers:true,maskFails:false,keepSvc:true,
  ms:false,msRun:true,amb:false,ambRun:false,failSet:false,keep:true,ambStays:false,telRun:8,telStays:0,apPresent:true,apFlag:false,apSvc:true,apWeb:true,apStays:false,calls:[],
  parseinfo:PARSEINFO,parseinfoBak:null,hookInstalled:false,hookAccept:true},start);
 // The AT-HUB hook: install decodes the awk payload, remove restores the saved original.
 function runHook(sh){
  if(sh.includes('sha256sum')){
   if(!s.parseinfo)return 'vetro-hook: no parseinfo\n';
   const h=/\nH=([A-Za-z0-9+/=]+)\n/.exec(sh),body=h?Buffer.from(h[1],'base64').toString():'';
   if(s.parseinfo.includes('VETRO_UPDATE_LOCK_HOOK')){if(s.parseinfo!==body){s.parseinfo=body;s.hookUpgrades=(s.hookUpgrades||0)+1;}return 'vetro-hook: installed\n';}
   if(!s.hookAccept)return 'vetro-hook: unknown parseinfo\n';
   if(!s.parseinfoBak)s.parseinfoBak=s.parseinfo;
   s.parseinfo=body;s.hookInstalled=true;
   return 'vetro-hook: installed\n';
  }
  if(sh.includes('vetro-hook: restored')){
   if(s.parseinfoBak&&s.parseinfo.includes('VETRO_UPDATE_LOCK_HOOK')){s.parseinfo=s.parseinfoBak;s.parseinfoBak=null;s.hookInstalled=false;return 'vetro-hook: restored\n';}
   return 'vetro-hook: unchanged\n';
  }
  return '';
 }
 const execute=async cmd=>{const sh=Buffer.from(cmd.split(' ')[1],'base64').toString();s.calls.push(sh);
  if(sh.includes('echo "AU|'))return {exit_code:0,stdout:'AU|value = '+s.autoupdate+' (Int32)\nFWS|value = '+s.fwsvc+' (Int32)\n'+
   qw.FWUNITS.map(u=>'LS|'+u+'|'+(s.fwMasked[u]?'masked':'loaded')+'|'+(s.fwMasked[u]?'inactive':s.fwActive[u]?'active':'inactive')).join('\n')+
   '\nMS|'+(s.ms?1:0)+'\nMR|'+(s.msRun?1:0)+'\nAR|'+(s.ambRun?1:0)+'\nTB|'+(s.telBrakes||0)+'\nTR|'+s.telRun+'\nAP|'+(s.apPresent?1:0)+'\nAF|'+(s.apFlag?1:0)+'\nAS|'+(s.apSvc?'active':'inactive')+'\nAW|'+(s.apWeb?1:0)+'\nQB|'+(s.parseinfo&&s.parseinfo.includes('VETRO_UPDATE_LOCK_HOOK')?1:0)+'\nGD|'+(s.guard?'active':'inactive')+'\nSF|'+(s.sflag?1:0)+'\n'};
  if(sh.startsWith('vconftool get'))return {exit_code:0,stdout:'value = '+(sh.includes(qw.FWSERVICE)?s.fwsvc:s.autoupdate)+' (Int32)\n'};
  const set=/vconftool set -f -t int (\S+) (-?\d+)/.exec(sh);if(set&&/^vconftool set/.test(sh)){if(s.failSet)return {exit_code:1,stderr:'denied',stdout:''};const v=Number(set[2]);
   if(set[1]===qw.FWSERVICE){if(s.keepSvc)s.fwsvc=v;}else if(s.keep||v===1)s.autoupdate=v;return {exit_code:0,stdout:''};}
  if(/^set \+e\n(?:echo \S+ \| base64 -d > \S+ 2>\/dev\/null\n)*systemctl mask --runtime /.test(sh)){if(!s.guardFails&&sh.includes('systemctl start --no-block '+qw.FW_GUARD+'.path'))s.guard=true;if(sh.includes('rm -f '+qw.STANDALONE_FLAG))s.sflag=false;s.guardFiles=(sh.match(/base64 -d > \S+/g)||[]).length;for(const u of qw.FWUNITS){if(!s.maskFails)s.fwMasked[u]=true;s.fwActive[u]=false;}s.markers=false;s.maskRuns=(s.maskRuns||0)+1;if(!s.failSet)for(const m of sh.matchAll(/vconftool set -f -t int (\S+) (-?\d+)/g)){if(m[1]===qw.FWSERVICE){if(s.keepSvc)s.fwsvc=Number(m[2]);}else if(s.keep||Number(m[2])===1)s.autoupdate=Number(m[2]);}return {exit_code:0,stdout:runHook(sh)};}
  if(/^set \+e\n(?:systemctl stop vetro-update-lock-guard[^\n]*\nrm -f [^\n]*\n)?systemctl unmask/.test(sh)){if(sh.includes('systemctl stop '+qw.FW_GUARD+'.path'))s.guard=false;s.fwMasked={};for(const u of ['swu-auto-upgrade.timer','swu-verifier-tv.service','was-background-update.path','fw-update-service.path','vdsystem-update-manager.timer','appbinary-manager.service'])s.fwActive[u]=true;s.unmaskRuns=(s.unmaskRuns||0)+1;return {exit_code:0,stdout:runHook(sh)};}
  // The telemetry boot pass carries the hook install in the same command: both halves count.
  if(/^touch \/opt\/usr\/share\/systemd\/system\/canalysis-daemon/.test(sh)){s.telBrakes=3;s.telRun=s.telStays;s.telOffRuns=(s.telOffRuns||0)+1;}
  if(sh.includes('vetro-hook:')||sh.includes('sha256sum'))return {exit_code:0,stdout:runHook(sh)};
  if(sh.includes('touch '+qw.MULTISCREEN_FLAG)){s.ms=true;if(/app_launcher -t com.samsung.tv.multiscreen/.test(sh))s.msRun=false;}
  if(sh.includes('rm -f '+qw.MULTISCREEN_FLAG))s.ms=false;
  if(/^for f in \/opt\/usr\/share\/systemd\/system\/canalysis-daemon .*\[ "\$o" = 0 \] && rm -f "\$f"/.test(sh)){s.telBrakes=0;s.telRun=8;}   // only root's files (the installer writes the same file as app_fw)
  if(/^set -e\ntouch \/opt\/usr\/share\/systemd\/system\/com.samsung.tv.airplay-service /.test(sh)){s.apFlag=true;if(!s.apStays){s.apSvc=false;s.apWeb=false;}s.apOffRuns=(s.apOffRuns||0)+1;}
  if(/^rm -f \/opt\/usr\/share\/systemd\/system\/com.samsung.tv.airplay-service /.test(sh)){s.apFlag=false;s.apSvc=true;}
  if(/AirPlayWebApp/.test(sh)&&/airplay-app\(-2\)/.test(sh)&&/ && echo up/.test(sh))return {exit_code:0,stdout:s.apWeb?'up\n':'down\n'};   // the web app check, Tizen 9's airplay-app-2 included (#279)
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
 assert.deepEqual(qw.parse('AU|value = 0 (Int32)\nMS|1\nMR|0\nAR|1\nnoise'),{autoupdate:0,fwService:null,fwUnits:{},multiscreenFlag:true,multiscreenRunning:false,ambientRunning:true,telemetryBrakes:null,telemetryRunning:null,airplayPresent:null,airplayFlag:null,airplayService:null,airplayWeb:null,quickbootHook:null,fwGuard:null,standaloneFlag:null,standaloneOtn:null,lastSearch:null,apps:{}});
 assert.deepEqual(qw.parse('TB|3\nTR|2'),{autoupdate:null,fwService:null,fwUnits:{},multiscreenFlag:null,multiscreenRunning:null,ambientRunning:null,telemetryBrakes:3,telemetryRunning:2,airplayPresent:null,airplayFlag:null,airplayService:null,airplayWeb:null,quickbootHook:null,fwGuard:null,standaloneFlag:null,standaloneOtn:null,lastSearch:null,apps:{}});
 assert.deepEqual(qw.parse('AU|Error: no such key'),{autoupdate:null,fwService:null,fwUnits:{},multiscreenFlag:null,multiscreenRunning:null,ambientRunning:null,telemetryBrakes:null,telemetryRunning:null,airplayPresent:null,airplayFlag:null,airplayService:null,airplayWeb:null,quickbootHook:null,fwGuard:null,standaloneFlag:null,standaloneOtn:null,lastSearch:null,apps:{}},'what cannot be read stays unknown');
 // Samsung's last update search: the date only, and only in its own format
 assert.equal(qw.parse('SD|20260828T094119').lastSearch,'2026-08-28');
 assert.equal(qw.parse('SD|20260828T094119\r').lastSearch,'2026-08-28');
 assert.equal(qw.parse('SD|').lastSearch,null);
 assert.equal(qw.parse('SD|/etc/passwd').lastSearch,null);
 let t=tv(),io=store(),w=new qw.Wins(t.execute,{fs:io,sleep:noWait,bootId:()=>'boot-1'});
 let st=await w.read();assert.deepEqual([st.wins.firmware.status,st.wins.multiscreen.status,st.wins.ambient.status],['off','off','off']);assert.equal(st.wins.telemetry.status,'off');

 // Firmware: the whole update stack, not just the menu value
 let r=await w.apply('firmware',true);assert.equal(r.changed,true);assert.equal(t.s.autoupdate,0);assert.equal(t.s.fwsvc,0);
 assert.deepEqual(qw.FWUNITS.filter(u=>t.s.fwMasked[u]),qw.FWUNITS,'every update unit is masked');
 assert.equal(t.s.markers,false,'download markers removed');
 assert.equal((await w.read()).wins.firmware.status,'on');
 assert.equal(JSON.parse(io.data).firmware,true);assert.equal(JSON.parse(io.data).autoupdatePrevious,1);assert.equal(JSON.parse(io.data).fwServicePrevious,1);
 assert.equal((await w.apply('firmware',true)).changed,false,'already locked');
 r=await w.apply('firmware',false);assert.equal(t.s.autoupdate,1);assert.equal(t.s.fwsvc,1);assert.equal(r.changed,true);
 assert.deepEqual(Object.keys(t.s.fwMasked),[],'all masks removed');assert.equal((await w.read()).wins.firmware.status,'off');
 assert.ok(t.s.calls.some(c=>/systemctl mask --runtime [^|]*swu-auto-upgrade\.timer[^|]* \|\| for u in /.test(c)),'the OTA scheduler is masked');
 assert.ok(t.s.calls.some(c=>/systemctl mask --runtime [^|]*was-background-update\.service[^|]* \|\| for u in /.test(c)),'the app/package updater is masked');
 assert.ok(t.s.calls.some(c=>/systemctl mask --runtime [^|]*appbinary-manager\.service[^|]* \|\| for u in /.test(c)),'the EMP updater is masked');
 assert.ok(t.s.calls.every(c=>!/\/usr\/lib|\/etc\/systemd/.test(c)),'nothing on the read-only image is written');
 // A TV that cannot mask: the lock fails and the switches it touched are put back
 t=tv({maskFails:true});w=new qw.Wins(t.execute,{fs:store(),sleep:noWait});
 await assert.rejects(w.apply('firmware',true),/did not keep the lock.*previous state restored/);assert.equal(t.s.autoupdate,1);assert.equal(t.s.fwsvc,1);
 t=tv({failSet:true});w=new qw.Wins(t.execute,{fs:store(),sleep:noWait});
 await assert.rejects(w.apply('firmware',true),/did not keep the lock|denied|restore not confirmed/);
 // A lock that failed is not remembered as chosen: the next boot does not mask the units again
 t=tv({maskFails:true});io=store();w=new qw.Wins(t.execute,{fs:io,sleep:noWait});
 await assert.rejects(w.apply('firmware',true));assert.equal(JSON.parse(io.data).firmware,false);
 // Only runtime masks (a plain mask would outlive Vetro), and the installers are stopped too: the firmware has two boot slots
 t=tv();w=new qw.Wins(t.execute,{fs:store(),sleep:noWait});r=await w.apply('firmware',true);
 assert.ok(t.s.calls.every(c=>!/systemctl mask (?!--runtime)/.test(c)),'no persistent mask');
 const stops=t.s.calls.join('\n').split('\n').filter(l=>l.includes('systemctl stop')).join('\n');
 assert.ok(t.s.calls.filter(c=>/systemctl mask --runtime/.test(c)&&/systemctl stop/.test(c)).every(c=>c.indexOf('systemctl mask --runtime')<c.indexOf('systemctl stop')),'masked before the stops, so a timer cannot start its unit again');
 assert.ok(/if \(lock\) units = units " [^"]*swu-verifier-tv\.timer/.test(t.s.parseinfo)&&(t.s.parseinfo.match(/systemctl mask --runtime" units " >\/dev\/null 2>&1 \|\| for u in" units/g)||[]).length===1&&t.s.parseinfo.indexOf('mask --runtime')<t.s.parseinfo.indexOf('stop --no-block'),'the boot hook masks all units in one call, before its stop');
 assert.ok(/swu-auto-upgrade\.timer/.test(stops)&&/swu-core-tv\.service/.test(stops)&&/swu-service\.service/.test(stops)&&!/bootmode-system-update/.test(stops),'the installers are stopped, the boot-mode oneshot is left to the mask');
 // Early lock: the AT-HUB script is replaced by the awk one, the vendor original is kept and restored on Off
 assert.equal(r.hook,true);assert.equal(t.s.hookInstalled,true);assert.equal(t.s.parseinfoBak,PARSEINFO);
 assert.ok(t.s.parseinfo.includes('VETRO_UPDATE_LOCK_HOOK')&&/target_version/.test(t.s.parseinfo),'the replacement keeps the vendor write');
 assert.ok(qw.FWUNITS.every(u=>t.s.parseinfo.includes(u)),'masks the same units before the boot services');
 assert.ok(t.s.parseinfo.includes('"firmware"')&&t.s.parseinfo.includes('lock = 1')&&!/systemctl mask (?!--runtime)/.test(t.s.parseinfo),'only when the saved choice is on, runtime masks only');
 r=await w.apply('firmware',false);assert.equal(r.changed,true);assert.equal(r.hook,false);
 assert.equal(t.s.hookInstalled,false);assert.equal(t.s.parseinfoBak,null);assert.ok(t.s.parseinfo.startsWith('#!/bin/bash'),'the vendor script is back');
 // A TV without parseinfo keeps the lock but cannot close the early window; an unknown script is not overwritten
 t=tv({parseinfo:null});w=new qw.Wins(t.execute,{fs:store(),sleep:noWait});r=await w.apply('firmware',true);
 assert.equal(r.hook,false);assert.equal(t.s.hookInstalled,false);
 t=tv({hookAccept:false});w=new qw.Wins(t.execute,{fs:store(),sleep:noWait});r=await w.apply('firmware',true);
 assert.equal(r.hook,false);assert.equal(t.s.parseinfoBak,null);assert.ok(t.s.parseinfo.startsWith('#!/bin/bash'),'unknown parseinfo left alone');
 // An owner who had Auto update off before the lock keeps it off afterwards; Off means no unit masked
 t=tv({autoupdate:0});io=store();w=new qw.Wins(t.execute,{fs:io,sleep:noWait});
 await w.apply('firmware',true);assert.equal(JSON.parse(io.data).autoupdatePrevious,null);
 r=await w.apply('firmware',false);assert.equal(t.s.autoupdate,0,'Auto update stays the owner\'s');assert.equal(r.status,'off');
 // A 0.5.0 switch: Auto update off with the old value saved, nothing masked. It reads off, and Off (Restore) still puts the value back, once
 t=tv({autoupdate:0});io=store();io.writeFileSync('x',JSON.stringify({autoupdatePrevious:1}));w=new qw.Wins(t.execute,{fs:io,sleep:noWait});
 assert.equal((await w.read()).wins.firmware.status,'off');assert.equal((await w.read()).wins.firmware.value,0);
 r=await w.apply('firmware',false);assert.equal(t.s.autoupdate,1,'the 0.5.0 value is put back');assert.equal(JSON.parse(io.data).autoupdatePrevious,null);
 assert.equal((await w.apply('firmware',false)).changed,false,'and only once');
 // A second lock over a 0 left by the first (a reboot whose re-apply failed) keeps the values saved the first time
 t=tv();io=store();w=new qw.Wins(t.execute,{fs:io,sleep:noWait});await w.apply('firmware',true);t.s.fwMasked={};
 await w.apply('firmware',true);assert.equal(JSON.parse(io.data).autoupdatePrevious,1);assert.equal(JSON.parse(io.data).fwServicePrevious,1);
 // The runtime masks live in /run: the boot job puts them back once per boot, before the SWU timer (120 s)
 let bid='fw-b1';t=tv();io=store();w=new qw.Wins(t.execute,{fs:io,sleep:noWait,bootId:()=>bid,skipAmbient:true});
 await w.apply('firmware',true);t.s.fwMasked={};t.s.markers=true;let fwDid=await w.boot(null);
 assert.ok(fwDid.includes('firmware'),'lock re-applied at boot');assert.deepEqual(qw.FWUNITS.filter(u=>t.s.fwMasked[u]),qw.FWUNITS);assert.equal(t.s.markers,false);
 // A firmware update puts the vendor parseinfo.sh back: the next boot masks again and reinstalls the early hook
 t.s.fwMasked={};t.s.parseinfo=PARSEINFO;t.s.hookInstalled=false;t.s.parseinfoBak=null;bid='fw-b1b';fwDid=await w.boot(null);
 assert.ok(fwDid.includes('firmware'));assert.equal(t.s.hookInstalled,true);assert.equal(t.s.parseinfoBak,PARSEINFO);
 t.s.fwMasked={};const beforeMasks=t.s.maskRuns;assert.deepEqual(await w.boot(null),[]);assert.equal(t.s.maskRuns,beforeMasks,'once per boot');
 bid='fw-b2';t.s.fwMasked={};fwDid=await w.boot(null);assert.ok(fwDid.includes('firmware'),'next boot: again');

 // Quick boot: the four markers at ~10 s, only while chosen; it shares the AT-HUB hook with the firmware lock
 t=tv();io=store();w=new qw.Wins(t.execute,{fs:io,sleep:noWait});
 r=await w.apply('quickboot',true);assert.equal(r.status,'on');assert.equal(r.hook,true);assert.equal(t.s.hookInstalled,true);
 assert.equal(JSON.parse(io.data).quickboot,true);assert.ok(/graphical.target.done/.test(t.s.parseinfo)&&/quickboot/.test(t.s.parseinfo));assert.ok(/ewaiter -d \/run\/systemd\/system\/default\.target\.done/.test(t.s.parseinfo),'sets the 6.5/9 system-default event');
 r=await w.apply('quickboot',false);assert.equal(r.status,'off');assert.equal(t.s.hookInstalled,false);assert.equal(JSON.parse(io.data).quickboot,false);
 // With the update lock on, turning quick boot off keeps the shared hook; turning the lock off last removes it
 t=tv();io=store();w=new qw.Wins(t.execute,{fs:io,sleep:noWait});await w.apply('firmware',true);await w.apply('quickboot',true);
 r=await w.apply('quickboot',false);assert.equal(r.status,'off');assert.equal(t.s.hookInstalled,true,'the update lock still needs the hook');
 r=await w.apply('firmware',false);assert.equal(t.s.hookInstalled,false,'both off: the vendor script is back');
 // A TV without the AT-HUB script cannot use quick boot; the failed choice is not kept
 t=tv({parseinfo:null});io=store();w=new qw.Wins(t.execute,{fs:io,sleep:noWait});
 await assert.rejects(w.apply('quickboot',true),/not available/);assert.equal(JSON.parse(io.data).quickboot,false);
 // At boot quick boot installs the hook without masking the update units; the firmware win does both
 t=tv();io=store();w=new qw.Wins(t.execute,{fs:io,sleep:noWait,bootId:()=>'qb-b1',skipAmbient:true});
 await w.apply('quickboot',true);t.s.fwMasked={};t.s.parseinfo=PARSEINFO;t.s.hookInstalled=false;
 const qbDid=await w.boot(null);assert.ok(qbDid.includes('quickboot'));assert.equal(t.s.hookInstalled,true);assert.deepEqual(Object.keys(t.s.fwMasked),[],'quick boot alone does not mask updates');
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
 assert.ok(!/systemctl (mask (?!--runtime)|disable)|rm -rf|\/usr\/lib/.test(off),'nothing on the system image, runtime masks only');
 assert.ok(/systemctl mask --runtime [^|]*issue_report_agent\.service[^|]*media-analytics-service\.service/.test(off)&&!/mask --runtime [^\n|]*data-service/.test(off),'units without a file of their own are masked at runtime (one call); data-service is only stopped');
 assert.ok(off.indexOf('mask --runtime')<off.indexOf('do systemctl stop'),'masked before the stops');
 assert.equal((await w.read()).wins.telemetry.dnsBlocked,true);
 // The filter whose only domain was that host: off switches the filter off (nothing left to block), on switches it on again (Q80A, 2026-11-22)
 {const d2=fakeDns({enabled:true,applied:true,domains:[qw.TELEMETRY_HOST]}),t2=tv(),w2=new qw.Wins(t2.execute,{fs:store(),sleep:noWait,dns:d2});
  w2.save({telemetry:true,telemetryDns:true});
  await w2.apply('telemetry',false);assert.equal(d2.enabled,false);assert.deepEqual(d2.domains,[]);
  const back=await w2.apply('telemetry',true);assert.equal(back.dns,'blocked');assert.equal(d2.enabled,true,'the filter is on again');assert.deepEqual(d2.domains,[qw.TELEMETRY_HOST]);
  const d3=fakeDns({enabled:false,domains:[]}),w3=new qw.Wins(tv().execute,{fs:store(),sleep:noWait,dns:d3});
  assert.equal((await w3.apply('telemetry',true)).dns,'saved');assert.equal(d3.enabled,false,'a filter the owner keeps off stays off');}
 t.s.telRun=2;assert.equal((await w.read()).wins.telemetry.status,'partial','chosen but running again');
 t.s.telRun=0;r=await w.apply('telemetry',false);assert.equal(r.dns,'removed');assert.deepEqual(dns.domains,['ads.example.com']);assert.equal(t.s.telBrakes,0,'brake files removed');assert.equal(JSON.parse(io.data).telemetry,false);
 assert.ok(t.s.calls.some(c=>/^for f in \/opt\/usr\/share\/systemd\/system\//.test(c)&&/for u in [^;]*pisa-service[^;]*contents-cognition-service-manager[^;]*; do systemctl start/.test(c)&&!/systemctl start data-service/.test(c)&&!/for u in [^;]*psid-checker[^;]*; do systemctl start/.test(c)),'undo starts the services again, data-service comes back by itself');
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
 // Cancelling a saved choice during boot must cancel the delayed enforcement too.
 t=tv();io=store();w=new qw.Wins(t.execute,{fs:io,sleep:async()=>{await w.apply('telemetry',false);},bootId:()=>'cancel-t',skipAmbient:true});
 w.remember('telemetry',true);did=await w.boot(null);
 assert.equal(t.s.telOffRuns,1,'the delayed pass must not stop collectors after undo');
 assert.equal(t.s.telBrakes,0);assert.deepEqual(did,[]);
 t=tv({ambRun:false});io=store();w=new qw.Wins(t.execute,{fs:io,sleep:async()=>{await w.apply('ambient',false);},bootId:()=>'cancel-a'});
 w.remember('ambient',true);did=await w.boot(null);
 assert.equal(t.s.ambRun,true,'undo during boot polling keeps Ambient running');assert.deepEqual(did,[]);
 // A synchronous storage failure must release the mutation lock.
 w=new qw.Wins(t.execute,{fs:{readFileSync(){throw Error('absent')},writeFileSync(){throw Error('disk full')}}});
 await assert.rejects(w.apply('ambient',true),/disk full/);assert.equal(w.busy,false);
 // Editing another win must not suppress an independent boot job.
 t=tv();w=new qw.Wins(t.execute,{fs:store(),sleep:noWait,bootId:()=>'independent',skipAmbient:true});
 w.remember('telemetry',true);w.busy=true;w.changing='firmware';
 assert.deepEqual(await w.boot(null),['telemetry']);assert.equal(t.s.telOffRuns,2);
 // AirPlay (idea by zabique): the flag files keep the receiver down; partial while something still runs; boot stops the web app
 assert.deepEqual(qw.parse('AP|1\nAF|1\nAS|inactive\nAW|0'),Object.assign({apps:{},autoupdate:null,fwService:null,fwUnits:{},multiscreenFlag:null,multiscreenRunning:null,ambientRunning:null,telemetryBrakes:null,telemetryRunning:null},{airplayPresent:true,airplayFlag:true,airplayService:false,airplayWeb:false,quickbootHook:null,fwGuard:null,standaloneFlag:null,standaloneOtn:null,lastSearch:null}));
 t=tv();io=store();w=new qw.Wins(t.execute,{fs:io,sleep:noWait,bootId:()=>'ap-1',skipAmbient:true});
 assert.equal((await w.read()).wins.airplay.status,'off');
 r=await w.apply('airplay',true);assert.equal(r.status,'on');assert.equal(JSON.parse(io.data).airplay,true);
 assert.ok(t.s.calls.some(c=>/airplay-service-2\n/.test(c)&&/^set -e/.test(c)),'both flag files');
 r=await w.apply('airplay',false);assert.equal(r.status,'off');assert.equal(t.s.apSvc,true);
 t=tv({apStays:true});w=new qw.Wins(t.execute,{fs:store(),sleep:noWait});
 await assert.rejects(w.apply('airplay',true),/started again right away/);
 t=tv({apPresent:false});w=new qw.Wins(t.execute,{fs:store(),sleep:noWait});assert.equal((await w.read()).wins.airplay.status,'unknown','no receiver on this TV');
 // 2022 and later TVs have only airplay-service-2: the read script loops over the units that exist and offers AirPlay only if each one carries the Condition line on its flag file
 t=tv({});w=new qw.Wins(t.execute,{fs:store(),sleep:noWait});await w.read();
 assert.ok(t.s.calls.some(s=>/for u in com\.samsung\.tv\.airplay-service com\.samsung\.tv\.airplay-service-2; do if systemctl cat \$u\.service/.test(s)&&s.includes('ConditionPathExists=!/opt/usr/share/systemd/system/$u$')),'AP loops over the units that exist and checks their Condition line');
 t=tv({apFlag:true,apSvc:false,apWeb:true});w=new qw.Wins(t.execute,{fs:store(),sleep:noWait});assert.equal((await w.read()).wins.airplay.status,'partial');
 t=tv({apFlag:true,apWeb:true});w=new qw.Wins(t.execute,{fs:store(),sleep:noWait,bootId:()=>'ap-b',skipAmbient:true});
 assert.deepEqual(await w.boot(null),[]);w.remember('airplay',true);assert.deepEqual(await w.boot(null),['airplay']);
 // Boot identity: boot_id alone is not enough after a snapshot restart, so btime is part of it
 const id1=qw.currentBoot();assert.ok(id1===null||/^[0-9a-f-]*@\d*$/.test(id1),'boot_id@btime');
 // Misuse
 await assert.rejects(w.apply('nope',true),/Unknown/);await assert.rejects(w.apply('firmware','yes'),/Invalid/);
 assert.throws(()=>w.remember('firmware',true),/Unknown/);
 console.log('PASS quick wins: auto update, MultiScreen preload, AmbientApp and data-collection services at boot, all reversible');
})().catch(e=>{console.error(e);process.exitCode=1});
