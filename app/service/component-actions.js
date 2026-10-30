'use strict';
var protectedApp=require('./debloat.js').isProtected;
function wrap(s){return 'echo '+Buffer.from(s).toString('base64')+' | base64 -d | sh';}
function validId(s){return typeof s==='string'&&/^[A-Za-z0-9_.-]{1,180}$/.test(s);}
// Shared by the HTTP backend and browser: unavailable commands carry a reason.
function availability(a,rows,verifiedIds){
 function protectedRow(r){return !!r&&(r.protected===true||/^vetrotvapp(?:\.|$)/.test(r.appId||'')||/^com\.samsung\.tv\.coba\.adagent(?:\.|$)/.test(r.appId||'')||/^com\.samsung\.tv\.coba\.adagent(?:\.|$)/.test(r.packageId||''));}
 function decision(reason){return {allowed:!reason,reason:reason||''};}
 var blocked=protectedRow(a),known=typeof a.disabled==='boolean',user=a.system===false&&a.removable===true;
 var tested=Array.isArray(verifiedIds)&&verifiedIds.indexOf(a.appId)>=0;
 var siblings=(rows||[]).filter(function(r){return r.packageId===a.packageId;});
 return {
  toggle:decision(blocked?'This component is protected.':!known?'App state is unavailable. Refresh the inventory.':!user&&!tested?'Disable is not supported for this system component.':null),
  uninstall:decision(blocked||siblings.some(protectedRow)?'This package contains a protected component.':a.system!==false?'System packages cannot be uninstalled here.':a.removable!==true?'The TV does not mark this package as removable.':typeof a.packageId!=='string'||!/^[A-Za-z0-9_.-]{1,180}$/.test(a.packageId)?'Package identity is unavailable.':null),
  launch:decision(!known?'App state is unavailable.':a.disabled?'Enable the app before launching it.':a.show!==true?'This is a background component with no launcher entry.':null),
  flags:decision(blocked?'This component is protected.':null)
 };
}
function validate(p,rows){
 if(!p||!validId(p.appId))throw Error('Invalid app ID');
 var a=rows.find(function(a){return a.appId===p.appId});if(!a)throw Error('App not installed');
 if(protectedApp(a.appId)||protectedApp(a.packageId)||/^vetrotvapp(?:\.|$)/.test(a.appId))throw Error('Protected component');
 if(['stop','flags','uninstall'].indexOf(p.action)<0)throw Error('Invalid action');
 if(p.action==='flags'&&(['onboot','autorestart'].indexOf(p.flag)<0||typeof p.enabled!=='boolean'))throw Error('Invalid flag');
 if(p.action==='flags'&&typeof a[p.flag]!=='boolean')throw Error('Startup flag is unavailable; refresh the inventory');
 if(p.action==='uninstall'){var cap=availability(a,rows,[]).uninstall;if(!cap.allowed)throw Error(cap.reason);}
 return a;
}
function command(p,a){
 if(p.action==='stop')return wrap('app_launcher -k '+a.appId);
 if(p.action==='uninstall')return wrap('pkgcmd -u -n '+a.packageId);
 var field=p.flag==='onboot'?'app_onboot':'app_autorestart',db='/opt/dbspace/.pkgmgr_parser.db';
 return wrap('set -e\nmkdir -p /home/owner/share/vetro/startup-backups\nbackup=/home/owner/share/vetro/startup-backups/'+a.appId+'\nif [ ! -f "$backup" ]; then sqlite3 -readonly '+db+' "SELECT app_onboot,app_autorestart FROM package_app_info WHERE app_id=\''+a.appId+'\';" > "$backup"; fi\nsqlite3 -bail -cmd ".timeout 5000" '+db+' "BEGIN IMMEDIATE; UPDATE package_app_info SET '+field+'=\''+(p.enabled?'true':'false')+'\' WHERE app_id=\''+a.appId+'\'; COMMIT;"\nsqlite3 -readonly '+db+' "SELECT '+field+' FROM package_app_info WHERE app_id=\''+a.appId+'\';"');
}
// A public-level certificate can leave Vetro's own service registered without on-boot and auto-restart (#4, S90C),
// so it never starts after a reboot. Commands that put config.xml's values back; users still cannot change them.
function selfStartup(rows){var a=(rows||[]).find(function(r){return r.appId==='vetrotvapp.svc'});return !a?[]:['onboot','autorestart'].filter(function(f){return a[f]===false}).map(function(f){return command({action:'flags',flag:f,enabled:true},a)});}
module.exports={validate:validate,command:command,availability:availability,selfStartup:selfStartup};
