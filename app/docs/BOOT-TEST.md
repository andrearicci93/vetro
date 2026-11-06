# Startup delay test

The recorder runs on the computer. It installs nothing on the TV and never reboots it or opens apps.
It polls GET `/status` and `/telemetry` every second, in parallel, with a 0.8-second timeout.
GET `/probe` is read every 5 seconds, keeping only its timestamp and counts.
After a confirmed new boot and agent connection, it sends one `/exec` request that reads
`/proc/<pid>/stat`, uptime, the clock tick rate and systemd timestamps. At the end of the capture a second
read-only `/exec` records when the launcher process and Samsung's Home (`csfs`) started (seconds since boot,
`processSnapshot.launcher`) and the tail of the launcher's log, so the gap between Samsung's Home and the
launcher can be measured.
It does not change logging, flags, configuration, databases or services on the TV.

## Preparation

From the `app` folder, with `TV_IP` set to the TV's LAN address (or pass `--base http://TV_IP:8099`):

```sh
export TV_IP=192.0.2.10  # replace with your TV address
export VETRO_TOKEN=...    # key from pairing, see SIGN-IN.md
python3 scripts/boot-test.py preflight
```

The TV must be on and Vetro already reachable. Preflight does not start a capture.
The recorder takes a fresh baseline before printing `ARMED`.
If the baseline is unreadable, it stops: do not reboot until `ARMED` appears.

## A — Automatic startup

```sh
python3 -u scripts/boot-test.py record --mode passive --out /tmp/vetro-boot-passive-01
```

1. Wait for `ARMED`.
2. Type `r` and Enter just before requesting the reboot with your usual method.
   Standby alone may not reboot the system: the tool checks the boot ID.
3. Do not open Vetro or other apps during startup.
4. When `newBoot`, `newService` and `agentConnected` appear, wait another
   20 seconds, then type `q` and Enter.
5. Check for `New boot confirmed: True` and `Capture complete: True`.

## B — Screen pause

After the TV has settled, use the same reboot method as in test A:

```sh
python3 -u scripts/boot-test.py record --mode visual --out /tmp/vetro-boot-visual-01
```

1. Wait for `ARMED`; mark `r` and reboot.
2. As soon as the remote responds, mark `o` and open Vetro.
3. When **ok apps** appears, type `a` and Enter.
4. When **ok packages** appears, type `p` and Enter.
5. When the report-sent message appears, type `f` and Enter.
6. Also wait for `agentConnected`, then 20 seconds, and finish with `q` and Enter.

Markers are human observations: they include reaction time and up to about one
polling cycle before the terminal reads them. A screen recording, if available,
helps correct the markers; it is not needed for test A.
Opening Vetro may start its service earlier, so interpret the two tests separately.
Do not change settings or reinstall Vetro between captures.

## Results and interpretation

Each folder contains:

- `plan.json`: mode, interval, timeout and maximum duration.
- `baseline.json`: state before the reboot.
- `events.jsonl`: requests with start/end on the computer's monotonic clock, and markers.
- `summary.json`: detected events, timing estimates and the process snapshot.

Every request records both ends: the first successful response is an observation
bound, not the exact moment the service became ready.
An HTTP outage alone does not confirm a reboot. A changed PID or initialization time
with the same boot ID is treated as a service restart.
An old persisted `/probe` does not certify that the current probe finished.

Compare:

- `processSnapshot.processStartBootSeconds`: process creation time since boot,
  read from `/proc` without depending on the TV's wall clock.
- `serviceInitializationApproxBootSeconds`: adapter initialization; an estimate
  with about 1-second precision, subject to TV clock corrections.
- `initializationToAgentSeconds`: additional time to connect the root agent.
- `observedAppsToPackagesSeconds`: pause observed on screen in test B.
- The `firstObserved` times and the markers in `events.jsonl`: whether HTTP
  and the agent were already ready while the screen was waiting for packages.

A process created late points to the launch phase; a process created early but
initialized late points to runtime/code loading.
Neither, on its own, identifies a specific internal Tizen function.

A capture always ends after 10 minutes. `Ctrl-C` saves partial results.
An existing folder is never overwritten: use suffixes `02`, `03` to repeat.
At least two passive captures help compare variability.
Results stay local: they exclude full inventories and tokens, but contain
the IP address, boot ID, PID and application revision.

## Testing the tool without a TV

```sh
python3 tests/boot-test.test.py
```

The test uses a local HTTP server that simulates the previous boot, an outage,
a new boot and the connected agent. It also checks that a plain outage or a
service-only restart is not reported as a reboot, that the old probe is
ignored and that an earlier capture is not overwritten.
