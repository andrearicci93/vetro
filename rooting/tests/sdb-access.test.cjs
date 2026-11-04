'use strict';
const assert=require('assert').strict, path=require('path'), EventEmitter=require('events');
const {TunnelServer}=require('../service/sdb-tunnel.js');
const load=require('./provider-harness.cjs');
(async()=>{
 const tunnel=new TunnelServer({bindHost:'0.0.0.0'}), accepted=[];
 tunnel._pool={addClient:s=>accepted.push(s),close(){}};
 function socket(address){const s=new EventEmitter();s.remoteAddress=address;s.destroyed=false;s.destroy=function(){this.destroyed=true;this.emit('close');};return s;}
 const local=socket('127.0.0.1'),refused=socket('192.0.2.1');
 tunnel.acceptClient(local);tunnel.acceptClient(refused);
 assert.equal(refused.destroyed,true);assert.deepEqual(accepted,[local]);
 tunnel.setLan(true);const remote=socket('192.0.2.2');tunnel.acceptClient(remote);
 assert.equal(remote.destroyed,false);assert.deepEqual(accepted,[local,remote]);
 tunnel.setLan(false);assert.equal(remote.destroyed,true);assert.equal(local.destroyed,false);
 const refusedAgain=socket('192.0.2.3');tunnel.acceptClient(refusedAgain);assert.equal(refusedAgain.destroyed,true);
 assert.throws(()=>tunnel.setLan('yes'),/Invalid/);

 let files={},failWrite=false;
 function boot(){
  const loaded=load(path.resolve(__dirname,'..')),c=loaded.context;
  c.fs={readFileSync(p){if(!(p in files)){const e=Error('missing');e.code='ENOENT';throw e;}return files[p];},writeFileSync(p,s){if(failWrite)throw Error('disk full');files[p]=s;},renameSync(a,b){files[b]=files[a];delete files[a];}};
  c.TunnelServer=function(opts){this.lanEnabled=opts.lanEnabled;this.start=cb=>cb(null,26201);this.close=()=>{};this.setLan=on=>{this.lanEnabled=on;};};
  c.startTunnel(()=>{});return loaded;
 }
 let h=boot();assert.equal(h.provider.sdbAccess().enabled,false);assert.equal(h.provider.sdbAccess().active,false);
 assert.equal((await h.provider.setSdbAccess(true)).active,true);
 h=boot();assert.equal(h.provider.sdbAccess().active,true,'on survives service restart');
 await h.provider.setSdbAccess(false);h=boot();assert.equal(h.provider.sdbAccess().active,false,'off survives service restart');
 failWrite=true;await assert.rejects(h.provider.setSdbAccess(true),/disk full/);assert.equal(h.provider.sdbAccess().active,false);failWrite=false;
 await assert.rejects(h.provider.setSdbAccess('yes'),/Invalid/);
 h.provider.stop();await assert.rejects(h.provider.setSdbAccess(true),/not available/);
 await h.provider.setSdbAccess(false);
 files[h.context.SDB_ACCESS_FILE]='broken';h=boot();assert.equal(h.context.tunnelServer.lanEnabled,false,'corrupt state never opens LAN access');
 assert.throws(()=>h.provider.sdbAccess());await h.provider.setSdbAccess(false);assert.equal(h.provider.sdbAccess().enabled,false);
 console.log('PASS SDB access: admission, revocation, local continuity, persistence, failures and unavailable tunnel');
})().catch(e=>{console.error(e);process.exitCode=1;});
