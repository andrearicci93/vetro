#!/usr/bin/env python3
"""Experimental TV dictation probes and explicit audio-file transcription.

Run `probe` first, then open an empty TV search field and run `type`.
ASCII text entry is verified in Screenroom.Player on the tested Q80A;
other apps and firmware still need on-device verification.
"""
import argparse
import base64
import json
import os
import pathlib
import re
import shlex
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import wave


PROBES = {
    'input_devices': 'cat /proc/bus/input/devices',
    'audio_devices': 'for p in /proc/asound/cards /proc/asound/pcm; do '
                     'if [ -r "$p" ]; then cat "$p"; fi; done; '
                     'ls -ld /dev/snd /dev/snd/* 2>/dev/null; true',
    'audio_tools': 'for p in input_keyevent arecord parec pactl '
                   'amixer tinycap gdbus dbus-send busctl; do command -v "$p"; done; true',
    'audio_libraries': 'for p in /usr/lib/lib*audio* /usr/lib/lib*sound* '
                       '/usr/lib/lib*voice* /usr/lib/lib*stt* /usr/lib/lib*mic* '
                       '/usr/lib/lib*isf* /usr/lib/lib*scim*; do '
                       'if [ -e "$p" ]; then printf "%s\\n" "$p"; fi; done',
    'voice_services': 'systemctl list-units --all --no-pager --plain 2>/dev/null '
                      '| grep -Ei "voice|speech|bixby|assistant|audio|sound|bluetooth|input|scim" '
                      '| sed "s/  */ /g"; true',
}

# Fixed X keysyms, as used by app/service/control.js. Never interpolate a
# transcript into a shell command. No Return, Tab, navigation or control keys.
PUNCTUATION = dict(zip(
    ' !"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
    ('space exclam quotedbl numbersign dollar percent ampersand apostrophe '
     'parenleft parenright asterisk plus comma minus period slash colon '
     'semicolon less equal greater question at bracketleft backslash '
     'bracketright asciicircum underscore grave braceleft bar braceright '
     'asciitilde').split()))


def text_keys(text):
    """Use physical Shift for capitals; the TV ignores uppercase key names."""
    if not isinstance(text, str) or not text.strip() or len(text) > 160:
        raise ValueError('Use a nonempty test phrase of at most 160 characters.')
    keys = []
    shifted = False
    for char in text:
        if char.isascii() and char.isalnum():
            key = char.lower()
        elif char in PUNCTUATION:
            key = PUNCTUATION[char]
        else:
            raise ValueError('This trial accepts printable ASCII only; '
                             'newlines and control characters are not allowed.')
        needs_shift = char.isascii() and char.isupper()
        if needs_shift != shifted:
            keys.append('shift_down' if needs_shift else 'shift_up')
            shifted = needs_shift
        keys.append(key)
    if shifted:
        keys.append('shift_up')
    return keys


def text_command(text):
    """Validate the complete phrase before producing any key events."""
    keys = text_keys(text)
    # Release Shift on failure as well as success. Keep it held across adjacent
    # capitals, but never send the same character again after an uncertain error.
    return ('shifted=0; release_shift() { if [ "$shifted" = 1 ]; then '
            '/usr/bin/input_keyevent Shift_L up; fi; }; '
            'trap release_shift EXIT; trap "exit 1" HUP INT TERM; '
            'for key in ' + ' '.join(shlex.quote(key) for key in keys) + '; do '
            'case "$key" in '
            'shift_down) shifted=1; /usr/bin/input_keyevent Shift_L down || exit;; '
            'shift_up) /usr/bin/input_keyevent Shift_L up || exit; shifted=0;; '
            '*) /usr/bin/input_keyevent "$key" || exit; sleep 0.08;; '
            'esac; done')


def base_url(value):
    url = urllib.parse.urlsplit(value)
    if (url.scheme not in ('http', 'https') or not url.hostname or
            url.username or url.password or url.query or url.fragment or
            url.path not in ('', '/')):
        raise ValueError('Use the dashboard origin, for example http://TV_IP:8099.')
    return value.rstrip('/')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('The endpoint redirected the request; refusing to forward it.')


def request(base, route, command=None):
    body = None if command is None else json.dumps({'cmd': command}).encode()
    headers = {'Content-Type': 'application/json'}
    token = os.environ.get('VETRO_API_TOKEN', '').strip()
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(base + route, data=body, headers=headers)
    # LAN traffic must stay off configured web proxies. Root commands must not
    # follow redirects to another host. The TV's execution deadline is 30 sec.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(req, timeout=40 if command else 6) as response:
        payload = response.read(1024 * 1024 + 1)
    if len(payload) > 1024 * 1024:
        raise RuntimeError('Unexpectedly large TV response.')
    result = json.loads(payload)
    if not isinstance(result, dict):
        raise RuntimeError('Unexpected TV response.')
    return result


def connected(base):
    status = request(base, '/status')
    agent = status.get('agent') or {}
    if not agent.get('connected') or agent.get('uid') != 0:
        raise RuntimeError('Vetro is reachable, but its root agent is not connected.')
    return {'app': status.get('app'), 'rootAgentConnected': True}


def transcribe(filename):
    """Only this explicit operation sends the selected recording to OpenAI."""
    key = os.environ.get('OPENAI_API_KEY', '').strip()
    if not key:
        raise ValueError('Set OPENAI_API_KEY in the local environment; do not put it in a command argument.')
    path = pathlib.Path(filename)
    suffix = path.suffix.lower()
    if suffix not in ('.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm'):
        raise ValueError('Use a supported audio file, such as WAV; raw PCM needs a WAV header first.')
    with path.open('rb') as source:
        data = source.read(25 * 1024 * 1024 + 1)
    if not data or len(data) > 25 * 1024 * 1024:
        raise ValueError('The recording must be nonempty and at most 25 MiB.')
    boundary = 'vetro' + uuid.uuid4().hex
    model = os.environ.get('OPENAI_TRANSCRIBE_MODEL', 'gpt-transcribe')
    # A fixed filename keeps private local paths out of the uploaded metadata.
    body = (('--' + boundary + '\r\nContent-Disposition: form-data; name="model"\r\n\r\n' +
             model + '\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="file"; '
             'filename="recording' + suffix + '"\r\nContent-Type: application/octet-stream\r\n\r\n').encode() +
            data + ('\r\n--' + boundary + '--\r\n').encode())
    req = urllib.request.Request('https://api.openai.com/v1/audio/transcriptions', data=body,
                                 headers={'Authorization': 'Bearer ' + key,
                                          'Content-Type': 'multipart/form-data; boundary=' + boundary})
    opener = urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(req, timeout=45) as response:
            result = json.loads(response.read(1024 * 1024))
    except urllib.error.HTTPError as error:
        raise RuntimeError('OpenAI transcription returned HTTP ' + str(error.code) +
                           '; check API credentials, model access, and billing.') from None
    text = result.get('text') if isinstance(result, dict) else None
    if not isinstance(text, str) or not text.strip():
        raise RuntimeError('OpenAI returned no transcript.')
    return text.strip()


def execute(base, command):
    result = request(base, '/exec', command)
    if not result.get('ok') or result.get('timed_out'):
        raise RuntimeError('TV operation failed: ' + str(result.get('error') or result.get('stderr') or 'timeout/exit status'))
    return result.get('output', '')


def record_remote(base, address, state=None):
    """Run the installed one-shot helper, then retrieve the held-button PCM."""
    if not re.fullmatch(r'[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}', address or ''):
        raise ValueError('Set VETRO_REMOTE_BLUETOOTH_ADDRESS or provide --address.')
    token = uuid.uuid4().hex
    folder = '/tmp/vetro-voice-trial/'
    pcm = folder + token + '.pcm'
    log = folder + token + '.log'
    if state is not None:
        state['status_path'] = pcm + '.status'
    port = urllib.parse.urlsplit(base).port or (443 if base.startswith('https:') else 80)
    helper_base = 'http://127.0.0.1:' + str(port)
    command = ('umask 077; nohup /usr/bin/dotnet ' + folder + 'VetroVoiceTrial.dll ' +
               shlex.quote(helper_base) + ' ' + shlex.quote(address) + ' ' + shlex.quote(pcm) + ' --feedback' +
               ' >' + shlex.quote(log) + ' 2>&1 </dev/null &')
    finished = False
    try:
        execute(base, 'test -f ' + folder + 'VetroVoiceTrial.dll')
        execute(base, command)
        deadline = time.monotonic() + 110
        armed = False
        while time.monotonic() < deadline:
            output = execute(base, 'if [ -f ' + shlex.quote(log) + ' ]; then cat ' + shlex.quote(log) + '; fi')
            if 'ARMED:' in output and not armed:
                print('Ready: hold the remote microphone button, speak, then release. Waiting up to 90 seconds.', flush=True)
                armed = True
            if 'Captured bytes:' in output:
                finished = True
                if 'Microphone stop: 0' not in output or 'Unregister callback: 0' not in output:
                    raise RuntimeError('The recording did not complete successfully. ' + output.strip())
                if re.search(r'Captured bytes: 0;', output):
                    raise RuntimeError('The remote returned no audio. ' + output.strip())
                encoded = execute(base, 'base64 ' + shlex.quote(pcm))
                data = base64.b64decode(''.join(encoded.split()), validate=True)
                if not data or len(data) > 640000 or len(data) % 2:
                    raise RuntimeError('Invalid PCM recording size.')
                print('Recorded ' + str(round(len(data) / 32000, 2)) + ' seconds. Transcribing…', flush=True)
                return data
            time.sleep(0.5)
        raise RuntimeError('Timed out waiting for the remote microphone test.')
    finally:
        if not finished:
            # Cooperative cancellation lets the native helper stop the remote
            # and unregister its callback even if the local command is aborted.
            try:
                execute(base, 'umask 077; touch ' + shlex.quote(pcm + '.cancel'))
            except Exception:
                print('Could not cancel the TV helper; its built-in timeout still applies.', file=sys.stderr)


def live_transcript(base, address, state=None):
    if not os.environ.get('OPENAI_API_KEY', '').strip():
        raise ValueError('Set OPENAI_API_KEY before starting a microphone trial.')
    pcm = record_remote(base, address, state)
    with tempfile.TemporaryDirectory(prefix='vetro-dictation-') as directory:
        path = pathlib.Path(directory) / 'recording.wav'
        with wave.open(str(path), 'wb') as recording:
            recording.setnchannels(1)
            recording.setsampwidth(2)
            recording.setframerate(16000)
            recording.writeframes(pcm)
        return transcribe(path)


def feedback_state(base, state, value):
    path = state.get('status_path')
    if path and value in ('typing', 'done', 'error'):
        execute(base, 'umask 077; printf %s ' + shlex.quote(value) + ' > ' + shlex.quote(path))


def dictation_text(text):
    # Search text should not acquire a sentence-ending full stop from speech.
    # Preserve internal punctuation (e.g. 3.14) and leave explicit `type` alone.
    text = ' '.join(text.split())
    return text[:-1] if text.endswith('.') else text


def keyboard_target(base):
    output = execute(base, 'gdbus call --system --dest org.enlightenment.wm '
                     '--object-path /org/enlightenment/wm --method org.enlightenment.wm.proc.GetFocusProc; '
                     'gdbus call --system --dest org.enlightenment.wm --object-path /org/enlightenment/wm '
                     '--method org.enlightenment.wm.info.get_window_info')
    focus = re.search(r'^\((\d+),\)', output)
    keyboard = re.search(r"'Keyboard',\s*-?\d+,\s*-?\d+,\s*(\d+),\s*(\d+),", output)
    if not focus or not keyboard or int(keyboard[1]) < 100 or int(keyboard[2]) < 100:
        raise RuntimeError('Open the TV keyboard in a text field before dictating. No text was sent.')
    return int(focus[1])


def send_typing(base, command):
    # No automatic retry: a transport error can mean some letters were typed.
    result = request(base, '/exec', command)
    if not result.get('ok') or result.get('timed_out'):
        raise RuntimeError('Typing was not confirmed; some characters may have '
                           'been entered. Check the TV before retrying. ' +
                           str(result.get('error') or result.get('stderr') or ''))
    print('Key commands accepted. Check whether the phrase appeared in the TV '
          'field; command success does not prove text entry. Enter was not sent.', flush=True)


def listen_once(base, address):
    target = keyboard_target(base)
    state = {}
    try:
        text = dictation_text(live_transcript(base, address, state))
        command = text_command(text)
        print('Transcript: ' + text, flush=True)
        if keyboard_target(base) != target:
            raise RuntimeError('The focused TV app changed during dictation. No text was sent.')
        feedback_state(base, state, 'typing')
        send_typing(base, command)
        feedback_state(base, state, 'done')
    except BaseException:
        try:
            feedback_state(base, state, 'error')
        except Exception:
            pass
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default=(
        'http://' + os.environ['TV_IP'] + ':8099' if os.environ.get('TV_IP') else None))
    sub = parser.add_subparsers(dest='action', required=True)
    sub.add_parser('probe', help='Read audio/input capabilities; no recording or changes.')
    typing = sub.add_parser('type', help='Try typing into the currently focused TV field.')
    typing.add_argument('text', nargs='?', default='hello from vetro')
    typing.add_argument('--dry-run', action='store_true', help='Print the command without connecting.')
    transcription = sub.add_parser('transcribe', help='Send an audio file to OpenAI; print its transcript.')
    transcription.add_argument('audio')
    dictation = sub.add_parser('dictate', help='Transcribe an audio file and type it into the focused TV field.')
    dictation.add_argument('audio')
    listening = sub.add_parser('listen', help='Capture one remote-microphone press, transcribe, then type into the focused field.')
    listening.add_argument('--address', default=os.environ.get('VETRO_REMOTE_BLUETOOTH_ADDRESS'))
    args = parser.parse_args(argv)
    if args.action == 'transcribe':
        print(transcribe(args.audio))
        return 0
    command = text_command(args.text) if args.action == 'type' else None
    if command and args.dry_run:
        print(command)
        return 0
    if not args.base:
        parser.error('Provide --base http://TV_IP:8099 or set TV_IP.')
    base = base_url(args.base)
    status = connected(base)
    if args.action == 'listen':
        listen_once(base, args.address)
        return 0
    if args.action == 'probe':
        result = {'status': status, 'probes': {}}
        for name, probe in PROBES.items():
            result['probes'][name] = request(base, '/exec', probe)
        print(json.dumps(result, indent=2))
        return 0 if all(p.get('ok') for p in result['probes'].values()) else 1
    if args.action == 'dictate':
        # Dictation is a single text field. Newlines become spaces, never Enter.
        text = dictation_text(transcribe(args.audio))
        command = text_command(text)
        print('Transcript: ' + text, flush=True)
    send_typing(base, command)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print('Voice trial: ' + str(error), file=sys.stderr)
        sys.exit(1)
