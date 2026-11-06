#!/bin/sh
# Builds TvCapture for the TVs' .NET Core 3.1 runtime and puts it where the screen-share Shard packs it from.
set -e
here=$(cd "$(dirname "$0")" && pwd)
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
dotnet build "$here/TvCapture.csproj" -c Release -o "$out" -p:UseAppHost=false -p:Deterministic=true -p:ContinuousIntegrationBuild=true -p:DebugType=none -p:PathMap="$here=/src" -p:BaseIntermediateOutputPath="$out/obj/"
dest="$here/../app/examples/plugins/screen-share/assets"
mkdir -p "$dest"
cp "$out/TvCapture.dll" "$out/TvCapture.runtimeconfig.json" "$dest/"
ls -l "$dest"
shasum -a 256 "$dest"/TvCapture.dll
