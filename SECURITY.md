# Security and responsible reports

Vetro is experimental privileged software. The browser management interface and API
require pairing with a code shown on the TV (see `app/docs/SIGN-IN.md`), but traffic
is plain HTTP and keys could be copied by anyone watching the LAN. Deploy only on a
trusted isolated LAN. Do not
forward its ports, expose it publicly or enable unrestricted access from other
networks. Root-agent authentication is a separate internal protocol from the dashboard sign-in.

The experimental SDB tunnel accepts only loopback clients by default. A paired
user can enable **Quick settings → Maintenance → Developer access → Allow SDB
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
