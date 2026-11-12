# Remote PC: service-local SMACK rules

Extracted from the Q74T port discussed in [#114](https://github.com/andrearicci93/vetro/issues/114).
On QE55Q74TATXZT / `20_NIKEM_QTV`, Tizen 5.5, firmware
`T-NKMDEUC-2743.0`, SMACK denied the UID-0 agent's loopback connection from
`_` to the installed service's package label despite its effective capabilities.
Loading explicit rules for that pair allowed the authenticated connection.

`remote-pc-smack.js` reads the calling service's own label and generates two
best-effort **write-only** rule loads. Missing or unsupported labels produce an empty script.
The accepted character/length subset is intentionally conservative, not a claim
to support every valid kernel SMACK label.

The upstream tree does not yet enable this backend; draft #189 supplies the first
adapter call site. This helper does not change the archive-root path. Call
`buildRules()` in the service and insert its returned text in
the already privileged launch script before starting the connecting agent:

```js
var smackRules = require('./remote-pc-smack.js').buildRules();
// launch = ... + smackRules + agentCommand;
```

## Reduced-policy hardware test, 11 November 2026

Following review #147, the owner installed a test build with the original inline
rules narrowed from `rwxat` to `w`, then performed a full TV reboot. The package
retained all other runtime/UI resources. Readback of the live kernel policy was:

```text
_ User::Pkg::vetrotvapp w
User::Pkg::vetrotvapp _ w
```

The installed Vetro agent reconnected as UID/EUID/GID/EGID 0 with full effective
capabilities and `_`; a fresh root command completed. This validates **the access
set `w` in both directions**, not that both directions are individually necessary.
There has not yet been a one-direction-only hardware test.

The [kernel documentation](https://docs.kernel.org/admin-guide/LSM/Smack.html)
describes socket delivery as requiring sender write access to the receiver.
These remain label-wide rules, not rules scoped to one socket; no read, execute,
append or transmute access is granted by this helper.

Offline `node rooting/tests/remote-pc-smack.test.cjs` checks the exact same two
write rules and redirects fixture writes to temporary files, never SMACK policy.
No root acquisition or boot persistence installer is included.
