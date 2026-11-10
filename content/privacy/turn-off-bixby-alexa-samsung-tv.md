---
title: "Turn off Bixby, Alexa and the mic on a Samsung TV"
description: "How to disable Bixby and Alexa on a Samsung TV: the hardware mic switch on some models, Voice Wake-up, the Voice menu, and what Vetro's voice switch does."
keywords: ["disable bixby samsung tv", "turn off alexa samsung tv", "samsung tv microphone switch", "samsung tv voice wake-up"]
date: 2026-11-10
updated: 2026-11-10
verified: "Re-read on 2026-11-10: Samsung's UAE microphone-switch and voice-assistant pages, Samsung Canada's microphone-switch page, Samsung Australia's Alexa page, Malwarebytes (2026-10-27) and the Vetro 0.5.0 README and CHANGELOG."
related: ["turn-off-acr-samsung-tv", "what-data-samsung-tv-collects", "samsung-ads-opt-out", "remap-samsung-remote-buttons", "what-each-vetro-switch-changes"]
---

On models with a built-in microphone switch, use it to disable the TV's built-in microphone. Review the remote microphone and any connected audio device separately. Otherwise, turn off Voice Wake-up and review the Voice menu for Bixby and Alexa. Samsung's voice-assistant page gives the path Home, Menu, Settings, All Settings, General & Privacy, Voice, Voice Wake-up, and says some options may not be supported on all models or regions. On a rooted TV, Vetro can also disable the voice components, including the remote's microphone button.

## Does my Samsung TV have a microphone switch?

Some do. [Samsung's UAE support page](https://www.samsung.com/ae/support/tv-audio-video/how-to-enable-or-disable-the-microphone-switch-on-samsung-smart-tvs/) says the switch is "typically positioned at the bottom center or bottom right side of the TV frame", that the design varies by model, and that it exists on select models in the Galaxy View, The Frame, QLED, Neo QLED and Crystal UHD series. It adds that "if the microphone is off, voice input features will not work", and that an on-screen pop-up shows whether the microphone is on or off. [Samsung Canada's page](https://www.samsung.com/ca/support/tv-audio-video/how-to-enable-or-disable-the-microphone-switch-on-samsung-smart-tvs) describes the switch on the lower edge, in the centre or toward the right, and says voice commands are unavailable while it is off.

Neither page gives a software menu path for the switch itself, and neither says what happens to microphone data when the switch is off. If your TV has no switch, there is nothing to flip. Check your model's manual.

## How do I turn off Alexa on a Samsung TV?

[Samsung Australia's Alexa page](https://www.samsung.com/au/support/tv-audio-video/set-up-alexa/) says Alexa is available on all Samsung Smart TV models produced in 2021 and beyond, plus select 2020 models. It lists the setting as Settings > General / Advanced Features > Voice > Alexa Settings, with a hands-free wake-up option, and says that if wake-up is not enabled, the remote's voice button is the only way to activate Alexa. The microphone-switch condition on that page applies to Voice Wake-up. It separately describes holding the remote's microphone button and speaking into the remote.

For the always-listening trigger, use Samsung's [voice-assistant troubleshooting page](https://www.samsung.com/ae/support/tv-audio-video/voice-assistant-issues-on-my-samsung-tv/):

1. Open Settings, then All Settings, then General & Privacy, then Voice.
2. Select Voice Wake-up and turn it off (the page also describes lowering its sensitivity).

Switching wake-up off stops the wake word, but the remote's microphone button still works. Samsung's pages we opened do not say how to remove Alexa from the TV.

## How do I turn off Bixby on a Samsung TV?

The Samsung pages we opened do not give a Bixby removal or Bixby-specific off path. Samsung Canada's microphone page says that when the switch is back on, "Bixby and other voice features" work again, which tells you the microphone switch affects Bixby. The Voice menu on your TV is the place to look for each assistant's setting, and the labels differ by model.

[Malwarebytes](https://www.malwarebytes.com/blog/news/2026/03/samsung-tvs-stop-spying-on-viewers-in-texas-heres-how-to-disable-acr-anywhere) lists Voice Recognition Services as a separate toggle under Samsung's privacy choices. [Samsung's US privacy policy](https://www.samsung.com/us/account/privacy-policy/) says you can make "feature-specific choices" about whether to allow collection through a voice recognition feature, and that voice recordings are collected "when you enable this function" and use voice commands. Our [inventory of collected data](/privacy/what-data-samsung-tv-collects/) shows where voice sits next to the other categories.

## What about Voice Guide and voice search?

Voice Guide, the read-aloud accessibility feature, is a separate setting. We have no Samsung page to cite for its menu path, so we give none. Vetro's voice switch also turns it off, as described below.

## Is the TV listening to the room?

[Malwarebytes (2026-10-27)](https://www.malwarebytes.com/blog/news/2026/10/samsung-tvs-without-mics-may-listen-through-soundbars-researcher-says) reports an online researcher's claims that a 2025 Samsung TV ran an always-on voice component that counted sounds such as barking dogs and crying infants and reported the counts to Samsung, and that TVs without microphones look for paired soundbars or Bluetooth microphones. Malwarebytes says the claims "haven't been independently verified" and that Samsung does not appear to have commented. We treat them as unproven. The microphone switch, where it exists, is a hardware control, and Samsung's page says voice features stop working while it is off.

## What does Vetro do about voice assistants?

Vetro is a launcher, debloater and remapper for rooted Samsung Tizen TVs. It is experimental, needs root and ships no signed installer: see [Vetro's root requirements](/root/how-to-root-samsung-tv/), [whether rooting a Samsung TV is safe](/root/is-it-safe-to-root-samsung-tv/) and [the Apps2Samsung install route](/root/install-vetro-apps2samsung/). The stock menus are the better answer if you only want to stop wake-up.

According to the Vetro 0.5.0 [CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md), Quick settings has a Voice section with a Disable all voice assistants switch, plus per-feature switches for Alexa, Google Assistant, Bixby and other voice services. The all-in switch disables whatever the Task manager files under voice assistants on that TV. It asks for confirmation because it also turns off the remote's microphone button, Voice Guide (read-aloud) and voice suggestions in search. The [README](https://github.com/andrearicci93/vetro/blob/main/README.md) says each switch shows Done or Partly done.

![Vetro Quick settings with the voice assistants switch](/assets/img/dashboard-quick-settings.jpg)

The evidence is limited. The CHANGELOG records a community report from a Samsung Q65S95C (2023) on Vetro 0.2.3 ([#13](https://github.com/andrearicci93/vetro/issues/13); see the [S95C page](/tested-tvs/s95c/)) with 23 voice-assistant and ACR components disabled from Quick settings and 29 of 29 controls confirmed. The project itself is developed on the [Q80A](/tested-tvs/q80a/), and the Task manager descriptions come from the Q80A firmware, so other models may leave some packages unclassified. Disabling a component does not prove that no audio leaves the TV, and the project has not published a traffic capture.

If you want the microphone button for something else, Vetro also remaps remote keys; see [remapping Samsung remote buttons](/control/remap-samsung-remote-buttons/).

## What this article does not cover

It does not cover Google Assistant on soundbars, phones or other brands, and it gives no legal or warranty advice. The other privacy switches are in [how to turn off ACR](/privacy/turn-off-acr-samsung-tv/), and the advertising switch is in [Samsung Ads opt-out](/privacy/samsung-ads-opt-out/).
