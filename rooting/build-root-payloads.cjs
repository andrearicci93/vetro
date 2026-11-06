'use strict';
// Compile the existing Unlicense upstream sources for the .NET 6 root route.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-net6-'));
const destination = path.join(__dirname, 'payload', 'net6');
const xml = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
try {
    for (const name of ['SamsungTvArchiveRoot', 'SamsungTvRootAgent']) {
        const directory = path.join(temporary, name);
        fs.mkdirSync(directory);
        const source = path.join(__dirname, 'tools', 'samsung-tv-root-master', 'payloads', 'common', name + '.cs');
        const project = path.join(directory, name + '.csproj');
        fs.writeFileSync(project, `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net6.0</TargetFramework><OutputType>Exe</OutputType>
    <AssemblyName>${name}</AssemblyName><UseAppHost>false</UseAppHost>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>
    <ImplicitUsings>disable</ImplicitUsings><Nullable>disable</Nullable>
    <Deterministic>true</Deterministic><DebugType>none</DebugType>
    <RollForward>Major</RollForward>
  </PropertyGroup>
  <ItemGroup><Compile Include="${xml(source)}" /></ItemGroup>
</Project>\n`);
        const output = path.join(directory, 'out');
        const result = spawnSync('dotnet', ['build', project, '-c', 'Release', '-o', output, '--nologo'],
            {cwd: temporary, stdio: 'inherit'});
        if (result.error) throw result.error;
        if (result.status !== 0) throw Error('Failed to build ' + name);
        fs.mkdirSync(destination, {recursive: true});
        for (const suffix of ['.dll', '.deps.json', '.runtimeconfig.json']) {
            fs.copyFileSync(path.join(output, name + suffix), path.join(destination, name + suffix));
        }
    }
} finally {
    fs.rmSync(temporary, {recursive: true, force: true});
}
