#!/usr/bin/env python3
"""Temporary VNC/SMB setup for the Q74T Remote PC adapter.

Reuses the owner's previously reviewed laboratory, without changing its pointer.
Only --start needs sudo, solely to bind TCP 445 before dropping privileges.
"""
import argparse
import importlib.util
import io
import json
import os
import pwd
import re
import secrets
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'self-test', 'start', 'serve', 'smb', 'vnc', 'test-smb'])
    parser.add_argument('--run', required=True, type=Path)
    parser.add_argument('--existing-lab', required=True, type=Path)
    parser.add_argument('--status-report', type=Path)
    parser.add_argument('--listen-fd', type=int)
    parser.add_argument('--password-file', type=Path, help='Reuse an eight-digit synthetic lab password')
    args = parser.parse_args()
    args.run = args.run.resolve()
    args.existing_lab = args.existing_lab.resolve()
    spec = importlib.util.spec_from_file_location('q74t_reviewed_lab', args.existing_lab)
    lab = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = lab
    spec.loader.exec_module(lab)
    lab.HERE = args.run.parent
    lab.POINTER = args.run / 'pointer.txt'
    lab.DURATION = 900

    def command(action):
        return [str(Path(__file__).resolve()), action, '--run', str(args.run), '--existing-lab', str(args.existing_lab)]

    if args.action == 'prepare':
        if args.run.exists():
            raise RuntimeError('Choose a fresh run directory')
        report = json.loads(args.status_report.read_text())['output']
        status, _ = json.JSONDecoder().raw_decode(report[report.index('{'):])
        username = status.get('bootstrapUsername', '')
        if status.get('rootMethod') != 'remote-pc' or not status.get('prepared') or not re.fullmatch(r'lab\$\(bash</tmp/vq-[A-Za-z0-9]+/launch\)', username):
            raise RuntimeError('The prototype is not waiting for a recognized setup trigger')
        args.run.mkdir(mode=0o700)
        (args.run / 'pointer.txt').write_text(str(args.run))
        password = args.password_file.read_text().strip() if args.password_file else ''.join(str(secrets.randbelow(10)) for _ in range(8))
        if not re.fullmatch(r'[0-9]{8}', password):
            raise RuntimeError('The reused lab password must contain eight digits')
        (args.run / 'password.txt').write_text(password + '\n')
        (args.run / 'password.txt').chmod(0o600)
        token = secrets.token_hex(6)
        data = {'tv': lab.TV, 'host': lab.HOST, 'marker': '/tmp/vp' + token, 'username': username,
                'mode': 'vetro-root-agent-launch', 'duration_seconds': 900, 'password_length': 8}
        (args.run / 'config.json').write_text(json.dumps(data, indent=2) + '\n')
        (args.run / 'share').mkdir()
        (args.run / 'share/README.txt').write_text('Vetro temporary root-agent setup. Read-only synthetic share.\n')
        card = ('VETRO Q74T — PROVA TEMPORANEA\n\nAccesso remoto -> PC remoto -> VNC\n'
                'Indirizzo PC: ' + lab.HOST + '\nNome utente INTERO:\n' + username + '\nPassword:\n' + password +
                '\n\nRicorda le credenziali. Attendi le fasce colorate, poi apri Cartelle condivise una volta.\n'
                'Un errore successivo non prova il fallimento: attendi la verifica dell’agente.\n')
        (args.run / 'SCHEDA-TV.txt').write_text(card)
        print(card)
        return
    if args.action == 'smb' or args.action == 'test-smb':
        # Diagnose credential/profile differences without logging usernames,
        # passwords or NTLM material. The older laboratory reports only a bool.
        from impacket import smbserver
        expected = json.loads((args.run / 'config.json').read_text())['username']
        original_setter = smbserver.SimpleSMBServer.setAuthCallback
        def instrumented_setter(server, callback):
            def outcome(**values):
                observed = values.get('user_name', '')
                if not isinstance(observed, str):
                    observed = ''
                prefix = 0
                for a, b in zip(expected, observed):
                    if a != b:
                        break
                    prefix += 1
                print(json.dumps({'time': time.time(), 'event': 'username_shape',
                    'expected_length': len(expected), 'received_length': len(observed),
                    'matching_prefix_length': prefix,
                    'matches_without_whitespace': ''.join(observed.split()) == ''.join(expected.split()),
                    'looks_like_old_identity_probe': bool(re.fullmatch(r'lab\$\((?:umask 022;)?id>/tmp/vp[0-9a-f]+\)', observed))}), flush=True)
                callback(**values)
            return original_setter(server, outcome)
        smbserver.SimpleSMBServer.setAuthCallback = instrumented_setter
        return lab.smb_worker(11445 if args.action == 'test-smb' else 445,
                              '127.0.0.1' if args.action == 'test-smb' else lab.TV, args.listen_fd)
    if args.action == 'vnc':
        return lab.vnc_worker()
    if args.action == 'self-test':
        from impacket.smbconnection import SMBConnection, SessionError
        data = json.loads((args.run / 'config.json').read_text())
        password = (args.run / 'password.txt').read_text().strip()
        with (args.run / 'smb-selftest.log').open('w') as log:
            worker = subprocess.Popen([str(lab.SMB_PYTHON)] + command('test-smb'), stdout=log, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 8
                while '"event": "listening"' not in (args.run / 'smb-selftest.log').read_text():
                    if worker.poll() is not None or time.monotonic() > deadline:
                        raise RuntimeError('SMB test did not start')
                    time.sleep(0.1)
                for username, candidate, accepted in [(data['username'], 'wrong-password', False),
                                                      (data['username'] + '_x', password, False),
                                                      (data['username'], password, True)]:
                    client = SMBConnection('127.0.0.1', '127.0.0.1', sess_port=11445, timeout=5)
                    try:
                        try:
                            client.login(username, candidate)
                        except SessionError:
                            if accepted:
                                raise
                            continue
                        if not accepted:
                            raise RuntimeError('Incorrect password accepted')
                        assert 'Q74TLAB' in [x['shi1_netname'].rstrip('\0') for x in client.listShares()]
                        content = io.BytesIO()
                        client.getFile('Q74TLAB', 'README.txt', content.write)
                        assert content.getvalue() == (args.run / 'share/README.txt').read_bytes()
                        try:
                            client.putFile('Q74TLAB', 'write-test', io.BytesIO(b'no').read)
                        except SessionError:
                            pass
                        else:
                            raise RuntimeError('Read-only share accepted a write')
                    finally:
                        client.close()
            finally:
                worker.terminate()
                try:
                    worker.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    worker.kill(); worker.wait()
        (args.run / 'selftest-result.json').write_text(json.dumps({'passed': True, 'tv_contacted': False,
            'checks': ['exact username', 'reject invalid password', 'accept correct password', 'enumerate', 'read', 'deny write']}) + '\n')
        print('SMB self-test passed; no TV contact')
        return
    if args.action == 'start':
        uid = int(os.environ.get('SUDO_UID', '-1'))
        if os.geteuid() != 0 or uid <= 0:
            raise RuntimeError('Run start with sudo from your normal account, only for binding TCP 445')
        if not json.loads((args.run / 'selftest-result.json').read_text()).get('passed'):
            raise RuntimeError('Self-test required')
        account = pwd.getpwuid(uid)
        listener = socket.socket()
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind((lab.HOST, 445)); listener.listen(8); listener.set_inheritable(True)
        os.initgroups(account.pw_name, account.pw_gid); os.setgid(account.pw_gid); os.setuid(uid)
        if os.getuid() != uid or os.geteuid() != uid:
            raise RuntimeError('Privilege drop failed')
        print('Porta 445 aperta; privilegi amministrativi rilasciati.', flush=True)
        os.execv('/usr/bin/python3', ['/usr/bin/python3'] + command('serve') + ['--listen-fd', str(listener.fileno())])
    children = []
    logs = []
    def stop(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    try:
        for action, interpreter in [('smb', lab.SMB_PYTHON), ('vnc', lab.VNC_PYTHON)]:
            log = (args.run / (action + '-live.log')).open('a'); logs.append(log)
            invocation = [str(interpreter)] + command(action)
            if action == 'smb':
                invocation += ['--listen-fd', str(args.listen_fd)]
            children.append(subprocess.Popen(invocation, stdout=log, stderr=subprocess.STDOUT,
                pass_fds=(args.listen_fd,) if action == 'smb' else ()))
        os.close(args.listen_fd)
        print('Laboratorio Vetro attivo per 15 minuti. Lascia aperto questo Terminale.', flush=True)
        deadline = time.monotonic() + 900
        while time.monotonic() < deadline:
            if any(child.poll() is not None for child in children):
                raise RuntimeError('Un servizio si è fermato; controllare i log')
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        for child in children:
            child.terminate()
        for child in children:
            try: child.wait(timeout=3)
            except subprocess.TimeoutExpired: child.kill(); child.wait()
        for log in logs: log.close()
        print('Servizi temporanei fermati.', flush=True)


if __name__ == '__main__':
    main()
