'use strict';
// Registry fields are hex encoded by SQLite: no delimiter ambiguity, SQL values
// supplied by callers, or arbitrary file paths accepted from HTTP requests.
var apps = require('./apps.js');
function command(sql){return 'sqlite3 -readonly /opt/dbspace/.pkgmgr_parser.db "'+sql+'"';}
function fields(text){return String(text||'').trim().split('\n').filter(Boolean).map(function(line){return line.split('|').map(function(v){if(!/^(?:[a-fA-F0-9]{2})*$/.test(v))throw new Error('invalid registry field');return Buffer.from(v,'hex').toString('utf8');});});}
function query(execute,sql){return execute(command(sql),15000).then(function(r){if(r.exit_code||r.timed_out)throw new Error('registry query failed');return fields(r.stdout);});}
// Older firmware omits this table. Only that specific schema error is optional;
// transport failures, timeouts, and malformed results still fail the registry read.
function dependencyQuery(execute){
    return execute(command('SELECT hex(package),hex(depends_on),hex(type),hex(required_version) FROM package_dependency_info;'),15000).then(function(r){
        if(!r.timed_out && r.exit_code===1 && /^Error: (?:in prepare, )?no such table: package_dependency_info(?: \(\d+\))?\s*$/.test(r.stderr||''))return null;
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
        var registered={};data[0].forEach(function(f){if(!/^[A-Za-z0-9_.-]+$/.test(f[0]))return;registered[f[0]]=true;var r=byId[f[0]];
            if(!r){r=apps.normalize([{id:f[0],packageId:f[1],show:false}],[])[0];rows.push(r);byId[f[0]]=r;}
            Object.assign(r,{packageId:f[1],type:f[2],component:f[3],disabled:f[4]==='true',removable:f[5]==='true',version:f[6]||r.version,size:+f[7]||r.size,author:f[8]||null,system:f[9]==='true',preload:f[10]==='true',onboot:f[11]==='true',autorestart:f[12]==='true',show:f[13]==='false',name:r.name||f[14]||null,iconPath:f[15]||null,dependencies:data[1]===null?null:[],dependents:data[1]===null?null:[],dependencySource:data[1]===null?null:'package registry'});
        });
        data[2].forEach(function(f){if(byId[f[0]])byId[f[0]].disabled=f[1]==='true';});rows=rows.filter(function(r){return registered[r.appId]});rows.forEach(function(r){r.origin=r.system?'system':r.preload?'preinstalled':r.system===false&&r.preload===false?'installed':'unknown';Object.assign(r,apps.classification(r),apps.describe(r));(data[1]||[]).forEach(function(d){if(d[0]===r.packageId)r.dependencies.push({packageId:d[1],type:d[2],version:d[3]||null});if(d[1]===r.packageId)r.dependents.push({packageId:d[0],type:d[2],version:d[3]||null});});});
        return {apps:rows,summary:apps.summarize(rows),source:'package registry + public probe',dependenciesAvailable:data[1]!==null,collectedAt:new Date().toISOString()};
    });
}
function iconCommand(row){var p=row&&row.iconPath;if(typeof p!=='string'||!/^\/(?:usr\/apps|opt\/usr\/apps)\/[A-Za-z0-9_.\/-]+\.(?:png|jpg|jpeg)$/i.test(p)||p.split('/').indexOf('..')!==-1)return null;
    return 'if [ -f "'+p+'" ] && [ "$(stat -c %s "'+p+'")" -le 262144 ]; then base64 "'+p+'"; else exit 1; fi';
}
module.exports={load:load,fields:fields,iconCommand:iconCommand};
