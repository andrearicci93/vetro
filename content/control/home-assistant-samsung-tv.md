---
title: "Home Assistant Samsung TV: three ways to connect it"
description: "Connect a Samsung TV to Home Assistant with the built-in integration, a community fork, or MQTT from the TV itself. What each does, needs and cannot do."
keywords: ["home assistant samsung tv", "samsungtv integration", "ha-samsungtv-smart", "samsung tv mqtt home assistant"]
date: 2026-11-10
updated: 2026-11-10
verified: "Checked on 2026-11-10 against the Home Assistant samsungtv integration page, the ha-samsungtv-smart and ha-samsungtv-tizen READMEs, and the Vetro 0.5.0 MQTT guide, README and SECURITY.md."
related: ["samsung-remote-keys-home-assistant", "remap-samsung-remote-buttons", "what-each-vetro-switch-changes", "vetro-security-model", "how-to-root-samsung-tv", "tizentube-samsung-tv"]
---

There are three practical ways to connect a Samsung TV to Home Assistant. The built-in Samsung Smart TV integration controls Tizen TVs from 2016 onward over your local network. Community forks add more entities, and some of their features need a SmartThings token. The third route runs on the TV: with Vetro on a rooted TV, the TV publishes its state over MQTT and can react to MQTT messages. Vetro is experimental, needs root and ships no signed installer. Start with the built-in integration and go further only when it falls short.

## How do I add a Samsung TV to Home Assistant?

Home Assistant's [Samsung Smart TV integration](https://www.home-assistant.io/integrations/samsungtv/) is the default choice and needs nothing on the TV beyond network access. According to its documentation:

- It supports Samsung Smart TVs on Tizen from 2016, plus TVs with a WebSocket API, and its IoT class is "Local Push".
- Home Assistant can discover the TV. Otherwise you add the integration under Settings, Devices & services and enter the host name or IP address.
- Every TV is checked every 10 seconds to see whether it is on. If the TV supports UPnP, volume and mute state are pushed to Home Assistant through UPnP events.
- A PIN is needed only for TVs that use the encrypted protocol, which includes some H and J series models. On other models you accept an authorization prompt on the TV.
- It exposes a media player and a remote entity that sends key codes and key sequences. Supported keys vary by model.
- Turning the TV on uses Wake on LAN, which must be enabled on the TV. You can also define a custom turn-on action.
- WebSocket connections fail across different subnets or VLANs. Newer TVs may ask for permission on every connection until you set Access notification to "First time only" in the TV's Device connection manager.

Menu labels differ by model and year. The page covers sending commands to the TV only and says nothing about receiving presses from the physical remote; [Samsung remote keys as Home Assistant events](/control/samsung-remote-keys-home-assistant/) covers that gap.

## When do I need a custom Samsung TV integration?

Two GitHub projects extend the built-in integration. Both install as custom components and are independent of Home Assistant and Samsung. The READMEs do not state which Home Assistant versions they support, so check each project's supported versions and open issues before installing.

[ha-samsungtv-smart](https://github.com/ollo69/ha-samsungtv-smart) is licensed Apache-2.0 and installs through HACS or by copying the `samsungtv_smart` folder into `custom_components`. Its README says it is only for 2016 and newer TVs. A SmartThings token is optional but "strongly suggested". The README lists TV status, channel names and running-app information, channel logos, automatic source detection, sound and picture mode selection and the SmartThings keys as depending on it. Initial setup is through the web UI.

[ha-samsungtv-tizen](https://github.com/mcc05/ha-samsungtv-tizen) is a fork of jaruba/ha-samsungtv-tizen, described as a modified version of the built-in integration. It also targets 2016 and newer TVs, installs through HACS or by copying the `samsungtv_tizen` folder, and then needs a `media_player` entry in `configuration.yaml` with host, port and MAC address. The SmartThings Cloud API is used only when both an API key and a device ID are set. It is Apache-2.0 licensed.

Pick a fork when you want the extra details above. The cost is a dependency on a community project and, for part of the feature set, a cloud account.

## How does Vetro connect to Home Assistant over MQTT?

[Vetro](https://github.com/andrearicci93/vetro) reads state on the TV and publishes it to an MQTT broker, and Home Assistant receives those messages. The built-in integration separately combines periodic power checks with supported state events, so the two routes complement each other. Vetro needs root, so this route is only worth it if you already want Vetro for something else. Read [Vetro's root requirements](/root/how-to-root-samsung-tv/), [whether rooting is safe](/root/is-it-safe-to-root-samsung-tv/) and the [Apps2Samsung install guide](/root/install-vetro-apps2samsung/) first.

The [Vetro MQTT guide](https://github.com/andrearicci93/vetro/blob/main/app/docs/mqtt/README.md) describes the setup in four parts:

1. A broker. The guide uses Mosquitto as a second Docker container next to Home Assistant, and its files are a template to copy rather than an installer. The broker's LAN IP goes into both Vetro and Home Assistant's MQTT integration. The template uses plain TCP on port 1883 without TLS, on your home network only.
2. Vetro's MQTT page, which the 0.5.0 dashboard shows as Home Assistant. Enter the same broker address, port and a separate account, keep the default topic prefix `vetro` and enable the connection.
3. What the TV publishes. Every 10 seconds Vetro publishes the metrics it has, and Home Assistant discovery registers SoC temperature, load average, CPU frequency, RAM used, uptime, foreground app, volume, mute and source. Some metrics may be unavailable on your TV. Volume, mute and source were read in the background on the tested [Q80A](/tested-tvs/q80a/).
4. What reacts to Home Assistant. You create a rule with an MQTT trigger on an exact topic and payload, plus an action such as opening an app. Vetro subscribes only to the exact topics of enabled rules and ignores retained messages and messages carrying MQTT's duplicate flag.

The guide's own test is to publish `open` to `vetro/command/open-app` with Home Assistant's `mqtt.publish` action, and the TV opens the app you chose. The volume, mute and source entities are state only, not controls, and channel number and name are not exposed. The guide also warns that MQTT service availability means Vetro is connected, not that the TV screen is on, so do not use these sensors as a replacement for the TV's power state.

The guide's validation note says a Q80A was verified connected to a real broker on 2026-10-13, and that a separate subscriber received the discovery records, live telemetry and volume, mute and source values. It adds that Home Assistant UI behavior and TLS against a real broker "still require verification", so treat the Home Assistant side as not yet confirmed by the project.

## Which Samsung TV integration should I use?

| | Built-in | Community fork | Vetro MQTT |
| --- | --- | --- | --- |
| Root needed | No | No | Yes |
| Where it runs | Home Assistant, local | Home Assistant, some features via SmartThings | On the TV, through a broker |
| Control the TV | Yes | Yes, more options | Opens apps and sends keys by rule |
| Read TV state | Media player state | Plus SmartThings data | Volume, mute, source, foreground app, system metrics |
| React to remote buttons | Not documented | Not documented | Yes, through a remap rule |

The built-in integration is enough for power, volume and sources. Reach for Vetro when you want the TV to report things the integration does not, or you want a remote button to start an automation. Do not root a TV only for Home Assistant.

## What are the security limits?

The Vetro dashboard runs over plain HTTP, and the MQTT template sends credentials without TLS, so keep both on a trusted LAN. Since 0.5.0 the dashboard uses a pairing code shown on the TV, but pairing is automatic: until the Vetro app on the TV has been seen, the dashboard is open to the local network. See [SECURITY.md](https://github.com/andrearicci93/vetro/blob/main/SECURITY.md) and the [security model](/reference/vetro-security-model/).

Next steps: [what each Vetro switch changes](/reference/what-each-vetro-switch-changes/), [remap Samsung remote buttons](/control/remap-samsung-remote-buttons/), and [TizenTube](/control/tizentube-samsung-tv/) if YouTube is your goal.
