'use strict';
// Local authenticated evdev bridge. The optional integration supplies the native
// helper; this feature never acquires privileges or uses the LAN remote API.
var net = require('net'), crypto = require('crypto'), path = require('path');
// Regular expressions compiled once at module load, not on every call.
var QUOTE_RE = /'/g;
var BLANK_LINE_RE = /\n\s*\n/;
var DEVICE_NAME_RE = /^N: Name="(.*)"$/m;
var DEVICE_HANDLERS_RE = /^H: Handlers=(.*)$/m;
var EVENT_NODE_RE = /\bevent\d+\b/;
var REMOTE_NAME_RE = /smart control|rc device|mcirb/i;
var NOT_REMOTE_NAME_RE = /keyboard|mouse|panel/i;
// Marks Vetro's own forwarding device; must match ForwardedPhys in rooting/payload/SamsungTvRemoteInputAgent.cs.
var FORWARDED_PHYS = 'vetro-forwarded-remote';
var DEVICE_PHYS_RE = /^P: Phys=(.*)$/m;
var DEVICE_EV_RE = /^B: EV=([0-9a-f]+)$/mi;
var DEVICE_KEY_RE = /^B: KEY=(.*)$/m;
var NON_ZERO_HEX_RE = /[1-9a-f]/i;
var KEY_CODE_RE = /^\d{1,3}$/;
var MAC_HEX_RE = /^[a-f0-9]{64}$/;
var EVENT_PATH_RE = /^\/dev\/input\/event\d+$/;
var INPUT_UNIT = 'vetro-input';
function normalizeExclude(list) {
    var out = [];
    if (!Array.isArray(list)) return out;
    list.forEach(function (name) {
        if (typeof name === 'string' && name.length > 0 && out.indexOf(name) < 0) out.push(name);
    });
    return out;
}
function quote(s) { return "'" + String(s).replace(QUOTE_RE, "'\\''") + "'"; }
function blockHasKeys(block) {
    var key = DEVICE_KEY_RE.exec(block);
    if (key) return NON_ZERO_HEX_RE.test(key[1]);
    var ev = DEVICE_EV_RE.exec(block);
    if (ev) return (parseInt(ev[1].slice(-8), 16) & 2) !== 0;
    return true;
}
function devices(text) {
    return String(text).split(BLANK_LINE_RE).map(function (block) {
        var n = DEVICE_NAME_RE.exec(block), h = DEVICE_HANDLERS_RE.exec(block);
        var node = h && EVENT_NODE_RE.exec(h[1]);
        var phys = DEVICE_PHYS_RE.exec(block);
        if (phys && phys[1] === FORWARDED_PHYS) {
            return null;
        }
        return n && node ? {
            name: n[1],
            node: '/dev/input/' + node[0],
            selectable: REMOTE_NAME_RE.test(n[1]) && !NOT_REMOTE_NAME_RE.test(n[1]) && blockHasKeys(block)
        } : null;
    }).filter(Boolean).map(function (d, i, all) {
        d.unique = all.filter(function (x) {return (d.selectable ? x.selectable : true) && x.name === d.name;}).length === 1;
        return d;
    });
}
// hooks (optional): onConnect(status) once a helper is connected and holds the remote (the forwarding node now exists), and
// onStop(lost) whenever the bridge stops for any reason (asked, the helper disconnected, a bad frame), so a key that was held
// down at that moment never keeps acting (the volume repeat waits for a release that will not come). lost is null when the stop
// was asked for, else {reason, connected}: the error that ended it and whether a helper was holding the remote at that moment.
function Bridge(execute, onEvent, hooks) {
    this.execute = execute; this.onEvent = onEvent; this.current = {mode:'off',connected:false};
    this.events = []; this.server = null; this.socket = null; this.generation = 0; this.startSeq = 0; this.lastError=null; this.cancel=null;
    this.hooks = hooks || {};
}
function callHook(fn, arg){if(typeof fn==='function'){try{fn(arg);}catch(e){}}}
Bridge.prototype.inventory = function () {
    return this.execute('cat /proc/bus/input/devices',10000).then(function(r){
        if (!r || r.exit_code || r.timed_out) throw new Error('input inventory unavailable');
        return devices(r.stdout);
    });
};
Bridge.prototype.status = function () {return {policy:this.current,events:this.events.slice(-30),error:this.lastError};};
Bridge.prototype.stop = function (reason) {
    ++this.generation; ++this.startSeq;
    var cancel=this.cancel, socket=this.socket, server=this.server, connected=!!this.current.connected;
    this.cancel=null; this.socket=null; this.server=null;
    this.current = {mode:'off',connected:false};
    if(cancel)cancel();
    if(socket)socket.destroy();
    if(server)server.close();
    callHook(this.hooks.onStop,reason?{reason:reason,connected:connected}:null);
};
// list (optional): the device list the caller has just read (restoreInput, Vetro UI), so it is not read a second time.
Bridge.prototype.start = function (device, mode, tokens, list, options) {
    var self=this;
    if (mode==='off') {self.stop(); return Promise.resolve(self.status());}
    if (mode!=='observe' && mode!=='filter' && mode!=='capture') return Promise.reject(new Error('invalid input mode'));
    if (!Array.isArray(tokens) || tokens.some(function(t){return !KEY_CODE_RE.test(t) || +t>767;})) return Promise.reject(new Error('invalid input codes'));
    if (mode==='filter' && !tokens.length) return Promise.reject(new Error('save a physical rule before enabling interception'));
    var reqSeq=++self.startSeq, requestGeneration=self.generation, allMode=device==='all', exclude=allMode?normalizeExclude(options&&options.exclude):[];
    return (Array.isArray(list) ? Promise.resolve(list) : self.inventory()).then(function(list){
        if(reqSeq!==self.startSeq||requestGeneration!==self.generation)throw new Error('input request cancelled');
        var selected;
        if (allMode) {
            var selectable=list.filter(function(d){return d.selectable && exclude.indexOf(d.name)<0;});
            if (!selectable.length) throw new Error('no physical remote devices found');
            selected={name:'all',node:'all',all:true,exclude:exclude,devices:selectable.map(function(d){return {name:d.name,node:d.node};})};
        } else {
            selected=list.find(function(d){return (d.node===device || d.unique && d.name===device) && d.selectable;});
            if (!selected) throw new Error('select a unique physical remote device');
        }
        self.stop(); self.events=[]; self.lastError=null; var generation=self.generation, secret=crypto.randomBytes(32), nonce=crypto.randomBytes(32), seq=0, authenticated=false;
        self.current={mode:mode,device:selected.name,node:selected.node,connected:false,blocked:mode==='filter'?tokens:[]};
        if (allMode) {
            self.current.devices=selected.devices;
            if (exclude.length) self.current.exclude=exclude;
        }
        return new Promise(function(resolve,reject){
            var settled=false, timer, server, connection=null;
            function active(){return generation===self.generation && self.server===server;}
            function fail(e){if(generation!==self.generation)return; self.lastError=e.message;if(!settled){settled=true;clearTimeout(timer);reject(e);}self.stop(e.message);}
            self.cancel=function(){if(!settled){settled=true;clearTimeout(timer);reject(new Error('input request cancelled'));}};
            timer=setTimeout(function(){fail(new Error('native input helper did not connect'));},12000);
            server=net.createServer(function(socket){
                if(!active()||connection){socket.destroy();return;} connection=socket;self.socket=socket;var buffer='';
                socket.write('SAMSUNG-TV-REMOTE/1\t'+nonce.toString('hex')+'\n');
                socket.on('error',function(e){fail(e);});
                socket.on('close',function(){fail(new Error('input helper disconnected; original keys released'));});
                socket.on('data',function(chunk){
                    if(!active()||self.socket!==socket){socket.destroy();return;}
                    buffer+=chunk.toString('utf8'); if(Buffer.byteLength(buffer)>65536){fail(new Error('oversized input frame'));return;}
                    var split;
                    while((split=buffer.indexOf('\n'))>=0){
                        if(!active()||self.socket!==socket){socket.destroy();return;}
                        var line=buffer.slice(0,split);buffer=buffer.slice(split+1);var last=line.lastIndexOf('\t');
                        if(last<0){fail(new Error('invalid input authentication'));return;}
                        var payload=line.slice(0,last), mac=line.slice(last+1);
                        var expected=crypto.createHmac('sha256',secret).update(nonce).update(Buffer.from([0])).update(payload).digest();
                        if(!MAC_HEX_RE.test(mac)||!crypto.timingSafeEqual(expected,Buffer.from(mac,'hex'))){fail(new Error('invalid input authentication'));return;}
                        var fields=payload.split('\t');
                        if(!authenticated){
                            if(fields.length!==9||fields[0]!=='AUTH'||fields[2]!=='0'||fields[3]!=='0'||Buffer.from(fields[4],'base64').toString()!==selected.name||Buffer.from(fields[5],'base64').toString()!==selected.node||fields[8]!==mode){fail(new Error('unexpected input helper identity'));return;}
                            authenticated=true;self.current.connected=true;clearTimeout(timer);settled=true;resolve(self.status());
                            callHook(self.hooks.onConnect,self.status());
                        }else{
                            try{
                                if(fields.length!==3||fields[0]!=='EVENT'||+fields[1]!==seq+1)throw new Error('invalid input sequence');
                                var event=JSON.parse(Buffer.from(fields[2],'base64').toString());
                                var nodeOk=allMode?(typeof event.node==='string'&&EVENT_PATH_RE.test(event.node)&&typeof event.device==='string'&&event.device.length>0):(event.node===selected.node&&event.device===selected.name);
                                if(event.type!==1||!Number.isInteger(event.code)||event.code<0||event.code>767||!nodeOk||event.sequence!==+fields[1])throw new Error('invalid input event');
                                seq=+fields[1];self.events.push(event);if(self.events.length>30)self.events.shift();
                                self.onEvent(event);
                            }catch(e){fail(e);return;}
                        }
                    }
                });
            });
            self.server=server;
            server.on('error',fail);
            server.listen(0,'127.0.0.1',function(){
                if(!active()){server.close(function(){});return;}
                var address=server.address();
                if(!address){fail(new Error('input listener closed before launch'));return;}
                var token='/tmp/vetro-input-'+crypto.randomBytes(12).toString('hex')+'.token';
                var helper=path.join(__dirname,'..','payload','SamsungTvRemoteInputAgent.dll');
                var deviceArg=allMode?(exclude.length?'*!'+exclude.map(function(n){return Buffer.from(n).toString('base64');}).join(','):'*'):(selected.name+'@'+selected.node);
                var args=['127.0.0.1',String(address.port),token,deviceArg,'evdev','TV',mode,mode==='filter'?tokens.join(','):''];
                var isolated=(mode==='filter'||mode==='capture'||allMode);
                // A filter helper still running from an earlier start (another service run, a bridge that was never told to stop) keeps the
                // remote grabbed: every new helper then fails EVIOCGRAB with EBUSY and the interception never connects (S95B on 1720.7,
                // static analysis 2026-11-19). Before a filter/capture/multi-remote start any previous unit/helper is stopped; legacy single observers are left alone.
                var unitStop=isolated?'systemctl stop --no-block '+INPUT_UNIT+'.service >/dev/null 2>&1; i=0; while [ $i -lt 30 ]; do case "$(systemctl is-active '+INPUT_UNIT+'.service 2>/dev/null)" in active|activating|deactivating|reloading) sleep 0.1; i=$((i+1)) ;; *) break ;; esac; done; systemctl reset-failed '+INPUT_UNIT+'.service >/dev/null 2>&1; ':'';
                var stale=isolated?'for d in /proc/[0-9]*; do c=; read -r c < "$d/cmdline" 2>/dev/null; case "$c" in /usr/bin/dotnet*) case "$(tr \'\\0\' \' \' < "$d/cmdline" 2>/dev/null)" in *SamsungTvRemoteInputAgent.dll*) kill -9 "${d#/proc/}" 2>/dev/null;; esac;; esac; done; ':'';
                // Running in its own transient systemd unit (like dock and tuner) keeps the bridge alive across standby instead of dying with sdbd.
                var runArgs=quote(helper)+' '+args.map(quote).join(' ');
                var launch=isolated?('systemd-run --unit='+INPUT_UNIT+' --collect -p KillSignal=SIGKILL -p StandardOutput=null -p StandardError=null /bin/sh -c '+quote('exec /usr/bin/dotnet "$@" </dev/null >/tmp/vetro-input.log 2>&1')+' '+INPUT_UNIT+' '+runArgs+' >/dev/null 2>&1 || { nohup /usr/bin/dotnet '+runArgs+' </dev/null >/tmp/vetro-input.log 2>&1 & }'):('nohup /usr/bin/dotnet '+runArgs+' </dev/null >/tmp/vetro-input.log 2>&1 &');
                // The last helper's words are kept one start longer (vetro-input.prev.log): a helper that ended on its own (the remote went
                // away, an exception) is followed within seconds by a new start, whose log would otherwise replace them.
                var command=unitStop+stale+'umask 077; rm -f /tmp/vetro-input-*.token; mv -f /tmp/vetro-input.log /tmp/vetro-input.prev.log 2>/dev/null; printf %s '+quote(secret.toString('base64'))+' > '+quote(token)+'; '+launch;
                self.execute(command,8000,active).then(function(r){if(!r||r.exit_code||r.timed_out)fail(new Error('input helper launch failed'));}).catch(fail);
            });
        });
    });
};
module.exports={Bridge:Bridge,devices:devices};
