'use strict';
var execError = require('./exec-error.js');
// One bounded snapshot shared by clients. /proc command lines and environment
// are deliberately excluded: process names suffice for this read-only view.
var LIGHT = "echo '__BOOT__'; cat /proc/sys/kernel/random/boot_id; echo '__CPU__'; cat /proc/stat; echo '__MEM__'; cat /proc/meminfo; echo '__NET__'; cat /proc/net/dev; echo '__VM__'; cat /proc/vmstat; echo '__ZRAM__'; cat /sys/block/zram0/mm_stat 2>/dev/null; echo '__BLOCK__'; for d in mmcblk0 zram0; do if test -r /sys/block/$d/stat; then printf '%s ' \"$d\"; cat /sys/block/$d/stat; fi; done; echo '__UPTIME__'; cat /proc/uptime";
var DETAILS = "echo '__APPS__'; app_launcher -S; echo '__PAGE__'; getconf PAGESIZE; echo '__PROC__'; for f in /proc/[0-9]*/stat; do if IFS= read -r line < \"$f\" 2>/dev/null; then printf '%s' \"$line\"; echo; fi; done";
var STORAGE = "echo '__DISK__'; df -k /opt";
// Two commands: the running state is read in a few milliseconds, but systemctl needs 13-17 s on the Q80A to work out
// each unit's boot state (list-unit-files), which is more than the old single 15 s limit left on slower TVs: the Q80A
// answered, and a Q70A, a Q65S95C and a QN55S95B reported "command timed out" for the whole listing.
var UNITS_RUNNING = 'systemctl list-units --all --type=service --no-legend --plain --no-pager';
var UNITS_FILES = 'systemctl list-unit-files --type=service --no-legend --no-pager';
var MAX_DELTA_MS = 60000;
function sections(text) {var out={},key=null;String(text||'').split('\n').forEach(function(l){var m=/^__(\w+)__$/.exec(l);if(m){key=m[1];out[key]=[];}else if(key)out[key].push(l);});return out;}
function processStat(line,page) {
    var m=/^(\d+) \((.*)\) (\S+) (.*)$/.exec(line);if(!m)return null;
    var f=m[4].trim().split(/\s+/);if(f.length<21)return null;
    return {pid:+m[1],name:m[2],state:m[3],ppid:+f[0],ticks:+f[10]+ +f[11],minorFaults:+f[6],majorFaults:+f[8],threads:+f[16],startTicks:f[18],virtualBytes:+f[19],rssBytes:Math.max(0,+f[20])*page,kernel:(+f[5]&0x200000)!==0};
}
function parse(text,previous,now) {
    var s=sections(text),boot=(s.BOOT||[])[0]||null;
    if(previous&&boot&&previous.bootId&&boot!==previous.bootId)previous=null;
    // Rates over a long idle gap would look current; start a new baseline instead.
    if(previous&&now-previous.ts>MAX_DELTA_MS)previous=null;
    var cpu={},mem={},net={},page=+(s.PAGE||[])[0]||4096;
    (s.CPU||[]).forEach(function(l){var m=/^(cpu\d*)\s+(.+)$/.exec(l);if(!m)return;var v=m[2].trim().split(/\s+/).map(Number);cpu[m[1]]={total:v.slice(0,8).reduce(function(a,b){return a+b;},0),idle:(v[3]||0)+(v[4]||0)};});
    (s.MEM||[]).forEach(function(l){var m=/^(\w+):\s+(\d+)/.exec(l);if(m)mem[m[1]]=+m[2]*1024;});
    (s.NET||[]).forEach(function(l){var m=/^\s*([^:]+):\s*(.*)$/.exec(l);if(!m)return;var v=m[2].trim().split(/\s+/).map(Number);net[m[1]]={name:m[1],rxBytes:v[0],txBytes:v[8],rxErrors:v[2],txErrors:v[10]};});
    var cpus=Object.keys(cpu).filter(function(k){return k!=='cpu';}),elapsed=previous?(now-previous.ts)/1000:0;
    var metrics=Object.keys(cpu).map(function(k){var a=cpu[k],b=previous&&previous.cpu[k],delta=b?a.total-b.total:0;return {name:k,percent:delta>0?Math.max(0,Math.min(100,100*(delta-(a.idle-b.idle))/delta)):null};});
    var totalDelta=previous&&cpu.cpu&&previous.cpu.cpu?cpu.cpu.total-previous.cpu.cpu.total:0;
    var processes=(s.PROC||[]).map(function(l){return processStat(l,page);}).filter(Boolean);
    var appPids={};(s.APPS||[]).forEach(function(l){var m=/^\s*([A-Za-z0-9_.-]+) \((\d+)\)/.exec(l);if(m)appPids[+m[2]]=m[1];});var byPid={};processes.forEach(function(p){var before=previous&&previous.processes[p.pid];var same=before&&p.startTicks===before.startTicks&&elapsed>0;p.majorFaultsPerSecond=same&&p.majorFaults>=before.majorFaults?(p.majorFaults-before.majorFaults)/elapsed:null;p.minorFaultsPerSecond=same&&p.minorFaults>=before.minorFaults?(p.minorFaults-before.minorFaults)/elapsed:null;p.cpuPercent=before&&p.startTicks===before.startTicks&&totalDelta>0?Math.max(0,Math.min(cpus.length*100,100*(p.ticks-before.ticks)/totalDelta*cpus.length)):null;byPid[p.pid]=p;});
    processes.forEach(function(p){var n=p,seen={};while(n&&!seen[n.pid]){seen[n.pid]=true;if(appPids[n.pid]){p.appId=appPids[n.pid];break;}n=byPid[n.ppid];}});
    var interfaces=Object.keys(net).filter(function(k){return k!=='lo';}).map(function(k){var n=net[k],b=previous&&previous.net[k];n.rxPerSecond=b&&elapsed>0&&n.rxBytes>=b.rxBytes?(n.rxBytes-b.rxBytes)/elapsed:null;n.txPerSecond=b&&elapsed>0&&n.txBytes>=b.txBytes?(n.txBytes-b.txBytes)/elapsed:null;return n;});
    var z=(s.ZRAM||[]).join(' ').trim().split(/\s+/).map(Number),disk=null;
    (s.DISK||[]).forEach(function(l){var f=l.trim().split(/\s+/);if(f.length>=6&&/^\d+$/.test(f[1]))disk={totalBytes:+f[1]*1024,usedBytes:+f[2]*1024,availableBytes:+f[3]*1024,usedPercent:parseFloat(f[4]),mount:f[5]};});
    var vm={},block={};(s.VM||[]).forEach(function(l){var f=l.trim().split(/\s+/);if(f.length===2&&/^\d+$/.test(f[1]))vm[f[0]]=+f[1];});
    (s.BLOCK||[]).forEach(function(l){var f=l.trim().split(/\s+/),name=f.shift(),v=f.map(Number);if(v.length<11||v.some(function(x){return !Number.isFinite(x)||x<0;}))return;block[name]={readBytes:v[2]*512,writeBytes:v[6]*512,busyMs:v[9]};});
    function counterRate(current,old){return elapsed>0&&current!=null&&old!=null&&current>=old?(current-old)/elapsed:null;}
    var io={};Object.keys(block).forEach(function(k){var c=block[k],b=previous&&previous.block&&previous.block[k];io[k]={readBytesPerSecond:counterRate(c.readBytes,b&&b.readBytes),writeBytesPerSecond:counterRate(c.writeBytes,b&&b.writeBytes),busyPercent:b&&c.busyMs>=b.busyMs?counterRate(c.busyMs,b.busyMs)/10:null};});
    var paging={swapInPagesPerSecond:counterRate(vm.pswpin,previous&&previous.vm&&previous.vm.pswpin),swapOutPagesPerSecond:counterRate(vm.pswpout,previous&&previous.vm&&previous.vm.pswpout),majorFaultsPerSecond:counterRate(vm.pgmajfault,previous&&previous.vm&&previous.vm.pgmajfault),source:'/proc/vmstat',scope:'Global VM events; unavailable counters stay null. Block I/O and process faults are separate proxies.'};
    return {sample:{ts:now,bootId:boot,vm:vm,block:block,cpu:cpu,net:net,processes:byPid},data:{ts:now,bootId:boot,paging:paging,io:io,intervalSeconds:elapsed||null,cpu:{percent:(metrics.find(function(c){return c.name==='cpu';})||{}).percent,cores:metrics.filter(function(c){return c.name!=='cpu';})},memory:{totalBytes:mem.MemTotal||null,availableBytes:mem.MemAvailable===undefined?null:mem.MemAvailable,freeBytes:mem.MemFree===undefined?null:mem.MemFree,swapTotalBytes:mem.SwapTotal||null,swapFreeBytes:mem.SwapFree===undefined?null:mem.SwapFree},zram:z.length>=3?{logicalBytes:z[0],compressedBytes:z[1],physicalBytes:z[2]}:null,storage:disk,network:interfaces,uptimeSeconds:parseFloat((s.UPTIME||[]).join(' '))||null,processes:processes,processCount:processes.length}};
}
function parseUnits(text){var split=String(text||'').split('__FILES__'),units={},states={};(split[1]||'').split('\n').forEach(function(l){var m=/^\s*(\S+\.service)\s+(\S+)/.exec(l);if(m)states[m[1]]=m[2];});(split[0]||'').split('\n').forEach(function(l){var m=/^\s*[●*]?\s*(\S+\.service)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/.exec(l);if(m)units[m[1]]={name:m[1],load:m[2],active:m[3],sub:m[4],description:m[5],bootState:states[m[1]]||null};});Object.keys(states).forEach(function(k){if(!units[k])units[k]={name:k,active:'not-loaded',sub:null,description:'',bootState:states[k]};});return Object.keys(units).sort().map(function(k){return units[k];});}
function Monitor(execute){this.execute=execute;this.streams={};this.storage=null;this.storageAt=0;this.unitsAt=0;this.units=null;this.unitsPending=null;}
// Separate deltas and in-flight requests prevent summary reads from corrupting
// per-process rates. Default full preserves the existing diagnostic API.
Monitor.prototype.snapshot=function(scope,force){var self=this;scope=scope||'full';if(scope!=='full'&&scope!=='summary')return Promise.reject(Error('Unsupported monitor scope'));var stream=this.streams[scope]||(this.streams[scope]={});if(force){if(stream.pending)return stream.pending.catch(function(){}).then(function(){return self.snapshot(scope,true)});stream.cached=null;}if(stream.cached&&Date.now()-stream.cached.ts<2000)return Promise.resolve(stream.cached);if(stream.pending)return stream.pending;
var withStorage=!this.storage||Date.now()-this.storageAt>=30000,cmd=LIGHT+(scope==='full'?'; '+DETAILS:'')+(withStorage?'; '+STORAGE:'');
stream.pending=this.execute(cmd,15000).then(function(r){if(r.exit_code||r.timed_out)throw execError.failed(r,'snapshot unavailable');var result=parse(r.stdout,stream.previous,Date.now());if(!result.sample.cpu.cpu||!result.data.memory.totalBytes||(scope==='full'&&!result.data.processCount))throw execError.coded('incomplete','incomplete system snapshot');
 if(withStorage&&result.data.storage){self.storage=result.data.storage;self.storageAt=result.data.ts;}if(result.data.bootId&&self.storageBoot&&self.storageBoot!==result.data.bootId&&!withStorage){self.storage=null;self.storageAt=0;}self.storageBoot=result.data.bootId;
 result.data.storage=self.storage;result.data.storageTs=self.storage?self.storageAt:null;result.data.scope=scope;
 if(scope==='summary'){delete result.data.processes;delete result.data.processCount;}
 stream.previous=result.sample;stream.cached=result.data;return result.data;
}).finally(function(){stream.pending=null;});return stream.pending;};
Monitor.prototype.startup=function(){var self=this;if(this.units&&Date.now()-this.unitsAt<60000)return Promise.resolve(this.units);if(this.unitsPending)return this.unitsPending;this.unitsPending=this.execute(UNITS_RUNNING,15000).then(function(r){if(r.exit_code||r.timed_out)throw execError.failed(r,'service inventory unavailable');
 // Without the boot states the listing is still useful: bootState stays null (unknown) instead of the whole section failing.
 return self.execute(UNITS_FILES,60000).then(function(f){return f.exit_code||f.timed_out?'':f.stdout;},function(){return '';}).then(function(files){self.units=parseUnits(r.stdout+'\n__FILES__\n'+files);self.unitsAt=Date.now();return self.units;});
}).finally(function(){self.unitsPending=null;});return this.unitsPending;};
module.exports={Monitor:Monitor,parse:parse,processStat:processStat,parseUnits:parseUnits};
