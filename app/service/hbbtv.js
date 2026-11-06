'use strict';
var execError = require('./exec-error.js');
// Regular expressions compiled once at module load, not on every call.
var DOT_RE = /\./g;
var VCONF_INT32_RE = /value = (-?\d+) \(Int32\)/;
var FLAG_SET_RE = /__FLAG__\s*1/;
var RUN_SET_RE = /__RUN__\s*1/;
var SVC_SET_RE = /__SVC__\s*1/;
var DIS_SET_RE = /__DIS__\s*1/;
// Q80A native menu verified 2026-10-13: Off=19, On=20.
// Recognize legacy Vetro value 0 as Off; new writes use the native menu value.
//
// The menu value alone does not stop HbbTV on the Q80A: the app keeps running with the value on Off. What starts
// it again is hbbtv_service, which listens for app status changes (TryRelaunchApp) at boot, on a source change and
// when the TV wakes. The firmware's brake file /tmp/hbbtv_do-not-relaunch only guards its first launch: with the
// app killed it came back within 4 s (Q80A, 2026-10-23). Stopping the service first, then the app, kept it off
// for the 40 s that were watched. The service did not come back by itself (no auto-restart on a normal stop).
// Off therefore means: menu value 19, the brake file, the service stopped and the app stopped. The service and the
// brake file live in tmpfs / the running system, so they are put back after each boot (see enforce and quick-wins.js).
// Off never starts anything. On removes both flag files and starts the service and the app.
//
// QN85A (T-NKM2DEUC, build 2026-07-21), checked 2026-11-02 by zabique (https://github.com/zabique/vetro, branch
// fork/extras): hbbtv_service is registered with auto-restart, so a stop is answered by a new hbbtv_service within a
// second; Off failed ("its service is still running") and rolled back. What works at once is disabling the service
// app (`pkgcmd -D --global`, app_disable=true): nothing can launch it, and `pkgcmd -A --global` puts it back. So Off
// also disables the service, and On enables it again. The Q80A firmware declares the same auto-restart for the
// service (ug-hbbtv-efl.xml), although its package database has it off and the service stayed down in the test
// above, so the disable is a safeguard there. Like the brake file, a system app's disable is not trusted to survive
// a reboot: enforce puts it back after each boot.
var fs=require('fs'),KEY='db/menu/system/data-service',FILE='/opt/usr/home/owner/share/vetro-hbbtv.json';
var APP='org.tizen.hbbtv',SERVICE='org.tizen.hbbtv-service',FLAG='/tmp/hbbtv_do-not-relaunch',RUNFLAG='/tmp/hbbtv_app_running';
var DB='/opt/dbspace/.pkgmgr_parser.db';
var DISABLED='sqlite3 -readonly '+DB+' "SELECT app_disable FROM package_app_info WHERE app_id=\''+SERVICE+'\';" 2>/dev/null | grep -q true';
// Disabling also ends a running service. read() checks the result afterwards, so the tool's exit code is not trusted.
var DISABLE_SVC='pkgcmd -D -t app -n '+SERVICE+' --global >/dev/null 2>&1 || true';
var ENABLE_SVC='if '+DISABLED+'; then pkgcmd -A -t app -n '+SERVICE+' --global >/dev/null 2>&1 || true; fi';
function listed(id){return 'app_launcher -S 2>/dev/null | grep -q "^[[:space:]]*'+id.replace(DOT_RE,'\\.')+'[[:space:]]"';}
// -t may exit non-zero when the app is already gone (the scripts run under set -e), and the process can take a
// moment to leave the list: wait up to 5 s.
function stopOf(id){return 'if '+listed(id)+'; then app_launcher -t '+id+' || true; i=0; while '+listed(id)+' && [ $i -lt 10 ]; do sleep 0.5; i=$((i+1)); done; fi';}
var STOP=DISABLE_SVC+'\n'+stopOf(SERVICE)+'\n'+stopOf(APP);
function wrap(s){return 'echo '+Buffer.from(s).toString('base64')+' | base64 -d | sh';}
function check(r){if(r.exit_code||r.timed_out)throw execError.failed(r,r.stderr||r.stdout||'HbbTV unavailable');return r.stdout||'';}
function Control(execute,storage){this.execute=execute;this.fs=storage||fs;this.busy=false;}
Control.prototype.read=function(){var self=this;
 var script='vconftool get '+KEY+' 2>&1\necho __FLAG__\n[ -e '+FLAG+' ] && echo 1 || echo 0\necho __RUN__\n'+listed(APP)+' && echo 1 || echo 0\necho __SVC__\n'+listed(SERVICE)+' && echo 1 || echo 0\necho __DIS__\n'+DISABLED+' && echo 1 || echo 0';
 return this.execute(wrap(script),8000).then(function(r){var out=check(r),m=VCONF_INT32_RE.exec(out);if(!m)throw Error('HbbTV value unreadable');
  var flag=FLAG_SET_RE.test(out),running=RUN_SET_RE.test(out),service=SVC_SET_RE.test(out),serviceDisabled=DIS_SET_RE.test(out),v=Number(m[1]),saved=null,valueOff=v===0||v===19;
  try{var b=JSON.parse(self.fs.readFileSync(FILE,'utf8'));if(Number.isInteger(b.value)&&b.value>0&&b.value!==19&&b.value<=2147483647)saved=b.value;}catch(e){}
  // off: all five hold (value, brake file, app stopped, service stopped and disabled). valueOff without the rest is
  // the state Samsung's own menu leaves behind: HbbTV still loaded.
  return {value:v,off:valueOff&&flag&&!running&&!service&&serviceDisabled,valueOff:valueOff,flag:flag,running:running,serviceRunning:service,serviceDisabled:serviceDisabled,restoreValue:saved,canRestore:saved!==null,source:KEY,verification:'Menu value, brake file and process list; the red button must be checked on the TV'};});};
Control.prototype.change=function(off,expected){var self=this;if(typeof off!=='boolean'||!Number.isInteger(expected))return Promise.reject(Error('Invalid HbbTV state'));if(this.busy)return Promise.reject(Error('HbbTV change already in progress'));this.busy=true;var previous;
 function apply(script){return self.execute(wrap('set -e\n'+script+'\nsleep 1'),25000).then(check);}
 function disable(){return apply('vconftool set -f -t int '+KEY+' 19\ntouch '+FLAG+'\n'+STOP);}
 function enable(value){return apply('vconftool set -f -t int '+KEY+' '+value+'\nrm -f '+FLAG+' '+RUNFLAG+'\n'+ENABLE_SVC+'\napp_launcher -s '+SERVICE+'\nsleep 1\napp_launcher -s '+APP);}
 // Back to what was there: the menu value, the brake file as it was, the service started again if it was running.
 function putBack(s){return apply('vconftool set -f -t int '+KEY+' '+s.value+'\n'+(s.flag?'touch '+FLAG:'rm -f '+FLAG)+'\n'+(s.serviceDisabled?DISABLE_SVC:ENABLE_SVC)+(s.serviceRunning?'\nif ! '+listed(SERVICE)+'; then app_launcher -s '+SERVICE+'; fi':''));}
 function why(a){return a.running?'the app is still running':a.serviceRunning?(a.serviceDisabled?'its service is still running':'its service is still running and could not be disabled'):!a.serviceDisabled?'its service could not be disabled':a.flag?'the menu value was not kept':'the brake file was not kept';}
 return this.read().then(function(s){if(s.value!==expected)throw Error('Value changed; refresh before editing');previous=s;
  if(off){if(s.off)return Object.assign(s,{changed:false});
   if(s.value>0&&!s.valueOff){var tmp=FILE+'.tmp';self.fs.writeFileSync(tmp,JSON.stringify({value:s.value})+'\n',{mode:0o600});self.fs.renameSync(tmp,FILE);}
   return disable().then(function(){return self.read();}).then(function(after){if(!after.off)throw Error('HbbTV is not fully off: '+why(after));return Object.assign(after,{changed:true});})
    .catch(function(e){return putBack(previous).then(function(){return self.read();}).then(function(restored){throw Error(e.message+' · '+(restored.value===previous.value?'previous state restored':'restore not confirmed'));},function(){throw Error(e.message+' · restore not confirmed');});});}
  var target=s.restoreValue;
  if(s.valueOff&&target===null)throw Error('Previous value not saved; restore unavailable');
  if(!s.valueOff&&!s.flag&&s.serviceRunning)return Object.assign(s,{changed:false});
  if(target===null)target=s.value;
  return enable(target).then(function(){return self.read();}).then(function(after){if(after.value!==target||after.flag)throw Error('HbbTV write not confirmed');return Object.assign(after,{changed:true});})
   .catch(function(e){return putBack(previous).then(function(){return self.read();}).then(function(restored){throw Error(e.message+' · '+(restored.value===previous.value?'previous state restored':'restore not confirmed'));},function(){throw Error(e.message+' · restore not confirmed');});});
 }).finally(function(){self.busy=false;});};
// After a boot: the brake file is gone with /tmp and the firmware has started the service and the app. Put the
// choice back: brake file, service stopped, app stopped.
Control.prototype.enforce=function(){var self=this;
 return this.read().then(function(s){if(!s.valueOff)return {stopped:false,reason:'HbbTV is on in the menu'};
  if(s.flag&&!s.running&&!s.serviceRunning&&s.serviceDisabled)return {stopped:false,reason:'already off'};
  return self.execute(wrap('touch '+FLAG+'\n'+STOP+'\nsleep 1\ntrue'),25000).then(check).then(function(){return {stopped:true};});});};
module.exports={Control:Control,KEY:KEY,FILE:FILE,FLAG:FLAG,STOP:STOP,SERVICE:SERVICE};
