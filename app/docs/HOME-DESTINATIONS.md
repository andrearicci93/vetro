# Home destinations

Choose **Home destination** in Launcher or Remapper. Both editors show the same saved launcher mode:

- **Samsung Home** turns off Vetro’s overlay or Custom launcher mode and restores Autorun Smart Hub to its saved value.
- **Toggle Vetro overlay** shows or hides the overlay on Home.
- **Open a custom launcher** opens an installed custom launcher on Home without showing Vetro’s overlay.

Samsung Home remains installed and enabled in every mode. Vetro and Custom modes use the native launcher’s Home listener and temporary close guard. The modes are mutually exclusive. A failed change attempts to restore the previous mode and reports if restoration could not be confirmed.

Home is reserved for this shared assignment. Enabled physical shortcuts for code 63 are refused; previously saved Home rules remain visible but inactive. Other physical shortcuts, listening, and their interception preference are independent. This assignment does not cover HDMI-CEC or network-injected Home events.

## Overlay Home tile

In **Launcher → Vetro launcher → Home shortcut**, choose an installed, enabled app and a label of 1–12 characters. Save the shortcut to update the overlay tile. Select **Samsung Home (default)** to restore the standard tile. An unavailable app falls back to the appropriate Samsung Home when the list refreshes; its saved preference is retained.

## Double-press Home

In **Launcher → Vetro launcher → Double-press Home**, enable the feature, choose **Use Home shortcut above** or **Choose a different app**, then save. The first press shows or hides the overlay immediately; a second distinct press within 350 ms opens the selected destination. The overlay can briefly appear during a double press.

Double press is off by default and active only in Vetro overlay mode. Its preference is retained in Samsung and Custom modes. Holding a key does not count as two presses. Navigation and input reconnects cancel an unfinished gesture. Unavailable destinations fall back to Samsung Home. Saving the setting restarts an active overlay to apply the new destination.
