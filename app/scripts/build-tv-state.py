"""Build the read-only helper using an existing SDK and .NET Core 3.1 references."""
import argparse
import json
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--dotnet', type=Path, required=True)
parser.add_argument('--references', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
compilers = sorted((args.dotnet.parent / 'sdk').glob('*/Roslyn/bincore/csc.dll'))
refs = sorted(args.references.glob('*.dll'))
if not compilers or not refs:
    raise SystemExit('Existing SDK/compiler and .NET Core 3.1 reference assemblies required')
subprocess.run([str(args.dotnet), str(compilers[-1]), '-nologo', '-noconfig', '-nostdlib+',
                '-target:exe', '-out:' + str(root / 'native/TvState.dll')]
               + ['-r:' + str(p) for p in refs] + [str(root / 'native/TvState.cs')], check=True)
(root / 'native/TvState.runtimeconfig.json').write_text(json.dumps({
    'runtimeOptions': {'tfm': 'netcoreapp3.1', 'framework': {
        'name': 'Microsoft.NETCore.App', 'version': '3.1.0'}}}) + '\n', encoding='utf-8')
