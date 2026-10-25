#!/usr/bin/env python3
"""Exercise the recorder against a fake TV, including a real HTTP outage."""
import contextlib
import http.server
import json
import pathlib
import runpy
import subprocess
import sys
import tempfile
import threading
import time
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'scripts' / 'boot-test.py'
MODULE = runpy.run_path(str(SCRIPT))


def fixture(boot='old', generation='old', probe_time=50):
    when = '2026-10-11T19:00:00+00:00' if generation == 'old' else '2026-10-11T20:00:00+00:00'
    epoch = MODULE['datetime'].datetime.fromisoformat(when).timestamp()
    return {'/status': {'when': when, 'self': {'pid': 123}, 'running': True,
                        'agent': {'connected': True, 'at': (epoch + 1.5) * 1000}},
            '/telemetry': {'boot_id': boot, 'ts': epoch + 5, 'uptime_s': 105},
            '/probe': {'receivedAt': probe_time, 'apps': [], 'packages': []}}


def row(values):
    return {route: {'ok': True, 'data': MODULE['compact'](route, value),
                    'start': MODULE['stamp'](), 'end': MODULE['stamp']()}
            for route, value in values.items()}


class BootTests(unittest.TestCase):
    def test_service_restart_is_not_reboot(self):
        baseline = row(fixture())
        result = MODULE['summarize'](baseline, [row(fixture(generation='new'))], [], 'passive')
        self.assertFalse(result['newBootConfirmed'])
        self.assertFalse(result['captureComplete'])

    def test_outage_alone_is_not_reboot(self):
        outage = {'/status': {'ok': False}, '/telemetry': {'ok': False}}
        result = MODULE['summarize'](row(fixture()), [outage, row(fixture())], [], 'passive')
        self.assertEqual(result['httpFailures'], 1)
        self.assertFalse(result['captureComplete'])

    def test_reboot_timings_and_stale_probe(self):
        result = MODULE['summarize'](row(fixture()), [row(fixture('new', 'new'))], [], 'passive')
        self.assertTrue(result['captureComplete'])
        self.assertEqual(result['serviceInitializationApproxBootSeconds'], 100)
        self.assertEqual(result['initializationToAgentSeconds'], 1.5)
        self.assertNotIn('newProbeReport', result['firstObserved'])

    def test_visual_markers_and_passive_contamination(self):
        markers = [{'name': name, 'monotonic': value} for name, value in
                   [('widget_open_requested', 1), ('ok_apps_visible', 3), ('ok_packages_visible', 65)]]
        values = [row(fixture('new', 'new'))]
        passive = MODULE['summarize'](row(fixture()), values, markers, 'passive')
        visual = MODULE['summarize'](row(fixture()), values, markers, 'visual')
        self.assertFalse(passive['captureComplete'])
        self.assertTrue(visual['captureComplete'])
        self.assertEqual(visual['observedAppsToPackagesSeconds'], 62)
        missing = MODULE['summarize'](row(fixture()), values, [], 'visual')
        self.assertFalse(missing['captureComplete'])

    def test_multiple_reboots_not_single_success(self):
        result = MODULE['summarize'](row(fixture()),
                                     [row(fixture('new', 'new')), row(fixture('third', 'new'))], [], 'passive')
        self.assertEqual(result['distinctNewBoots'], 2)
        self.assertFalse(result['captureComplete'])

    def test_actual_recorder_http_outage_and_local_artifacts(self):
        routes = []
        started = time.monotonic()

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                routes.append(('GET', self.path))
                age = time.monotonic() - started
                if 0.45 < age < 1.05:
                    self.send_error(503)
                    return
                current = fixture('new', 'new') if age >= 1.05 else fixture()
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(current[self.path]).encode())

            def do_POST(self):
                routes.append(('POST', self.path))
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                # /proc/<pid>/stat fields 3..21 followed by starttime (field 22).
                fields = ['S'] + ['0'] * 18 + ['24500'] + ['0'] * 5
                if 'DOCKSTAT' in body['cmd']:
                    self.server.launcher_command = body['cmd']
                    late = ['S'] + ['0'] * 18 + ['30000'] + ['0'] * 5
                    output = ('250\n130.0 100\nDOCKSTAT 77 (dotnet) ' + ' '.join(late) +
                              '\nCSFSSTAT 55 (csfs) ' + ' '.join(fields) + '\nDOCKLOG\n12:00:00.1 start\n')
                else:
                    self.server.command = body['cmd']
                    output = '250\n123 (vetrotvapp.svc) ' + ' '.join(fields) + '\n105.0 100\n'
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({'ok': True, 'output': output}).encode())

        with http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                with tempfile.TemporaryDirectory(prefix='vetro-boot-test-') as directory:
                    out = pathlib.Path(directory) / 'capture'
                    cmd = [sys.executable, str(SCRIPT), 'record', '--base',
                           'http://127.0.0.1:' + str(server.server_port), '--out', str(out),
                           '--duration', '2.3', '--interval', '0.5', '--timeout', '0.2']
                    result = subprocess.run(cmd, input='', text=True, capture_output=True, timeout=8)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    report = json.loads((out / 'summary.json').read_text())
                    self.assertTrue(report['captureComplete'])
                    self.assertGreater(report['httpFailures'], 0)
                    self.assertEqual(report['processSnapshot']['processStartBootSeconds'], 98)
                    events = [json.loads(line) for line in (out / 'events.jsonl').read_text().splitlines()]
                    self.assertTrue(any(event['type'] == 'sample' for event in events))
                    self.assertTrue(any(event['type'] == 'processSnapshot' for event in events))
                    self.assertEqual(routes.count(('POST', '/exec')), 2, 'one service snapshot, one launcher snapshot')
                    launcher = report['processSnapshot']['launcher']
                    self.assertEqual(launcher['dockStartBootSeconds'], 120)
                    self.assertEqual(launcher['csfsStartBootSeconds'], 98)
                    self.assertTrue(launcher['dockRunning'] and launcher['samsungHomeRunning'])
                    self.assertEqual(launcher['dockLogTail'], ['12:00:00.1 start'])
                    self.assertTrue(any(event['type'] == 'launcherSnapshot' for event in events))
                    self.assertNotIn('>', server.launcher_command.replace('2>/dev/null', ''), 'read-only: no redirection that writes')
                    self.assertTrue(set(routes) <= {('GET', path) for path in MODULE['ROUTES']} | {('POST', '/exec')})
                    self.assertIn('cat /proc/123/stat', server.command)
                    again = subprocess.run(cmd, input='', text=True, capture_output=True, timeout=3)
                    self.assertNotEqual(again.returncode, 0, 'Must not overwrite an earlier capture')
            finally:
                server.shutdown()


if __name__ == '__main__':
    unittest.main(verbosity=2)
