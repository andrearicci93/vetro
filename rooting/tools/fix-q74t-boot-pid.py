#!/usr/bin/env python3
"""Prepare a local Q74T boot-hook correction; never contacts or writes to a TV."""
import argparse
from pathlib import Path


def patch(source):
    old = b'PIDFILE="$D/supervisor.pid"\n'
    if source.count(old) != 1 or b'LOCK=/tmp/.q74t-boot-lock\n' not in source or b'SUP="$D/root-supervisor.sh"\n' not in source:
        raise ValueError('Unexpected boot hook; refusing to patch')
    # /opt survives cold boots; a PID stored there can name an unrelated process
    # next time. The root-owned lock directory is on tmpfs and fresh each boot.
    return source.replace(old, b'PIDFILE="$LOCK/supervisor.pid"\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    fixed = patch(args.source.read_bytes())
    with args.destination.open('xb') as out:
        out.write(fixed)
    print('Prepared local boot hook; no TV contacted')


if __name__ == '__main__':
    main()
