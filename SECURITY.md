# Security and responsible reports

Vetro is experimental privileged software. The browser management interface and API
require pairing with a code shown on the TV (see `app/docs/SIGN-IN.md`), but traffic
is plain HTTP and keys could be copied by anyone watching the LAN. Deploy only on a
trusted isolated LAN. Do not
forward its ports, expose it publicly or enable unrestricted access from other
networks. Root-agent authentication is a separate internal protocol from the dashboard sign-in.

Use GitHub private vulnerability reporting if the repository maintainer enables
it. If no private channel is configured, ask for one in an issue without including
credentials, exploits, device identifiers, raw logs or sensitive reproduction data.
No public security contact or private-report endpoint has been configured locally.

Only use the tool on devices you own or are authorized to administer. Do not share
signing keys or developer-account credentials. Diagnostic JSON excludes many
private fields but can still reveal installed software; review it before posting.
