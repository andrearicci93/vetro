#!/usr/bin/env python3
import json,pathlib,statistics
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=pathlib.Path(__file__).resolve().parents[1];D=ROOT/'diagnostics';data={p:json.loads((D/f'benchmark-{p}-20261011.json').read_text(encoding='utf-8')) for p in ['A','B']}
for d in data.values():
 if not d['completed']:raise SystemExit('Incomplete phase')
assert data['A']['planHash']==data['B']['planHash'];assert data['A']['bootId']!=data['B']['bootId']
fig,axes=plt.subplots(3,1,figsize=(11,8),sharex=True);colors={'A':'#929a9f','B':'#23745c'};summary={}
for phase,d in data.items():
 samples=[x for x in d['samples'] if 'monitor'in x];t=[x['elapsed'] for x in samples];m=[x['monitor'] for x in samples];cpu=[x['cpu']['percent'] for x in m];ram=[x['memory']['availableBytes']/1048576 for x in m];swap=[x['memory']['swapFreeBytes']/1048576 for x in m]
 label='A · five apps re-enabled' if phase=='A' else 'B · original debloat'
 axes[0].plot(t,cpu,color=colors[phase],label=label);axes[1].plot(t,ram,color=colors[phase]);axes[2].plot(t,swap,color=colors[phase]);summary[phase]={'samples':len(samples),'durationSeconds':d['durationSeconds'],'initialRamMiB':d['initial']['memory']['availableBytes']/1048576,'meanCpuPercent':statistics.mean(x for x in cpu if x is not None),'medianRamMiB':statistics.median(ram),'minRamMiB':min(ram),'endRamMiB':ram[-1],'endSwapFreeMiB':swap[-1],'medianKeyAckMs':statistics.median(x['ackSeconds']*1000 for x in d['actions'] if x['path']=='/control')}
 for index,app in enumerate(d['plan']['apps']):
  start=next(x['elapsed'] for x in d['actions'] if x['body'].get('appId')==app);end=next((x['elapsed'] for x in d['actions'] if x['path']=='/apps/launch' and x['elapsed']>start),d['durationSeconds']);stage=[x['monitor']for x in samples if start<=x['elapsed']<end];stage_cpu=[x['cpu']['percent']for x in stage if x['cpu']['percent']is not None];stage_ram=[x['memory']['availableBytes']/1048576 for x in stage];summary[phase][app]={'meanCpuPercent':statistics.mean(stage_cpu) if stage_cpu else None,'medianRamMiB':statistics.median(stage_ram) if stage_ram else None}
for ax,label in zip(axes,['Total CPU (%)','Available RAM (MiB)','Free swap (MiB)']):
 ax.set_ylabel(label);ax.grid(axis='y',alpha=.2);ax.spines[['top','right']].set_visible(False)
 for x in [30,55,80,105,131,156]:ax.axvline(x,color='#dddddd',linewidth=.8)
axes[0].legend(frameon=False,loc='upper left');axes[2].set_xlabel('Seconds from sequence start');axes[0].set_title('Vetro · first A/B comparison after full power-off',loc='left',pad=18)
for x,name in [(30,'YouTube'),(55,'Stremio'),(80,'Disney+'),(105,'Prime'),(131,'Netflix'),(156,'Scroll')]:axes[0].text(x+1,1.01,name,transform=axes[0].get_xaxis_transform(),fontsize=8)
fig.text(.09,.015,'One exploratory pair; cache/network remain variable. FPS and visual load times not measured.',fontsize=9,color='#737b84');fig.tight_layout(rect=(0,.04,1,1));fig.savefig(D/'benchmark-AB-20261011.png',dpi=160);fig.savefig(D/'benchmark-AB-20261011.svg');(D/'benchmark-summary-20261011.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
report='''# First A/B comparison — Q80A, 2026-10-11

Both sequences completed and were visually confirmed by the owner. Five apps and twelve keys; no errors in the samples. Two different boots, with initial uptime aligned within 0.28 s. Vetro version unchanged across phases; no DNS or HbbTV changes. A re-enables the five initial app_disable flags; B restores exactly those flags, without changing onboot/autorestart. This is not equivalent to a TV restored to factory settings.

| Measure | A | B |
|---|---:|---:|
'''
for title,key,unit in [('Initial available RAM','initialRamMiB',' MiB'),('Median available RAM','medianRamMiB',' MiB'),('Minimum available RAM','minRamMiB',' MiB'),('Final available RAM','endRamMiB',' MiB'),('Overall mean CPU','meanCpuPercent','%'),('Final free swap','endSwapFreeMiB',' MiB'),('Median key command response','medianKeyAckMs',' ms')]:report+=f'| {title} | {summary["A"][key]:.1f}{unit} | {summary["B"][key]:.1f}{unit} |\n'
report+='''
![Comparison chart](../diagnostics/benchmark-AB-20261011.png)

In this pair, B ends with about 43 MiB more available memory and about 2.5 percentage points lower mean CPU. The median RAM difference is larger, but the starting point and intermediate phases show variability. B already started with more available RAM but also more used swap; final free swap is lower in B. Not every indicator improves, and the different RAM/swap balance does not show an equivalent reduction of total memory load.

During A, only ACR was observed among the five targets (peak RSS ~17.5 MiB, minimal CPU activity); the other four were absent from the samples. In B none of the five was observed. They may be active during startup, before the sampled window. The test shows that the global flags persist and that ACR is absent in B, but **it does not causally attribute all differences to the five targets** and does not show improved smoothness. More pairs, preferably ABBA, and a visual timing/frame measurement are needed.

Key times are HTTP/native injection acknowledgements, not input-to-photon latency. Launch times are launcher acknowledgements; some processes may be preloaded. Time to a usable screen was not measured. The compositor getter returns an uninterpreted `a(usiud)` ABI: raw records are kept, with no "below 60 FPS" count. Actual intervals between keys include acknowledgement time and are recorded: sequence and pauses are identical, real timings are not exactly identical.

## DNS and final state

After B, the local filter is active. `config.samsungads.com` resolves to 0.0.0.0 and :: through getent in the Netflix, YouTube and Vetro namespaces. This tests the resolver in those namespaces, not every HTTP request made inside the apps. Custom resolver and fallback DNS unchanged; HbbTV remains at value 20. Output is kept in benchmark-postflight and dns-namespace. No new blocklist applied.

The five original flags are restored and verified after boot B. No uninstalls or startup-flag changes. Raw A/B data, pkgcmd output and the initial snapshot are in diagnostics; the plan and script are in scripts/benchmark-tv.py and docs/BENCHMARK.md.
'''
(ROOT/'docs/BENCHMARK-RESULTS-20261011.md').write_text(report,encoding='utf-8')
print(json.dumps({p:{k:v for k,v in s.items() if not isinstance(v,dict)}for p,s in summary.items()},indent=2))
