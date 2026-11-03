#!/usr/bin/env python3
"""Stage/inspect/stop a temporary Vetro Remote PC prototype on the owner's TV.

No package installation, boot changes or firmware writes. Uses the original Node.
The SDK process and root channel expire after 15 minutes.
"""
import argparse
import importlib.util
import ipaddress
import json
import re
import secrets
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['deploy', 'status', 'stop', 'runtime-check', 'process-check', 'shell-check', 'start-inline', 'recover-probe'])
    parser.add_argument('--tv', required=True, type=ipaddress.IPv4Address)
    parser.add_argument('--host', required=True, type=ipaddress.IPv4Address)
    parser.add_argument('--sdb', required=True, type=Path)
    parser.add_argument('--helper', required=True, type=Path)
    parser.add_argument('--run', required=True, type=Path)
    parser.add_argument('--bundle', type=Path)
    parser.add_argument('--port', type=int, default=9000)
    args = parser.parse_args()
    args.run.mkdir(parents=True, exist_ok=True, mode=0o700)
    spec = importlib.util.spec_from_file_location('q74t_prototype_sdb', args.helper)
    helper = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = helper
    spec.loader.exec_module(helper)
    client = helper.SdbClient(args.sdb, str(args.tv), timeout=10)
    client.connect()
    client.require_device()
    config_file = args.run / 'deployment.json'
    if args.action == 'deploy':
        if config_file.exists():
            raise RuntimeError('Use a fresh run directory; this one already records a deployment')
        if not args.bundle or not (args.bundle / 'service/q74t-prototype-start.js').is_file():
            raise RuntimeError('Build a prototype bundle first')
        remote = '/home/owner/share/tmp/sdk_tools/vetro-q74t-' + secrets.token_hex(6)
        archive = args.run / 'prototype.tar'
        with tarfile.open(archive, 'w') as package:
            for file in sorted(args.bundle.rglob('*')):
                if file.is_file():
                    package.add(file, arcname=str(file.relative_to(args.bundle)), recursive=False)
        client.push(archive, PurePosixPath(remote + '.tar'))
        script = ('set -e;umask 077;mkdir ' + remote + ';tar -xf ' + remote + '.tar -C ' + remote + ';rm ' + remote + '.tar;cd ' + remote
                  + ';setsid /usr/bin/node -e \'process.argv[2]="--session";require("' + remote
                  + '/service/q74t-prototype-start.js")\' 3>&- </dev/null >' + remote + '/prototype.log 2>&1 & echo START_REQUESTED')
        # Larger scripts use the reviewed helper's temporary, self-deleting staging.
        result = client.capture(script, callback_host=str(args.host), bind_host=str(args.host), timeout=15)
        config = {'time_utc': datetime.now(timezone.utc).isoformat(), 'tv': str(args.tv),
                  'remote': remote, 'port': args.port, 'expires_after_seconds': 900, 'deploy_output': result.output,
                  'transport_returncode': result.transport_returncode}
        config_file.write_text(json.dumps(config, indent=2) + '\n')
        config_file.chmod(0o600)
        if '\n[exit:0]' not in result.output:
            raise RuntimeError('Deployment command did not report success; inspect deployment.json')
        print(json.dumps(config, indent=2))
        return
    config = json.loads(config_file.read_text())
    remote = config['remote']
    if config['tv'] != str(args.tv) or not re.fullmatch(r'/home/owner/share/tmp/sdk_tools/vetro-q74t-[0-9a-f]{12}', remote):
        raise RuntimeError('Deployment target mismatch')
    if args.action == 'recover-probe':
        script = 'pkill -f "[S]PAWN_OK";pkill -f "[T]V_SHELL_OK";echo PROBE_CLEARED'
    elif args.action == 'runtime-check':
        script = '/usr/bin/node -e \'require("' + remote + '/service/compat.js").install();console.log("MODULE_LOAD_OK")\''
    elif args.action == 'process-check':
        script = ('command -v setsid nohup timeout;/usr/bin/node -e \'setTimeout(function(){process.exit(4)},2000);'
                  'require("child_process").execFile("/bin/echo",["SPAWN_OK"],function(e,o){console.log(e?e.message:o);process.exit(0)})\' '
                  '3>&- </dev/null >' + remote + '/process-check.log 2>&1 & echo PROCESS_PROBE_STARTED')
    elif args.action == 'shell-check':
        inline = ('require("' + remote + '/service/compat.js").install();'
                  'var x=require("' + remote + '/service/shell-executor.js").create(process.argv[1],Number(process.argv[2]),process.getuid());'
                  'x({seq:1,timeout:3000,command:"id;printf TV_SHELL_OK"},function(r){console.log(JSON.stringify(r));x.close()})')
        script = ('umask 077;r=/tmp/vqcheck-$$;mkdir -m 700 "$r";'
                  'setsid /bin/sh -c \'s=$1;shift;. "$s"\' vetro-worker ' + remote + '/service/shell-worker.sh "$r" 3>&- </dev/null >' + remote + '/shell-check.log 2>&1 & w=$!;'
                  '/usr/bin/node -e \'' + inline + '\' "$r" "$w";kill -KILL -- "-$w" 2>/dev/null;'
                  'tail -n 16 ' + remote + '/shell-check.log;rm -f "$r"/*;rmdir "$r" 2>/dev/null;echo SHELL_CHECK_DONE')
    elif args.action == 'start-inline':
        script = ('cd ' + remote + ';setsid /usr/bin/node -e \'process.argv[2]="--session";require("' + remote
                  + '/service/q74t-prototype-start.js")\' 3>&- </dev/null >' + remote + '/prototype.log 2>&1 & echo START_REQUESTED')
    elif args.action == 'status':
        port = int(config.get('port', 9000))
        if port < 1024 or port > 65535:
            raise RuntimeError('Invalid deployment port')
        script = ('cat ' + remote + '/root-proof.json 2>/dev/null;tail -n 12 ' + remote + '/prototype.log;cat ' + remote + '/process-check.log 2>/dev/null;'
                  '/usr/bin/node -e \'var q=require("http").get("http://127.0.0.1:' + str(port)
                  + '/status",function(r){if(!/json/.test(r.headers["content-type"]||"")){r.destroy();console.log("NOT_VETRO_JSON");return;}'
                  + 'var n=0;r.on("data",function(b){n+=b.length;if(n>16384){r.destroy();return;}process.stdout.write(b)});});'
                  + 'q.on("error",function(e){console.log(e.message)});q.setTimeout(3000,function(){q.abort()})\'')
    else:
        script = ('p=$(cat ' + remote + '/prototype.pid 2>/dev/null);case "$p" in ""|*[!0-9]*) exit 1;;esac;'
                  'tr "\\0" " " </proc/$p/cmdline | grep -Fq "' + remote + '/service/q74t-prototype-start.js" && kill -TERM "$p"')
    result = client.capture(script, callback_host=str(args.host), bind_host=str(args.host), timeout=15)
    report = {'time_utc': datetime.now(timezone.utc).isoformat(), 'action': args.action,
              'output': result.output, 'transport_returncode': result.transport_returncode}
    (args.run / (args.action + '-' + datetime.now(timezone.utc).strftime('%H%M%S') + '.json')).write_text(json.dumps(report, indent=2) + '\n')
    print(result.output)


if __name__ == '__main__':
    main()
