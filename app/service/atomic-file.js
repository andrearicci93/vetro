'use strict';
// Writes a small state file so that a power cut (these TVs are switched off at the wall) leaves either the old
// content or the new content, never half of one. The temporary file sits next to the target: rename is atomic
// only inside one filesystem. Callers that read the file already treat a missing or unparsable file as "no saved
// state", which is why a truncated file used to silently reset the setting.
function write(fs, file, text, options) {
    var temp = file + '.tmp';
    try {
        fs.writeFileSync(temp, text, options);
        fs.renameSync(temp, file);
    } catch (e) {
        try { fs.unlinkSync(temp); } catch (x) { /* nothing to remove */ }
        throw e;
    }
}
module.exports = {write: write};
