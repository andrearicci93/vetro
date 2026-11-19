'use strict';
// Registry fields are hex encoded by SQLite: no delimiter ambiguity, SQL values
// supplied by callers, or arbitrary file paths accepted from HTTP requests.
var apps = require('./apps.js');
// Regular expressions compiled once at module load, not on every call.
var HEX_FIELD_RE = /^(?:[a-fA-F0-9]{2})*$/;
var NO_DEPENDENCY_TABLE_RE = /^Error: (?:in prepare, )?no such table: package_dependency_info(?: \(\d+\))?\s*$/;
var REGISTERED_ID_RE = /^[A-Za-z0-9_.-]+$/;
var ICON_COMMAND_RE = /^\/(?:usr\/apps|opt\/usr\/apps)\/[A-Za-z0-9_.\/-]+\.(?:png|jpg|jpeg)$/i;
function command(sql){return 'sqlite3 -readonly /opt/dbspace/.pkgmgr_parser.db "'+sql+'"';}
function fields(text){return String(text||'').trim().split('\n').filter(Boolean).map(function(line){return line.split('|').map(function(v){if(!HEX_FIELD_RE.test(v))throw new Error('invalid registry field');return Buffer.from(v,'hex').toString('utf8');});});}
function query(execute,sql){return execute(command(sql),15000).then(function(r){if(r.exit_code||r.timed_out)throw new Error('registry query failed');return fields(r.stdout);});}
// Older firmware omits this table. Only that specific schema error is optional;
// transport failures, timeouts, and malformed results still fail the registry read.
function dependencyQuery(execute){
    return execute(command('SELECT hex(package),hex(depends_on),hex(type),hex(required_version) FROM package_dependency_info;'),15000).then(function(r){
        if(!r.timed_out && r.exit_code===1 && NO_DEPENDENCY_TABLE_RE.test(r.stderr||''))return null;
        if(r.exit_code||r.timed_out)throw new Error('registry dependency query failed');
        return fields(r.stdout);
    });
}
function load(execute,probe){
    var ownerUid=typeof process.getuid==='function'?process.getuid():5001;var rows=apps.normalize(probe.apps,probe.packages), byId={};rows.forEach(function(r){byId[r.appId]=r;});
    return Promise.all([
        query(execute,"SELECT hex(a.app_id),hex(a.package),hex(a.app_type),hex(a.app_component),hex(COALESCE((SELECT is_disabled FROM package_app_info_for_uid u WHERE u.app_id=a.app_id AND u.uid=OWNER_UID),a.app_disable)),hex(a.app_removable),hex(p.package_version),hex(p.package_size),hex(p.author_name),hex(p.package_system),hex(p.package_preload),hex(a.app_onboot),hex(a.app_autorestart),hex(a.app_nodisplay),hex((SELECT app_label FROM package_app_localized_info l WHERE l.app_id=a.app_id AND app_label != '' ORDER BY CASE WHEN app_locale='en_US' THEN 0 ELSE 1 END LIMIT 1)),hex((SELECT app_icon FROM package_app_localized_info l WHERE l.app_id=a.app_id AND app_icon != '' LIMIT 1)) FROM package_app_info a LEFT JOIN package_info p ON p.package=a.package;".replace('OWNER_UID',String(ownerUid))),
        dependencyQuery(execute),
        execute('sqlite3 -readonly /opt/dbspace/user/'+ownerUid+'/.pkgmgr_parser.db \"SELECT hex(app_id),hex(is_disabled) FROM package_app_info_for_uid WHERE uid='+ownerUid+';\"',5000).then(function(r){return r.exit_code?[]:fields(r.stdout)})
    ]).then(function(data){
        var registered={};data[0].forEach(function(f){if(!REGISTERED_ID_RE.test(f[0]))return;registered[f[0]]=true;var r=byId[f[0]];
            if(!r){r=apps.normalize([{id:f[0],packageId:f[1],show:false}],[])[0];rows.push(r);byId[f[0]]=r;}
            Object.assign(r,{packageId:f[1],type:f[2],component:f[3],disabled:f[4]==='true',removable:f[5]==='true',version:f[6]||r.version,size:+f[7]||r.size,author:f[8]||null,system:f[9]==='true',preload:f[10]==='true',onboot:f[11]==='true',autorestart:f[12]==='true',show:f[13]==='false',name:r.name||f[14]||null,iconPath:f[15]||null,dependencies:data[1]===null?null:[],dependents:data[1]===null?null:[],dependencySource:data[1]===null?null:'package registry'});
        });
        var depsByPkg = {}, dependentsByPkg = {};
        if (data[1]) {
            data[1].forEach(function (d) {
                var pkg = d[0], dep = d[1], type = d[2], ver = d[3] || null;
                (depsByPkg[pkg] || (depsByPkg[pkg] = [])).push({packageId: dep, type: type, version: ver});
                (dependentsByPkg[dep] || (dependentsByPkg[dep] = [])).push({packageId: pkg, type: type, version: ver});
            });
        }
        data[2].forEach(function(f){if(byId[f[0]])byId[f[0]].disabled=f[1]==='true';});rows=rows.filter(function(r){return registered[r.appId]});rows.forEach(function(r){r.origin=r.system?'system':r.preload?'preinstalled':r.system===false&&r.preload===false?'installed':'unknown';Object.assign(r,apps.classification(r),apps.describe(r));if(data[1]!==null){r.dependencies=(depsByPkg[r.packageId]||[]).slice();r.dependents=(dependentsByPkg[r.packageId]||[]).slice();}});
        return {apps:rows,summary:apps.summarize(rows),source:'package registry + public probe',dependenciesAvailable:data[1]!==null,collectedAt:new Date().toISOString()};
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
    var line=withUser?main+'; r=$?; echo '+ONE_USER_MARK+'; sqlite3 -readonly /opt/dbspace/user/'+ownerUid+'/.pkgmgr_parser.db "SELECT hex(app_id),hex(is_disabled) FROM package_app_info_for_uid WHERE uid='+ownerUid+" AND app_id='"+appId+"';\" 2>/dev/null; exit $r":main;
    return execute(line,15000).then(function(r){
        if(r.exit_code||r.timed_out)throw new Error('registry query failed');
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
