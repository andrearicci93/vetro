# Remote PC: opt-in channel renewal

Extracted from the Q74T port discussed in [#114](https://github.com/andrearicci93/vetro/issues/114).
The original adapter stops after its 15-minute window. An independently installed
root supervisor can answer subsequent bootstraps, but only if the adapter keeps
offering fresh ones. Renewal must dispose of the old channel before starting the
next, and must not repeat submitted commands.

The upstream tree does not yet contain that adapter. `remote-pc-deadline.js`
isolates its deadline callback for review without importing the whole port. Its
intended call site replaces the existing `setTimeout(stop, lifetimeMs)`:

```js
var schedule = require('./remote-pc-deadline.js').schedule;
// Inside the adapter's existing successful preparation callback:
deadline = schedule(stop, start, options);
// Existing stop() must retain: clearTimeout(deadline); deadline = null;
```

Omitting `autoRenew`, or setting it to anything other than boolean `true`, keeps
one-window manual behavior. The default lifetime remains 900000 ms. Nothing in
this contribution selects a new backend, enables renewal by default, acquires
root, installs a supervisor, or changes the firmware. `start()` remains
responsible for preparing fresh session material.

The inline renewal behavior was used on QE55Q74TATXZT / `20_NIKEM_QTV`, Tizen 5.5,
firmware `T-NKMDEUC-2743.0`. This extraction has not been redeployed. Offline
`node rooting/tests/remote-pc-deadline.test.cjs` checks expiry, cleanup ordering,
three renewal cycles and explicit-stop cancellation using a deterministic clock;
it does not certify a hardware cold boot or a connected agent.
