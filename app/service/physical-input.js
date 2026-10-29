'use strict';
// Local authenticated evdev bridge. The optional integration supplies the native
// helper; this feature never acquires privileges or uses the LAN remote API.
var net = require('net'), crypto = require('crypto'), path = require('path');
// Marks Vetro's own forwarding device; must match ForwardedPhys in rooting/payload/SamsungTvRemoteInputAgent.cs.
var FORWARDED_PHYS = 'vetro-forwarded-remote';
function quote(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
function devices(text) {
    return String(text).split(/\n\s*\n/).map(function (block) {
        var n = /^N: Name="(.*)"$/m.exec(block), h = /^H: Handlers=(.*)$/m.exec(block);
        var node = h && /\bevent\d+\b/.exec(h[1]);
        var phys = /^P: Phys=(.*)$/m.exec(block);
        if (phys && phys[1] === FORWARDED_PHYS) {
            return null;
        }
        return n && node ? {name:n[1], node:'/dev/input/' + node[0]} : null;
    }).filter(Boolean).map(function (d, i, all) {
        d.unique = all.filter(function (x) {return x.name === d.name;}).length === 1;
        d.selectable = /smart control|rc device|mcirb/i.test(d.name) && !/keyboard|mouse|panel/i.test(d.name);
        return d;
    });
}
function Bridge(execute, onEvent) {
    this.execute = execute; this.onEvent = onEvent; this.current = {mode:'off',connected:false};
    this.events = []; this.server = null; this.socket = null; this.generation = 0; this.lastError=null; this.cancel=null;
}
Bridge.prototype.inventory = function () {
    return this.execute('cat /proc/bus/input/devices',10000).then(function(r){
        if (r.exit_code || r.timed_out) throw new Error('input inventory unavailable');
        return devices(r.stdout);
    });
};
Bridge.prototype.status = function () {return {policy:this.current,events:this.events.slice(-30),error:this.lastError};};
Bridge.prototype.stop = function () {
    ++this.generation;
    if(this.cancel){var cancel=this.cancel;this.cancel=null;cancel();}
    if (this.socket) this.socket.destroy(); this.socket = null;
    if (this.server) this.server.close(); this.server = null;
    this.current = {mode:'off',connected:false};
};
Bridge.prototype.start = function (device, mode, tokens) {
    var self=this;
    if (mode==='off') {self.stop(); return Promise.resolve(self.status());}
    if (mode!=='observe' && mode!=='filter') return Promise.reject(new Error('invalid input mode'));
    if (!Array.isArray(tokens) || tokens.some(function(t){return !/^\d{1,3}$/.test(t) || +t>767;})) return Promise.reject(new Error('invalid input codes'));
    if (mode==='filter' && !tokens.length) return Promise.reject(new Error('save a physical rule before enabling interception'));
    var requestGeneration=self.generation;
    return self.inventory().then(function(list){
        if(requestGeneration!==self.generation)throw new Error('input request cancelled');
        var selected=list.find(function(d){return (d.node===device || d.unique && d.name===device) && d.selectable;});
        if (!selected) throw new Error('select a unique physical remote device');
        self.stop(); self.events=[]; self.lastError=null; var generation=self.generation, secret=crypto.randomBytes(32), nonce=crypto.randomBytes(32), seq=0, authenticated=false;
        self.current={mode:mode,device:selected.name,node:selected.node,connected:false,blocked:mode==='filter'?tokens:[]};
        return new Promise(function(resolve,reject){
            var settled=false, timer;
            function fail(e){if(generation!==self.generation)return; self.lastError=e.message;if(!settled){settled=true;clearTimeout(timer);reject(e);}self.stop();}
            self.cancel=function(){if(!settled){settled=true;clearTimeout(timer);reject(new Error('input request cancelled'));}};
            timer=setTimeout(function(){fail(new Error('native input helper did not connect'));},12000);
            self.server=net.createServer(function(socket){
                if(self.socket){socket.destroy();return;} self.socket=socket;var buffer='';
                socket.write('SAMSUNG-TV-REMOTE/1\t'+nonce.toString('hex')+'\n');
                socket.on('error',function(e){fail(e);});
                socket.on('close',function(){fail(new Error('input helper disconnected; original keys released'));});
                socket.on('data',function(chunk){
                    buffer+=chunk.toString('utf8'); if(Buffer.byteLength(buffer)>65536){fail(new Error('oversized input frame'));return;}
                    var split;
                    while((split=buffer.indexOf('\n'))>=0){
                        var line=buffer.slice(0,split);buffer=buffer.slice(split+1);var last=line.lastIndexOf('\t'), payload=line.slice(0,last), mac=line.slice(last+1);
                        var expected=crypto.createHmac('sha256',secret).update(nonce).update(Buffer.from([0])).update(payload).digest();
                        if(!/^[a-f0-9]{64}$/.test(mac)||!crypto.timingSafeEqual(expected,Buffer.from(mac,'hex'))){fail(new Error('invalid input authentication'));return;}
                        var fields=payload.split('\t');
                        if(!authenticated){
                            if(fields.length!==9||fields[0]!=='AUTH'||fields[2]!=='0'||fields[3]!=='0'||Buffer.from(fields[4],'base64').toString()!==selected.name||Buffer.from(fields[5],'base64').toString()!==selected.node||fields[8]!==mode){fail(new Error('unexpected input helper identity'));return;}
                            authenticated=true;self.current.connected=true;clearTimeout(timer);settled=true;resolve(self.status());
                        }else{
                            try{
                                if(fields.length!==3||fields[0]!=='EVENT'||+fields[1]!==seq+1)throw new Error('invalid input sequence');
                                var event=JSON.parse(Buffer.from(fields[2],'base64').toString());
                                if(event.type!==1||!Number.isInteger(event.code)||event.code<0||event.code>767||event.node!==selected.node||event.device!==selected.name||event.sequence!==+fields[1])throw new Error('invalid input event');
                                seq=+fields[1];self.events.push(event);if(self.events.length>30)self.events.shift();
                                self.onEvent(event);
                            }catch(e){fail(e);return;}
                        }
                    }
                });
            });
            self.server.on('error',fail);
            self.server.listen(0,'127.0.0.1',function(){
                var token='/tmp/vetro-input-'+crypto.randomBytes(12).toString('hex')+'.token';
                var helper=path.join(__dirname,'..','payload','SamsungTvRemoteInputAgent.dll');
                var args=['127.0.0.1',String(self.server.address().port),token,selected.name+'@'+selected.node,'evdev','TV',mode,mode==='filter'?tokens.join(','):''];
                var command='umask 077; printf %s '+quote(secret.toString('base64'))+' > '+quote(token)+'; nohup /usr/bin/dotnet '+quote(helper)+' '+args.map(quote).join(' ')+' </dev/null >/tmp/vetro-input.log 2>&1 &';
                self.execute(command,5000).then(function(r){if(r.exit_code||r.timed_out)fail(new Error('input helper launch failed'));}).catch(fail);
            });
        });
    });
};
module.exports={Bridge:Bridge,devices:devices};
