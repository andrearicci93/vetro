#!/bin/sh
# Launched as root by Remote PC, inside a root-owned mode-0700 directory.
set -u
runtime=$1
umask 077
while :; do
    if [ ! -f "$runtime/request" ]; then sleep 0.1; continue; fi
    IFS= read -r job < "$runtime/request" || exit 0
    rm -f "$runtime/request"
    case "$job" in ''|*[!0-9]*) exit 1;; esac
    # Record the session leader before executing any requested command.
    setsid /bin/sh -c 'printf "%s\n" "$$" > "$1/pid-$2"; ulimit -f 2048; exec /bin/sh -c "$(cat "$1/cmd-$2")"' \
        vetro-worker "$runtime" "$job" </dev/null >"$runtime/out-$job" 2>"$runtime/err-$job" &
    child=$!
    wait "$child"
    code=$?
    printf '%s\n' "$code" > "$runtime/done-$job.tmp"
    mv "$runtime/done-$job.tmp" "$runtime/done-$job"
done
