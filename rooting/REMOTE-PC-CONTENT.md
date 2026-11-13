# Remote PC: invoke nested helpers by content

Extracted from the Q74T port discussed in [#114](https://github.com/andrearicci93/vetro/issues/114).
The verified device is QE55Q74TATXZT / `20_NIKEM_QTV`, Tizen 5.5, firmware
`T-NKMDEUC-2743.0`. UEP's script-loading restriction applies recursively:
starting the outer bootstrap by content does not authorize loading its helpers
by path. The working port starts the shell worker through the signed shell with
the helper's content supplied to `-c`.

The upstream tree does not yet contain the Remote PC adapter. This isolated
command builder is for that adapter; it is not enabled in the archive-root path.
The intended replacement for an indirect `. "$s"` worker launch is:

```js
var helperCommand = require('./remote-pc-content.js').helperCommand;
var worker = helperCommand(directory + '/shell-worker.sh', 'vetro-worker', [runtimeDirectory]);
```

Arguments are literal data: pass the resolved runtime path. Append the caller's existing stdin/log redirections,
background operator and `w=$!` PID capture. `$0` is the supplied worker name and
`$1` onward are the supplied arguments. The helper path must be trusted staging;
quoting is not an ownership or provenance check.

Content invocation is necessary but did not alone repair the Q74T connection:
the separate SMACK loopback restriction also had to be addressed. The original
inline launch was hardware-tested; this extraction has only offline checks:
`node rooting/tests/remote-pc-content.test.cjs`. The fixture checks content and
argument handling without emulating UEP or detachment. No firmware write,
bootstrap installer or account change is included.
