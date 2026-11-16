#!/usr/bin/env python3
"""Apply the reviewed TU7092 port to a local checkout; never contacts a TV."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

REVISION = '81e16b164236e2fd1edae50a06d986da5e607469'
HERE = Path(__file__).resolve().parent
ICON_SHA256 = '1027b1b0517727adb9697155a270744381c3ce9b047b1c8bd8a9389dc7d07a83'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--with-launcher-preferences', action='store_true')
    parser.add_argument('--check', action='store_true', help='Validate only; do not modify files')
    args = parser.parse_args()
    root = args.source.resolve()
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    if revision != REVISION:
        raise SystemExit('Port is pinned to ' + REVISION + '; review newer upstream code first')
    marker = root/'rooting/service/external-agent.json'
    if marker.exists() or marker.is_symlink():
        raise SystemExit('External-agent marker already exists; refusing a second/partial application')
    patches = [HERE/'compatibility.patch']
    if args.with_launcher_preferences:
        patches.append(HERE/'launcher-preferences.patch')
        icon = HERE/'assets/youtube.png'
        if hashlib.sha256(icon.read_bytes()).hexdigest() != ICON_SHA256:
            raise SystemExit('Unexpected YouTube icon bytes')
    # Check every patch before any file is changed; git apply is atomic across its inputs.
    subprocess.run(['git', 'apply', '--check', *map(str, patches)], cwd=root, check=True)
    if args.check:
        print('Port patches apply; no files changed')
        return
    subprocess.run(['git', 'apply', *map(str, patches)], cwd=root, check=True)
    if args.with_launcher_preferences:
        shutil.copyfile(icon, root/'dock/res/icons/youtube.png')
    marker.write_text(json.dumps({'enabled': True}) + '\n')
    print('Local port prepared. Rebuild the .NET 3.0 launcher and sign with your own TV certificate.')


if __name__ == '__main__':
    main()
