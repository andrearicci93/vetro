'use strict';
var execError = require('./exec-error.js');
// Native controls identified on the Q80A; no arbitrary D-Bus method or key.
var INTERFACE='org.tizen.tv.avoc.AvOutputControl';
var INTROSPECT_XML='busctl --system --xml-interface introspect org.tizen.tv.avoc /org/tizen/tv/avoc '+INTERFACE+' 2>/dev/null; true';
var INTROSPECT_TABLE='busctl --system introspect org.tizen.tv.avoc /org/tizen/tv/avoc '+INTERFACE+' 2>/dev/null; true';
var PREFIX='busctl --system call org.tizen.tv.avoc /org/tizen/tv/avoc org.tizen.tv.avoc.AvOutputControl ';
var ITEMS=[
 {id:'backlight',label:'Panel brightness',group:'picture',get:'GetBacklight',args:'i 0',set:'SetBacklight',signature:'ii',min:0,max:50},
 {id:'contrast',label:'Contrast',group:'picture',get:'GetContrast',args:'i 0',set:'SetContrast',signature:'yi',min:0,max:50},
 {id:'sharpness',label:'Sharpness',group:'picture',get:'GetSharpness',args:'i 0',set:'SetSharpness',signature:'yi',min:0,max:20},
 {id:'color',label:'Color',group:'picture',get:'GetColorStrength',args:'i 0',set:'SetColorStrength',signature:'yi',min:0,max:50},
 {id:'pictureMode',label:'Picture mode',group:'picture',get:'GetPictureMode',args:'i 0',coded:true},
 {id:'colorTone',label:'Color tone',group:'picture',get:'GetColorToneMode',args:'i 0',coded:true},
 {id:'brightness',label:'Internal brightness',group:'advanced',get:'GetBrightness',args:'i 0'},
 {id:'colorSpace',label:'Color space',group:'advanced',get:'GetColorSpace',args:'i 0',coded:true},
 {id:'localDimming',label:'Local dimming',group:'advanced',get:'GetSmartLed',args:'i 0',coded:true,set:'SetSmartLed',signature:'ii',min:1,max:2},
 {id:'gameMode',label:'Game mode',group:'advanced',get:'GetGameMode',args:'i 0',coded:true},
 {id:'hdr',label:'HDR state',group:'advanced',get:'GetHdrStatus',args:'',coded:true},
 {id:'motionLighting',label:'Motion lighting',group:'advanced',get:'GetMotionLighting',args:'',coded:true},
 {id:'ecoSensor',label:'Light sensor configuration',group:'advanced',get:'GetEcoSensor',args:'i 0',coded:true},
 {id:'ecoSensorState',label:'Light sensor state',group:'advanced',get:'GetEcoSensorState',args:'',coded:true},
 {id:'minimumBacklight',label:'Minimum brightness with sensor',group:'advanced',get:'GetEcoSensorMinimalBacklight',args:'i 0'},
 {id:'filmmakerAuto',label:'Auto switch to Filmmaker',group:'advanced',get:'GetFilmmakerAutoMode',args:'',set:'SetFilmmakerAutoMode',signature:'i',min:0,max:1,boolean:true},
 {id:'motionPlus',label:'Motion Plus',group:'advanced',get:'GetAutoMotionPlus',args:'i 0',coded:true},
 {id:'blurReduction',label:'Blur reduction',group:'advanced',get:'GetBlurReduction',args:'i 0',set:'SetBlurReduction',signature:'iy',min:0,max:10,gated:true,hint:'May have no visible effect unless Motion Plus is on Custom.'},
 {id:'judderReduction',label:'Judder reduction',group:'advanced',get:'GetJuddlerReduction',args:'i 0',set:'SetJuddlerReduction',signature:'iy',min:0,max:10,gated:true,hint:'May have no visible effect unless Motion Plus is on Custom.'},
 {id:'ledClearMotion',label:'LED Clear Motion',group:'advanced',get:'GetLedClearMotion',args:'i 0',set:'SetLedClearMotion',signature:'ii',min:0,max:2,coded:true,gated:true,options:['Off','On','Auto'],hint:'Black frame insertion; lowers brightness. Auto is not offered on every model.'},
 {id:'hdmiBlackLevel',label:'HDMI black level',group:'advanced',get:'GetHdmiBlackLevel',args:'i 0',set:'SetHdmiBlackLevel',signature:'ii',min:0,max:2,coded:true,gated:true,options:['Normal','Low','Auto'],hint:'Applies to the current HDMI source.'},
 {id:'cleanView',label:'Digital Clean View',group:'advanced',get:'GetDigitalCleanView',args:'i 0',coded:true},
 {id:'dynamicContrast',label:'Contrast enhancer',group:'advanced',get:'GetDynamicContrast',args:'i 0',coded:true},
 {id:'filmMode',label:'Film processing mode',group:'advanced',get:'GetFilmMode',args:'i 0',coded:true},
 {id:'soundMode',label:'Sound mode',group:'audio',get:'GetSoundMode',args:'u 0',coded:true},
 {id:'autoVolume',label:'Auto volume',group:'audio',get:'GetAutoVolume',args:'u 0',coded:true},
 {id:'balance',label:'Audio balance',group:'audio',get:'GetBalance',args:'u 0',coded:true},
 {id:'digitalAudioFormat',label:'Digital audio output format',group:'audio',get:'GetNordigUserDigitalAudioOutputFormat',args:'',coded:true},
 {id:'earc',label:'eARC',group:'audio',get:'GetEarcEnable',args:'',coded:true}
];
function decode(text){var m=/^([iyu]{2})\s+(-?\d+)\s+(-?\d+)\s*$/.exec(String(text));if(!m)throw Error('Unrecognized setting response');if(+m[3]!==0)throw Error('Setting unavailable (code '+m[3]+')');return +m[2];}
// Preferred: busctl --xml-interface, where each <arg> carries its own type and direction.
function parseIntrospectXml(text){var methods={},n=0,body=String(text||''),block=new RegExp('<interface name="'+INTERFACE.replace(/\./g,'\\.')+'">([\\s\\S]*?)</interface>').exec(body);if(!block)return {methods:methods,count:0};
 block[1].replace(/<method name="(\w+)"\s*(?:\/>|>([\s\S]*?)<\/method>)/g,function(all,name,inner){var input='',reply='';String(inner||'').replace(/<arg\b([^>]*)\/?>/g,function(x,attrs){var type=/type="([^"]+)"/.exec(attrs),dir=/direction="(\w+)"/.exec(attrs);if(!type)return;if(dir&&dir[1]==='out')reply+=type[1];else input+=type[1];});methods[name]={input:input,reply:reply};n++;});return {methods:methods,count:n};}
// Fallback: the padded table ".SetContrast  method  yi  i  -". A shortened cell ("…") means the layout cannot be trusted.
function parseIntrospect(text){var methods={},n=0,body=String(text||'');if(/…|\.\.\.\s/.test(body))return {methods:methods,count:0};body.split('\n').forEach(function(line){var m=/^\.(\w+)\s+method\s+(\S+)\s+(\S+)/.exec(line);if(m){methods[m[1]]={input:m[2]==='-'?'':m[2],reply:m[3]==='-'?'':m[3]};n++;}});return {methods:methods,count:n};}
function inputSignature(args){return String(args||'').replace(/ \d+/g,'').replace(/ /g,'');}
// Compares an item with what this TV exposes; null when nothing was introspected.
function confirm(x,probe){if(!probe||!probe.count)return null;var g=probe.methods[x.get],s=x.set&&probe.methods[x.set];if(!g||(x.set&&!s))return 'missing';if(g.input!==inputSignature(x.args)||(x.set&&s.input!==x.signature))return 'signature-mismatch';return 'confirmed';}
function check(r){if(r.exit_code||r.timed_out)throw execError.failed(r,r.stderr||'TV read failed');return r.stdout;}
function Store(execute,options){this.tizen55=!!(options&&options.tizen55);this.execute=execute;this.busy=false;this.cached=null;this.pending=null;}
// The method list only changes with firmware, so one successful introspection is kept; a failure is retried on the next read.
Store.prototype.introspect=function(){var self=this;if(this.probe&&this.probe.count)return Promise.resolve(this.probe);
 function run(command,parse){return self.execute(command,8000).then(function(r){return r.exit_code||r.timed_out?{methods:{},count:0}:parse(r.stdout);},function(){return {methods:{},count:0};});}
 return run(INTROSPECT_XML,parseIntrospectXml).then(function(p){return p.count?p:run(INTROSPECT_TABLE,parseIntrospect);}).then(function(p){if(p.count)self.probe=p;return p;});};
Store.prototype.read=function(){var self=this;if(this.cached&&Date.now()-this.cached.ts<2000)return Promise.resolve(this.cached);if(this.pending)return this.pending;
 var cmd=ITEMS.map(function(x){return 'echo __'+x.id+'__; '+PREFIX+x.get+' '+x.args;}).join('; ');
 this.pending=Promise.all([this.execute(cmd,15000),this.introspect()]).then(function(both){var r=both[0],probe=both[1],output=check(r),rows=ITEMS.map(function(x){var state=confirm(x,probe),passive=x.id==='hdr'||x.id==='ecoSensorState',row={id:x.id,label:x.label,group:x.group,writable:!!x.set,coded:!!x.coded,boolean:!!x.boolean,options:x.options||null,hint:x.hint||null,probe:state,access:x.set?(x.gated?'firmware':'verified'):passive?'state':'unverified',readOnlyReason:x.set?null:passive?'State reported by the TV':x.coded?'Options and writes have not been tested':'Write and restore have not been tested',min:x.min,max:x.max,value:null,error:null};
 if(x.set&&(x.gated?state!=='confirmed':state==='signature-mismatch')){row.writable=false;row.readOnlyReason=state==='missing'?'This TV does not offer this control':state==='signature-mismatch'?'This TV exposes the control differently; writes are off':'Control support could not be checked; writes are off';}
 if(self.tizen55&&['localDimming','blurReduction','judderReduction','ledClearMotion'].indexOf(x.id)>=0){row.writable=false;row.readOnlyReason='Write and restore need device verification on the Q74T; the last hardware test was rejected.';row.access='unverified';}
 var section=output.split('__'+x.id+'__\n')[1];try{row.value=decode((section||'').split('__')[0].trim());}catch(e){row.error=e.message;row.writable=false;}return row;});self.confirmed={};rows.forEach(function(r){if(r.probe==='confirmed')self.confirmed[r.id]=true;});self.cached={ts:Date.now(),items:rows,api:{status:probe.count?'ok':'unavailable',methods:probe.count},scope:'Values apply to the current source and may change with apps or HDR.'};return self.cached;}).finally(function(){self.pending=null;});return this.pending;
};
Store.prototype.write=function(p){var self=this,x=ITEMS.find(function(x){return x.id===p.id});if(!x||!x.set)return Promise.reject(Error('Setting is read-only'));if(this.tizen55&&['localDimming','blurReduction','judderReduction','ledClearMotion'].indexOf(x.id)>=0)return Promise.reject(Error('This Q74T control needs hardware verification; writes are off'));if(x.gated&&!(this.confirmed&&this.confirmed[x.id]))return Promise.reject(Error('This TV has not confirmed this control; refresh the settings first'));
 if(!Number.isInteger(p.value)||p.value<x.min||p.value>x.max||!Number.isInteger(p.expected))return Promise.reject(Error('Invalid value'));
 if(this.busy)return Promise.reject(Error('Change already in progress'));this.busy=true;
 function get(){return self.execute(PREFIX+x.get+' '+x.args,5000).then(function(r){return decode(check(r));});}
 function set(v){return self.execute(PREFIX+x.set+' '+x.signature+' '+v+(x.signature.length>1?' 0':''),5000).then(function(r){if(!/^i 0\s*$/.test(check(r)))throw Error('TV rejected the change');});}
 return get().then(function(before){if(before!==p.expected)throw Error('TV value changed; refresh before saving');return set(p.value).then(get).then(function(after){if(after!==p.value)throw Error('Readback does not match');return {ok:true,verified:true,id:x.id,previous:before,value:after};}).catch(function(e){return get().then(function(current){return current===before?current:set(before).then(get);}).then(function(restored){e.message+=' · restore '+(restored===before?'confirmed':'not confirmed');throw e;},function(){throw Error(e.message+' · restore not confirmed');});});}).finally(function(){self.cached=null;self.busy=false;});
};
function unwrap(v){if(v&&typeof v==='object'&&Object.prototype.hasOwnProperty.call(v,'type')&&Object.prototype.hasOwnProperty.call(v,'data'))return unwrap(v.data);if(Array.isArray(v))return v.map(unwrap);if(v&&typeof v==='object'){var o={};Object.keys(v).forEach(function(k){o[k]=unwrap(v[k]);});return o;}return v;}
// systemd 231 has no busctl JSON output. Decode its typed, counted values.
function connmanText(text) {
 var tokens=String(text).match(/"(?:\\.|[^"\\])*"|\S+/g)||[],at=0;
 function next(){if(at>=tokens.length)throw Error('Truncated D-Bus reply');var t=tokens[at++];return t[0]==='"'?JSON.parse(t):t;}
 function count(){var n=Number(next());if(!Number.isInteger(n)||n<0||n>10000)throw Error('Invalid D-Bus count');return n;}
 function value(type){var n,i,o;if(type==='a{sv}'){o={};n=count();for(i=0;i<n;i++){var k=next();o[k]=value(next());}return o;}if(type==='as'||type==='ao'){o=[];n=count();for(i=0;i<n;i++)o.push(next());return o;}if(type==='s'||type==='o')return next();if(type==='b')return next()==='true';if(/^[yqiuxtn]$/.test(type))return Number(next());throw Error('Unsupported D-Bus type');}
 if(next()!=='a(oa{sv})')throw Error('Unexpected ConnMan reply');var out=[],n=count();for(var i=0;i<n;i++)out.push([next(),value('a{sv}')]);return {data:out};
}
function networkDecode(output){
 var parts=String(output).split(/__(LINKS|ADDR|ROUTES|ROUTES6)__\n/),sections={connman:parts[0]};for(var i=1;i<parts.length;i+=2)sections[parts[i]]=parts[i+1];
 var services=[],serviceError=null;try{var raw;try{raw=JSON.parse(sections.connman.trim());}catch(jsonError){raw=connmanText(sections.connman.trim());}services=unwrap(raw).data;/* outer tuple contains the services array */if(!services)services=unwrap(raw);if(services.length===1&&Array.isArray(services[0])&&Array.isArray(services[0][0]))services=services[0];services=services.map(function(pair){var p=pair[1],eth=p.Ethernet||{};return {name:p.Name||eth.Interface||p.Type,type:p.Type,state:p.State,interface:eth.Interface,mac:eth.Address,mtu:eth.MTU,autoConnect:p.AutoConnect,ipv4:p.IPv4||{},ipv4Configured:p['IPv4.Configuration']||{},ipv6:p.IPv6||{},ipv6Configured:p['IPv6.Configuration']||{},nameservers:p.Nameservers||[],nameserversConfigured:p['Nameservers.Configuration']||[],proxy:p.Proxy||{},mdns:p.mDNS,signal:p.Strength==null?null:p.Strength,security:p.Security||[]};});}catch(e){serviceError='ConnMan configuration unavailable';}
 var interfaces=[];String(sections.LINKS||'').split('\n').forEach(function(line){var m=/^\d+: ([^:@]+)(?:@[^:]+)?:.*?mtu (\d+).*?state (\S+)/.exec(line);if(!m||m[1]==='lo')return;var mac=/link\/ether ([0-9a-f:]+)/i.exec(line);interfaces.push({name:m[1],state:m[3],mtu:+m[2],mac:mac?mac[1]:null,addresses:[]});});
 String(sections.ADDR||'').split('\n').forEach(function(line){var m=/^\d+: (\S+)\s+(inet6?) (\S+).*?scope (\S+)/.exec(line);if(!m)return;var item=interfaces.find(function(x){return x.name===m[1]});if(item)item.addresses.push({family:m[2]==='inet'?'IPv4':'IPv6',address:m[3],scope:m[4]});});
 function routes(text){return String(text||'').split('\n').filter(function(l){return /^default /.test(l)}).map(function(l){var dev=/\bdev (\S+)/.exec(l),via=/\bvia (\S+)/.exec(l);return {interface:dev?dev[1]:null,gateway:via?via[1]:null};});}
 var defaults=routes(sections.ROUTES),defaults6=routes(sections.ROUTES6),active=services.find(function(x){return defaults.some(function(r){return r.interface===x.interface})})||services.find(function(x){return x.state==='online'||x.state==='ready'})||null;
 return {source:'ConnMan + kernel interfaces and routes',services:services,interfaces:interfaces,active:active,defaultRoutes:defaults,defaultRoutes6:defaults6,configurationError:serviceError,writable:false,writeReason:'Network writes and connection recovery have not been tested'};
}
Store.prototype.readNetwork=function(){if(this.networkPending)return this.networkPending;var self=this;this.networkPending=this.execute('busctl --system --json=short call net.connman / net.connman.Manager GetServices 2>/dev/null || busctl --system call net.connman / net.connman.Manager GetServices; echo __LINKS__; ip -o link; echo __ADDR__; ip -o addr; echo __ROUTES__; ip route; echo __ROUTES6__; ip -6 route',10000).then(function(r){return networkDecode(check(r));}).finally(function(){self.networkPending=null;});return this.networkPending;};

module.exports={Store:Store,ITEMS:ITEMS,decode:decode,parseIntrospect:parseIntrospect,parseIntrospectXml:parseIntrospectXml,networkDecode:networkDecode};
