'use strict';
const assert=require('assert').strict, registry=require('../service/app-registry.js');
const hex=values=>values.map(v=>Buffer.from(v).toString('hex')).join('|');
assert.deepEqual(registry.fields(hex(['app','Label | with comma, and quote"'])),[['app','Label | with comma, and quote"']]);
assert.throws(()=>registry.fields('not hex'));
assert.equal(registry.iconCommand({iconPath:'/etc/passwd'}),null);
assert.equal(registry.iconCommand({iconPath:'/usr/apps/x/../secret.png'}),null);
assert.equal(registry.iconCommand({iconPath:'/usr/apps/x/shared/res/icon.svg'}),null);
assert.ok(registry.iconCommand({iconPath:'/usr/apps/x/shared/res/icon.png'}).includes('262144'));
registry.load(cmd=>Promise.resolve({exit_code:0,stdout:cmd.includes('SELECT hex(app_id),hex(is_disabled)')?'':cmd.includes('package_dependency_info')?hex(['pkg.a','pkg.b','requires','1.0']):hex(['app.a','pkg.a','dotnet','uiapp','true','false','1.2','1000','Author','true','true','true','false','false','Registry label','/usr/apps/app.a/icon.png'])}),{apps:[{id:'app.a',packageId:'pkg.a',name:'Alpha'}],packages:[]}).then(d=>{
 const a=d.apps[0];assert.equal(a.name,'Alpha');assert.equal(a.disabled,true);assert.equal(a.version,'1.2');assert.deepEqual(a.dependencies,[{packageId:'pkg.b',type:'requires',version:'1.0'}]);assert.equal(a.dependencySource,'package registry');assert.equal(a.onboot,true);assert.equal(a.autorestart,false);assert.equal(a.show,true);assert.equal(a.origin,'system');assert.equal(a.iconPath,'/usr/apps/app.a/icon.png');console.log('PASS registry: real dependencies, encoded fields, icon path boundaries');
}).catch(e=>{console.error(e);process.exitCode=1});

registry.load(cmd=>Promise.resolve({exit_code:0,stdout:cmd.includes('SELECT hex(app_id),hex(is_disabled)')?'':cmd.includes('package_dependency_info')?'':hex(['new.app','new.pkg','wgt','uiapp','false','true','2.1','1000','Author','false','false','false','true','false','New app','/opt/usr/apps/new/icon.png'])}),{apps:[],packages:[]}).then(d=>{assert.equal(d.apps[0].name,'New app');assert.equal(d.apps[0].show,true);assert.equal(d.apps[0].origin,'installed');assert.equal(d.apps[0].category,'user');}).catch(e=>{console.error(e);process.exitCode=1});

registry.load(cmd=>Promise.resolve({exit_code:0,stdout:cmd.includes('SELECT hex(app_id),hex(is_disabled)')?hex(['user.app','true']):cmd.includes('package_dependency_info')?'':hex(['user.app','user.pkg','webapp','uiapp','false','true','1','0','','false','false','false','false','false','User',''])}),{apps:[],packages:[]}).then(d=>assert.equal(d.apps[0].disabled,true,'owner disabled override must win over global metadata')).catch(e=>{console.error(e);process.exitCode=1});

(async function(){
 const row=hex(['old.app','old.pkg','webapp','uiapp','false','true','1','10','','false','false','true','true','false','Older TV app','']);
 function executor(dependencyResult){return cmd=>Promise.resolve(cmd.includes('package_dependency_info')?dependencyResult:{exit_code:0,stdout:cmd.includes('SELECT hex(app_id),hex(is_disabled)')?'':row});}
 for(const stderr of ['Error: no such table: package_dependency_info\n','Error: in prepare, no such table: package_dependency_info (1)\n']){
  const d=await registry.load(executor({exit_code:1,stderr}),{apps:[],packages:[]});
  assert.equal(d.apps.length,1);assert.equal(d.apps[0].appId,'old.app');assert.equal(d.apps[0].onboot,true);
  assert.equal(d.dependenciesAvailable,false);assert.equal(d.registryError,undefined);
  assert.equal(d.apps[0].dependencies,null);assert.equal(d.apps[0].dependents,null);assert.equal(d.apps[0].dependencySource,null);
 }
 const empty=await registry.load(executor({exit_code:0,stdout:''}),{apps:[],packages:[]});
 assert.equal(empty.dependenciesAvailable,true);assert.deepEqual(empty.apps[0].dependencies,[],'an empty table is known, unlike an absent table');
 for(const result of [{exit_code:1,stderr:'Error: database is locked'},
  {exit_code:1,stderr:'Error: no such table: package_info'},
  {exit_code:1,timed_out:true,stderr:'Error: no such table: package_dependency_info'},
  {exit_code:0,stdout:'not hex'}]){
  await assert.rejects(registry.load(executor(result),{apps:[],packages:[]}));
 }
 await assert.rejects(registry.load(cmd=>cmd.includes('package_dependency_info')?Promise.reject(Error('disconnected')):executor({})(cmd),{apps:[],packages:[]}),/disconnected/);
 console.log('PASS older registry: absent dependency table preserves inventory with unknown links; real failures propagate');
})().catch(e=>{console.error(e);process.exitCode=1});
