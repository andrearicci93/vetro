# Input compatibility

The launcher, Remapper, Home Assistant rule editor and **Settings and controls → Network and inputs → Inputs** use the device's source inventory to choose between two layouts.

| Detected configuration | Launcher and Inputs tab | Remapper and MQTT input choices |
| --- | --- | --- |
| Exactly one HDMI port, DisplayPort and USB-C, with matching native source identities | HDMI, DisplayPort, USB-C | HDMI, DisplayPort, USB-C |
| Every other configuration | Original TV and HDMI 1–4 list; DisplayPort when present, as before | Original TV and HDMI 1–4 actions |

Detection uses physical source identities rather than a model-name prefix. A DisplayPort or USB-C entry alone does not select the G8 layout. An additional HDMI, TV or unrecognized source prevents that layout from matching. Activity suffixes such as `HDMI1/0` identify the same physical port. A disconnected cached port remains selectable and still counts toward the layout; recognized network/USB media entries and the observed `USBCAM` camera tile (source type 67, including activity suffixes) do not count as display inputs. Camera appearance, disappearance and connection state do not change the three-port layout. A camera key with an unrecognized source type remains unknown. Unknown source metadata is retained only as a classification flag, without exposing private names or paths.

The service merges the two Samsung Home source caches. If they cannot be read, ordinary devices retain the default TV/HDMI choices and current-state readback. Once a G8 layout has been identified, an unavailable inventory is reported instead of substituting unsupported TV inputs.

## Switching and existing behavior

G8 input remaps use the native source IDs and the same app-control request as the launcher. The service calls the packaged launcher's bounded `--switch-source TYPE LABEL ICON` mode; it sends one request without starting a launcher window or changing launcher settings. The firmware's native input resource, including SVG, is kept separate from optional tile artwork. Disabling Samsung source artwork therefore does not disable switching.

Other devices retain `KEY_TV` and `KEY_HDMI1`–`KEY_HDMI4` remaps and their original `input_keyevent` commands. Their native launcher icon fallback and optional PNG artwork behavior are preserved. DisplayPort on other supported monitors remains available in the launcher and Inputs tab without replacing the default remap list or adding USB-C.

The shared source selector validates numeric source IDs, serializes complete selections and confirms the selected source through readback. Its result includes `previousSourceType`, captured from the fresh inventory before selection; selecting that source again uses the same validation and readback path when it is known and still available. Round-trip restore tests cover both layouts. Failed commands or unconfirmed state are errors. The Inputs tab displays this inventory read-only. This change adds no persistent firmware setting or new root-integration mechanism.

## Validation and limits

`input-layout-compat.test.cjs` covers 20 configuration cases: matching monitors with and without USB cameras, activity suffixes, a different native HDMI identity, ordinary/empty TV caches, other DisplayPort monitors, incomplete or invalid inventories, extra HDMI/TV/unknown sources and network/USB-media metadata. It also exercises all five original TV key commands, legacy DisplayPort switching, unavailable-cache fallback and preservation of existing artwork behavior.

Dashboard tests exercise both layouts in the read-only Inputs tab and both key pickers, including layout transitions and unavailable inventories. Dispatch coverage retains the physical-event callback, remap resolver and selector, substituting only the TV execution boundary. Source-cache tests also cover camera enumeration in either Home cache across repeated reads and launcher refreshes. The native tests check source-resource validation, request data, errors and handle cleanup.

On an Odyssey OLED G8 LS34BG850SNXZA, firmware T-PTMLWWC-1720.7 / Tizen 6.5, the user reports working launcher and input-remapped buttons on an earlier combined test build, plus automatic UID 0 root startup after a cold restart. The final layout restriction and default-device regressions are fixture-tested; that refined build has not yet been installed. Other configurations have not received new hardware validation. An earlier selected-source readback mismatch remains to be reconciled with the successful picture changes before claiming complete hardware acceptance.

Settings/Quick Settings remapping is outside this change. No device credentials, local addresses, raw diagnostic files or device-specific signed packages belong in the contribution.
