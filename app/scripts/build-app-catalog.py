#!/usr/bin/env python3
"""Extract package facts from a private firmware dump for the app catalog.

Reads Tizen package manifests (usr/share/packages, opt/share/packages) and
searches the dump for references to each app/package ID. The output is a
private facts file; review it before curating service/app-catalog.js. The dump
itself never leaves the computer.

Usage: python3 scripts/build-app-catalog.py DUMP_ROOTFS OUT.json [--compact service/app-facts.js]

--compact also writes the per-package facts the service ships: which other
packages reference each package, whether it starts on system events or key
sequences, and whether it may use the microphone, camera or location.
"""
import json
import pathlib
import re
import sys
import xml.etree.ElementTree as ET

NS = '{http://tizen.org/ns/packages}'
APP_TAGS = ('ui-application', 'service-application', 'widget-application', 'watch-application', 'component-based-application')
PRIVILEGE_FLAGS = {
    'microphone': ('recorder', 'microphone', 'smartcontroller.microphone', 'audiorecorder'),
    'camera': ('camera',),
    'location': ('location',),
    'packageAdmin': ('packagemanager.admin',),
    'appKill': ('appmanager.kill',),
    'keyGrab': ('keygrab',),
    'inputGenerator': ('inputgenerator',),
    'screenCapture': ('screen.capture', 'externalstorage.appdata', 'tv.display'),
    'internet': ('internet',),
}
SEARCH_DIRS = ('usr/apps', 'opt/usr/apps', 'usr/share/packages', 'opt/share/packages', 'etc',
               'usr/lib/systemd', 'usr/share/dbus-1', 'usr/share/menu', 'usr/bin', 'usr/lib/systemd/user')


def text(node):
    return (node.text or '').strip() if node is not None else ''


def parse_manifest(path):
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError:
        return None
    pkg = root.get('package')
    if not pkg:
        return None
    privileges = [text(p) for p in root.iter(NS + 'privilege')]
    flags = sorted(k for k, words in PRIVILEGE_FLAGS.items()
                   if any(p.rsplit('/', 1)[-1] in words for p in privileges))
    apps = []
    for tag in APP_TAGS:
        for app in root.iter(NS + tag):
            meta = {}
            for m in app.iter(NS + 'metadata'):
                meta.setdefault(m.get('key'), []).append(m.get('value'))
            events, operations = [], []
            for control in app.iter(NS + 'app-control'):
                ops = [o.get('name') for o in control.iter(NS + 'operation')]
                uris = [u.get('name') for u in control.iter(NS + 'uri')]
                operations += ops
                if any(o and o.endswith('launch_on_event') for o in ops):
                    events += uris
            apps.append({
                'appId': app.get('appid'), 'kind': tag.replace('-application', ''),
                'label': text(app.find(NS + 'label')), 'exec': app.get('exec'),
                'onBoot': app.get('on-boot') == 'true', 'autoRestart': app.get('auto-restart') == 'true',
                'noDisplay': app.get('nodisplay') == 'true', 'type': app.get('type'),
                'launchOnEvent': sorted(set(filter(None, events))),
                'appControl': sorted(set(filter(None, operations)) - {'http://tizen.org/appcontrol/operation/launch_on_event'}),
                'backgroundCategory': sorted(set(b.get('value') for b in app.iter(NS + 'background-category'))),
                'assistantWakeupEngine': (meta.get('http://tizen.org/metadata/multi-assistant/wakeup_engine_appid') or [None])[0],
                'assistantName': (meta.get('http://tizen.org/metadata/multi-assistant/name') or [None])[0],
                'allowedAppIds': meta.get('http://tizen.org/metadata/allowedappid') or [],
                'serviceName': (meta.get('http://samsung.com/tv/metadata/servicename') or [None])[0],
                'smartHubReset': 'http://developer.samsung.com/tizen/metadata/smarthubreset' in meta,
                'builtIn': (meta.get('http://samsung.com/tv/metadata/built-in-app') or [None])[0] == 'true',
            })
    return {'package': pkg, 'version': root.get('version'), 'type': root.get('type'),
            'preload': root.get('preload') == 'true', 'removable': root.get('removable') != 'false',
            'readonly': root.get('readonly') == 'true', 'author': text(root.find(NS + 'author')),
            'descriptions': sorted(set(filter(None, (text(d) for d in root.iter(NS + 'description'))))),
            'privilegeFlags': flags, 'privilegeCount': len(privileges), 'apps': apps,
            'manifest': str(path)}


def references(root, packages):
    """Map each ID to the packages whose files mention it (excluding its own).

    Files are scanned for ID-shaped tokens; a token also matches when it only
    adds suffixes such as ".png" or "/bin" to a known ID.
    """
    ids = {p['package'] for p in packages} | {a['appId'] for p in packages for a in p['apps'] if a['appId']}
    owner = {}
    for p in packages:
        owner[p['package']] = p['package']
        for a in p['apps']:
            owner[a['appId']] = p['package']
    token = re.compile(rb'[A-Za-z0-9][A-Za-z0-9_.-]{4,180}')
    pkg_dir = re.compile(r'^(?:opt/)?usr/apps/([^/]+)/|^(?:opt/)?usr/share/packages/(.+)\.xml$')
    refs = {}
    for top in SEARCH_DIRS:
        base = root / top
        if not base.exists():
            continue
        for path in base.rglob('*'):
            try:
                if path.is_symlink() or not path.is_file() or path.stat().st_size > 64 * 1024 * 1024:
                    continue
                data = path.read_bytes()
            except OSError:
                continue
            rel = path.relative_to(root).as_posix()
            m = pkg_dir.match(rel)
            source = (m.group(1) or m.group(2)) if m else 'system:' + '/'.join(rel.split('/')[:2])
            found = set()
            for raw in set(token.findall(data)):
                word = raw.decode('ascii', 'ignore')
                while word:
                    if word in ids:
                        found.add(word)
                        break
                    cut = word.rfind('.')
                    if cut <= 0:
                        break
                    word = word[:cut]
            for f in found:
                if owner[f] != source:
                    refs.setdefault(f, {}).setdefault(source, set()).add(rel)
    return {k: {s: sorted(v)[:3] for s, v in sources.items()} for k, sources in refs.items()}


# Registries that list every package; they say nothing about real use.
GENERIC_SOURCES = {'tvs-lite-app', 'webappservice', 'vetrotvapp', 'settings-datafw'}


def compact(packages):
    out = {}
    for p in packages:
        refs = set(p['referencedBy'])
        for a in p['apps']:
            refs |= set(a['referencedBy'])
        events = {e.split(':', 1)[0] for a in p['apps'] for e in a['launchOnEvent']}
        entry = {'usedBy': sorted(r for r in refs if not r.startswith('system:') and r not in GENERIC_SOURCES and r != p['package'])}
        if events:
            entry['startsOn'] = sorted({'key sequence' if e == 'keysequence' else 'system event' for e in events})
        access = [f for f in ('microphone', 'camera', 'location') if f in p['privilegeFlags']]
        if access:
            entry['access'] = access
        descriptions = [d for d in p['descriptions'] if len(d) > 3 and d.lower() not in ('application', p['package'].lower())]
        if descriptions:
            entry['description'] = descriptions[0][:120]
        out[p['package']] = entry
    return {'source': 'Tizen package manifests and file references in one Q80A firmware (T-NKM2DEUC)', 'packages': out}


def one_line_per_package(facts):
    lines = ['%s:%s' % (json.dumps(k), json.dumps(v, separators=(',', ':'), sort_keys=True)) for k, v in sorted(facts['packages'].items())]
    return '{"source":%s,"packages":{\n%s\n}}' % (json.dumps(facts['source']), ',\n'.join(lines))


def main():
    args = sys.argv[1:]
    compact_out = None
    if '--compact' in args:
        i = args.index('--compact')
        if i + 1 >= len(args):
            raise SystemExit(__doc__)
        compact_out = args[i + 1]
        del args[i:i + 2]
    if len(args) != 2:
        raise SystemExit(__doc__)
    sys.argv[1:] = args
    root = pathlib.Path(sys.argv[1]).resolve()
    manifests = sorted(list((root / 'usr/share/packages').glob('*.xml')) + list((root / 'opt/share/packages').glob('*.xml')))
    packages = [m for m in (parse_manifest(p) for p in manifests) if m]
    for p in packages:
        p['manifest'] = pathlib.Path(p['manifest']).relative_to(root).as_posix()
    refs = references(root, packages)
    for p in packages:
        p['referencedBy'] = refs.get(p['package'], {})
        for a in p['apps']:
            a['referencedBy'] = refs.get(a['appId'], {})
    units = {}
    for unit in list((root / 'usr/lib/systemd/system').glob('*')) + list((root / 'usr/lib/systemd/user').glob('*')):
        try:
            content = unit.read_text(encoding='utf-8', errors='replace')
        except (IsADirectoryError, OSError):
            continue
        for p in packages:
            for a in p['apps']:
                if a['appId'] and (a['appId'] in content or (a['exec'] and a['exec'] in content)):
                    units.setdefault(a['appId'], []).append(unit.name)
    for p in packages:
        for a in p['apps']:
            a['systemdUnits'] = sorted(set(units.get(a['appId'], [])))
    pathlib.Path(sys.argv[2]).write_text(json.dumps({'packages': packages}, indent=1) + '\n', encoding='utf-8')
    if compact_out:
        pathlib.Path(compact_out).write_text("'use strict';\n// Generated by scripts/build-app-catalog.py from a private firmware dump. Do not edit.\nmodule.exports = "
                                             + one_line_per_package(compact(packages)) + ';\n', encoding='utf-8')
    print(len(packages), 'packages,', sum(len(p['apps']) for p in packages), 'components')


if __name__ == '__main__':
    main()
