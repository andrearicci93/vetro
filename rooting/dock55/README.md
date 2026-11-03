# Q74T / Tizen 5.5 launcher

The Vetro dock sources in `dock/src` compiled against the existing firmware's .NET Core 3.0 assemblies. No firmware assemblies are redistributed. The standard .NET 3.1 launcher remains unchanged.

Run with Samsung's signed `/usr/bin/dotnet-launcher --standalone` from the installed app directory. The launcher keeps its pid, FIFO, log and app catalog under Vetro’s app shared directory because Samsung drops capabilities and `/home/owner` is 0750. Only the child process uses `System::Privileged`; no global SMACK policy is installed. On the Q74T, Home, navigation and application launch were verified by the owner on 2026-11-03. Reboot restoration still needs an installed-widget power-cycle check.

Rebuild with existing local tools:

```sh
python3 rooting/tools/build-dock-tizen55.py --dotnet /path/to/dotnet --compiler /path/to/csc.dll --references /path/to/existing/3.0.0 --out rooting/dock55
```

`build-manifest.json` records the source and binary hashes. The integration builder refuses mismatches. Licensing follows the repository's [GPL license](../../LICENSE).
