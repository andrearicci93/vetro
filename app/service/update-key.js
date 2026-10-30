'use strict';
// Public half of the key that signs Vetro updates (PEM text), or null while none is set.
// Generate the pair with `node rooting/release.cjs keygen <folder>`, keep update-private.pem offline, paste the public
// key here. Until then the TV refuses every update bundle.
module.exports = null;
