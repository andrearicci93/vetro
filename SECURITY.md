# Security and responsible reports

Vetro is experimental privileged software. **Pairing is automatic by default:** it
switches on by itself once the Vetro app on the TV has been seen, because that proves the TV
can show the code. Until then, and on a TV whose app is never recognised, the service is open like
0.3.5: any device on the local network can use the browser management interface and API,
including root commands, and the dashboard warns about it. With pairing on, every
browser or script needs a code shown on the TV (see `app/docs/SIGN-IN.md`). The TV itself needs no code:
programs on the TV that send no Origin, and the TV browser on the dashboard address. An opaque Origin
counts as the TV only on the Vetro app's routes, so a web page open in the TV browser cannot use root routes. Traffic is plain HTTP and keys could be copied
by anyone watching the LAN. Deploy only on a
trusted isolated LAN. Do not
forward its ports, expose it publicly or enable unrestricted access from other
networks. Root-agent authentication is a separate internal protocol from the dashboard sign-in.

**Require pairing** in Quick settings → Developer settings → Pairing lets the owner replace the
automatic mode (always on, or never). While pairing is not on, a warning says so; Origin/host checks remain, opaque or non-web origins
are accepted only on the TV page's check routes (`/status`, `/probe`, `/screen`), and
the pairing code remains TV-only. Turning it on from an unpaired browser first pairs
that browser, so nobody is locked out; existing paired keys remain valid either way.
Restore the TV does not change it. This switch does not control SDB access.

The experimental SDB tunnel accepts only loopback clients by default. A paired
user can enable **Quick settings → Developer settings → Developer access → Allow SDB
from the local network**. The choice persists across service restarts. SDB itself
has no Vetro pairing: any reachable client then gets developer access to the TV.
Turning the switch off disconnects existing network SDB clients while retaining
Vetro's local streams. HTTP sign-out alone does not revoke SDB access.

The integration keeps one IPv4 listener on port 26201 and rejects remote clients
before processing SDB frames while the switch is off; the listener is not rebound
when the switch changes. `VETRO_SDB_TUNNEL_PORT` changes the port, not authentication.

Plugins (`app/docs/plugins.md`) are third-party code that runs inside Vetro's service process. There is **no sandbox**:
the host guards failures, but a plugin can use everything Vetro can, including running commands as root, whatever
permissions it declares (permissions are labels, not limits). They are off until switched on and can only be installed
by a paired device. The public list is signed with its own key and spot-checked, not audited: a signature shows that a
file is the one the list published, not that its code is safe. Plugins outside the list need Developer mode. Switch on only
plugins you trust.

Self-update (`app/docs/UPDATING.md`) replaces Vetro's files with the root helper. An update is accepted only if its manifest
is signed with the Vetro release key, whose public half is part of the package; the private key is kept offline and is not
the plugin list's key.

Use GitHub private vulnerability reporting if the repository maintainer enables
it. If no private channel is configured, ask for one in an issue without including
credentials, exploits, device identifiers, raw logs or sensitive reproduction data.
No public security contact or private-report endpoint has been configured locally.

Only use the tool on devices you own or are authorized to administer. Do not share
signing keys or developer-account credentials. Diagnostic JSON excludes many
private fields but can still reveal installed software; review it before posting.
