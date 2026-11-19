#!/usr/bin/env python3
"""Audit the current tracked release snapshot, not old Git history."""
import re
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
problems = []
for name in filter(None, paths):
    path = root / name
    if not path.is_file():
        continue
    if (name.startswith(('app/diagnostics/', 'rooting/on-boot-probe/certs/', 'rooting/tools/tizen/', 'rooting/tools/payloads31/', '.claude/'))
        or path.suffix.lower() in ('.p12', '.pfx', '.wgt', '.cer', '.key', '.log')
        or name.split('/')[-1].startswith('.env')):
        problems.append('Private/generated artifact tracked: ' + name)
    if path.suffix.lower() in ('.png', '.jpg', '.jpeg', '.dll', '.ico'):
        continue
    try:
        text = path.read_text()
    except (UnicodeError, OSError):
        continue
    if re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s+[A-Za-z0-9+/=]{80}', text):
        problems.append('Private key material: ' + name)
    if ('/Users/' + 'andrearicci/') in text or re.search(r'192\.168\.1\.(?:91|72)\b', text):
        problems.append('Local device/user data: ' + name)
    if name.startswith('app/service/') and re.search(r'require\([\'"][^\'"]*rooting/', text):
        problems.append('App imports rooting implementation: ' + name)
# Check the actual standalone WGT file list through its builder, not just source paths.
cmd = "console.log(JSON.stringify(require('./app/build.cjs').collectFiles().map(f=>decodeURIComponent(f.uri))))"
files = __import__('json').loads(subprocess.check_output(['node', '-e', cmd], cwd=root))
# Every root adapter module except platform.js (the app-only package has its own) stays out of it (#240).
privileged = {'service/' + p.name for p in (root/'rooting/service').glob('*.js') if p.name != 'platform.js'}
for name in files:
    if name.startswith('payload/') or name in privileged:
        problems.append('Privileged implementation in app-only package: ' + name)
platform = (root/'app/service/platform.js').read_text()
if 'app-only' not in platform:
    problems.append('Standalone platform adapter missing')
if problems:
    print('\n'.join(problems))
    sys.exit(1)
print('PASS current release snapshot: no private/generated artifacts, no local identifiers, app-only boundary intact')
print('Git history is NOT audited or cleaned by this script; publish a fresh audited snapshot or review a history purge.')
