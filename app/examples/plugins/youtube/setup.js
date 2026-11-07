'use strict';
// Shell pieces run as root through ctx.execute: the certificate setup, starting and closing the YouTube app, and cleanup.
// Everything the plugin keeps outside its own folder is under DIR.

var DIR = '/opt/usr/home/owner/share/vetro-youtube';
var CACHE = DIR + '/cache';
// The copy of the YouTube app's content folder. Its path is kept very short on purpose: Samsung's own tile passes the app at most
// 127 characters of flags, and Samsung's flags already take about 50 of them.
var CONTENT = '/opt/usr/home/owner/share/vyt';
var COBALT = '/usr/apps/com.samsung.tv.cobalt/content/app/cobalt';
var APP = 'com.samsung.tv.cobalt-yt';       // Samsung's YouTube
var USER = 5001;

function toBase64(text) { return (Buffer.from && Buffer.from !== Uint8Array.from ? Buffer.from(text) : new Buffer(text)).toString('base64'); }
function wrap(script) { return 'echo ' + toBase64(script) + ' | base64 -d | sh'; }

// Makes (once, and again when something expires or Samsung's YouTube changed) three things in DIR:
//  - a certificate authority of its own (ca.key stays root-only) and a certificate for youtube.com signed by it (leaf.*);
//  - CONTENT, a copy of the YouTube app's content folder with that authority added to its trust store. The app is started with
//    --content pointing here, so the authority is trusted by that app alone, never by the TV.
// Prints one word: ready | nocobalt.
function setupScript() {
    return [
        'set -e',
        'umask 022',
        "D='" + DIR + "'",
        "C='" + CONTENT + "'",
        "SRC='" + COBALT + "/content'",
        "LIB='" + COBALT + "/lib/libcobalt.so'",
        '[ -d "$SRC/ssl/certs" ] || { echo nocobalt; exit 0; }',
        // DIR belongs to root: the user the TV apps run as cannot swap a file for a link that a root command below would follow.
        // Only cache/ is theirs (the downloaded script, verified by hash on every read).
        'mkdir -p "$D"; chown root:root "$D"; chmod 755 "$D"; cd "$D"',
        'for f in ca.key ca.crt ca.cnf ca.srl leaf.key leaf.crt leaf.csr leaf.ext content.stamp cache "$C"; do [ -L "$f" ] && rm -f "$f"; done',
        'if [ -f ca.key ] && [ ! -O ca.key ]; then rm -rf ca.key ca.crt leaf.key leaf.crt leaf.csr ca.srl "$C" content.stamp; fi',
        'rm -rf content',                                     // where the copy used to be (before the path had to be short)
        '[ -d cache ] || mkdir cache; chown owner:users cache; chmod 755 cache',
        'if [ ! -f ca.key ] || [ ! -f ca.crt ] || ! openssl x509 -in ca.crt -noout -checkend 2592000 >/dev/null 2>&1; then',
        '  rm -rf ca.key ca.crt leaf.key leaf.crt leaf.csr ca.srl "$C" content.stamp',
        "  printf '%s\\n' '[req]' 'distinguished_name=dn' 'x509_extensions=v3' 'prompt=no' '[dn]' 'CN=Vetro YouTube Local CA' '[v3]' 'basicConstraints=critical,CA:TRUE' 'keyUsage=critical,keyCertSign,cRLSign' 'subjectKeyIdentifier=hash' > ca.cnf",
        '  openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 3650 -sha256 -config ca.cnf >/dev/null 2>&1',
        'fi',
        'STAMP="v3-$(stat -c %Y "$LIB" 2>/dev/null)-$(openssl x509 -in ca.crt -noout -fingerprint -sha256)"',
        'if [ ! -d "$C" ] || [ ! -O "$C" ] || [ "$(cat content.stamp 2>/dev/null)" != "$STAMP" ]; then',
        '  rm -rf "$C" content.stamp; cp -R "$SRC" "$C"',
        '  cp ca.crt "$C/ssl/certs/$(openssl x509 -in ca.crt -noout -subject_hash).0"',
        '  cp ca.crt "$C/ssl/certs/$(openssl x509 -in ca.crt -noout -subject_hash_old).0"',
        '  echo "$STAMP" > content.stamp',
        'fi',
        'if [ ! -f leaf.crt ] || [ ! -f leaf.key ] || ! openssl x509 -in leaf.crt -noout -checkend 2592000 >/dev/null 2>&1 || ! openssl verify -CAfile ca.crt leaf.crt >/dev/null 2>&1; then',
        '  openssl req -new -newkey rsa:2048 -nodes -keyout leaf.key -subj /CN=www.youtube.com -out leaf.csr >/dev/null 2>&1',
        "  printf '%s\\n' 'subjectAltName=DNS:www.youtube.com,DNS:youtube.com' 'basicConstraints=CA:FALSE' 'keyUsage=digitalSignature,keyEncipherment' 'extendedKeyUsage=serverAuth' > leaf.ext",
        '  openssl x509 -req -in leaf.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out leaf.crt -days 397 -sha256 -extfile leaf.ext >/dev/null 2>&1',
        'fi',
        'chown root:root ca.key; chown owner:users leaf.key leaf.crt ca.crt; chmod 600 ca.key leaf.key; chmod 644 ca.crt leaf.crt',
        'echo ready'
    ].join('\n');
}

// What Samsung's own tile passes to the YouTube app (metadata native.userdata of 9Ur5IzDKqV.TizenYouTube), plus the proxy and
// the content folder. The proxy list ends in direct://: if the proxy is down the app connects directly (unpatched) instead of
// showing a network error. The value of USERDATA starts with a space on purpose: without it app_launcher reads the value as one
// of its own options.
var SAMSUNG_ARGS = '--base_url=https://www.youtube.com/tv --dial_name=YouTube --use_eden --start_frag=#start';

// No http:// in front of the proxy address (it is the default) and a short content path: see CONTENT.
function proxyArgs(proxyHost, proxyPort) { return '--proxy=' + proxyHost + ':' + proxyPort + ',direct:// --content=' + CONTENT; }

function launchScript(proxyHost, proxyPort) {
    var args = ' ' + SAMSUNG_ARGS + ' ' + proxyArgs(proxyHost, proxyPort);
    return 'app_launcher -t ' + APP + ' -u ' + USER + ' >/dev/null 2>&1; sleep 1; app_launcher -s ' + APP + ' -u ' + USER + " USERDATA '" + args + "' 2>&1";
}

function closeScript() { return 'app_launcher -t ' + APP + ' -u ' + USER + ' 2>&1'; }

// Everything this plugin put on the TV outside its own folder.
function cleanupScript() { return closeScript() + '; rm -rf "' + DIR + '" "' + CONTENT + '"; echo removed'; }

module.exports = { DIR: DIR, CACHE: CACHE, CONTENT: CONTENT, APP: APP, SAMSUNG_ARGS: SAMSUNG_ARGS, proxyArgs: proxyArgs, wrap: wrap, setupScript: setupScript, launchScript: launchScript, closeScript: closeScript, cleanupScript: cleanupScript };
