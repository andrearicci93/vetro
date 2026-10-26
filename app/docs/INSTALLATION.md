# Install Vetro on your TV

[Back to Vetro](../../README.md) · [Compatibility and root](../../README.md#root-on-the-tv)

## The short version

Vetro has two packages. They are built from the same sources and differ in one thing:

| Package | Built with | What you get |
| --- | --- | --- |
| **App only** | `node build.cjs` in `app/` | The dashboard, unsigned. It shows the TV's apps but cannot change anything: no root. Good for a first look. |
| **With the root integration** | `node build.cjs` in `rooting/` (step 3) | Everything. This is the package this guide installs, and it has to be signed with your own certificate. |

What you do, once, from a computer on the same network as the TV:

1. Turn on Developer Mode on the TV and point it at your computer (step 2).
2. Build the integration package and sign it with your own Samsung certificate (step 3).
3. Install it on the TV and open **Vetro** once (step 4). This first opening is required: on some TVs the installer registers the service with on-boot and auto-restart off. Since 0.3.2 Vetro turns them on by itself, but only after it has run once and the root agent has connected. Until you open it, the service will not start by itself after a restart ([#25](https://github.com/andrearicci93/vetro/issues/25)).
4. Change the TV's **Host PC IP** to `127.0.0.1` and restart the TV (step 5).

What you do **not** do: run any C# file, DLL or "archive chain" yourself. Those are the root integration's own parts. After step 5 the Vetro service starts with the TV, uses the TV's own SDB service to start a small root helper (the *root agent*), and the helper connects back to the service. The dashboard says *Root agent: connected* when that worked. You will not see it happen; you only see the result.

Expect the whole thing to need a computer with Tizen Studio and a certificate, and some patience. There is no signed installer that you can just download, because a Samsung certificate is tied to its owner.


### 1. Check requirements

Use only a TV you own or are authorized to administer. Read the compatibility table first.

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

During installation, **Host PC IP** is the computer's LAN address. Once Vetro is installed you change it to `127.0.0.1` (step 5): that is what lets the TV start its own root helper. Do not change the TV's custom DNS to accomplish this.

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

Open **Vetro** once to run the public API probe. Visit `http://TV_IP:8099/` from a browser on the same LAN. Check app inventory, probe status and platform connectivity. A visible icon or accepted installation is not proof that the background service or root agent works.

### 5. Let the TV reach its own SDB service

The root helper is started through the TV's own SDB service, so the TV has to talk to itself. On the TV, open the Developer Mode screen again (**Apps**, then **12345**), set **Host PC IP** to `127.0.0.1`, and restart the TV. Then wait up to 90 seconds and open the dashboard.

The integration has been tested with this setting on a Q80A, and community reports from other models describe the same step as the one that made the TV root itself. While it is set, a computer can no longer use SDB on this TV. To work from the computer again (for example to install a new build), put the computer's IP back, restart the TV, and repeat this step afterwards.

### 6. Check that it starts by itself

After a cold boot, Vetro’s background startup and root reacquisition can take **up to 90 seconds**. Wait before treating an unavailable dashboard or agent as a failure.

To test unattended startup, record a boot checkpoint privately, fully power off the TV, unplug it for 30 seconds, turn it on, and check `/status` and `/monitor?scope=summary` without opening Vetro or issuing a launch command. Confirm a new boot, running service and authenticated UID-0 agent. Keep boot identifiers private. Standby is not a cold boot. See [release audit](RELEASE-AUDIT.md) for current results.

### If the dashboard says the root agent is not connected

Open `http://TV_IP:8099/status` in a browser and read these fields:

| What you see | What it means | What to do |
| --- | --- | --- |
| `"mode": "app-only"` | The package on the TV is the app-only one, with no root integration. | Build with `rooting/build.cjs` (step 3) and install that package. |
| A message such as `<operation>: TV platform adapter unavailable`, together with `"mode": "app-only"` in the status output | The package on the TV was built without the integration builder, so it has no TV platform adapter. | Rebuild with the integration builder (`node build.cjs` in `rooting/`, step 3; see [rooting/README.md](../../rooting/README.md)) and install that package. |
| `"mode": "tv-integration"` and `"agent": {"connected": false}` | The integration is there but the helper has not connected. | Check that Developer Mode is on and **Host PC IP** is `127.0.0.1` (step 5), that you restarted the TV afterwards, and that you waited 90 seconds. |
| The page does not load at all | The background service is not running. | Open **Vetro** on the TV once, wait 10 seconds and reload. If that does not help, see the [service notes](../../README.md#root-on-the-tv). |
| `"attempts"` lists launches that end without `agent-connected` | Root did not work on this firmware, or SDB refused the connection. | Download the report from **Diagnostics** and attach it to a new issue; it contains no addresses or serial numbers. |

Several sections of the diagnostic report say *unavailable: no root agent connected* until the helper is up. That is expected during those first 90 seconds, and it is the usual picture for a TV where step 5 was skipped.
