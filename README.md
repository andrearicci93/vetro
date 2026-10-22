<p align="center">
  <img src="app/icon.png" alt="Vetro app icon" width="112">
</p>
<h1 align="center">Vetro</h1>
<p align="center"><strong>Less bloat. More control over your Samsung TV.</strong></p>
<p align="center">Root-powered debloating, privacy controls and a clearer view of what runs on Tizen.</p>
<p align="center">
  <a href="app/docs/INSTALLATION.md">Install on your TV</a> ·
  <a href="#debloat-with-context">Debloating</a> ·
  <a href="#root-on-the-tv">Root</a> ·
  <a href="#compatibility">Compatibility</a> ·
  <a href="#development">Development</a>
</p>

Vetro lets you turn off features you never use, stop unwanted background services and reduce viewing-data collection. Open its dashboard from a computer or phone on your local network, see what each component does, and choose what stays active.

<p align="center">
  <img src="app/docs/images/quick-settings.jpg" alt="Vetro Quick settings: HbbTV, ACR viewing data, domain blocking and voice assistant switches" width="1000">
  <br><em>Quick settings on Vetro 0.2.3, connected to the test TV.</em>
</p>

## Make the TV yours

- **Disable voice assistants.** Separate switches for Alexa, Google Assistant, Bixby and shared voice services disable their listed components and stop those still running, including wake-word engines where included.
- **Reduce tracking.** Turn off the supported ACR viewing-data services and HbbTV interactive broadcast features. Block selected advertising and tracking domains locally while keeping your DNS servers.
- **Cut background work.** Inspect apps, stop running components and control startup and auto-restart flags. Remove eligible user packages and clear leftover installer files to reclaim storage.
- **See the effect.** Check CPU, RAM, swap, storage and processes from the dashboard. Live sampling starts only when you request it and stops after two minutes.

Disabling unnecessary services can free resources; the result depends on what was running. An exploratory comparison on the test TV ended with about **43 MiB more available RAM** after restoring five disabled-app flags. Repeat measurements are still needed; see [performance evidence](app/docs/PERFORMANCE.md).

## Debloat with context

A package name alone rarely tells you whether you need it. Vetro adds descriptions, feature areas and roles drawn from the Q80A firmware manifests: **Tracking**, **Not used at home**, **Optional** and **Keep**. Search by name, package or purpose, then expand a group to inspect its components.

<p align="center">
  <img src="app/docs/images/debloater-current.jpg" alt="Vetro Debloater filtered to Tracking, with component descriptions, app state and startup flags" width="1000">
  <br><em>Find viewing analytics and advertising components without guessing their purpose.</em>
</p>

The component drawer brings together app state, running processes, startup controls and declared dependencies. Disable, Stop and Uninstall show an in-page confirmation before sending a command. Protected targets stay restricted; available actions depend on the component and what has been verified.

**Disable** keeps a component installed and can be reversed with Enable. **Stop** ends its current process. **Uninstall** removes an eligible package and requires an installer to recover it. App state, boot flags and running processes are shown separately so you can check what actually changed.

Quick settings and Debloater share the same inventory: switch off an assistant in one, and its disabled components appear in the other.

## More privacy, fewer voice services

Use the controls for the features you want to stop: ACR for the supported content-recognition services, HbbTV for interactive broadcast services, and the assistant switches for voice components. Domain blocking adds an exact-domain filter on the TV itself.

Turning a voice group off also affects the remote's microphone shortcut and voice control; Vetro asks you to confirm. These controls disable software components, not the microphone hardware. Voice Guide's text-to-speech engine is excluded from the quick switches. Domain filtering does not guarantee that every app's advertising or telemetry is blocked.

## Root on the TV

Vetro's optional integration runs a background service and reacquires a root context through TV-local SDB. Once configured, the TV can manage its own root-agent connection without a computer keeping a session open. This is what enables privileged app, process, startup and system controls behind the dashboard.

Root and startup support depend on firmware, Developer Mode and your signing privileges; this is an experimental source release with no universal signed installer. See the [compatibility table](#compatibility) for tested hardware and upstream root evidence.

Vetro **0.2.3** is installed on the test TV, with its source revision and authenticated UID-0 agent verified. Autonomous root recovery was observed after an earlier cold boot; unattended cold boot of 0.2.3 remains to be checked. Startup can take up to 90 seconds.

The dashboard and API answer only devices paired with the TV: a browser or script pairs once with a 6-digit code shown on the TV screen. See [sign-in](app/docs/SIGN-IN.md). Traffic is still plain HTTP, so keep the TV on a trusted, isolated LAN with no public exposure. Privileged changes can disrupt TV features; review each target before changing it.

[Install and configure Vetro →](app/docs/INSTALLATION.md) · [Integration details](rooting/README.md) · [Validation record](app/docs/RELEASE-AUDIT.md)

## Compatibility

**Vetro has been tested by the maintainer on one physical TV only;** one community diagnostic report from a second model is listed below. The root technique may work more broadly: the upstream [SDK archive-launcher route](https://github.com/chris-ritsen/samsung-tv-root#archive-root-route) is model-independent and has been demonstrated on QN90B and QN90F. That is evidence for the technique, not confirmation that Vetro's packaged integration or controls work on those TVs.

| TV / platform | Firmware | Evidence | Vetro status |
| --- | --- | --- | --- |
| **Q80A — QE50Q80AATXZT**, Tizen 6, ARMv7 | **T-NKM2DEUC-2301.1** | Vetro installed; authenticated root agent and device controls verified. | **Tested on one TV** |
| Q67B — QE43Q67BAUXXH (2022) | T-NKLBDEUC-1720.7 | Community diagnostic report from Vetro 0.2.3: app and service running, authenticated root agent reported with UID 0, app-disable flags set. Not confirmed: persistence after a cold boot, system service listing (that report section was unavailable) and device controls. | **Reported working**; not verified by the maintainer |
| QN90B — QN55QN90BAFXZA, Tizen 6.5, ARMv7 | T-PTMAKUC-1602.3 | Upstream root testing, including the archive-launcher route. | Untested |
| QN90F — QN75QN90FAFXZA / QA55QN90FAUXEG, Tizen 9.0, AArch64 | 1203.0 / 1301.0 | Upstream root testing on both firmwares; the archive route is also demonstrated on QN90F, without a separate firmware matrix. | Untested; architecture/runtime differences may require adaptation |
| S90D | Exact OS/firmware not established here | An owner reported the underlying route; upstream has not run its exact archive implementation on this model. | Untested |
| Other Samsung Tizen TVs, including S90C | Unknown | Possible where the required SDB, .NET and launcher components remain available. | Compatibility unknown |

There is no confirmed blanket Tizen version range. Firmware patches, runtime support, signing privileges and on-boot behavior can change the outcome even within the same model family.

**Help expand this table:** if you try Vetro, open a [TV diagnostic report issue](https://github.com/andrearicci93/vetro/issues/new?template=log_report.yml) with your exact model, firmware, what worked or failed, and the JSON from **Diagnostics → Download report** if the dashboard is reachable. Failed attempts are useful too. The report is designed to exclude credentials, IP/MAC addresses, serial numbers and viewing history; review it before uploading. See the [diagnostic format](app/docs/DIAGNOSTIC-EXPORT.md).

## Also included

| Feature | What you can do |
| --- | --- |
| Remote shortcuts | Map supported physical remote buttons to native app launches and actions; save interception across restarts. |
| TV settings | Adjust supported picture controls and selected advanced settings, with readback and restore handling. |
| MQTT & Home Assistant | Connect a broker, publish state and discovery, and trigger actions from exact topics. [Setup guide](app/docs/mqtt/README.md). |
| Diagnostics | Download a redacted compatibility report for review before sharing it in an issue. [Report format](app/docs/DIAGNOSTIC-EXPORT.md). |

## Development

The app has no npm runtime dependencies. Use a maintained Node.js release and Python 3.10+ for repository checks.

```sh
git clone https://github.com/andrearicci93/vetro.git
cd vetro/app
npm test
npm start
```

Open `http://127.0.0.1:8099/`. Local mode serves the UI with device operations unavailable; it does not simulate a connected TV. The separate [integration builder](rooting/README.md) adds the TV adapter and runtime payloads to the app package.

From the repository root, run the remaining checks:

```sh
node rooting/tests/run.cjs
python3 .github/scripts/test_parse_log.py
python3 .github/scripts/audit_release.py
```

[App & platform contract](app/README.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

## Credits & license

Vetro builds on [Chris Ritsen and contributors' Samsung TV root research](https://github.com/chris-ritsen/samsung-tv-root). [Glasshouse](https://github.com/rorygallagher2024/glasshouse) inspired the TV-management concept and dashboard. [TizenBrew, TizenTube and tizen.js](https://github.com/reisxd) informed installation and runtime research; [Samsung's developer documentation](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html) documents the device workflow. See [third-party notices](THIRD_PARTY_NOTICES.md) for provenance and licenses.

Original Vetro code is [MIT licensed](LICENSE); vendored code retains its own license. Independent, experimental software, provided as is and unaffiliated with Samsung or the projects above. Generative AI and coding agents assisted development; tests and device observations define what has been verified.
