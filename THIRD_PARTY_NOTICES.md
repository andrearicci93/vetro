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
