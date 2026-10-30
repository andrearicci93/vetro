'use strict';
// Runs the real cleanup script against a temporary folder pair.
const assert=require('assert').strict,fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
const l=require('../service/leftovers.js');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'vetro-leftovers-')),a=path.join(root,'sdk_tools'),b=path.join(a,'tmp'),shim=path.join(root,'bin');
fs.mkdirSync(path.join(a,'archive-root-0123'),{recursive:true});fs.mkdirSync(shim);
// Portable stat -c %s for macOS test hosts.
fs.writeFileSync(path.join(shim,'stat'),'#!/bin/sh\nif [ "$1" = -c ] && [ "$2" = %h ]; then /usr/bin/stat -f %l "$3"; exit 0; fi\nif [ "$1" = -c ]; then wc -c < "$3" | tr -d " "; exit 0; fi\nexec /usr/bin/stat "$@"\n',{mode:0o755});
const files={'app.wgt':10,'UPPER.TPK':20,'.hidden.rpm':30,'name with space.wgt':40,'.wgt':5,'device-profile.xml':7};
Object.entries(files).forEach(([n,s])=>fs.writeFileSync(path.join(a,n),'x'.repeat(s)));
fs.writeFileSync(path.join(a,'archive-root-0123','agent.wgt'),'keep');
function run(clear,dirs,extras){return l.parse(cp.execFileSync('sh',['-c',l.script(clear,dirs,root,extras||null)],{env:{...process.env,PATH:shim+':'+process.env.PATH}}).toString(),dirs);}
try{
 const listed=run(false,[a,b]);
 assert.deepEqual(listed.errors,[],'missing tmp/ subfolder is not an error');
 assert.equal(listed.packageCount,4);assert.equal(listed.packageBytes,100);
 assert.ok(listed.files.some(f=>f.name==='.wgt'&&!f.isPackage),'name must be longer than the extension');
 assert.ok(!listed.files.some(f=>f.name==='agent.wgt'),'subfolders are never scanned');
 assert.ok(listed.storageBefore&&listed.storageBefore.availableBytes>0);
 fs.mkdirSync(b);fs.writeFileSync(path.join(b,'nested.wgt'),'x'.repeat(8));
 const cleared=run(true,[a,b]);
 assert.deepEqual(cleared.deleted.map(f=>f.name).sort(),['.hidden.rpm','UPPER.TPK','app.wgt','name with space.wgt','nested.wgt']);
 assert.equal(cleared.freedBytes,108);assert.deepEqual(cleared.failed,[]);
 assert.deepEqual(fs.readdirSync(a).sort(),['.wgt','archive-root-0123','device-profile.xml','tmp']);
 assert.ok(fs.existsSync(path.join(a,'archive-root-0123','agent.wgt')),'agent staging folders stay');
 assert.deepEqual(run(false,[path.join(root,'absent'),b]).errors,[{path:path.join(root,'absent'),error:'missing'}]);

 // Other scraps: a closed list, with age, link, open-file and running-app checks. app_launcher and fuser are stubbed.
 {
  const x=path.join(root,'x'),web=path.join(x,'apps_rw'),pv=path.join(web,'org.tizen.primevideo','data','tmp'),logs=path.join(x,'net');
  fs.mkdirSync(pv,{recursive:true});fs.mkdirSync(logs,{recursive:true});
  const old=f=>cp.execFileSync('touch',['-t','202001010000',f]);
  const w=(f,n)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,'x'.repeat(n));return f;};
  old(w(path.join(logs,'inm.log.0'),100));old(w(path.join(logs,'inm.log.1'),200));w(path.join(logs,'inm.log.2'),300);       // too young
  old(w(path.join(logs,'inm.log.busy'),400));old(w(path.join(logs,'other.log.0'),500));                                      // not matched
  fs.linkSync(path.join(logs,'inm.log.1'),path.join(logs,'inm.log.9'));                                                       // hard linked: both have 2 links
  old(w(path.join(pv,'tmp_bitmap12'),1000));old(w(path.join(pv,'tmp_bitmap7.3'),2000));w(path.join(pv,'tmp_bitmap99'),3000);old(w(path.join(pv,'tmp_other'),4000));old(w(path.join(pv,'tmp_bitmap5x'),5000));
  w(path.join(web,'AAAAAAAAAA','data','Code Cache','js','a'),10240);w(path.join(web,'AAAAAAAAAA','data','GPUCache','b'),4096);w(path.join(web,'AAAAAAAAAA','data','Local Storage','keep'),50);
  w(path.join(web,'RUNNING000','data','Code Cache','c'),8192);w(path.join(web,'vetrotvapp','data','Code Cache','d'),8192);
  w(path.join(web,'LINKED0000','data','Code Cache','e'),8192);fs.symlinkSync('/tmp',path.join(web,'LINKED0000','data','Code Cache','lnk'));
  fs.mkdirSync(path.join(web,'EMPTY00000','data','Code Cache'),{recursive:true});
  const cfg={logs:[path.join(logs,'inm.log.[0-9]*')],logDays:7,bitmaps:[{dir:pv,app:'org.tizen.primevideo'}],bitmapDays:1,webRoot:web,webNames:['Code Cache','GPUCache']};
  const stub=(name,body)=>fs.writeFileSync(path.join(shim,name),'#!/bin/sh\n'+body+'\n',{mode:0o755});
  stub('app_launcher','printf "\\t%s (10)\\n\\t%s (11)\\n" RUNNING000.service com.samsung.tv.csfs');
  stub('fuser','case "$1" in *.busy) exit 0;; *) exit 1;; esac');
  const listed2=run(false,[a,b],cfg);
  const names=k=>listed2.extras.filter(e=>e.kind===k).map(e=>path.relative(x,e.path)).sort();
  assert.deepEqual(names('log'),['net/inm.log.0'],'only old, plain, unused, matching logs (the hard-linked pair and the young one stay)');
  assert.deepEqual(names('bitmap'),['apps_rw/org.tizen.primevideo/data/tmp/tmp_bitmap12','apps_rw/org.tizen.primevideo/data/tmp/tmp_bitmap7.3'],'old tmp_bitmap<number> files only');
  assert.deepEqual(names('webcache'),['apps_rw/AAAAAAAAAA/data/Code Cache','apps_rw/AAAAAAAAAA/data/GPUCache'],'not running apps, no symlinks inside, not Vetro, not empty');
  assert.equal(listed2.extras.find(e=>e.kind==='bitmap'&&/12$/.test(e.path)).size,1000);assert.equal(listed2.appsUnreadable,false);
  assert.equal(listed2.extraKinds.webcache.count,2);assert.ok(listed2.extraKinds.webcache.bytes>=14336);
  assert.ok(fs.existsSync(path.join(logs,'inm.log.0')),'listing deletes nothing');
  const done=run(true,[a,b],cfg);
  assert.equal(done.extrasDeleted.length,5);assert.deepEqual(done.extrasFailed,[]);
  assert.ok(!fs.existsSync(path.join(logs,'inm.log.0'))&&fs.existsSync(path.join(logs,'inm.log.2'))&&fs.existsSync(path.join(logs,'other.log.0'))&&fs.existsSync(path.join(logs,'inm.log.1')));
  assert.deepEqual(fs.readdirSync(pv).sort(),['tmp_bitmap5x','tmp_bitmap99','tmp_other'],'the folder and the files that do not match stay');
  assert.ok(fs.existsSync(path.join(web,'AAAAAAAAAA','data','Code Cache'))&&fs.readdirSync(path.join(web,'AAAAAAAAAA','data','Code Cache')).length===0,'the cache folder stays, emptied');
  assert.ok(fs.existsSync(path.join(web,'AAAAAAAAAA','data','Local Storage','keep')),'other app data is untouched');
  assert.ok(fs.existsSync(path.join(web,'RUNNING000','data','Code Cache','c'))&&fs.existsSync(path.join(web,'vetrotvapp','data','Code Cache','d'))&&fs.existsSync(path.join(web,'LINKED0000','data','Code Cache','e')),'running app, Vetro and linked caches are untouched');
  // Without the list of running apps nothing that needs a closed app is touched
  stub('app_launcher','exit 1');w(path.join(web,'AAAAAAAAAA','data','Code Cache','again'),2048);old(w(path.join(pv,'tmp_bitmap1'),10));
  const blind=run(true,[a,b],cfg);assert.equal(blind.appsUnreadable,true);assert.equal(blind.extrasDeleted.filter(e=>e.kind!=='log').length,0);assert.ok(fs.existsSync(path.join(pv,'tmp_bitmap1')));
  // Without fuser every file counts as open
  stub('app_launcher','printf "\\tx (1)\\n"');fs.rmSync(path.join(shim,'fuser'));old(w(path.join(logs,'inm.log.5'),10));
  const nofuser=run(false,[a,b],{...cfg,webRoot:path.join(x,'none')});assert.deepEqual(nofuser.extras,[],'fuser missing: nothing is offered');
  assert.throws(()=>l.script(false,[a],root,{...cfg,logs:["/a b/'x"]}),/Unsafe path/);
 }
 console.log('PASS leftovers: Apps2Samsung staging rules, dotfiles, case-insensitive packages, folders kept, bytes freed');
}finally{fs.rmSync(root,{recursive:true,force:true});}
