# Tizen 5.5 input payload

This is the remote-input helper built from `../payload/SamsungTvRemoteInputAgent.cs`
against existing .NET Core 3.0 assemblies. It retains that source's license;
see `../payload/SamsungTvRemoteInputAgent.LICENSE` and the repository notices.
Firmware/reference assemblies are build inputs only and are not included here.

Rebuild with `../tools/build-input-tizen55.py` using your installed SDK and
existing target reference assemblies. `build-manifest.json` pins the source,
compiler and output digests. Its `hardwareVerified: false` is the build-time
default, not a hardware-test receipt; the separate Q74T notes describe the
observed tests and their limits.

Only Remote PC integration packages select this DLL and runtime configuration.
The normal archive adapter keeps the existing payload under `../payload/`.
