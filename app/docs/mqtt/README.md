# MQTT with Home Assistant Container

MQTT sends messages through a **broker**. The broker receives a message on a **topic** (a name such as `vetro/command/open-app`) and forwards it to subscribed clients. Mosquitto is the broker; Vetro and Home Assistant are clients. Run Mosquitto as a second Docker container on your Home Assistant server. An add-on is not required.

These files are a setup template to copy to your Docker server. They do not install anything automatically. In Vetro, use the **Docker server's LAN IP** as the broker address.

## 1. Start Mosquitto

Copy this directory to the server running Home Assistant. Open a terminal there and create separate accounts:

```sh
docker compose run --rm --no-deps mosquitto mosquitto_passwd -c /mosquitto/config/passwords vetro
docker compose run --rm --no-deps mosquitto mosquitto_passwd /mosquitto/config/passwords homeassistant
chmod 644 config/passwords
docker compose up -d
docker compose logs --tail=50 mosquitto
```

The commands ask for passwords interactively and save hashes in a local file excluded from Git. Use `-c` only when creating the file: using it again replaces existing accounts. If you already have a broker, skip this step and use its connection details.

Port 1883 must be available on the server and reachable from the TV and Home Assistant. This template uses TCP without TLS on your home network; no router port forwarding is needed. TLS requires a broker listener and certificate configuration. Vetro's TLS switch does not configure the broker.

## 2. Connect Home Assistant

Open **Settings → Devices & services → Add integration → MQTT** and enter:

- Broker: the Docker server's LAN IP.
- Port: `1883`.
- Username: `homeassistant`, with the password you created.

Inside a container, `localhost` refers to that container. Using the server's LAN IP avoids changes to Home Assistant's Docker network.

## 3. Connect Vetro

Open **MQTT** in Vetro's sidebar. Enter the same broker address and port, username `vetro` and its password. Keep the default topic prefix `vetro`, enable the connection and save.

A connected state means the broker accepted the MQTT connection, rather than just a TCP socket opening. Vetro does not return the saved password to the page or include it in diagnostic exports. Leaving the password field blank preserves the saved password.

Every 10 seconds, Vetro publishes available metrics. Home Assistant discovery registers SoC temperature, load average, CPU frequency, RAM used, uptime, foreground app, volume, mute, source and channel. Some metrics may be unavailable on your TV. Discovery records are retained. Metrics use QoS 0; the sent counter does not confirm delivery.

### TV states for automations

On the tested Q80A, audio/source reads run in the background without opening Vetro. Every 10 seconds Vetro reads five of the TV's own settings (input, master volume, the mute of the TV's key, the audio mute and the power state) with one short command, about 34 ms on the Q80A; no .NET program is started for it. Only a TV where those settings cannot be read falls back to the small native helper (`native/TvState.dll`), a .NET program started at each read.

| Entity | State topic suffix | Values |
| --- | --- | --- |
| Volume sensor | `volume` | Integer 0–100, TV volume scale |
| Power state sensor | `power` | `on` while the picture is on, `standby` when it is off (Picture Off or the TV's own standby); Home Assistant shows On / Standby |
| Muted binary sensor | `muted` | `ON` / `OFF` |
| Source sensor | `source` | `TV`, `HDMI1`–`HDMI4`, `DisplayPort` (Samsung monitors) when recognized |
| Channel sensor | `channel` | `<number> <name>`, e.g. `21 Rai 4`; attributes in `channel-attrs`: `number`, `name`, `tv_plus` |
| Foreground app sensor | `foreground-app` | App name or ID, or `none` |

The complete topic is `<prefix>/<identity>/<suffix>`. Volume, mute and source states are retained and refreshed every 10 seconds; the channel is retained and published when it changes. Each has an additional `<suffix>/availability` topic; Home Assistant requires both that topic and service availability to be online. Failed reads clear the retained state and mark that entity unavailable instead of keeping a stale value. These are state entities, not controls. Existing explicit MQTT remapper rules provide actions such as launching an app or sending a supported native remote key.

The channel comes from Vetro's own tuner (Vetro UI → Live TV): while it runs and the input is `TV`, it writes the channel on screen at every change, and Vetro publishes it. With the tuner off, or on another input, the Channel sensor is unavailable. Samsung TV Plus channels count as channels (`tv_plus` true) when the tuner shows them. Service availability does not establish whether the screen is on: the Power state sensor does (it is unavailable on a TV where the power state cannot be read, and on the .NET fallback).

The fallback helper's source is `native/TvState.cs`; the packaged DLL targets the TV's .NET Core 3.1 runtime. To rebuild it with an existing SDK and reference assemblies, run `python3 scripts/build-tv-state.py --dotnet /absolute/path/to/dotnet --references /absolute/path/to/netcoreapp3.1/references`. No SDK download or installation is performed by this script.

### Availability and TV identity

Vetro stores a separate client identity for each TV and keeps it across configuration changes. Older configurations use a machine identity or a generated identity saved on the TV. The UI reports a temporary identity if saving fails.

Telemetry uses `<prefix>/<identity>/<metric>`. The retained availability topic is `<prefix>/<identity>/availability`. Vetro publishes `online` when connected; the broker publishes the QoS 0 Last Will, `offline`, after an unexpected disconnect. Home Assistant entities use this availability topic.

When reconfiguring or disabling MQTT, Vetro clears discovery records published by the current connection and sends `offline` before disconnecting. These QoS 0 writes are not broker acknowledgements. Legacy entities using the fixed `vetro` identity require manual cleanup; Vetro does not delete records that could belong to another installation. Explicit remapper topics do not change.

## 4. Try an automation

In Vetro, create a rule with an **MQTT** trigger, topic `vetro/command/open-app`, exact payload `open`, and an **Open app** action. Choose the application to launch. In Home Assistant's developer tools, run:

```yaml
action: mqtt.publish
data:
  topic: vetro/command/open-app
  payload: open
  retain: false
```

Vetro subscribes only to the exact topics of enabled rules. Retained messages and messages marked as duplicates do not trigger actions. Trigger frequency and queue size are limited. Rules that directly connect an input topic to an output topic are rejected to prevent loops. Use separate topics for commands and state.

A physical remote button can also publish an MQTT message. Enable physical input interception in **Remote** first. Incoming MQTT rules work in the background while the TV and Vetro service are running. MQTT commands do not use the remote WebSocket API.

## Validation status

Protocol handling, trigger validation, discovery cleanup and native state validation have local fixture tests. The owner's TV was verified connected to its real broker on 2026-10-13: a separate diagnostic subscriber received nine retained discovery records, live telemetry, and retained volume `7`, mute `ON` and source `TV`, each with availability `online`. These audio/source values matched the native helper installed on the TV. Home Assistant UI behavior and real-broker TLS still require verification.

References: [Home Assistant MQTT](https://www.home-assistant.io/integrations/mqtt/), [Mosquitto configuration](https://mosquitto.org/man/mosquitto-conf-5.html), [Mosquitto passwords](https://mosquitto.org/man/mosquitto_passwd-1.html).
