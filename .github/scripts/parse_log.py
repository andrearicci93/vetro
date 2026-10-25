#!/usr/bin/env python3
"""Deterministic Vetro report analysis. Never execute or quote submitted logs."""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

MAX_BYTES = 2 * 1024 * 1024
MARKER = '<!-- vetro-log-analysis:v1 -->'
SIGNATURES = {
    'Root acquisition failure': r'\b(non-root agent|no root agent connected|root acquisition failed)\b',
    'Process crash': r'\b(segmentation fault|SIGSEGV|segfault)\b',
    'Permission failure': r'\b(permission denied|EACCES|EPERM)\b',
    'Connection refused': r'\b(ECONNREFUSED|connection refused)\b',
    'Port conflict': r'\b(EADDRINUSE|address already in use)\b',
    'Timeout': r'\b(timed out|timeout)\b',
    'Probe response failure': r'\b(response is not JSON|report rejected)\b',
}


SECTIONS = ('platform', 'device', 'inventory', 'settings', 'catalog', 'monitor', 'startup', 'network', 'dns', 'mqtt', 'privacy', 'hbbtv', 'launcher', 'quickWins', 'components', 'probe', 'serviceApis')
STATUSES = ('unavailable', 'timeout')
REASONS = {
    'no-root-agent': 'no root agent connected',
    'command-timeout': 'command timed out',
    'command-failed': 'command failed',
    'incomplete': 'incomplete data',
    'unreadable': 'source unreadable',
    'report-deadline': 'report deadline reached',
    'no-reader': 'not collected',
    'not-requested': 'not requested',
    'error': 'error',
}


def safe_token(value):
    return value if isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_.-]{1,100}', value) else 'Unknown'


def analyze(text):
    if not text.strip():
        raise ValueError('Empty report')
    findings = []
    signatures = None
    try:
        report = json.loads(text)
    except json.JSONDecodeError:
        if text.lstrip().startswith(('{', '[')):
            raise ValueError('Invalid JSON report') from None
        report = None
    if report is None:
        findings.append(('Format', 'Legacy text; no structured compatibility evidence'))
        findings.append(('Root', 'Log claims UID 0' if re.search(r'\b(?:e?uid)[=: ]+0\b', text) else 'Unknown'))
        findings.append(('Persistence / background execution', 'Unknown; a text signature is not a cold-boot test'))
        findings.append(('Connectivity', 'Failure signature present' if re.search(SIGNATURES['Connection refused'], text, re.I) else 'Unknown'))
        compatibility = 'Unknown. Please download the JSON report from Diagnostics.'
    else:
        if not isinstance(report, dict) or report.get('format') != 'vetro-diagnostics' or report.get('schemaVersion') != 1:
            raise ValueError('Unsupported report format or schema version')
        sections = report.get('sections')
        if not isinstance(sections, dict) or len(sections) > 100:
            raise ValueError('Invalid report sections')
        def data(name):
            section = sections.get(name, {})
            if not isinstance(section, dict) or section.get('status') != 'ok':
                return {}
            value = section.get('data', {})
            return value if isinstance(value, dict) else {}
        device = data('device')
        model = safe_token(device.get('realModel') or device.get('model'))
        firmware = safe_token(device.get('firmware'))
        findings.extend([('Model', model), ('Firmware', firmware)])
        age = device.get('probeAgeMinutes')
        if device.get('source') == 'widget-probe':
            findings.append(('Model/firmware source', 'Reported by the Vetro widget' + (f'; last probe about {age} min before export' if type(age) is int and 0 <= age < 10**7 else '; probe age unknown') + ' (not read live)'))
        if device.get('firmwareSource') == 'service-read':
            findings.append(('Firmware source', 'Read from the TV by the Vetro service; the widget probe had not arrived'))
        tizen = device.get('tizenVersion')
        if isinstance(tizen, str) and re.fullmatch(r'\d{1,2}\.\d{1,2}\.\d{1,2}', tizen):
            findings.append(('Tizen version', tizen))
        revision = report.get('sourceRevision')
        if isinstance(revision, str) and re.fullmatch(r'[a-f0-9]{40}', revision):
            dirty = report.get('sourceDirty')
            findings.append(('Source revision', revision[:7] + (' (build differed from it)' if dirty is True else ' (matched at build)' if dirty is False else ' (build state not recorded)')))
        p = data('platform')
        agent = p.get('rootAgent') if isinstance(p.get('rootAgent'), dict) else {}
        connected, uid = agent.get('connected'), agent.get('uid')
        root = 'Reported connected with UID 0' if connected is True and type(uid) is int and uid == 0 else 'Reported disconnected' if connected is False else 'Reported connected without UID-0 confirmation' if connected is True else 'Unknown (platform section missing or incomplete)'
        findings.append(('Root agent', root))
        running = p.get('running')
        findings.append(('Vetro service', 'Reported running at capture time' if running is True else 'Reported stopped' if running is False else 'Unknown'))
        findings.append(('Persistence / background execution', 'Unknown; requires a new cold boot without manually opening Vetro'))
        net = data('network')
        services = net.get('services', [])
        active = any(isinstance(x, dict) and x.get('state') in ('ready', 'online') for x in services) if isinstance(services, list) else False
        findings.append(('IP connectivity', 'Network interface reported ready; not an Internet or DNS reachability test' if active else 'No ready interface confirmed'))
        probe = data('probe')
        reach = probe.get('serviceReach', {})
        findings.append(('Loopback service probe', 'Succeeded when probed' if isinstance(reach, dict) and reach.get('available') is True else 'Unknown or failed'))
        inventory = data('inventory').get('apps')
        if isinstance(inventory, list):
            findings.append(('App components', str(len(inventory))))
            disabled = sum(isinstance(x, dict) and x.get('disabled') is True for x in inventory)
            findings.append(('Disabled components', str(disabled)))
        controls = data('settings').get('items')
        if isinstance(controls, list):
            findings.append(('TV controls with a write path in Vetro', str(sum(isinstance(x, dict) and x.get('writable') is True and x.get('available') is True for x in controls)) + ' (not written or tested on this TV by the export)'))
        if isinstance(controls, list):
            api = data('settings').get('api')
            gated = [x for x in controls if isinstance(x, dict) and (x.get('access') == 'firmware' or x.get('probe') is not None)]
            if gated:
                states = {}
                for x in gated:
                    state = x.get('probe') if x.get('probe') in ('confirmed', 'missing', 'signature-mismatch') else 'unchecked'
                    states[state] = states.get(state, 0) + 1
                methods = api.get('methods') if isinstance(api, dict) and type(api.get('methods')) is int and 0 <= api['methods'] <= 5000 else None
                findings.append(('Controls checked against the TV method list', ', '.join(f'{n} {s}' for s, n in sorted(states.items())) + (f' ({methods} picture API methods exposed)' if methods is not None else '')))
        memory = data('monitor').get('memory', {})
        ram = memory.get('availableBytes') if isinstance(memory, dict) else None
        if type(ram) in (int, float) and 0 <= ram <= 2**50:
            findings.append(('Available RAM at capture', f'{ram / 1048576:.0f} MiB (not a performance comparison)'))
        packages = data('components').get('packages')
        if isinstance(packages, list):
            rows = [x for x in packages if isinstance(x, dict)]
            differing = [(x, c) for x in rows for c in (x.get('components') if isinstance(x.get('components'), list) else []) if isinstance(c, dict) and c.get('differs') is True]
            findings.append(('Component details', f'{len(rows)} unrecognised packages read' + (f'; {len(differing)} with start flags that differ from their manifest' if differing else '')))
            # Names only for system, preinstalled and Vetro's own packages: other app names can identify the household.
            shown = [safe_token(c.get('appId')) for x, c in differing if x.get('origin') in ('system', 'preinstalled') or str(x.get('packageId', '')).startswith('vetrotvapp')][:5]
            if shown:
                findings.append(('Start flags differ from the manifest', ', '.join(shown)))
        missing = []
        for name in SECTIONS:
            section = sections.get(name)
            if not isinstance(section, dict) or section.get('status') == 'ok':
                continue
            if section.get('reason') == 'not-requested':
                continue  # opt-in section the reporter did not tick
            status = section.get('status') if section.get('status') in STATUSES else 'unavailable'
            reason = REASONS.get(section.get('reason'), 'reason not recorded')
            code = section.get('exitCode')
            missing.append(f'{name} ({status}: {reason}' + (f', exit code {code}' if type(code) is int and 0 <= code <= 255 else '') + ')')
        extra = sum(1 for name in sections if name not in SECTIONS)
        findings.append(('Sections not collected', f'{len(missing)}' + (': ' + '; '.join(missing) if missing else '') + (f' (plus {extra} unrecognised)' if extra else '')))
        signatures = []
        if model == 'QE50Q80AATXZT' and firmware == 'T-NKM2DEUC-2301.1':
            compatibility = 'Matches the model and firmware of the single tested TV. This submitted snapshot is not independent verification of compatibility or persistence.'
        else:
            compatibility = 'Unverified model/firmware combination. A maintainer must review available controls before recommending changes.'
    if signatures is None:
        # Text signatures only make sense for free-form legacy logs. A structured report
        # already says what failed, and its own status words must not match them.
        signatures = [label for label, pattern in SIGNATURES.items() if re.search(pattern, text, re.I)]
    return {'findings': findings, 'signatures': signatures, 'compatibility': compatibility}


def markdown(result):
    lines = [MARKER, '### Vetro diagnostic review', '', 'Thanks for sharing the report. This automated check reads technical fields; it does not run commands or change your TV.', '', '| Check | Result |', '| --- | --- |']
    lines += [f'| {key} | {value} |' for key, value in result['findings']]
    lines += ['', '**Presumed compatibility:** ' + result['compatibility'], '', '**Error signatures:** ' + (', '.join(result['signatures']) or 'No known signatures found. This does not prove the absence of errors.'), '', 'The report describes one capture. It cannot establish app loading times, FPS, a complete dependency graph, or safe debloat targets. Any recommended write needs a separate validation and restore test.', '', 'A maintainer can use this report to investigate controls and propose a tested change. Please do not attach passwords, raw browsing history or private device identifiers.']
    return '\n'.join(lines) + '\n'


def attachment_url(url):
    u = urllib.parse.urlsplit(url)
    if u.scheme != 'https' or u.hostname != 'github.com' or u.username or u.password or u.port or u.query or u.fragment:
        return False
    return bool(re.fullmatch(r'/(?:user-attachments/files|[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/files)/\d+/[A-Za-z0-9_.%-]+\.(?:json|txt|log)', u.path, re.I))


def download_host(url):
    u = urllib.parse.urlsplit(url)
    if u.scheme != 'https' or u.username or u.password or u.port or u.fragment:
        return False
    host = u.hostname or ''
    return host in ('github.com', 'objects.githubusercontent.com') or bool(re.fullmatch(r'github-production-user-asset-[a-f0-9]+\.s3\.amazonaws\.com', host))


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not download_host(newurl):
            raise ValueError('Attachment redirect is outside the supported GitHub download hosts')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url):
    if not attachment_url(url):
        raise ValueError('Unsupported attachment URL')
    # No API token/cookies are forwarded to attachment/CDN hosts.
    opener = urllib.request.build_opener(SafeRedirect())
    req = urllib.request.Request(url, headers={'Accept-Encoding': 'identity', 'User-Agent': 'Vetro-log-review'})
    started = time.monotonic()
    with opener.open(req, timeout=10) as response:
        if not download_host(response.geturl()):
            raise ValueError('Unsupported download host')
        if response.headers.get('Content-Encoding', 'identity') != 'identity':
            raise ValueError('Compressed reports are not supported')
        try:
            if int(response.headers.get('Content-Length', 0)) > MAX_BYTES:
                raise ValueError('Report exceeds the 2 MiB limit')
        except (TypeError, ValueError):
            raise ValueError('Invalid or oversized report length') from None
        chunks, size = [], 0
        while True:
            block = response.read(65536)
            size += len(block)
            if size > MAX_BYTES or time.monotonic() - started > 30:
                raise ValueError('Report size/time limit exceeded')
            if not block:
                break
            chunks.append(block)
    return b''.join(chunks).decode('utf-8-sig')


def issue_matches(issue):
    return isinstance(issue, dict) and str(issue.get('title', '')).startswith('[Log report]') and '### Vetro diagnostic report' in str(issue.get('body', ''))


def report_text(body):
    links = re.findall(r'https://github\.com/[^\s<>)\]]+', body)
    attachments = list(dict.fromkeys(url for url in links if attachment_url(url)))
    if len(attachments) == 1:
        return download(attachments[0])
    if len(attachments) > 1:
        raise ValueError('Attach one diagnostic file per issue')
    inline = re.findall(r'```json\s*\n([\s\S]*?)\n```', body)
    if len(inline) == 1 and len(inline[0].encode()) <= MAX_BYTES:
        return inline[0]
    raise ValueError('Attach one JSON report or paste it in a fenced json block')


def api(path, token, method='GET', data=None):
    req = urllib.request.Request('https://api.github.com' + path, method=method, headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Vetro-log-review'}, data=None if data is None else json.dumps(data).encode())
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.load(response)


def post_comment(issue, body):
    repo = os.environ['GITHUB_REPOSITORY']
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo) or type(issue.get('number')) is not int:
        raise ValueError('Invalid repository or issue number')
    token = os.environ['GITHUB_TOKEN']
    base = f'/repos/{repo}/issues/{issue["number"]}/comments'
    for page in range(1, 6):
        comments = api(base + f'?per_page=100&page={page}', token)
        for comment in comments:
            if comment.get('user', {}).get('login') == 'github-actions[bot]' and comment.get('body', '').startswith(MARKER):
                api(f'/repos/{repo}/issues/comments/{int(comment["id"])}', token, 'PATCH', {'body': body})
                return
        if len(comments) < 100:
            break
    api(base, token, 'POST', {'body': body})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--file', type=Path)
    parser.add_argument('--event', type=Path)
    parser.add_argument('--output', type=Path, default=Path('diagnostic-comment.md'))
    args = parser.parse_args()
    issue = None
    if args.event:
        event = json.loads(args.event.read_text())
        issue = event.get('issue')
        if not issue_matches(issue):
            print('Not a Vetro log report; skipped')
            return 0
        try:
            text = report_text(issue.get('body', ''))
            result = markdown(analyze(text))
        except (ValueError, TypeError, RecursionError, OSError, UnicodeError):
            result = MARKER + '\n### Vetro diagnostic review\n\nThe report could not be read. Attach one UTF-8 JSON report downloaded from Diagnostics, no larger than 2 MiB. GitHub attachment hosts and schema version 1 are supported. Do not include private logs or credentials. No compatibility result is available.\n'
    elif args.file:
        if args.file.stat().st_size > MAX_BYTES:
            parser.error('Report exceeds the 2 MiB limit')
        result = markdown(analyze(args.file.read_text(encoding='utf-8-sig')))
    else:
        parser.error('Use --file or --event')
    args.output.write_text(result)
    print('Diagnostic review generated')
    return 0


if __name__ == '__main__':
    sys.exit(main())
