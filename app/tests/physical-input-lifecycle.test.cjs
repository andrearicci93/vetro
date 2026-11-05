'use strict';
const assert=require('assert').strict,fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const {EventEmitter}=require('events');
const source=fs.readFileSync(path.join(__dirname,'../service/physical-input.js'),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const b64=value=>Buffer.from(value).toString('base64');

function fixture(options={}){
    const servers=[],commands=[],events=[],timers=[],queued=[];
    class Socket extends EventEmitter{
        constructor(){super();this.destroyed=false;this.writes=[];}
        write(value){this.writes.push(value);}
        destroy(){this.destroyed=true;}
    }
    class Server extends EventEmitter{
        constructor(callback){super();this.callback=callback;this.closed=false;this.port=41000+servers.length;}
        listen(port,host,callback){this.listening=callback;}
        close(){this.closed=true;}
        address(){return this.closed?null:{port:this.port};}
        accept(socket){this.callback(socket);}
    }
    const fakeNet={createServer(callback){const server=new Server(callback);servers.push(server);return server;}};
    const context={module:{exports:{}},Buffer,__dirname:path.join(__dirname,'../service'),
        require(name){return name==='net'?fakeNet:require(name);},
        setTimeout(callback){const timer={callback,cleared:false};timers.push(timer);return timer;},
        clearTimeout(timer){if(timer)timer.cleared=true;}};
    vm.runInNewContext(source,context);
    const bridge=new context.module.exports.Bridge((command,timeout,guard)=>{
        if(command==='cat /proc/bus/input/devices')return Promise.resolve({exit_code:0,stdout:'N: Name="Smart Control"\nH: Handlers=event4\n'});
        if(options.deferLaunch)return new Promise((resolve,reject)=>{
            queued.push(()=>{
                if(!guard || !guard())return reject(Error('dispatch cancelled'));
                commands.push(command);resolve({exit_code:0});
            });
        });
        commands.push(command);return Promise.resolve({exit_code:0});
    },event=>events.push(event));
    function peer(server){
        const command=commands.find(value=>value.includes("'127.0.0.1' '"+server.port+"'"));
        assert.ok(command,'helper launch uses the owning listener');
        const secret=Buffer.from(/printf %s '([^']+)'/.exec(command)[1],'base64');
        const socket=new Socket();server.accept(socket);
        const nonce=Buffer.from(socket.writes[0].trim().split('\t')[1],'hex');
        const frame=payload=>payload+'\t'+crypto.createHmac('sha256',secret).update(nonce).update(Buffer.from([0])).update(payload).digest('hex')+'\n';
        return {socket,frame,auth(){socket.emit('data',Buffer.from(frame(['AUTH','123','0','0',b64('Smart Control'),b64('/dev/input/event4'),b64('evdev'),b64('TV'),'filter'].join('\t'))));},
            event(sequence){return frame('EVENT\t'+sequence+'\t'+b64(JSON.stringify({type:1,code:63,sequence,device:'Smart Control',node:'/dev/input/event4',action:'down',decision:'blocked'})));}};
    }
    return {bridge,servers,commands,events,timers,queued,Socket,peer};
}

(async()=>{
    // A stop can run before queued listening/connection notifications arrive.
    // Neither notification may resurrect a listener, retain a socket or spawn
    // a helper for the cancelled attempt.
    {
        const f=fixture(),pending=f.bridge.start('Smart Control','filter',['63']);
        const rejected=assert.rejects(pending,/cancelled/);
        await flush();const first=f.servers[0];f.bridge.stop();await rejected;
        first.closed=false; // A pending bind finishes after the earlier close.
        assert.doesNotThrow(()=>first.listening());assert.equal(first.closed,true);assert.equal(f.commands.length,0);
        const late=new f.Socket();first.accept(late);
        assert.equal(late.destroyed,true);assert.equal(late.writes.length,0);
        assert.equal(f.bridge.socket,null);assert.equal(f.bridge.server,null);
        assert.equal(f.bridge.status().policy.mode,'off');
    }
    // The root command queue may be blocked after listen succeeds. Cancelling
    // before dispatch must prevent the native helper from being launched.
    {
        const f=fixture({deferLaunch:true}),pending=f.bridge.start('Smart Control','filter',['63']);
        const rejected=assert.rejects(pending,/cancelled/);
        await flush();f.servers[0].listening();assert.equal(f.queued.length,1);
        f.bridge.stop();await rejected;f.queued[0]();await flush();
        assert.equal(f.commands.length,0);assert.equal(f.bridge.status().policy.mode,'off');
    }
    // Socket data already queued when stop destroyed it must not authenticate
    // the replacement attempt or emit actions into its session.
    {
        const f=fixture(),oldPending=f.bridge.start('Smart Control','filter',['63']);
        const rejected=assert.rejects(oldPending,/cancelled/);
        await flush();const oldServer=f.servers[0];oldServer.listening();const old=f.peer(oldServer);
        f.bridge.stop();await rejected;
        const pending=f.bridge.start('Smart Control','filter',['63']);await flush();
        const server=f.servers[1];server.listening();const current=f.peer(server);
        oldServer.listening();assert.equal(oldServer.closed,true);assert.equal(server.closed,false);
        old.auth();assert.equal(f.bridge.status().policy.connected,false);
        assert.equal(f.bridge.socket,current.socket);assert.equal(current.socket.destroyed,false);
        current.auth();await pending;assert.equal(f.bridge.status().policy.connected,true);
        old.socket.emit('data',Buffer.from(old.event(1)));
        old.socket.emit('close');old.socket.emit('error',Error('late socket error'));
        f.timers[0].callback();
        assert.equal(f.bridge.status().policy.connected,true);assert.equal(f.events.length,0);
        current.socket.emit('data',Buffer.from(current.event(1)));
        assert.equal(f.events.length,1);assert.equal(f.events[0].sequence,1);
        assert.equal(server.closed,false);f.bridge.stop();
        assert.equal(current.socket.destroyed,true);assert.equal(server.closed,true);
    }
    // Event handlers may synchronously stop a bridge. A second frame already
    // in the same data chunk must not dispatch after cancellation.
    {
        const f=fixture(),pending=f.bridge.start('Smart Control','filter',['63']);await flush();
        const server=f.servers[0];server.listening();const current=f.peer(server);current.auth();await pending;
        f.bridge.onEvent=event=>{f.events.push(event);f.bridge.stop();};
        current.socket.emit('data',Buffer.from(current.event(1)+current.event(2)));
        assert.equal(f.events.length,1);assert.equal(f.bridge.status().policy.mode,'off');
    }
    console.log('PASS physical input lifecycle: cancelled listeners and peers cannot launch, authenticate or dispatch into a replacement session');
})().catch(error=>{console.error(error);process.exitCode=1;});
