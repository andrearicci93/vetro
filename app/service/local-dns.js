'use strict';
var blocklist=require('./blocklist.js');
var BASE='/home/owner/share/vetro/dns',MARKER='# VETRO LOCAL DOMAIN FILTER';
function wrap(s){return 'echo '+Buffer.from(s).toString('base64')+' | base64 -d | sh';}
function validate(domains){if(!Array.isArray(domains)||domains.length>500)throw Error('At most 500 domains');var out=[];domains.forEach(function(d){if(typeof d!=='string')throw Error('Invalid domain');d=d.toLowerCase().trim();if(d.length>253||d.indexOf('.')<0||!d.split('.').every(function(l){return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l)})||/^\d+(?:\.\d+){3}$/.test(d)||/(?:^|\.)localhost$/.test(d))throw Error('Invalid domain: '+d);var need=blocklist.essential(d);if(need)throw Error(d+' cannot be blocked: '+need.reason);if(out.indexOf(d)<0)out.push(d)});return out;}
function check(r){if(r.exit_code||r.timed_out)throw Error(r.stderr||r.stdout||'Local filter unavailable');return r.stdout||'';}
function Filter(execute){this.execute=execute;this.busy=false;}
Filter.prototype.status=function(){var self=this;return this.execute(wrap('nsenter -t 1 -m -- /bin/sh <<\'VETRO_DNS_STATUS\'\nif [ -f '+BASE+'/config.json ]; then cat '+BASE+'/config.json; else echo \'{"enabled":false,"domains":[]}\'; fi\necho __HOSTS__\nif grep -q "'+MARKER+'" /etc/hosts && grep -q " /etc/hosts " /proc/mounts; then echo applied; else echo inactive; fi\necho __RESOLVERS__\ncat /etc/resolv.conf\nVETRO_DNS_STATUS'),5000).then(function(r){var s=check(r).split('__HOSTS__'),c=JSON.parse(s[0]),parts=(s[1]||'').split('__RESOLVERS__');return {enabled:!!c.enabled,domains:c.domains||[],applied:/^\s*applied/.test(parts[0]),resolvers:(parts[1]||'').split('\n').filter(function(l){return /^nameserver\s/.test(l)}).map(function(l){return l.trim().split(/\s+/)[1]}),scope:'Exact domains through system resolver; custom DNS, cached addresses and direct IP connections can bypass this filter.'};}).then(function(s){
 if(!s.enabled||!s.applied||!s.domains.length)return s;
 var domain=validate(s.domains)[0];
 var script='nsenter -t 1 -m -- /bin/sh -c '+"'"+'command -v getent >/dev/null 2>&1 || exit 127; getent ahostsv4 '+domain+"'";
 return self.execute(wrap(script),5000).then(function(r){
  var addresses=(r.stdout||'').trim().split('\n').map(function(l){return l.trim().split(/\s+/)[0]}).filter(Boolean);
  s.verification={domain:domain,checked:!r.exit_code&&!r.timed_out&&addresses.length>0,ipv4Blocked:!r.exit_code&&!r.timed_out&&addresses.length>0&&addresses.every(function(a){return a==='0.0.0.0'})};
  return s;
 },function(){s.verification={domain:domain,checked:false,ipv4Blocked:false};return s;});
 });};
Filter.prototype.apply=function(enabled,domains){var self=this;if(this.busy)return Promise.reject(Error('Filter change already in progress'));try{domains=validate(domains);if(typeof enabled!=='boolean')throw Error('Invalid state');if(enabled&&!domains.length)throw Error('Add at least one domain')}catch(e){return Promise.reject(e)}this.busy=true;var config=Buffer.from(JSON.stringify({enabled:enabled,domains:domains})).toString('base64'),hosts=Buffer.from(MARKER+'\n'+domains.map(function(d){return '0.0.0.0 '+d+'\n:: '+d}).join('\n')+'\n').toString('base64');
function allNamespaces(inner){return 'seen=""\nfor f in /proc/[0-9]*/ns/mnt; do\n ns=$(readlink "$f") || continue\n case "|$seen|" in *"|$ns|"*) continue;; esac\n seen="$seen|$ns"\n pid=${f#/proc/}; pid=${pid%%/*}\n [ -x /proc/"$pid"/root/bin/sh ] || continue\n nsenter -t "$pid" -m -- /bin/sh -c '+"'"+inner+"'"+' || { [ ! -d /proc/"$pid" ] || echo skipped_namespace:"$pid"; }\ndone\n';}
var remove='if grep -q "'+MARKER+'" /etc/hosts && grep -q " /etc/hosts " /proc/mounts; then umount /etc/hosts; fi';
var script='set -e\nmkdir -p '+BASE+'\nchmod 700 '+BASE+'\n'+allNamespaces(remove);
if(enabled)script+='nsenter -t 1 -m -- cat /etc/hosts > '+BASE+'/hosts.original\ncp '+BASE+'/hosts.original '+BASE+'/hosts.filtered\necho '+hosts+' | base64 -d >> '+BASE+'/hosts.filtered\nchmod 644 '+BASE+'/hosts.filtered\n'+allNamespaces('if grep -q " /etc/hosts " /proc/mounts; then grep -q "'+MARKER+'" /etc/hosts && exit 0; echo "hosts managed by another component"; exit 1; fi; mount --bind '+BASE+'/hosts.filtered /etc/hosts');
script+='echo '+config+' | base64 -d > '+BASE+'/config.json\n';return this.execute(wrap(script),25000).then(function(r){var output=check(r);return self.status().then(function(s){s.namespaceWarnings=output.split('\n').filter(function(l){return /^skipped_namespace:/.test(l)});return s;});}).finally(function(){self.busy=false});};
Filter.prototype.restore=function(){var self=this;return this.status().then(function(s){return s.enabled&&!s.applied?self.apply(true,s.domains):s;});};
Filter.prototype.observe=function(){
var script="command -v tcpdump >/dev/null 2>&1 || { echo 'tcpdump unavailable' >&2; exit 127; }\nO=$(mktemp /tmp/vetro-dns.XXXXXX) || exit 1\nE=$O.err\ntrap 'rm -f \"$O\" \"$E\"' EXIT\ntcpdump -nn -l -i any -c 60 'udp dst port 53' >\"$O\" 2>\"$E\" &\np=$!\n(sleep 6; kill -INT \"$p\" 2>/dev/null) &\nw=$!\nwait \"$p\"; rc=$?\nkill \"$w\" 2>/dev/null; wait \"$w\" 2>/dev/null\ncat \"$O\"\ncat \"$E\" >&2\nexit \"$rc\"";
return this.execute(wrap(script),12000).then(function(r){var out=[];check(r).split('\n').forEach(function(l){var m=/\b(A|AAAA)\? ([a-zA-Z0-9_.-]+)\./.exec(l);if(m&&out.indexOf(m[2].toLowerCase())<0)out.push(m[2].toLowerCase())});return {domains:out,seconds:6,note:'UDP DNS only, in the capture namespace. No requests observed does not mean no traffic.'};});};

module.exports={Filter:Filter,validate:validate};
