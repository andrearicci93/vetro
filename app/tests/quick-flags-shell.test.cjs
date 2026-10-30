'use strict';
// Runs the root scripts of Quick settings for real against a scratch SQLite database, in a POSIX shell,
// because the other tests only look at their text. Skipped where sqlite3 is missing.
const assert=require('assert').strict;
const cp=require('child_process'),fs=require('fs'),os=require('os'),path=require('path');
const quick=require('../service/quick-settings.js');
const has=c=>cp.spawnSync('sh',['-c','command -v '+c]).status===0;
if(!has('sqlite3')){console.log('SKIP quick settings shell scripts: sqlite3 not installed');process.exit(0);}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vetro-quick-')),db=path.join(dir,'p.db'),saved=path.join(dir,'quick-flags');
const sql=q=>cp.spawnSync('sqlite3',[db,q],{encoding:'utf8'}).stdout.trim();
sql("CREATE TABLE package_app_info(app_id TEXT, app_onboot TEXT, app_autorestart TEXT);INSERT INTO package_app_info VALUES('a.one','true','true'),('a.two','true','false'),('a.three','false','false');");
function run(cmd,shell){
 const script=Buffer.from(/^echo (\S+) \|/.exec(cmd)[1],'base64').toString().split('/opt/dbspace/.pkgmgr_parser.db').join(db).split('/home/owner/share/vetro/quick-flags').join(saved);
 const r=cp.spawnSync(shell,['-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;
}
const rows=()=>sql('SELECT app_id,app_onboot,app_autorestart FROM package_app_info ORDER BY app_id;');
const shells=['sh'].concat(has('dash')?['dash']:[]).concat(has('busybox')?['busybox sh']:[]);
shells.forEach(shell=>{
 sql("UPDATE package_app_info SET app_onboot='true',app_autorestart='true' WHERE app_id='a.one';UPDATE package_app_info SET app_onboot='true',app_autorestart='false' WHERE app_id='a.two';UPDATE package_app_info SET app_onboot='false',app_autorestart='false' WHERE app_id='a.three';");
 fs.rmSync(saved,{recursive:true,force:true});
 const before=rows();
 let out=run(quick.clearFlagsCommand(['a.one','a.two','a.three']),shell);
 assert.deepEqual(quick.exitCodes(out),{'a.one':0,'a.two':0,'a.three':0},shell+': every id reports success');
 assert.equal(rows(),'a.one|false|false\na.three|false|false\na.two|false|false',shell+': both flags cleared');
 assert.deepEqual(fs.readdirSync(saved).sort(),['a.one','a.two'],shell+': only components that had a flag are saved');
 assert.equal(fs.readFileSync(path.join(saved,'a.two'),'utf8').trim(),'true|false');
 // A second clear must not overwrite the saved values with the cleared ones
 run(quick.clearFlagsCommand(['a.one']),shell);assert.equal(fs.readFileSync(path.join(saved,'a.one'),'utf8').trim(),'true|true',shell+': saved values survive a second clear');
 out=run(quick.restoreFlagsCommand(['a.one','a.two','a.three']),shell);
 assert.deepEqual(out.trim().split('\n'),['a.one 0','a.two 0','a.three none'],shell+': restored, restored, nothing saved');
 assert.equal(rows(),before,shell+': flags are back as they were');assert.deepEqual(fs.readdirSync(saved),[],shell+': saved files are removed');
 // A locked database is waited for instead of failing at once
 const lock=cp.spawn('sqlite3',[db],{stdio:['pipe','ignore','ignore']});lock.stdin.write('BEGIN IMMEDIATE;\n.shell sleep 1\nCOMMIT;\n');
 const t=Date.now();while(Date.now()-t<200);
 out=run(quick.clearFlagsCommand(['a.one']),shell);lock.stdin.end();
 assert.deepEqual(quick.exitCodes(out),{'a.one':0},shell+': a briefly locked database does not fail the change');
});
fs.rmSync(dir,{recursive:true,force:true});
console.log('PASS quick settings shell scripts: clear and restore run for real ('+shells.join(', ')+'), saved values kept, locked database waited for');
