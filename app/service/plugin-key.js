'use strict';
// Public half of the key that signs the public plugin list (PEM text), or null while none is set. It is NOT the key that
// signs Vetro updates (update-key.js): a compromised plugin list must not be able to push code as a Vetro update.
// With a key set, a plugin installs only with the list's signature, or in Developer mode.
// Make the pair with `node scripts/vetro-plugin.cjs keygen <folder>`; sign the list with `... sign <index.json> <private.pem>`.
module.exports = null;
