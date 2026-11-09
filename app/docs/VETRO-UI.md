# Vetro UI

Vetro UI is everything Vetro draws on the TV, gathered on one page of the dashboard: the **launcher**, **live TV** (Vetro TV Tuner) and the **on-screen displays** (the glass volume bar and the glass number pad). It replaces the separate Launcher and Vetro TV Tuner pages.

The page has four tabs:

| Tab | What it holds |
| --- | --- |
| **Overview** | One switch per part, its state, what it still needs, and how the parts depend on each other |
| **Launcher** | What the Home key opens: the Vetro launcher (with its preview, the task manager, HDMI and TizenTube options) or **another app** you installed (the custom launcher). Samsung’s Home switch lives here too |
| **Live TV** | The tuner: its switch, each of its parts (banner, channel list, TV guide (EPG), number pad, info panel, audio key, hold-to-repeat), the remote buttons and a picture of every screen |
| **On-screen displays** | The glass volume bar (with its position) and the glass number pad, what they need, and a picture of each that follows the chosen position |

Old links still work: opening the former Launcher or Tuner page opens Vetro UI on the matching tab.

## What depends on what

These rules are in `app/service/vetro-ui.js`, shared by the service and the page, and covered by `app/tests/vetro-ui.test.cjs`.

- **One launcher on the Home key.** Samsung’s Home, the Vetro launcher or another app: never two of Vetro’s at once. When one is on, the other offers a single **Use … instead** button: one question, then Vetro turns the first off and the second on, with the same steps as their own switches. If the second step fails, Samsung’s Home answers the Home key until you try again.
- **The volume bar and the 123 pad are drawn by the launcher’s process.** It runs while the Vetro launcher is on and, in the background, while another app is the launcher (in that mode the launcher’s process draws nothing of its own but still answers these keys; not yet tried on a TV). With Samsung’s Home on the Home key the two switches are kept but do nothing, and the page says so.
- **They need the remote interception.** The Remapper’s input bridge holds Vol +, Vol −, Mute and 123 back from Samsung and hands them to the launcher. **Vetro UI turns the interception on by itself** when you switch one of them on (or when the launcher that draws them comes on): it picks the one remote that reports keys, as the Remapper’s restore does. With more than one remote it does not guess and the page says to choose it in the Remapper. When both parts go off again, an interception Vetro UI turned on itself goes off too, unless shortcuts of your own still need it. It never turns the interception on at start-up or in the background: if you switch it off in the Remapper, it stays off.
- **The held keys are listed in the Remapper**, first among the shortcuts, with a lock: they cannot be deleted there, only switched off in Vetro UI. They are worked out from the launcher’s switches each time (`GET /remap` returns them as `reserved`) and never written into your rules, so an older Vetro or a restore never finds stray rules.
- **Vetro UI’s keys come first.** A shortcut of yours on Vol, Mute or 123 does not run while the part that uses that key is on; the Remapper marks it *Overridden by Vetro UI*. Before a part takes a key you use, Vetro UI names the shortcut and asks; saving a new shortcut on a held key asks too, and so does switching the interception off while Vetro UI needs it.
- **A launcher coming on can wake parts that were waiting.** With Samsung’s Home on the Home key, a volume bar or pad that is switched on holds no key. Turning on the Vetro launcher or another app makes them work, so the question before it names any shortcut of yours that would stop running.
- **Shortcuts on the tuner’s keys.** While the remote interception is on, a key that one of your shortcuts uses goes to that shortcut and is never passed on, so the tuner never gets it (CH ±, OK, the arrows, Info, Guide, Back). The Live TV tab lists such shortcuts, the Remapper marks them *Live TV does not get …*, and saving a new one on a tuner key asks first. The shortcut wins here: giving the tuner precedence would need the bridge to stop holding those keys while the tuner is on screen, which is not built.
- **The task manager is part of the Vetro launcher.** Down on the apps row lists the running apps with their CPU and memory: OK switches to one, holding OK (0.8 s) closes it. It is off unless you switch it on (Launcher tab or Overview); when on, a “Task manager” hint sits under the bar, which moves 46 px higher to make room. It needs no interception, and with another app as the launcher it does nothing (nothing of the dock is drawn then). It reads Down and OK, so a shortcut of yours on either key stops it from working while the interception is on; the Launcher tab says so. By zabique (PR #172).
- **Live TV stands alone.** It needs no launcher and no interception: while the bridge holds the remote, the tuner reads the keys from the bridge’s forwarded copy of the remote (same name), picked up within three seconds. The 123 pad’s Done tunes the tuner when it is on screen, and its Info key opens the tuner’s info panel.

## Compatibility

Nothing is moved or renamed on the TV: the launcher’s state (`vetro-dock.json`), the tuner’s state, the routes `/dock` and `/tuner` and the plugin ids `launcher` and `tuner` are the same. Whoever had the launcher or the tuner on before an update finds them on, with the same options. A launcher state from an older version has no position for the volume bar: it reads as Left, the default, and has the task manager off, so the launcher looks and works as before. The remote setting gains one optional field, `auto`, which older versions ignore.

## Not tried on a TV

The page, the switch-over and the automatic interception are tested on the computer only. Not yet seen on a TV: the bar and pad in custom-launcher mode, the automatic choice of the remote, the tuner reading the forwarded remote right after the bridge starts. The task manager was tried by its author on a QN85A (opening, sorting, Back); tapping and holding OK on a physical remote, and any run on a Q80A, are still to do.
