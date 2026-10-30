import json,urllib.request,re,pathlib,sys,time,argparse
parser=argparse.ArgumentParser();parser.add_argument('phase',choices=['A','B']);parser.add_argument('--snapshot',required=True);parser.add_argument('--out',required=True);parser.add_argument('--base',default='http://127.0.0.1:8099');args=parser.parse_args()
base=args.base
snapshot=json.load(open(args.snapshot))
targets=[x for x in snapshot['/apps']['apps'] if x.get('disabled')]
def api(cmd):
 req=urllib.request.Request(base+'/exec',data=json.dumps({'cmd':cmd}).encode(),headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+__import__('os').environ['VETRO_TOKEN']} if __import__('os').environ.get('VETRO_TOKEN') else {})})
 with urllib.request.urlopen(req,timeout=35) as r:d=json.load(r)
 if not d.get('ok'):raise RuntimeError(str(d))
 return d
ids=[x['appId'] for x in targets]
if len(ids)!=5 or not all(re.fullmatch('[A-Za-z0-9_.-]+',x) for x in ids):raise SystemExit('Unexpected target set')
where=','.join("'"+x+"'" for x in ids)
q='sqlite3 -readonly /opt/dbspace/.pkgmgr_parser.db "SELECT app_id,app_disable,app_onboot,app_autorestart FROM package_app_info WHERE app_id IN ('+where+') ORDER BY app_id;"'
mode=args.phase;flag='-A' if mode=='A' else '-D';events=[]
try:
 for app in ids:
  d=api('pkgcmd '+flag+' -t app -n '+app+' --global');events.append({'appId':app,'result':d});print(app,d['output'][-120:],flush=True)
 state=api(q);print(state,flush=True);events.append({'verifiedRows':state})
 rows=[x.split('|') for x in state['output'].splitlines() if x]
 expected='false' if mode=='A' else 'true'
 if len(rows)!=5 or any(r[1]!=expected for r in rows):raise RuntimeError('Global flags not confirmed')
 originals={x['appId']:x for x in targets}
 for r in rows:
  o=originals[r[0]]
  if (r[2]=='true')!=o['onboot'] or (r[3]=='true')!=o['autorestart']:raise RuntimeError('Boot flag changed unexpectedly')
except Exception:
 if mode=='A':
  for app in ids:api('pkgcmd -D -t app -n '+app+' --global')
 raise
finally:pathlib.Path(args.out).write_text(json.dumps(events,indent=2))
