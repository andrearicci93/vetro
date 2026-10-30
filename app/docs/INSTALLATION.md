# Install Vetro on your TV

[Back to Vetro](../../README.md) · [Compatibility](../../README.md#compatibility)

## Choose a way

- **[1. Apps2Samsung](#1-apps2samsung-the-fastest)**: the fastest. A one-click installer that handles the certificate, the signing and the install.
- **[2. With a coding agent](#2-with-a-coding-agent)**: an AI coding agent with a terminal follows this guide for you. Not Claude.
- **[3. Manual](#3-manual)**: Tizen Studio and your own Samsung certificate, step by step.

All three ways end with the same **[last steps](#last-steps-all-three-ways)**: open Vetro once, set **Host PC IP** to `127.0.0.1`, restart the TV.

**Good to know before you start**

- Use only a TV you own or are allowed to manage. Check the [compatibility table](../../README.md#compatibility) first.
- You need a computer (or, with Apps2Samsung, a phone) on the same trusted network as the TV.
- Vetro needs the package **with the root integration**. The app-only package (`node build.cjs` in `app/`) shows the TV's apps but cannot change anything, and says *TV platform adapter unavailable*.
- You never run any C# file, DLL or "archive chain" yourself: those are parts of the root integration, and they start by themselves after the last steps.
- There is no signed installer to download: a Samsung certificate belongs to its owner and is tied to your TV.

## 1. Apps2Samsung (the fastest)

[Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung) is a free installer for Samsung Tizen TVs by [PatrickSt1991](https://github.com/PatrickSt1991). Vetro is in its community catalog. Many thanks to Patrick for the tool, and for the install-leftovers cleanup that Vetro ported from it.

- **Get Apps2Samsung** from its [releases page](https://github.com/Apps2Samsung/Apps2Samsung/releases): desktop app (Windows, macOS, Linux), Android app, or command line.
- **Turn on Developer Mode** on the TV: open **Apps**, enter **12345** with the remote, switch Developer Mode on, set **Host PC IP** to the address of the computer or phone running Apps2Samsung, and restart the TV. Apps2Samsung tells you if something is not ready.
- **Find Vetro** in the catalog (under *Tools*). It has a *root* badge: confirm when Apps2Samsung asks.
- **Port (optional):** Vetro uses port 8099. Change it only if another app on the TV uses the same port (for example tizen-youtube).
- **First install only:** Apps2Samsung asks you to sign in to your Samsung account once, to create the certificate for your TV.
- **From the command line:** `apps2samsung-cli install "Vetro" --tv TV_IP --allow-root`.
- Then do the **[last steps](#last-steps-all-three-ways)**.

Two community reports in the compatibility table (#10 and #17) installed Vetro this way.

## 2. With a coding agent

A coding agent is an AI assistant that can run commands in a terminal on your computer. It can follow this guide and do the technical part for you.

- **Which agent:** one that can use a terminal, for example **Codex** or **Gemini CLI**.
- **Not Claude:** its cybersecurity safeguards stop it on the root steps.
- **What you still do yourself:** everything on the TV with the remote (Developer Mode, Host PC IP, restarts), the Samsung account sign-in in the browser, and certificate passwords. **Type passwords yourself, in the terminal or the sign-in page. Never paste them into the chat with the agent.**
- **What to ask**, for example:

  > Install Vetro (https://github.com/andrearicci93/vetro) on my Samsung TV at 192.168.1.100. Follow app/docs/INSTALLATION.md. Use Apps2Samsung's command line (apps2samsung-cli) if you can, otherwise the manual way. Explain each step before running it, stop whenever I have to do something on the TV, and never ask me to paste a password into the chat.

- Check what the agent does: it runs commands on your computer.
- Then do the **[last steps](#last-steps-all-three-ways)**, if the agent has not already walked you through them.

## 3. Manual

What you do, once, from a computer on the same network as the TV:

- **Requirements:** Tizen Studio and your own Samsung certificate (step 1).
- **Developer Mode** on the TV, pointed at your computer (step 2).
- **Build and sign** the package with the root integration (step 3).
- **Install** it on the TV and check it (step 4).
- Then the **[last steps](#last-steps-all-three-ways)**.

Expect it to take some patience the first time.

### 1. Check requirements

Tizen Studio has been deprecated in favor of the Tizen Extension for VSCode. The last Tizen Studio release is available [here](https://download.tizen.org/sdk/Installer/tizen-studio_6.1/). You'll want the installer starting with `web-ide_` for your platform.

Install Tizen Studio's TV extension and Samsung Certificate Extension from the official tools. Create your own author/distributor certificate profile bound to your TV. The integration's on-boot service has been investigated with Partner-level distribution privileges; ordinary public signing is not evidence that boot execution is supported.

Do not reuse someone else's signed package or certificates. Historical signing material is excluded from the release. Review [Samsung's TV-device setup guide](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html) for your model's installation workflow.

The certificate is bound to your TV's DUID (its device ID). One community report found it on the TV under **Smart Hub Information → Unique Device ID**; menu names vary by model.

If Certificate Manager fails with `ArrayIndexOutOfBoundsException`, check whether a DNS filter or ad blocker on the computer blocks `svdca.samsungqbe.com`. A community report found that the plugin then saved the block page as `author.crt`; allowing the domain made the official certificate flow work.

### 2. Enable Developer Mode

On the tested TV, open **Apps**, enter **12345** using the remote, enable Developer Mode, enter the installation computer's LAN IP in **Host PC IP**, and restart the TV. Menu names can vary by model. Connect the TV and computer to the same trusted LAN.

There are two different addresses to keep separate:

| Address | Meaning | Where to use it |
| --- | --- | --- |
| `TV_IP`, for example `192.168.1.100` | TV's LAN address | SDB connection and browser dashboard |
| `127.0.0.1` | Loopback of the machine using it | TV's autonomous integration talks to its own SDB service; a PC using this address talks to itself |

During installation, **Host PC IP** is the computer's LAN address. Once Vetro is installed you change it to `127.0.0.1` (in the [last steps](#last-steps-all-three-ways)): that is what lets the TV start its own root helper. Do not change the TV's custom DNS to accomplish this.

```sh
export TV_IP=192.168.1.100  # replace with your TV address
sdb connect "$TV_IP:26101"
sdb devices
```

### 3. Build and sign the package with the root integration

Install signing dependencies with `npm ci` in `rooting/on-boot-probe`. Despite its historical name, only its dependency manifests are required by the current builder. Set `AUTHOR_P12`, `DIST_P12`, `AUTHOR_PW` and `DIST_PW` to your own certificate paths and passwords outside the repository. Use your shell or secret manager to supply passwords without committing them.

```sh
cd rooting/on-boot-probe
npm ci
cd ..
# Supply certificate variables securely before running this command.
OUT=/tmp/vetro.wgt node build.cjs
```

**Port clash (for example with tizen-youtube):** Vetro listens on port 8099. If another app on the TV uses the same port, build with another one, for example `VETRO_PORT=9000 OUT=/tmp/vetro.wgt node build.cjs` (a whole number from 1024 to 65535, not 8001 or 8002). The port is written into the package, so the dashboard is then at `http://TV_IP:9000/`, and the scripts need `--base http://TV_IP:9000`. Changing it later means building and installing again.

The resulting integration WGT contains privileged components. There is no universal certificate or guaranteed root compatibility. The bundled integration derives from [Samsung TV root research](https://github.com/chris-ritsen/samsung-tv-root); consult its compatibility information and [integration notes](../../rooting/README.md). Do not treat successful signing as successful privilege acquisition.

### 4. Install and verify

Select the connected TV target in Tizen Studio Device Manager, permit app installation for your certificate profile, and install `/tmp/vetro.wgt`. Alternatively, use the configured Tizen CLI target:

```sh
tizen install -n /tmp/vetro.wgt -t YOUR_TV_TARGET
```

**Use `tizen install`, not `sdb install`.** A community report found that installing with `sdb` did nothing and showed no error, while `tizen install` worked. After Tizen Studio is installed, the tools are typically in `~/tizen-studio/tools/sdb` and `~/tizen-studio/tools/ide/bin/tizen` (the folder may differ, and they may not be on your `PATH`). To check that the installation reached the TV, `sdb shell 0 vd_applist` lists the apps installed on it; Vetro should be in the list.

## Last steps (all three ways)

### Open Vetro once

- Open **Vetro** on the TV once after installing. **This is required:** on some TVs the installer registers the service with start at boot and auto-restart off. Vetro turns them on by itself (since 0.3.2), but only after it has run once and the root agent has connected. Until then the service does not start by itself after a restart ([#25](https://github.com/andrearicci93/vetro/issues/25)).
- Visit `http://TV_IP:8099/` from a browser on the same network (or your port, if you changed it). Check the app list, the probe status and the platform connection.
- A visible icon or an accepted install is not proof that the background service or the root agent works.

### Let the TV reach its own SDB service

The root helper is started through the TV's own SDB service, so the TV has to talk to itself.

- On the TV, open the Developer Mode screen again (**Apps**, then **12345**).
- Set **Host PC IP** to `127.0.0.1` and restart the TV.
- Wait up to 90 seconds and open the dashboard. It says *Root agent: connected* when it worked.

Good to know:

- This setting is tested on a Q80A. Community reports from other models describe the same step as the one that made the TV root itself.
- While it is set, a computer can no longer use SDB on this TV. To install a new build from a computer, put the computer's IP back, restart the TV, install, and repeat this step afterwards.

### Check that it starts by itself

- After a cold boot, startup and root can take **up to 90 seconds**. Wait before treating an unavailable dashboard or agent as a failure.
- To test it: fully power off the TV, unplug it for 30 seconds, turn it on, and open `/status` and `/monitor?scope=summary` without opening Vetro. Check for a new boot, a running service and an authenticated UID-0 agent. Keep boot identifiers private. Standby is not a cold boot.
- See the [release audit](RELEASE-AUDIT.md) for current results.

## If the dashboard says the root agent is not connected

Open `http://TV_IP:8099/status` in a browser and read these fields:

| What you see | What it means | What to do |
| --- | --- | --- |
| `"mode": "app-only"` | The package on the TV is the app-only one, with no root integration. | Install the package with the root integration: Apps2Samsung (way 1), or build it with `node build.cjs` in `rooting/` (manual step 3). |
| A message such as `<operation>: TV platform adapter unavailable`, together with `"mode": "app-only"` in the status output | The package on the TV was built without the integration builder, so it has no TV platform adapter. | Install the package with the root integration: Apps2Samsung (way 1), or build it with `node build.cjs` in `rooting/` (manual step 3; see [rooting/README.md](../../rooting/README.md)). |
| `"mode": "tv-integration"` and `"agent": {"connected": false}` | The integration is there but the helper has not connected. | Check that Developer Mode is on and **Host PC IP** is `127.0.0.1` ([last steps](#let-the-tv-reach-its-own-sdb-service)), that you restarted the TV afterwards, and that you waited 90 seconds. |
| The page does not load at all | The background service is not running. | Open **Vetro** on the TV once, wait 10 seconds and reload. If that does not help, see [Check that it starts by itself](#check-that-it-starts-by-itself). |
| `"attempts"` lists launches that end without `agent-connected` | Root did not work on this firmware, or SDB refused the connection. | Download the report from **Diagnostics** and attach it to a new issue; it contains no addresses or serial numbers. |

Several sections of the diagnostic report say *unavailable: no root agent connected* until the helper is up. That is expected during those first 90 seconds, and it is the usual picture for a TV where the Host PC IP step was skipped.
