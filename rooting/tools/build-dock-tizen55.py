#!/usr/bin/env python3
"""Compile the Vetro launcher against existing .NET Core 3.0 assemblies.

Does not download dependencies, copy firmware files into the output, contact a
TV, or change the ordinary Vetro launcher. Output is an experimental DLL plus
its runtime configuration, ready for a separate compatibility test.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dotnet', type=Path, required=True, help='Installed dotnet executable, resolved to its real path')
    parser.add_argument('--references', type=Path, required=True, help='Existing .NET Core 3.0 reference/runtime assembly directory')
    parser.add_argument('--compiler', type=Path, help='Existing Roslyn csc.dll; otherwise discovered beside dotnet')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--state', action='store_true', help='Build the native audio/source reader instead')
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    dotnet = args.dotnet.resolve(strict=True)
    references = args.references.resolve(strict=True)
    refs = sorted(p for p in references.glob('*.dll') if not p.name.endswith('.ni.dll'))
    if not refs or not (references / 'System.Runtime.dll').is_file():
        parser.error('A complete existing .NET Core 3.0 assembly directory is required')
    if args.compiler:
        compiler = args.compiler.resolve(strict=True)
    else:
        compilers = sorted(dotnet.parent.glob('sdk/*/Roslyn/bincore/csc.dll'))
        if len(compilers) != 1:
            parser.error('Select --compiler explicitly when the installed SDK is missing or ambiguous')
        compiler = compilers[0]
    output = args.out.resolve()
    output.mkdir(parents=True, exist_ok=True)
    name = 'TvState' if args.state else 'tvlauncher-dotnet'
    dll = output / (name + '.dll')
    sources = [repo / 'app/native/TvState.cs'] if args.state else sorted((repo / 'dock/src').rglob('*.cs'))
    env = dict(os.environ, DOTNET_CLI_HOME=str(repo / 'rooting/dist/dotnet-home'),
               DOTNET_CLI_TELEMETRY_OPTOUT='1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE='1')
    subprocess.run([str(dotnet), str(compiler), '-nologo', '-noconfig', '-nostdlib+',
                    '-target:exe', '-deterministic+', '-debug-', '-optimize+',
                    '-out:' + str(dll), '-pathmap:' + str(repo) + '=/src/vetro']
                   + ['-r:' + str(p) for p in refs] + [str(p) for p in sources], env=env, check=True)
    runtime = {'runtimeOptions': {'tfm': 'netcoreapp3.0', 'framework': {
        'name': 'Microsoft.NETCore.App', 'version': '3.0.0'}, 'configProperties': {
        'System.GC.Concurrent': False, 'System.Globalization.Invariant': True}}}
    (output / (name + '.runtimeconfig.json')).write_text(json.dumps(runtime, indent=2) + '\n')
    digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    result = {'target': 'netcoreapp3.0', 'sources': {str(p.relative_to(repo)): digest(p) for p in sources}, 'dllSha256': digest(dll),
              'compilerSha256': digest(compiler), 'referenceAssemblies': len(refs),
              'hardwareVerified': False, 'firmwareAssembliesPackaged': False}
    (output / 'build-manifest.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
