# Third-party notices

Vetro original code is MIT licensed. This notice does not relicense upstream works.

## Samsung TV root research

Source: https://github.com/chris-ritsen/samsung-tv-root
License: Unlicense. The vendored source retains its full notice at
`rooting/tools/samsung-tv-root-master/LICENSE`. Privilege-acquisition components
and integration research derive from that work. Preserve its notice when
redistributing the integration or adapted payload sources.

## Apps2Samsung

Source: https://github.com/Apps2Samsung/Apps2Samsung
License: MIT. The install-leftovers cleanup in `app/service/leftovers.js` ports
the staging-folder rules of its TV Toolbox agent (folders, package extensions,
one-at-a-time deletion and freed-bytes total). Retain the following notice for
the adapted portion:

```text
MIT License

Copyright (c) 2025 Patrick Stel 

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Glasshouse

Source: https://github.com/rorygallagher2024/glasshouse
License: MIT. Vetro's concept/design and earlier dashboard work were informed
by this LG webOS project. Retain the following notice for adapted portions:

```text
MIT License

Copyright (c) 2026 Rory Gallagher

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## TizenBrew and TizenTube

Sources: https://github.com/reisxd/TizenBrew and https://github.com/reisxd/TizenTube
Licenses: GPL-3.0, as declared upstream. Historical test WGTs are not included
in the public snapshot or app package. Links, research and compatibility tests
do not grant permission to relicense those projects. If code or packages are
incorporated later, distribute them under the applicable upstream license and
assess the combined work before release.

## Build dependencies and vendor tooling

The optional signing builder uses jszip, node-forge and reisxd/tizen.js through
its lockfile. Dependencies keep their own licenses; they are installed locally
and not vendored into the standalone application. Preserve package notices
when distributing build tools or their code. Samsung/Tizen Studio tooling,
certificates and SDK binaries are not part of the public source snapshot.

No vendor-owned TV applications, decrypted packages, user certificates,
accounts or raw device dumps are distributed as part of this source release.

## Phosphor Icons

Source: https://phosphoricons.com
License: MIT. The bold glyphs in `dock/tools/glyphs/` (gear, television, HDMI
numbers, sign-in) are used to draw the dock's Settings, Source and input icons.
The full notice is kept in `dock/tools/glyphs/LICENSE-phosphor.txt`.

## Packaged notices

Both WGT variants include this file, Vetro's `LICENSE` and the complete Phosphor
notice at `notices/LICENSE-phosphor.txt`. The integration WGT also includes the
root research notice at `notices/LICENSE-samsung-tv-root.txt`; remote-helper notices
remain alongside the payload. Contributor acknowledgements are in the repository
README and release changelog, including adapted contributions from still-open PRs.

## zabique's fork of Vetro

Source: https://github.com/zabique/vetro (branch `fork/extras`)
License: MIT, the same licence and copyright line as Vetro ("Vetro contributors"). The fork's commits carry
no author identity, so it is credited by its GitHub name. Ideas, mechanisms and first implementations adapted
from it, each marked in the file header:

- `app/service/keep-removed.js`: keeping removed apps off by writing their store ids into webappservice's
  list of removed apps (`RESERVED_19`), with a backstop that uninstalls a listed package that is back.
- `app/service/quick-wins.js`: the AirPlay win (do-not-start files for Samsung's AirPlay units) and the
  boot identity made of the boot id and the boot time.
- `app/service/hbbtv.js`: disabling the HbbTV service app so that its auto-restart cannot bring it back.

## pponce's fork of Vetro

Source: https://github.com/pponce/vetro (branch `prep/input-lifecycle-release-20261105`)
License: MIT, the same licence and copyright line as Vetro ("Vetro contributors"). The commit is included with its
original author and message; only a conflict in `runActions` (the `direct` parameter from #135 next to the new
`dispatchGuard`) was resolved here.

- `app/service/main.js`, `app/service/physical-input.js` and the tests `input-service-lifecycle`,
  `physical-input-lifecycle`: cancelling remote-input callbacks and queued actions after the service stops.
