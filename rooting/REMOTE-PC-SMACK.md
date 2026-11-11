# Remote PC: service-local SMACK rules

Extracted from the Q74T port discussed in [#114](https://github.com/andrearicci93/vetro/issues/114).
On QE55Q74TATXZT / `20_NIKEM_QTV`, Tizen 5.5, firmware
`T-NKMDEUC-2743.0`, SMACK denied the UID-0 agent's loopback connection from
`_` to the installed service's package label despite its effective capabilities.
Loading explicit rules for that pair allowed the authenticated connection.

`remote-pc-smack.js` reads the calling service's own label and generates a
best-effort `_ -> service` write rule. `{reverse: true}` also emits the reverse
write rule for controlled testing. Missing or unsupported labels produce an empty script.
The accepted character/length subset is intentionally conservative, not a claim
to support every valid kernel SMACK label.

The experimental external-root adapter calls this only after an explicit SMACK
mode opt-in. It does not change the archive-root path. Call `buildRules()` in
the service and insert its returned text in
the already privileged launch script before starting the connecting agent:

```js
var smackRules = require('./remote-pc-smack.js').buildRules();
// launch = ... + smackRules + agentCommand;
```

The original inline implementation used **two `rwxat` rules** and was
hardware-tested. Following review #147, these reduced write-only candidates
have offline tests but are **not yet hardware-verified**. A clean boot is needed
to avoid old broad rules masking failures. The fixture writes only to temporary
files, never SMACK policy. No root acquisition or boot persistence installer is included.
