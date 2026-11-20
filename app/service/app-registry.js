'use strict';
// Registry fields are hex encoded by SQLite: no delimiter ambiguity, SQL values
// supplied by callers, or arbitrary file paths accepted from HTTP requests.
var apps = require('./apps.js');
// Regular expressions compiled once at module load, not on every call.
var HEX_FIELD_RE = /^(?:[a-fA-F0-9]{2})*$/;
var CR_RE = /\r/g;
var NO_DEPENDENCY_TABLE_RE = /^(?:Error: (?:in prepare, )?|Parse error[^:]*: )no such table: package_dependency_info(?: \(\d+\))?\s*$/;
var REGISTERED_ID_RE = /^[A-Za-z0-9_.-]+$/;
var ICON_COMMAND_RE = /^\/(?:usr\/apps|opt\/usr\/apps)\/[A-Za-z0-9_.\/-]+\.(?:png|jpg|jpeg)$/i;
var LOAD_DEPS_MARK = '__VETRO_DEPS__';
var LOAD_DEPS_RC_MARK = '__VETRO_DEPS_RC__';
var LOAD_USER_MARK = '__VETRO_USER__';
function command(sql){return 'sqlite3 -readonly -cmd ".timeout 5000" /opt/dbspace/.pkgmgr_parser.db "'+sql+'"';}
function fields(text){return String(text||'').replace(CR_RE,'').trim().split('\n').filter(Boolean).map(function(line){return line.split('|').map(function(v){if(!HEX_FIELD_RE.test(v))throw new Error('invalid registry field');return Buffer.from(v,'hex').toString('utf8');});});}
// Older firmware omits package_dependency_info. Only that specific schema error is optional;
// transport failures, timeouts, and malformed results still fail the registry read.
function load(execute,probe){
    var ownerUid=typeof process.getuid==='function'?process.getuid():5001;var rows=apps.normalize(probe.apps,probe.packages), byId=Object.create(null);rows.forEach(function(r){byId[r.appId]=r;});
    var mainSql="SELECT hex(a.app_id),hex(a.package),hex(a.app_type),hex(a.app_component),hex(COALESCE((SELECT is_disabled FROM package_app_info_for_uid u WHERE u.app_id=a.app_id AND u.uid=OWNER_UID),a.app_disable)),hex(a.app_removable),hex(p.package_version),hex(p.package_size),hex(p.author_name),hex(p.package_system),hex(p.package_preload),hex(a.app_onboot),hex(a.app_autorestart),hex(a.app_nodisplay),hex((SELECT app_label FROM package_app_localized_info l WHERE l.app_id=a.app_id AND app_label != '' ORDER BY CASE WHEN app_locale='en_US' THEN 0 ELSE 1 END LIMIT 1)),hex((SELECT app_icon FROM package_app_localized_info l WHERE l.app_id=a.app_id AND app_icon != '' LIMIT 1)) FROM package_app_info a LEFT JOIN package_info p ON p.package=a.package;".replace('OWNER_UID',String(ownerUid));
    var depCmd=command('SELECT hex(package),hex(depends_on),hex(type),hex(required_version) FROM package_dependency_info;');
    var userCmd='sqlite3 -readonly -cmd ".timeout 5000" /opt/dbspace/user/'+ownerUid+'/.pkgmgr_parser.db "SELECT hex(app_id),hex(is_disabled) FROM package_app_info_for_uid WHERE uid='+ownerUid+';" 2>/dev/null';
    var script=command(mainSql)+'; r=$?; [ $r -eq 0 ] || exit $r; echo '+LOAD_DEPS_MARK+'; '+depCmd+' 2>&1; echo "'+LOAD_DEPS_RC_MARK+'$?"; echo '+LOAD_USER_MARK+'; '+userCmd+'; true';
    return execute(script,15000).then(function(r){
        if(!r||r.exit_code||r.timed_out)throw new Error('registry query failed');
        var text=String(r.stdout||'').replace(CR_RE,''), p1=text.split(LOAD_DEPS_MARK);
        var mainRows=fields(p1[0]), deps=null, userRows=[];
        if(p1.length<2)throw new Error('registry dependency query failed');
        var p2=p1[1].split(LOAD_USER_MARK), rcSplit=p2[0].split(LOAD_DEPS_RC_MARK);
        if(rcSplit.length<2)throw new Error('registry dependency query failed');
        var depOut=rcSplit[0], depRc=parseInt(rcSplit[1].trim(),10);
        if(depRc===0)deps=fields(depOut);
        else if(depRc===1 && NO_DEPENDENCY_TABLE_RE.test(depOut.trim()))deps=null;
        else throw new Error('registry dependency query failed');
        try{userRows=fields(p2[1]||'');}catch(e){userRows=[];}
        var registered=Object.create(null);mainRows.forEach(function(f){if(!REGISTERED_ID_RE.test(f[0]))return;registered[f[0]]=true;var r=byId[f[0]], oldPkg;
            if(!r){r=apps.normalize([{id:f[0],packageId:f[1],show:false}],[])[0];rows.push(r);byId[f[0]]=r;oldPkg=f[1];}
            else oldPkg=r.packageId;
            Object.assign(r,{packageId:f[1],type:f[2],component:f[3],disabled:f[4]==='true',removable:f[5]==='true',version:f[6]||r.version,size:+f[7]||r.size,author:f[8]||null,system:f[9]==='true',preload:f[10]==='true',onboot:f[11]==='true',autorestart:f[12]==='true',show:f[13]==='false',name:r.name||f[14]||null,iconPath:f[15]||null,dependencies:deps===null?null:[],dependents:deps===null?null:[],dependencySource:deps===null?null:'package registry'});
            if(oldPkg!==f[1])Object.assign(r,apps.describe(r));
        });
        userRows.forEach(function(f){if(byId[f[0]])byId[f[0]].disabled=f[1]==='true';});
        var depsByPkg=Object.create(null), revByPkg=Object.create(null);
        if(deps)deps.forEach(function(d){
            (depsByPkg[d[0]]||(depsByPkg[d[0]]=[])).push({packageId:d[1],type:d[2],version:d[3]||null});
            (revByPkg[d[1]]||(revByPkg[d[1]]=[])).push({packageId:d[0],type:d[2],version:d[3]||null});
        });
        rows=rows.filter(function(r){return registered[r.appId]});
        rows.forEach(function(r){
            r.origin=r.system?'system':r.preload?'preinstalled':r.system===false&&r.preload===false?'installed':'unknown';
            Object.assign(r,apps.classification(r));
            if(r.origin==='installed')Object.assign(r,apps.describe(r));
            if(deps){r.dependencies=depsByPkg[r.packageId]?depsByPkg[r.packageId].slice():[];r.dependents=revByPkg[r.packageId]?revByPkg[r.packageId].slice():[];}
        });
        return {apps:rows,summary:apps.summarize(rows),source:'package registry + public probe',dependenciesAvailable:deps!==null,collectedAt:new Date().toISOString()};
    });
}
// One app's row, for a caller that needs a few fields of one app and not the whole inventory: Vetro's own startup flags at
// boot, the custom launcher's lookup about once a minute. The fields mean what load() gives for that app: disabled with the
// owner's override from both registries (the user registry is optional, as in load()), show from app_nodisplay. Resolves
// null when the app is not registered. options.user === false skips the user registry (one sqlite3 instead of two).
var ONE_USER_MARK='__VETRO_USER__';
function one(execute,appId,options){
    if(typeof appId!=='string'||!REGISTERED_ID_RE.test(appId)||appId.length>180)return Promise.reject(new Error('invalid app ID'));
    var ownerUid=typeof process.getuid==='function'?process.getuid():5001,withUser=!(options&&options.user===false);
    var main=command("SELECT hex(a.app_id),hex(a.package),hex(COALESCE((SELECT is_disabled FROM package_app_info_for_uid u WHERE u.app_id=a.app_id AND u.uid="+ownerUid+"),a.app_disable)),hex(a.app_removable),hex(p.package_system),hex(p.package_preload),hex(a.app_onboot),hex(a.app_autorestart),hex(a.app_nodisplay),hex((SELECT app_label FROM package_app_localized_info l WHERE l.app_id=a.app_id AND app_label != '' ORDER BY CASE WHEN app_locale='en_US' THEN 0 ELSE 1 END LIMIT 1)) FROM package_app_info a LEFT JOIN package_info p ON p.package=a.package WHERE a.app_id='"+appId+"';");
    // One shell for both reads; the exit status is the main registry's, the user registry may be missing (as in load()).
    var line=withUser?main+'; r=$?; echo '+ONE_USER_MARK+'; sqlite3 -readonly -cmd ".timeout 5000" /opt/dbspace/user/'+ownerUid+'/.pkgmgr_parser.db "SELECT hex(app_id),hex(is_disabled) FROM package_app_info_for_uid WHERE uid='+ownerUid+" AND app_id='"+appId+"';\" 2>/dev/null; exit $r":main;
    return execute(line,15000).then(function(r){
        if(!r||r.exit_code||r.timed_out)throw new Error('registry query failed');
        var parts=String(r.stdout||'').split(ONE_USER_MARK),f=fields(parts[0]).filter(function(x){return x[0]===appId;})[0];
        if(!f)return null;
        var row={appId:f[0],packageId:f[1],disabled:f[2]==='true',removable:f[3]==='true',system:f[4]==='true',preload:f[5]==='true',onboot:f[6]==='true',autorestart:f[7]==='true',show:f[8]==='false',name:f[9]||null};
        var user=[];try{user=fields(parts[1]||'');}catch(e){user=[];}
        user.forEach(function(u){if(u[0]===appId)row.disabled=u[1]==='true';});
        return row;
    });
}
function iconCommand(row){var p=row&&row.iconPath;if(typeof p!=='string'||!ICON_COMMAND_RE.test(p)||p.split('/').indexOf('..')!==-1)return null;
    return 'if [ -f "'+p+'" ] && [ "$(stat -c %s "'+p+'")" -le 262144 ]; then base64 "'+p+'"; else exit 1; fi';
}
module.exports={load:load,one:one,fields:fields,iconCommand:iconCommand};
