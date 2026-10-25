#!/bin/sh
# Builds the dock and copies the two files the Vetro package needs into app/native/dock/.
# The images come straight from dock/res when the package is built (app/build.cjs).
set -e
cd "$(dirname "$0")"
dotnet build -c Release Launcher.csproj
cp bin/Release/netcoreapp3.1/tvlauncher-dotnet.dll bin/Release/netcoreapp3.1/tvlauncher-dotnet.runtimeconfig.json ../app/native/dock/
echo "copied to app/native/dock/"
