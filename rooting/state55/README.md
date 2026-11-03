# Tizen 5.5 audio/source reader

Compiled from `app/native/TvState.cs` with the same existing .NET 3.0 references as the launcher. Rebuild using `rooting/tools/build-dock-tizen55.py --state` and the arguments documented in `../dock55/README.md` (output `rooting/state55`). No firmware assemblies are packaged. Licensing follows the repository license.

The Samsung launcher receives a private temporary output file because it redirects managed stdout. Hardware validation of this variant is pending; the build manifest records source and DLL hashes.
