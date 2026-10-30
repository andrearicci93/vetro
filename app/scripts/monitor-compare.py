#!/usr/bin/env python3
"""Observer-cost comparison. Reads counters; never switches UI or TV settings."""
import argparse,base64,json,pathlib,time,urllib.request,re

def api(base,path,body=None):
    req=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+__import__('os').environ['VETRO_TOKEN']} if __import__('os').environ.get('VETRO_TOKEN') else {})})
    with urllib.request.urlopen(req,timeout=25) as response:return json.load(response)
def command(pids):
    script="echo __BOOT__; cat /proc/sys/kernel/random/boot_id; echo __UPTIME__; cat /proc/uptime; echo __CPU__; cat /proc/stat; echo __MEM__; cat /proc/meminfo; echo __VM__; cat /proc/vmstat; echo __ZRAM__; cat /sys/block/zram0/mm_stat; echo __BLOCK__; for d in mmcblk0 zram0; do printf '%s ' \"$d\"; cat /sys/block/$d/stat; done"
    for pid in pids:script+=f"; echo __PID__:{pid}; cat /proc/{pid}/stat /proc/{pid}/io 2>/dev/null"
    return 'echo '+base64.b64encode(script.encode()).decode()+' | base64 -d | sh'
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--base',default='http://127.0.0.1:8099');p.add_argument('--phase',choices=['closed','dashboard','task-manager'],required=True);p.add_argument('--seconds',type=int,default=60);p.add_argument('--interval',type=int,default=10);p.add_argument('--previous');p.add_argument('--out',required=True);a=p.parse_args()
    if not 30<=a.seconds<=300 or not 5<=a.interval<=30:p.error('duration 30–300s, interval 5–30s')
    out=pathlib.Path(a.out)
    if out.exists():p.error('Output exists; refusing overwrite')
    status=api(a.base,'/status');pids=sorted({x for x in [status.get('agent',{}).get('pid'),status.get('self',{}).get('pid')] if isinstance(x,int) and x>0})
    if len(pids)<2:p.error('Service and agent PID unavailable; comparison not reliable')
    boot=api(a.base,'/telemetry').get('boot_id')
    if not boot:p.error('Boot ID unavailable')
    if a.previous:
        prior=json.loads(pathlib.Path(a.previous).read_text())
        if not prior.get('complete') or prior['bootId']!=boot or prior['pids']!=pids or prior['seconds']!=a.seconds or prior['interval']!=a.interval:p.error('Comparison requires completed previous phase, same boot/PIDs/duration/interval')
    result={'phase':a.phase,'bootId':boot,'pids':pids,'seconds':a.seconds,'interval':a.interval,'complete':False,'method':'Read-only collector; UI phase declared by user, not inferred. No calls to /monitor. Observer overhead present in all phases.','samples':[]}
    start=time.monotonic();target=start;identities=None
    try:
        while target<=start+a.seconds:
            time.sleep(max(0,target-time.monotonic()));t=time.monotonic();r=api(a.base,'/exec',{'cmd':command(pids)})
            if not r.get('ok'):raise RuntimeError('Counter collection failed')
            if r['output'].split('__BOOT__\n',1)[1].splitlines()[0]!=boot:raise RuntimeError('Boot changed during collection')
            current={}
            for pid in pids:
                match=re.search(r'__PID__:'+str(pid)+r'\n'+str(pid)+r' \(.*\) (.*)',r['output'])
                if not match:raise RuntimeError('Observed process disappeared')
                fields=match.group(1).split();current[str(pid)]=fields[19]
            if identities is not None and identities!=current:raise RuntimeError('Observed process restarted')
            identities=current
            result['samples'].append({'elapsed':time.monotonic()-start,'latencyMs':(time.monotonic()-t)*1000,'raw':r['output']})
            out.write_text(json.dumps(result,indent=2));target+=a.interval
        result['complete']=True
    finally:out.write_text(json.dumps(result,indent=2))
if __name__=='__main__':main()
