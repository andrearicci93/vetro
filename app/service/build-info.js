'use strict';
// The package builder adds the committed source revision and whether tracked or
// new files under app/ and rooting/ differed from it. `shell` is the revision of what a file swap cannot change
// (config.xml: privileges, service flags); raise it when one of those changes, never for the version attribute
// alone, which every release touches and which the swap leaves behind on the TV. Self-update asks for a reinstall
// when a bundle's shell is higher than the installed one. Some 0.7.1 installs (built from the v0.7.1 tag, commit 24cbee6) carry
// shell 2 although config.xml never changed: the next real config.xml change must raise this to 3, or those TVs would take it as a file swap.
module.exports = {version: '0.7.2', shell: 1, sourceRevision: null, sourceDirty: null};
