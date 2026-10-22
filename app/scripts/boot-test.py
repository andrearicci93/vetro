#!/usr/bin/env python3
"""Read-only TV boot observer. Writes measurements only to the local output folder."""
import argparse
import concurrent.futures
import datetime
import json
import os
import pathlib
import select
import sys
import time
import urllib.request

ROUTES = ('/status', '/telemetry', '/probe')
MARKERS = {'r': 'reboot_requested', 'o': 'widget_open_requested',
           'a': 'ok_apps_visible', 'p': 'ok_packages_visible',
           'f': 'report_sent_visible'}


def stamp():
    return {'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'monotonic': time.monotonic()}


def compact(route, data):
    """Do not store full app inventories, agent logs, tokens or staging paths."""
    if route == '/telemetry':
        return {k: data.get(k) for k in ('boot_id', 'uptime_s', 'ts', 'loadavg')}
    if route == '/status':
        agent = data.get('agent') or {}
        return {'when': data.get('when'), 'pid': (data.get('self') or {}).get('pid'),
                'running': data.get('running'), 'prepared': data.get('prepared'),
                'agent': {k: agent.get(k) for k in ('connected', 'at', 'pid', 'uid')},
                'app': data.get('app'),
                'attempts': [{k: a.get(k) for k in ('t', 'phase', 'connect')}
                             for a in data.get('attempts', [])]}
    return {'receivedAt': data.get('receivedAt'),
            'appCount': len(data.get('apps', [])),
            'packageCount': len(data.get('packages', [])),
            'probe': {k: {'ok': v.get('ok')} for k, v in data.get('probe', {}).items()
                      if isinstance(v, dict)}}


def auth_headers():
    """Content type plus the paired key from VETRO_TOKEN, when Vetro's sign-in is on."""
    headers = {'Content-Type': 'application/json'}
    if os.environ.get('VETRO_TOKEN'):
        headers['Authorization'] = 'Bearer ' + os.environ['VETRO_TOKEN']
    return headers


def request(base, route, timeout=0.8, command=None):
    result = {'route': route, 'start': stamp()}
    try:
        body = None if command is None else json.dumps({'cmd': command}).encode()
        req = urllib.request.Request(base + route, data=body,
                                     headers=auth_headers())
        # A local TV must not be routed through a configured HTTP proxy.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(req, timeout=timeout) as response:
            data = json.load(response)
        result['data'] = compact(route, data) if route in ROUTES else data
        result['ok'] = True
    except Exception as error:
        result.update(ok=False, error=type(error).__name__ + ': ' + str(error))
    result['end'] = stamp()
    result['durationSeconds'] = result['end']['monotonic'] - result['start']['monotonic']
    return result


def sample(base, executor, include_probe=False, timeout=0.8):
    routes = ROUTES if include_probe else ROUTES[:2]
    futures = {route: executor.submit(request, base, route, timeout) for route in routes}
    return {route: future.result() for route, future in futures.items()}


def data_at(row, route):
    result = row.get(route, {})
    return result.get('data', {}) if result.get('ok') else {}


def baseline_valid(row):
    return bool(data_at(row, '/telemetry').get('boot_id') and
                data_at(row, '/status').get('when'))


def summarize(baseline, rows, markers, mode):
    original_boot = data_at(baseline, '/telemetry').get('boot_id')
    original_when = data_at(baseline, '/status').get('when')
    first = {}
    boots = set()
    failures = 0
    for row in rows:
        if not row['/status'].get('ok'):
            failures += 1
        telemetry = data_at(row, '/telemetry')
        boot = telemetry.get('boot_id')
        if not boot or boot == original_boot:
            continue
        boots.add(boot)
        status = data_at(row, '/status')
        first.setdefault('newBoot', row['/telemetry'])
        if status.get('when') and status['when'] != original_when:
            first.setdefault('newService', row['/status'])
            if status.get('agent', {}).get('connected'):
                first.setdefault('agentConnected', row['/status'])
        probe = data_at(row, '/probe')
        # A persisted report from before the boot is not a new probe completion.
        boot_epoch = (telemetry.get('ts') or 0) - (telemetry.get('uptime_s') or 0)
        if probe.get('receivedAt') and probe['receivedAt'] > boot_epoch:
            first.setdefault('newProbeReport', row['/probe'])
    result = {'newBootConfirmed': bool(boots), 'distinctNewBoots': len(boots),
              'httpFailures': failures,
              'firstObserved': {k: {'utc': v['end']['utc'],
                                   'monotonic': v['end']['monotonic']}
                                for k, v in first.items()}}
    if 'newService' in first and 'newBoot' in first:
        # Use telemetry from the SAME round as the first new service response.
        service_response = first['newService']
        row = next(r for r in rows if r.get('/status') is service_response)
        telemetry = data_at(row, '/telemetry')
        status = service_response['data']
        started = datetime.datetime.fromisoformat(status['when'].replace('Z', '+00:00')).timestamp()
        boot_epoch = telemetry['ts'] - telemetry['uptime_s']
        result['serviceInitializationApproxBootSeconds'] = round(started - boot_epoch, 3)
        result['firstServiceObservationUptimeSeconds'] = telemetry['uptime_s']
    if 'agentConnected' in first:
        status = first['agentConnected']['data']
        started = datetime.datetime.fromisoformat(status['when'].replace('Z', '+00:00')).timestamp()
        if status['agent'].get('at') is not None:
            result['initializationToAgentSeconds'] = round(status['agent']['at'] / 1000 - started, 3)
    by_name = {}
    for marker in markers:
        by_name.setdefault(marker['name'], marker)
    if 'ok_apps_visible' in by_name and 'ok_packages_visible' in by_name:
        result['observedAppsToPackagesSeconds'] = round(
            by_name['ok_packages_visible']['monotonic'] - by_name['ok_apps_visible']['monotonic'], 3)
    visual_marked = any(m['name'] in ('widget_open_requested', 'ok_apps_visible',
                                    'ok_packages_visible', 'report_sent_visible') for m in markers)
    result['passiveRunContaminatedByWidget'] = mode == 'passive' and (
        visual_marked or 'newProbeReport' in first)
    result['captureComplete'] = bool(len(boots) == 1 and 'agentConnected' in first and
                                    not result['passiveRunContaminatedByWidget'] and
                                    (mode == 'passive' or all(k in by_name for k in
                                     ('widget_open_requested', 'ok_apps_visible', 'ok_packages_visible'))))
    result['limitations'] = [
        'HTTP reachability is not ICMP/network readiness; a failed request does not prove reboot.',
        'First observations are polling bounds, not exact readiness times; request intervals are in events.jsonl.',
        'TV wall-clock timestamps have approximately 1-second telemetry precision and may be affected by clock corrections.',
        'Human markers include reaction time; persisted probes are never treated as current screen state.',
        'Opening the widget may influence service startup. Compare passive and visual runs separately.',
    ]
    return result


def process_snapshot(base, pid):
    if not isinstance(pid, int) or pid < 1:
        return {'ok': False, 'error': 'No valid service PID'}
    # Only reading existing process metadata and systemd properties. No TV writes.
    command = ('getconf CLK_TCK; cat /proc/' + str(pid) + '/stat; cat /proc/uptime; '
               'systemctl show org.tizen.webappservice.service ac.service booting-done.service '
               '-p Id -p ExecMainStartTimestampMonotonic -p ActiveEnterTimestampMonotonic')
    result = request(base, '/exec', timeout=10, command=command)
    raw = result.get('data', {})
    if raw.get('ok'):
        try:
            lines = raw['output'].splitlines()
            ticks = int(lines[0])
            fields = lines[1].rsplit(')', 1)[1].split()
            result['processStartBootSeconds'] = int(fields[19]) / ticks
            result['snapshotUptimeSeconds'] = float(lines[2].split()[0])
        except (KeyError, ValueError, IndexError, ZeroDivisionError):
            result['parseError'] = 'Process timing unavailable; inspect raw output.'
    return result


def save_summary(out, baseline, rows, markers, mode, snapshot, reason):
    report = summarize(baseline, rows, markers, mode)
    report.update(mode=mode, stopReason=reason, processSnapshot=snapshot)
    pending = out / 'summary.tmp'
    pending.write_text(json.dumps(report, indent=2) + '\n')
    pending.replace(out / 'summary.json')
    return report


def record(args):
    out = pathlib.Path(args.out).expanduser().resolve()
    if out.exists():
        raise SystemExit('Output folder already exists: choose a new --out.')
    rows, markers, snapshot = [], [], None
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        baseline = sample(args.base, pool, True, 3)
        if not baseline_valid(baseline):
            raise SystemExit('Preflight failed: /status and /telemetry must respond before the reboot.')
        out.mkdir(parents=True)
        (out / 'baseline.json').write_text(json.dumps(baseline, indent=2) + '\n')
        (out / 'plan.json').write_text(json.dumps(vars(args), indent=2) + '\n')
        print('ARMED — ' + str(out), flush=True)
        print('Mode: ' + args.mode + '. This tool never reboots the TV or opens apps on it.', flush=True)
        print('Type a letter + Enter: r reboot requested, o Vetro opened, a ok apps,', flush=True)
        print('p ok packages, f report sent, q finish. Ctrl-C still saves.', flush=True)
        started = time.monotonic()
        due = started
        probe_due = started
        snapshot_future = None
        observed = set()
        last_up = True
        reason = 'duration_elapsed'
        read_stdin = True
        with (out / 'events.jsonl').open('x', buffering=1) as stream:
            def event(kind, value):
                stream.write(json.dumps({'type': kind, **value}) + '\n')
                stream.flush()
            try:
                while time.monotonic() - started < args.duration:
                    if read_stdin and select.select([sys.stdin], [], [], 0)[0]:
                        line = sys.stdin.readline()
                        if not line:
                            read_stdin = False
                        else:
                            key = line.strip().lower()
                            if key == 'q':
                                reason = 'user_finished'
                                break
                            if key in MARKERS:
                                marker = {'name': MARKERS[key], **stamp()}
                                markers.append(marker)
                                event('marker', marker)
                                print('Marked: ' + marker['name'], flush=True)
                    now = time.monotonic()
                    if now < due:
                        time.sleep(min(0.05, due - now))
                        continue
                    row = sample(args.base, pool, now >= probe_due, args.timeout)
                    if now >= probe_due:
                        probe_due = now + 5
                    rows.append(row)
                    event('sample', {'results': row})
                    up = row['/status']['ok']
                    if up != last_up:
                        print('Vetro HTTP: ' + ('reachable' if up else 'unreachable'), flush=True)
                        last_up = up
                    summary = summarize(baseline, rows, markers, args.mode)
                    for name in summary['firstObserved']:
                        if name not in observed:
                            print('Observed: ' + name, flush=True)
                            observed.add(name)
                    if 'agentConnected' in observed and snapshot_future is None:
                        pid = data_at(row, '/status').get('pid')
                        snapshot_future = pool.submit(process_snapshot, args.base, pid)
                    if snapshot_future is not None and snapshot_future.done() and snapshot is None:
                        snapshot = snapshot_future.result()
                        event('processSnapshot', snapshot)
                    save_summary(out, baseline, rows, markers, args.mode, snapshot, 'recording')
                    due = max(due + args.interval, time.monotonic())
            except KeyboardInterrupt:
                reason = 'interrupted'
            finally:
                if snapshot_future is not None and snapshot is None:
                    snapshot = snapshot_future.result()
                    event('processSnapshot', snapshot)
                report = save_summary(out, baseline, rows, markers, args.mode, snapshot, reason)
        print('Saved: ' + str(out / 'summary.json'), flush=True)
        print('New boot confirmed: ' + str(report['newBootConfirmed']), flush=True)
        print('Capture complete: ' + str(report['captureComplete']), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('preflight', 'record'))
    tv_ip = os.environ.get('TV_IP')
    parser.add_argument('--base', default='http://' + tv_ip + ':8099' if tv_ip else None,
                        help='Vetro service URL, e.g. http://TV_IP:8099 (default: from TV_IP)')
    parser.add_argument('--mode', choices=('passive', 'visual'), default='passive')
    parser.add_argument('--out')
    parser.add_argument('--duration', type=float, default=600)
    parser.add_argument('--interval', type=float, default=1)
    parser.add_argument('--timeout', type=float, default=0.8)
    args = parser.parse_args()
    if not args.base:
        parser.error('pass --base http://TV_IP:8099 or set TV_IP')
    args.base = args.base.rstrip('/')
    if args.interval < 0.5 or args.timeout <= 0 or args.duration <= 0:
        parser.error('interval must be >= 0.5; timeout and duration must be positive')
    if args.action == 'preflight':
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            row = sample(args.base, pool, True, 3)
        for route, response in row.items():
            print(route, 'OK' if response['ok'] else response.get('error'),
                  '%.3fs' % response['durationSeconds'])
        if baseline_valid(row):
            print('READY: baseline readable. No reboot and no writes to the TV.')
            probe = data_at(row, '/probe')
            print('Persisted probe: apps=%s packages=%s receivedAt=%s' %
                  (probe.get('appCount'), probe.get('packageCount'), probe.get('receivedAt')))
        else:
            raise SystemExit(1)
    else:
        if not args.out:
            parser.error('record requires --out')
        record(args)


if __name__ == '__main__':
    main()
