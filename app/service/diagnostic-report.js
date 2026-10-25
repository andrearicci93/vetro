'use strict';
// Export a new allowlisted object. Never serialize raw endpoint responses,
// command output, settings strings, MQTT messages, or user action history.
var settings = require('./tv-settings.js').ITEMS;
var buildInfo = require('./build-info.js');
var execError = require('./exec-error.js');
function token(v) {
    if (typeof v !== 'string' || v.length > 180 || !/^[A-Za-z0-9_./ -]+$/.test(v)) return null;
    if (/(?:\d{1,3}\.){3}\d{1,3}|(?:[a-f0-9]{2}[:-]){5}[a-f0-9]{2}|https?:|\/home\/|\/opt\/usr\/|\/Users\//i.test(v)) return null;
    return v;
}
// Menu ids come from the firmware (for example 'anynet+(hdmicec)'); only the
// address and URL patterns are refused, as in token().
function menuId(v) {
    if (typeof v !== 'string' || v.length > 180 || !/^[A-Za-z0-9_./+() -]+$/.test(v)) return null;
    return token(v.replace(/[+()]/g, '')) === null ? null : v;
}
function failure(e) {
    var out = {reason: 'error'};
    if (e && typeof e.code === 'string' && execError.CODES.indexOf(e.code) >= 0) out.reason = e.code;
    if (e && Number.isInteger(e.exitCode) && e.exitCode >= 0 && e.exitCode <= 255) out.exitCode = e.exitCode;
    return out;
}
// Relative and rounded: how stale a widget-posted value is, not when the user was active.
function ageMinutes(receivedAt) {
    var seconds = Math.floor(Date.now() / 1000) - numeric(receivedAt);
    return numeric(receivedAt) === null || seconds < -60 ? null : Math.max(0, Math.round(seconds / 60));
}
function numeric(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }
function boolean(v) { return typeof v === 'boolean' ? v : null; }
function numbers(o, keys) { var out={}; keys.forEach(function(k){out[k]=numeric((o||{})[k]);});return out; }
function flags(o, keys) { var out={}; keys.forEach(function(k){out[k]=boolean((o||{})[k]);});return out; }
function list(v, limit) { return Array.isArray(v) ? v.slice(0,limit||5000) : []; }
function dependencies(v) { return Array.isArray(v)?list(v).map(function(d){return {packageId:token(d.packageId),type:token(d.type),version:token(d.version)};}):null; }
var projectors = {
    platform:function(d){return {mode:token(d.mode),running:boolean(d.running),prepared:boolean(d.prepared),rootAgent:{connected:boolean((d.agent||{}).connected),uid:numeric((d.agent||{}).uid)},runtime:token((d.self||{}).node),persistence:'unknown',backgroundExecution:'unknown'};},
    device:function(d){var out={};['model','realModel','modelCode','firmware'].forEach(function(k){out[k]=token((d||{})[k]);});out.source='widget-probe';out.probeAgeMinutes=ageMinutes((d||{}).receivedAt);return out;},
    inventory:function(d){return {source:token(d.source),registryAvailable:!d.registryError,apps:list(d.apps).map(function(a){return Object.assign({appId:token(a.appId),packageId:token(a.packageId),version:token(a.version),type:token(a.type),component:token(a.component),category:token(a.category),origin:token(a.origin),size:numeric(a.size),dependencies:dependencies(a.dependencies),dependents:dependencies(a.dependents)},flags(a,['disabled','onboot','autorestart','show','system','removable','protected']));})};},
    settings:function(d){return {items:list(d.items).filter(function(x){return settings.some(function(s){return s.id===x.id;});}).map(function(x){return {id:x.id,value:typeof x.value==='boolean'?x.value:numeric(x.value),writable:boolean(x.writable),access:x.access==='verified'?'implemented':token(x.access),probe:token(x.probe),available:!x.error};}),api:d.api&&typeof d.api==='object'?{status:token(d.api.status),methods:numeric(d.api.methods)}:null};},
    catalog:function(d){return {items:list(d.items,1500).map(function(x){return Object.assign({id:menuId(x.id),group:token(x.group),vconfKey:token(x.vconfKey),type:token(x.type),provider:token(x.provider),capability:token(x.capability),readStatus:token(x.readStatus)},flags(x,['readable','writableVerified','danger']));})};},
    monitor:function(d){return {intervalSeconds:numeric(d.intervalSeconds),cpu:{percent:numeric((d.cpu||{}).percent),cores:list((d.cpu||{}).cores,256).map(function(x){return {name:token(x.name),percent:numeric(x.percent)};})},memory:numbers(d.memory,['totalBytes','availableBytes','freeBytes','swapTotalBytes','swapFreeBytes']),zram:numbers(d.zram,['logicalBytes','compressedBytes','physicalBytes']),telemetry:numbers(d.telemetry,['cpu_freq_khz','cpu_cores','soctemp_c']),storage:numbers(d.storage,['totalBytes','availableBytes','usedBytes','usedPercent']),paging:numbers(d.paging,['swapInPagesPerSecond','swapOutPagesPerSecond','majorFaultsPerSecond']),kernelThreadCount:list(d.processes).filter(function(p){return p.kernel===true;}).length,processes:list(d.processes).filter(function(p){return p.kernel!==true;}).map(function(p){return Object.assign({name:token(p.name),appId:token(p.appId),state:token(p.state)},numbers(p,['cpuPercent','rssBytes','virtualBytes','threads','majorFaultsPerSecond','minorFaultsPerSecond']));})};},
    startup:function(d){return {services:list(d).map(function(x){return {name:token(x.name),load:token(x.load),active:token(x.active),sub:token(x.sub),bootState:token(x.bootState)};})};},
    network:function(d){return {available:!d.configurationError,services:list(d.services,64).filter(function(s){return s.state!=='idle';}).map(function(s){return {type:token(s.type),state:token(s.state),autoConnect:boolean(s.autoConnect),ipv4Method:token((s.ipv4||{}).Method),ipv6Method:token((s.ipv6||{}).Method),customDnsConfigured:Array.isArray(s.nameserversConfigured)?s.nameserversConfigured.some(function(v){return /^(?:\d|[a-f0-9]*:)/i.test(v);}):null};})};},
    dns:function(d){return {enabled:boolean(d.enabled),applied:boolean(d.applied),domainCount:Array.isArray(d.domains)?d.domains.length:null};},
    mqtt:function(d){return Object.assign({state:['connected','connecting','disconnected','disabled','error'].indexOf(d.state)>=0?d.state:'unknown',hasError:!!d.lastError},flags(d,['connected']),numbers(d,['sent','received']));},
    privacy:function(d){return {doNotTrack:numeric(d.doNotTrack),acr:numbers(d.acr,['recognitionStatus','reset']),hbbtv:Object.assign(numbers(d.hbbtv,['dataService']),flags(d.hbbtv,['off','appRunning'])),tvPlusConsent:boolean(d.tvPlusConsent),agreementsAvailable:boolean(d.agreementsAvailable)};},
    hbbtv:function(d){return Object.assign({value:numeric(d.value)},flags(d,['off','canRestore']));},
    // Launcher: states and counts only. The error text, the log tail and the app list (names of installed apps) stay out.
    launcher:function(d){return Object.assign({entryCount:Array.isArray(d.entries)?d.entries.length:null,inputCount:Array.isArray(d.inputs)?d.inputs.length:null,
        appCount:numeric((d.apps||{}).count),skippedCount:Array.isArray((d.apps||{}).skipped)?d.apps.skipped.length:null,failures:numeric(d.failures),hasError:boolean(d.hasError),
        tizenTubeTile:Array.isArray(d.entries)?d.entries.some(function(e){return /tizentube/i.test(String(e.appId));}):null},
        flags(d,['installed','enabled','running','samsungHome','busy','fixTizenTube','autorunSwitchedOff']));},
    quickWins:function(d){var w=d.wins||{},out={};['firmware','multiscreen','ambient'].forEach(function(k){out[k]=Object.assign({status:['on','off','partial','unknown'].indexOf((w[k]||{}).status)>=0?w[k].status:null},flags(w[k],['running','chosen']));});return out;},
    probe:function(d){var out={source:'widget-probe',probeAgeMinutes:ageMinutes(d.receivedAt)};['tizenObject','webapisObject','supportedKeys','apps','packages','productinfo','systeminfoBattery','remoteApi8001','serviceReach'].forEach(function(k){var p=(d.probe||{})[k];out[k]={available:p?boolean(p.ok):null};if(p&&k==='supportedKeys')out[k].keys=list(p.value,256).map(token).filter(Boolean);if(p&&(k==='tizenObject'||k==='webapisObject'))out[k].present=boolean(p.value);});return out;},
    serviceApis:function(d){return flags(d,['tizenObject','webapisObject','application','package','tvinputdevice','systeminfo']);}
};
// The startup listing needs about 13-17 s of systemctl work on a Q80A and more on slower TVs.
var SLOW = {startup: 4};
function collect(readers, timeoutMs) {
    return Promise.all(Object.keys(projectors).map(function(name){
        if(typeof readers[name]!=='function')return {name:name,status:'unavailable',reason:'no-reader'};
        return new Promise(function(resolve){var done=false,timer=setTimeout(function(){finish({name:name,status:'timeout',reason:'report-deadline'});},(timeoutMs||20000)*(SLOW[name]||1));
            function finish(v){if(done)return;done=true;clearTimeout(timer);resolve(v);}
            function fail(e){var f=failure(e);finish({name:name,status:'unavailable',reason:f.reason,exitCode:f.exitCode});}
            Promise.resolve().then(readers[name]).then(function(d){if(!d||d.error)throw Error('unavailable');finish({name:name,status:'ok',data:projectors[name](d)});},fail).catch(fail);
        });
    })).then(function(results){var sections={};results.forEach(function(r){sections[r.name]={status:r.status};if(r.reason)sections[r.name].reason=r.reason;if(r.exitCode!==undefined)sections[r.name].exitCode=r.exitCode;if(r.data)sections[r.name].data=r.data;});return {format:'vetro-diagnostics',schemaVersion:1,appVersion:buildInfo.version,sourceRevision:buildInfo.sourceRevision,sourceDirty:boolean(buildInfo.sourceDirty),privacy:{policy:'allowlist-v1',excluded:['credentials','network addresses','serial numbers','device identity','hostnames','user names','custom display names','URLs','MQTT topics and payloads','command lines','raw logs and errors','viewing history','action history'],note:'Installed package IDs and current process names are included. This is a technical snapshot, not a record of watched content.'},limitations:['One snapshot; not a performance benchmark. CPU rates come from two samples taken a moment apart and may be unavailable.','Catalog entries describe firmware capabilities, not confirmed working controls.','Dependencies are declared registry links only.','Model, firmware and API probes are reported by the Vetro widget and may be out of date; see probeAgeMinutes.','Settings marked implemented have a write path in Vetro; they were not written during this export or tested on this TV.'],sections:sections};});
}
// CPU and fault rates need two samples. The second only runs while the report
// deadline still has room, so a slow TV returns the first, rate-less sample
// instead of timing the whole section out.
function twoSamples(snapshot, gapMs, totalMs) {
    var started = Date.now();
    return snapshot(false).then(function(first){
        var budget = totalMs - (Date.now() - started) - gapMs;
        if (budget < 3000) return first;
        return new Promise(function(resolve){
            var finished = false, timer = null;
            function finish(v){if(finished)return;finished=true;clearTimeout(timer);resolve(v);}
            setTimeout(function(){snapshot(true).then(finish,function(){finish(first);});},gapMs);
            timer = setTimeout(function(){finish(first);}, gapMs + budget);
        });
    });
}
module.exports={collect:collect,projectors:projectors,twoSamples:twoSamples};
