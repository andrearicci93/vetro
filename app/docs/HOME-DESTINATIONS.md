# Home destinations

Choose **Home destination** in Launcher or Remapper. Both editors show the same saved launcher mode:

- **Samsung Home** turns off Vetro’s overlay or Custom launcher mode and restores Autorun Smart Hub to its saved value.
- **Toggle Vetro overlay** shows or hides the overlay on Home.
- **Open a custom launcher** opens an installed custom launcher on Home without showing Vetro’s overlay.

Samsung Home remains installed and enabled in every mode. The modes are mutually exclusive. A failed change attempts to restore the previous mode and reports if restoration could not be confirmed.

Vetro’s overlay uses the launcher's native Home-key claim. The claim is attempted when the first Home press from the input reader shows the window, so Samsung Home may briefly appear on that first press after the launcher starts. The close guard remains available if Samsung Home still opens. Custom launcher mode uses the native listener and close guard without a window claim.

Home is reserved for this shared assignment. New enabled physical shortcuts for code 63 are refused; previously saved Home rules remain visible but inactive and can be retained when other shortcuts are edited. The remote bridge forwards physical Home to the native launcher instead of running a second Home shortcut. Volume, Mute, the number pad, other shortcuts, and listening keep their own input handling.

Home sent by name through Vetro uses the running launcher's control pipe while its claim is active; otherwise it follows the system key path. Support for other HDMI-CEC and network remotes depends on the events the TV delivers.
