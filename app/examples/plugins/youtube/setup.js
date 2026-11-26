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
        '[ -L "$D" ] && rm -f "$D"; mkdir -p "$D"; chown root:root "$D"; chmod 755 "$D"; cd "$D"',
        'for f in ca.key ca.crt ca.key.tmp ca.crt.tmp ca.cnf ca.srl leaf.key leaf.crt leaf.key.tmp leaf.crt.tmp leaf.csr leaf.ext content.stamp content.stamp.tmp cache "$C" "$C.tmp" "$C.old"; do [ -L "$f" ] && rm -f "$f"; done',
        'if [ -f ca.key ] && [ ! -O ca.key ]; then rm -rf ca.key ca.crt leaf.key leaf.crt leaf.csr ca.srl "$C" content.stamp; fi',
        'rm -rf content',                                     // where the copy used to be (before the path had to be short)
        '[ -d cache ] || mkdir cache; chown owner:users cache; chmod 755 cache',
        'if [ ! -f ca.key ] || [ ! -f ca.crt ] || ! openssl x509 -in ca.crt -noout -checkend 2592000 >/dev/null 2>&1; then',
        '  rm -rf ca.key.tmp ca.crt.tmp leaf.csr ca.srl',
        "  printf '%s\\n' '[req]' 'distinguished_name=dn' 'x509_extensions=v3' 'prompt=no' '[dn]' 'CN=Vetro YouTube Local CA' '[v3]' 'basicConstraints=critical,CA:TRUE' 'keyUsage=critical,keyCertSign,cRLSign' 'subjectKeyIdentifier=hash' > ca.cnf",
        '  openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key.tmp -out ca.crt.tmp -days 3650 -sha256 -config ca.cnf >/dev/null 2>&1',
        '  chown root:root ca.key.tmp; chown owner:users ca.crt.tmp; chmod 600 ca.key.tmp; chmod 644 ca.crt.tmp',
        '  mv ca.key.tmp ca.key; mv ca.crt.tmp ca.crt',
        'fi',
        'STAMP="v3-$(stat -c %Y "$LIB" 2>/dev/null)-$(openssl x509 -in ca.crt -noout -fingerprint -sha256)"',
        'if [ ! -d "$C" ] || [ ! -O "$C" ] || [ "$(cat content.stamp 2>/dev/null)" != "$STAMP" ]; then',
        '  rm -rf "$C.tmp" "$C.old"; cp -R "$SRC" "$C.tmp"',
        '  cp ca.crt "$C.tmp/ssl/certs/$(openssl x509 -in ca.crt -noout -subject_hash).0"',
        '  cp ca.crt "$C.tmp/ssl/certs/$(openssl x509 -in ca.crt -noout -subject_hash_old).0"',
        '  if [ -e "$C" ]; then mv "$C" "$C.old"; fi',
        '  mv "$C.tmp" "$C"; rm -rf "$C.old"',
        '  echo "$STAMP" > content.stamp.tmp && mv content.stamp.tmp content.stamp',
        'fi',
        'if [ ! -f leaf.crt ] || [ ! -f leaf.key ] || ! openssl x509 -in leaf.crt -noout -checkend 2592000 >/dev/null 2>&1 || ! openssl verify -CAfile ca.crt leaf.crt >/dev/null 2>&1; then',
        '  rm -f leaf.key.tmp leaf.crt.tmp leaf.csr',
        '  openssl req -new -newkey rsa:2048 -nodes -keyout leaf.key.tmp -subj /CN=www.youtube.com -out leaf.csr >/dev/null 2>&1',
        "  printf '%s\\n' 'subjectAltName=DNS:www.youtube.com,DNS:youtube.com' 'basicConstraints=CA:FALSE' 'keyUsage=digitalSignature,keyEncipherment' 'extendedKeyUsage=serverAuth' > leaf.ext",
        '  openssl x509 -req -in leaf.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out leaf.crt.tmp -days 397 -sha256 -extfile leaf.ext >/dev/null 2>&1',
        '  chown owner:users leaf.key.tmp leaf.crt.tmp; chmod 600 leaf.key.tmp; chmod 644 leaf.crt.tmp',
        '  mv leaf.key.tmp leaf.key; mv leaf.crt.tmp leaf.crt',
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
    var appPattern = '(^|[ =])[' + APP.charAt(0) + ']' + APP.slice(1).replace(/\./g, '\\.') + '($| )';
    return [
        'yt_up() {',
        '  for f in $(grep -al "[c]obalt" /proc/[0-9]*/cmdline 2>/dev/null); do',
        '    p=${f%/cmdline}',
        '    [ "$p" = "/proc/$$" ] && continue',
        '    [ -r "$f" ] || continue',
        '    if [ -r "$p/comm" ]; then',
        '      IFS= read -r COMM < "$p/comm" 2>/dev/null || COMM=""',
        '      case "$COMM" in sh|ash|dash|bash|busybox|grep|awk|tr|sed|cat|base64|node|dotnet) continue;; esac',
        '    fi',
        '    ARGS=$(tr "\\0" "\\n" < "$f" 2>/dev/null)',
        '    case "$ARGS" in /bin/sh*|sh*|*/sh*|*/ash*|*/dash*|*/bash*) continue;; esac',
        "    if printf '%s\\n' \"$ARGS\" | grep -Eq '" + appPattern + "'; then return 0; fi",
        '    case "$ARGS" in /usr/apps/com.samsung.tv.cobalt/bin/cobalt_launcher*)',
        '      U=$(printf "%s\\n" "$ARGS" | awk \'prev=="USERDATA"{u=$0} {if(NR==4) a4=$0; prev=$0} END{if(u!="") print u; else if(a4!="") print a4}\')',
        '      A=$(printf "%s\\n" "$ARGS" | awk \'prev=="__AUL_APPID__"{print; exit} {prev=$0}\')',
        '      D=$(printf "%s" "$U" | base64 -d 2>/dev/null | tr -c "[:print:]" " ")',
        '      ID=$(printf "%s" "$A" | base64 -d 2>/dev/null | tr -c "[:print:]" " ")',
        '      case " $D " in *"dial_name=YouTube "*) return 0;; esac',
        '      case " $ID " in *" ' + APP + ' "*) return 0;; esac',
        '      ;;',
        '    esac',
        '  done',
        '  return 1',
        '}',
        'yt_wait() { if command -v usleep >/dev/null 2>&1; then usleep 200000; else sleep 0.2 2>/dev/null || sleep 1; fi; }',
        'if yt_up; then',
        '  app_launcher -t ' + APP + ' -u ' + USER + ' >/dev/null 2>&1',
        '  i=0; while [ $i -lt 15 ] && yt_up; do yt_wait; i=$((i + 1)); done',
        '  if yt_up; then',
        '    app_launcher -k ' + APP + ' -u ' + USER + ' >/dev/null 2>&1',
        '    i=0; while [ $i -lt 5 ] && yt_up; do yt_wait; i=$((i + 1)); done',
        '  fi',
        'fi',
        'app_launcher -s ' + APP + ' -u ' + USER + " USERDATA '" + args + "' 2>&1"
    ].join('\n');
}

function closeScript() { return 'app_launcher -t ' + APP + ' -u ' + USER + ' 2>&1'; }

// Everything this plugin put on the TV outside its own folder.
function cleanupScript() { return closeScript() + '; rm -rf "' + DIR + '" "' + CONTENT + '" "' + CONTENT + '.tmp" "' + CONTENT + '.old"; echo removed'; }

module.exports = { DIR: DIR, CACHE: CACHE, CONTENT: CONTENT, APP: APP, SAMSUNG_ARGS: SAMSUNG_ARGS, proxyArgs: proxyArgs, wrap: wrap, setupScript: setupScript, launchScript: launchScript, closeScript: closeScript, cleanupScript: cleanupScript };
