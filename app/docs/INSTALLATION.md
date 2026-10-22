# Install Vetro on your TV

[Back to Vetro](../../README.md) · [Compatibility and root](../../README.md#root-on-the-tv)


### 1. Check requirements

Use only a TV you own or are authorized to administer. Read the compatibility table first. Install Tizen Studio's TV extension and Samsung Certificate Extension from the official tools. Create your own author/distributor certificate profile bound to your TV. The integration's on-boot service has been investigated with Partner-level distribution privileges; ordinary public signing is not evidence that boot execution is supported.

Do not reuse someone else's signed package or certificates. Historical signing material is excluded from the release. Review [Samsung's TV-device setup guide](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html) for your model's installation workflow.

### 2. Enable Developer Mode

On the tested TV, open **Apps**, enter **12345** using the remote, enable Developer Mode, enter the installation computer's LAN IP in **Host PC IP**, and restart the TV. Menu names can vary by model. Connect the TV and computer to the same trusted LAN.

There are two different addresses to keep separate:

| Address | Meaning | Where to use it |
| --- | --- | --- |
| `TV_IP`, for example `192.168.1.100` | TV's LAN address | SDB connection and browser dashboard |
| `127.0.0.1` | Loopback of the machine using it | TV's autonomous integration talks to its own SDB service; a PC using this address talks to itself |

During installation, **Host PC IP** is the computer's LAN address. The experimental autonomous integration has been tested with the TV's Host PC IP changed to `127.0.0.1` after installation and a restart. This can prevent ordinary PC SDB access; switch back to the computer IP and restart for maintenance when necessary. Do not change the TV's custom DNS to accomplish this.

```sh
export TV_IP=192.168.1.100  # replace with your TV address
sdb connect "$TV_IP:26101"
sdb devices
```

### 3. Build and sign the optional integration

Install signing dependencies with `npm ci` in `rooting/on-boot-probe`. Despite its historical name, only its dependency manifests are required by the current builder. Set `AUTHOR_P12`, `DIST_P12`, `AUTHOR_PW` and `DIST_PW` to your own certificate paths and passwords outside the repository. Use your shell or secret manager to supply passwords without committing them.

```sh
cd rooting/on-boot-probe
npm ci
cd ..
# Supply certificate variables securely before running this command.
OUT=/tmp/vetro.wgt node build.cjs
```

The resulting integration WGT contains privileged components. There is no universal certificate or guaranteed root compatibility. The bundled integration derives from [Samsung TV root research](https://github.com/chris-ritsen/samsung-tv-root); consult its compatibility information and [integration notes](../../rooting/README.md). Do not treat successful signing as successful privilege acquisition.

### 4. Install and verify

Select the connected TV target in Tizen Studio Device Manager, permit app installation for your certificate profile, and install `/tmp/vetro.wgt`. Alternatively, use the configured Tizen CLI target:

```sh
tizen install -n /tmp/vetro.wgt -t YOUR_TV_TARGET
```

Open **Vetro** once to run the public API probe. Visit `http://TV_IP:8099/` from a browser on the same LAN and pair it with the code the TV shows ([sign-in](SIGN-IN.md)). Check app inventory, probe status and platform connectivity. A visible icon or accepted installation is not proof that the background service or root agent works.

After a cold boot, Vetro’s background startup and root reacquisition can take **up to 90 seconds**. Wait before treating an unavailable dashboard or agent as a failure.

To test unattended startup, record a boot checkpoint privately, fully power off the TV, unplug it for 30 seconds, turn it on, and check `/status` and `/monitor?scope=summary` without opening Vetro or issuing a launch command. Confirm a new boot, running service and authenticated UID-0 agent. Keep boot identifiers private. Standby is not a cold boot. See [release audit](RELEASE-AUDIT.md) for current results.

