'use strict';
// The package builder adds the committed source revision and whether tracked or
// new files under app/ and rooting/ differed from it. `shell` is the revision of what a file swap cannot change
// (config.xml); raise it when config.xml changes so that self-update asks for a reinstall instead.
module.exports = {version: '0.4.0', shell: 1, sourceRevision: null, sourceDirty: null};
