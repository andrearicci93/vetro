'use strict';
const assert = require('assert').strict;
const {Dock} = require('../service/dock.js');
function fixture(mode='samsung') {
 let state={enabled:mode==='vetro',customApp:mode==='custom'?'old.Home':null};
 const log=[], dock=Object.create(Dock.prototype);
 dock.readState=()=>({...state});dock.status=async()=>({...state});
 dock.appCheck=async id=>({ok:id!=='missing.Home'});
 dock.enable=async()=>{log.push('enable');state.enabled=true;return dock.status()};
 dock.disable=async()=>{log.push('disable');state.enabled=false;return dock.status()};
 dock.enableCustom=async id=>{log.push('custom:'+id);if(id==='broken.Home')throw Error('start failed');state.customApp=id;return dock.status()};
 dock.disableCustom=async()=>{log.push('disableCustom');state.customApp=null;return dock.status()};
 return {dock,log};
}
(async()=>{
 const f=fixture('vetro');
 await f.dock.setHomeAssignment({mode:'custom',appId:'new.Home'});
 assert.deepEqual(f.log,['disable','custom:new.Home']);
 assert.equal(f.dock.readState().enabled,false);
 await f.dock.setHomeAssignment({mode:'samsung'});
 assert.equal(f.dock.readState().customApp,null);
 await f.dock.setHomeAssignment({mode:'vetro'});
 await assert.rejects(f.dock.setHomeAssignment({mode:'custom',appId:'missing.Home'}),/installed/);
 assert.equal(f.dock.readState().enabled,true,'validation happens before stopping current owner');
 await assert.rejects(f.dock.setHomeAssignment({mode:'custom',appId:'broken.Home'}),/start failed/);
 assert.equal(f.dock.readState().enabled,true,'failed transition restores previous owner');
 let release;f.dock.appCheck=()=>new Promise(r=>{release=r});
 const pending=f.dock.setHomeAssignment({mode:'custom',appId:'new.Home'});
 await assert.rejects(f.dock.setHomeAssignment({mode:'samsung'}),/in progress/);
 release({ok:true});await pending;
 assert.equal(f.dock.homeChanging,false);
 console.log('PASS shared Home mode transitions, validation, rollback and concurrent saves');
})().catch(e=>{console.error(e);process.exitCode=1});
