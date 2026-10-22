#!/usr/bin/env python3
"""Reproducible TV workload. No factory reset, power, debloat or network writes."""
import argparse, json, pathlib, threading, time, urllib.request, hashlib
APPS=['com.samsung.tv.cobalt-yt','newslO9NqF.stremio','MCmYXNxgcu.DisneyPlus','org.tizen.primevideo','org.tizen.netflix-app']
PLAN={'apps':APPS,'settleSeconds':30,'appWaitSeconds':25,'keyIntervalSeconds':0.8,'netflixKeys':['Down']*6+['Up']*6,'samplesEverySeconds':3}
FPS='busctl --system call org.enlightenment.wm /org/enlightenment/wm org.enlightenment.wm.info get_fps_info'
FLAGS="sqlite3 -readonly /opt/dbspace/.pkgmgr_parser.db \"SELECT app_id,app_disable,app_onboot,app_autorestart FROM package_app_info WHERE app_disable='true' ORDER BY app_id;\""
def api(base,path,body=None):
    req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+__import__('os').environ['VETRO_TOKEN']} if __import__('os').environ.get('VETRO_TOKEN') else {})})
    with urllib.request.urlopen(req,timeout=30) as r:return json.load(r)
def main():
    p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:8099');p.add_argument('--phase',choices=['A','B'],required=True);p.add_argument('--out',required=True);p.add_argument('--snapshot',required=True);p.add_argument('--expected-boot');p.add_argument('--previous');a=p.parse_args()
    out=pathlib.Path(a.out)
    if out.exists():raise SystemExit('Output already exists; measurements are never overwritten')
    baseline=json.loads(pathlib.Path(a.snapshot).read_text());installed=api(a.base,'/apps')['apps'];ids={x['appId'] for x in installed}
    if not all(x in ids for x in APPS):raise SystemExit('One of the five planned apps is missing')
    expected=set() if a.phase=='A' else {x['appId'] for x in baseline['/apps']['apps'] if x.get('disabled')}
    flags=api(a.base,'/exec',{'cmd':FLAGS})
    if not flags.get('ok'):raise SystemExit('Global flags unreadable')
    actual={line.split('|')[0] for line in flags['output'].splitlines() if line}
    if actual!=expected:raise SystemExit('Flags differ from the expected phase; benchmark not run')
    initial=api(a.base,'/monitor');boot=initial.get('telemetry',{}).get('boot_id')
    if not boot or (a.expected_boot and boot==a.expected_boot):raise SystemExit('New boot not confirmed')
    planHash=hashlib.sha256(json.dumps(PLAN,sort_keys=True).encode()).hexdigest()
    if a.previous:
        previous=json.loads(pathlib.Path(a.previous).read_text())
        if previous['planHash']!=planHash or previous['bootId']==boot:raise SystemExit('Different plan or same boot as the previous phase')
        if previous['phase']==a.phase:raise SystemExit('Previous phase must be different')
        target=previous['initialUptimeSeconds']
        while initial['uptimeSeconds']<target:
            remaining=target-initial['uptimeSeconds'];print('Settling: '+str(round(remaining))+' seconds until the same initial uptime',flush=True);time.sleep(min(remaining,15));initial=api(a.base,'/monitor')
            if initial.get('telemetry',{}).get('boot_id')!=boot:raise SystemExit('TV rebooted while settling')
    report={'phase':a.phase,'bootId':boot,'initialUptimeSeconds':initial['uptimeSeconds'],'plan':PLAN,'planHash':planHash,'disabled':sorted(actual),'bootAgeDifferenceSeconds':initial['uptimeSeconds']-previous['initialUptimeSeconds'] if a.previous else None,'initial':initial,'samples':[],'actions':[],'completed':False,'limitations':['HTTP acknowledgement is not visual app readiness','FPS records are compositor diagnostics, not per-frame presentation times','Network responses, persisted caches and streaming-app state are not reset by cold boot']}
    lock=threading.Lock();stop=threading.Event();start=time.monotonic()
    def save():
        with lock:
            tmp=out.with_suffix(out.suffix+'.tmp');tmp.write_text(json.dumps(report,indent=2));tmp.replace(out)
    def sampler():
        while not stop.is_set():
            sample={'elapsed':time.monotonic()-start}
            try:
                m=api(a.base,'/monitor');m.pop('telemetry',None);sample['monitor']=m
                sample['fpsRaw']=api(a.base,'/exec',{'cmd':FPS})
            except Exception as e:sample['error']=str(e)
            with lock:report['samples'].append(sample)
            save();stop.wait(PLAN['samplesEverySeconds'])
    def action(path,body):
        t=time.monotonic();response=api(a.base,path,body);entry={'elapsed':t-start,'path':path,'body':body,'ackSeconds':time.monotonic()-t,'response':response}
        with lock:report['actions'].append(entry)
        save();print(json.dumps(entry),flush=True)
        if response.get('ok') is False or response.get('error'):raise RuntimeError('Action not confirmed: '+str(response))
    save();thread=threading.Thread(target=sampler,daemon=True);thread.start()
    try:
        time.sleep(PLAN['settleSeconds'])
        for app in APPS:
            action('/apps/launch',{'appId':app});time.sleep(PLAN['appWaitSeconds'])
            if app==APPS[-1]:
                for key in PLAN['netflixKeys']:
                    action('/control',{'key':key});time.sleep(PLAN['keyIntervalSeconds'])
        report['completed']=True
    finally:
        stop.set();thread.join(35);report['durationSeconds']=time.monotonic()-start;save()
    print('Saved '+str(out),flush=True)
if __name__=='__main__':main()
