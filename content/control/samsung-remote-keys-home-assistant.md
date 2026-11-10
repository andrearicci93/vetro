---
title: "Samsung TV remote buttons as Home Assistant events"
description: "Home Assistant can send keys to a Samsung TV but cannot hear its remote. Here is how a rooted TV running Vetro can publish a button press over MQTT."
keywords: ["samsung tv remote button home assistant", "home assistant remote button trigger", "samsung remote mqtt", "samsung tv remote events"]
date: 2026-11-10
updated: 2026-11-10
verified: "Checked on 2026-11-10 against Home Assistant's samsungtv integration and trigger docs, a Home Assistant community thread, and the Vetro 0.5.0 MQTT guide, README, SECURITY.md and release audit."
related: ["home-assistant-samsung-tv", "remap-samsung-remote-buttons", "what-each-vetro-switch-changes", "vetro-security-model", "how-to-root-samsung-tv", "is-it-safe-to-root-samsung-tv"]
---

Home Assistant's Samsung integration sends keys to the TV. Its documentation does not describe receiving a press from the TV's own remote, so an automation like "when I press the Netflix button, dim the lights" cannot be built from that integration alone. On a rooted TV, Vetro can fill the gap: its Remapper intercepts a remote key and can publish an MQTT message, which Home Assistant reads as a trigger. Vetro is experimental, needs root and ships no signed installer. This page shows the flow and where the documentation stops.

## Why doesn't Home Assistant see Samsung remote presses?

The [Samsung Smart TV integration page](https://www.home-assistant.io/integrations/samsungtv/) describes sending key codes and key sequences to the TV, plus power and media state. It says nothing about receiving presses from the remote. A [Home Assistant community thread about triggering a scene from a TV remote](https://community.home-assistant.io/t/automation-when-press-button-on-tv-remote-control-activate-scene/429272) shows the usual workaround. The poster had an LG webOS TV, and the only reply suggested an IR receiver on an ESP board to read the button presses. That is a different brand, so it is not proof about Samsung, but the idea is the same: put a sensor next to the remote.

## How does Vetro turn a key press into an MQTT message?

Vetro's Remapper listens to the remote's input device on the TV, and a saved shortcut can open an app, send a native key or publish an MQTT message. The [Vetro MQTT guide](https://github.com/andrearicci93/vetro/blob/main/app/docs/mqtt/README.md) says: "A physical remote button can also publish an MQTT message." The steps:

1. Set up a broker and connect both Home Assistant and Vetro to it, as described in [Samsung TV and Home Assistant: three ways](/control/home-assistant-samsung-tv/).
2. Turn on physical input interception. The guide calls this part of the dashboard Remote; the 0.5.0 dashboard has a Remapper tab, and the MQTT page is now named Home Assistant.
3. Create a Remapper rule for the button with an MQTT action.
4. In Home Assistant, create an automation with an MQTT trigger on the same topic.

The guide does not name a topic for outgoing key presses, so use the topic you enter in the rule. The only topic it names is `vetro/command/open-app`, an incoming command. It also says rules that connect an input topic directly to an output topic are rejected to prevent loops, and recommends separate topics for commands and state.

On the Home Assistant side, the [automation trigger documentation](https://www.home-assistant.io/docs/automation/trigger/) includes an MQTT trigger with a `topic`:

```yaml
triggers:
  - trigger: mqtt
    topic: "YOUR/TOPIC/HERE"
```

Replace the topic with the one from your Vetro rule. The trigger page links to a separate MQTT trigger reference for the remaining options, so check it for current syntax.

## What happens to the button's normal action?

Interception means Vetro blocks the original action for keys you save. In the [release audit](https://github.com/andrearicci93/vetro/blob/main/app/docs/RELEASE-AUDIT.md) for an earlier build on a [Q80A](/tested-tvs/q80a/), two saved key codes were blocked after a reboot and the Prime Video button opened Stremio instead. A remapped button therefore stops doing what Samsung built it to do. The documentation does not say whether a button can keep its old function and also publish a message, and we have not tested it.

## What is verified and what is not?

- The MQTT guide says a Q80A was verified connected to a real broker on 2026-10-13, with a separate subscriber receiving discovery records, telemetry and volume, mute and source values. Rules with an MQTT trigger and an Open app action are documented with a Home Assistant `mqtt.publish` test.
- The same guide says Home Assistant UI behavior and TLS against a real broker still require verification. No recorded end-to-end test of a remote button publishing to Home Assistant is published, so treat the flow as documented rather than proven.
- After a restart the key filter was seen connected at about 115 and 118 seconds of uptime in the audit. Until then the button does what Samsung assigned and no message is sent. Incoming MQTT rules work in the background while the TV and the Vetro service are running.
- Which keys can be intercepted depends on firmware. See [remap Samsung remote buttons](/control/remap-samsung-remote-buttons/).

## What does the finished chain look like?

A press is read on the TV, the original action is blocked, the Remapper publishes a message to the broker, and Home Assistant's MQTT trigger fires an automation: a light, a scene, anything you attach. The reverse direction works through exact-topic rules, so an automation can open an app on the TV. Keep command topics and state topics separate.

## What are the risks?

Read [whether rooting a Samsung TV is safe](/root/is-it-safe-to-root-samsung-tv/) and [Vetro's root requirements](/root/how-to-root-samsung-tv/) before you start; the [Apps2Samsung install guide](/root/install-vetro-apps2samsung/) shows the install. The dashboard runs over plain HTTP and the MQTT template uses TCP without TLS, so keep the TV and broker on a trusted LAN. Since 0.5.0 the dashboard uses a pairing code, but pairing is automatic and the dashboard stays open until the Vetro app on the TV has been seen ([SECURITY.md](https://github.com/andrearicci93/vetro/blob/main/SECURITY.md), [security model](/reference/vetro-security-model/)). Every switch is listed in [what each Vetro switch changes](/reference/what-each-vetro-switch-changes/).

## Can I do this without root?

The only workaround in the community thread above is hardware, an IR receiver with an ESP board next to the remote. It is not a Samsung feature and we have not tested it.
