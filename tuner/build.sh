#!/bin/sh
# Builds the tuner and copies the two files the Vetro package needs into app/native/tuner/.
# The pictures come straight from tuner/res when the package is built (app/build.cjs).
#
# Samsung's TV client (Tizen.TV.Broadcast.TVService.dll) is only referenced at compile time and is never copied: the TV has it.
# Pass the firmware copy of it as the first argument or in TVS_DLL, e.g. from a firmware dump:
#   sh build.sh /path/to/Tizen.TV.Broadcast.TVService.dll
set -e
cd "$(dirname "$0")"
DLL="${1:-$TVS_DLL}"
if [ -z "$DLL" ] || [ ! -f "$DLL" ]; then
  echo "Give the path of Tizen.TV.Broadcast.TVService.dll from the firmware (argument or TVS_DLL)." >&2
  exit 2
fi
dotnet build -c Release -p:TvsDll="$DLL" Tuner.csproj
mkdir -p ../app/native/tuner
cp bin/Release/netcoreapp3.1/vetro-tuner.dll bin/Release/netcoreapp3.1/vetro-tuner.runtimeconfig.json ../app/native/tuner/
if [ -e ../app/native/tuner/Tizen.TV.Broadcast.TVService.dll ]; then echo "Samsung's DLL must not be shipped" >&2; exit 3; fi
echo "copied to app/native/tuner/"
