# Remote PC: service-local SMACK rules

Extracted from the Q74T port discussed in [#114](https://github.com/andrearicci93/vetro/issues/114).
On QE55Q74TATXZT / `20_NIKEM_QTV`, Tizen 5.5, firmware
`T-NKMDEUC-2743.0`, SMACK denied the UID-0 agent's loopback connection from
`_` to the installed service's package label despite its effective capabilities.
Loading explicit rules for that pair allowed the authenticated connection.

`remote-pc-smack.js` reads the calling service's own label and generates the two
best-effort rule loads. Missing or unsupported labels produce an empty script.
The accepted character/length subset is intentionally conservative, not a claim
to support every valid kernel SMACK label.

The upstream tree does not yet contain the Remote PC adapter. This is an isolated
building block, not an enabled backend or a change to the archive-root path. In
that adapter, call `buildRules()` in the service and insert its returned text in
the already privileged launch script before starting the connecting agent:

```js
var smackRules = require('./remote-pc-smack.js').buildRules();
// launch = ... + smackRules + agentCommand;
```

The original inline implementation was hardware-tested on the device above.
This extraction was checked offline with `node rooting/tests/remote-pc-smack.test.cjs`;
it has not been redeployed. The fixture writes only to temporary files, never
SMACK policy. No root acquisition or boot persistence installer is included.
