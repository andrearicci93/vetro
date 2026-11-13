"""Run with: python3 app/tests/voice-trial.test.py"""
import contextlib
import importlib.util
import io
import os
import pathlib
import shlex
import string
import subprocess
import tempfile
import unittest
import wave
from unittest import mock

spec = importlib.util.spec_from_file_location(
    'voice_trial', pathlib.Path(__file__).parents[1] / 'scripts' / 'voice-trial.py')
trial = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trial)


class TrialTests(unittest.TestCase):
    def test_tv_request_uses_only_vetro_pairing_token(self):
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = b'{"ok":true}'
        opener = mock.Mock()
        opener.open.return_value = response
        with mock.patch.dict(os.environ, {'VETRO_API_TOKEN': 'test-vetro-token', 'OPENAI_API_KEY': 'test-openai-key'}), mock.patch.object(
                trial.urllib.request, 'build_opener', return_value=opener):
            trial.request('http://tv:8099', '/status')
        req = opener.open.call_args.args[0]
        self.assertEqual(req.get_header('Authorization'), 'Bearer test-vetro-token')
        self.assertNotIn('test-openai-key', str(req.headers))

    def test_printable_ascii_is_mapped_without_control_keys(self):
        text = string.ascii_letters + string.digits + string.punctuation + ' '
        keys = [k for k in trial.text_keys(text) if k not in ('shift_down', 'shift_up')]
        self.assertEqual(len(keys), len(text))
        self.assertTrue(all(k.isascii() and k.isalnum() for k in keys))
        self.assertTrue({'Return', 'Tab', 'Escape', 'BackSpace'}.isdisjoint(keys))
        command = trial.text_command("$(touch /tmp/nope); 'quoted' `command` & | >")
        for raw in ('touch', '$(', '`', 'quoted'):
            self.assertNotIn(raw, command)

    def run_key_command(self, text, fail_key=''):
        with tempfile.TemporaryDirectory() as directory:
            tool = pathlib.Path(directory) / 'keytool'
            log = pathlib.Path(directory) / 'events'
            tool.write_text('#!/bin/sh\nprintf "%s %s\\n" "$1" "$2" >> "$KEY_LOG"\n'
                            '[ "$1" != "$FAIL_KEY" ]\n')
            tool.chmod(0o700)
            command = trial.text_command(text).replace('/usr/bin/input_keyevent', shlex.quote(str(tool)))
            result = subprocess.run(['/bin/sh', '-c', command], env={
                **os.environ, 'KEY_LOG': str(log), 'FAIL_KEY': fail_key}, capture_output=True, text=True)
            return result.returncode, [line.split() for line in log.read_text().splitlines()]

    def test_capitals_use_shift_and_preserve_following_lowercase(self):
        code, events = self.run_key_command('Tt TV')
        self.assertEqual(code, 0)
        self.assertEqual(events, [['Shift_L', 'down'], ['t'], ['Shift_L', 'up'],
                                  ['t'], ['space'], ['Shift_L', 'down'], ['t'],
                                  ['v'], ['Shift_L', 'up']])

    def test_failed_capital_releases_shift_without_retry_or_remaining_text(self):
        code, events = self.run_key_command('TV', fail_key='t')
        self.assertNotEqual(code, 0)
        self.assertEqual(events, [['Shift_L', 'down'], ['t'], ['Shift_L', 'up']])

    def test_unsupported_text_fails_before_any_network_request(self):
        with mock.patch.object(trial, 'request') as request:
            for text in ('', ' ', 'hello\nReturn', '\t', '\x00', 'café', 'x' * 161):
                with self.assertRaises(ValueError):
                    trial.main(['--base', 'http://tv:8099', 'type', text])
            request.assert_not_called()

    def test_missing_root_agent_prevents_typing(self):
        with mock.patch.object(trial, 'request', return_value={'agent': {'connected': False}}) as request:
            with self.assertRaises(RuntimeError):
                trial.main(['--base', 'http://tv:8099', 'type', 'hello'])
            request.assert_called_once_with('http://tv:8099', '/status')

    def test_failed_typing_is_not_retried(self):
        with mock.patch.object(trial, 'connected'), mock.patch.object(
                trial, 'request', return_value={'ok': False, 'timed_out': True}) as request:
            with self.assertRaisesRegex(RuntimeError, 'some characters'):
                trial.main(['--base', 'http://tv:8099', 'type', 'hello'])
            self.assertEqual(request.call_count, 1)

    def test_transcript_newline_is_space_not_submit(self):
        with mock.patch.object(trial, 'connected'), mock.patch.object(
                trial, 'transcribe', return_value='hello\nworld'), mock.patch.object(
                trial, 'request', return_value={'ok': True}) as request, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(trial.main(['--base', 'http://tv:8099', 'dictate', 'sample.wav']), 0)
            request.assert_called_once_with('http://tv:8099', '/exec', trial.text_command('hello world'))

    def test_dictation_drops_final_full_stop_but_keeps_internal_punctuation(self):
        self.assertEqual(trial.dictation_text(' Terminator 3.\n'), 'Terminator 3')
        self.assertEqual(trial.dictation_text('version 3.14.'), 'version 3.14')
        self.assertEqual(trial.dictation_text('version 3.14'), 'version 3.14')
        with mock.patch.object(trial, 'connected'), mock.patch.object(
                trial, 'transcribe', return_value='Terminator 3.'), mock.patch.object(
                trial, 'request', return_value={'ok': True}) as request, contextlib.redirect_stdout(io.StringIO()):
            trial.main(['--base', 'http://tv:8099', 'dictate', 'sample.wav'])
            request.assert_called_once_with('http://tv:8099', '/exec', trial.text_command('Terminator 3'))

    def test_transcription_needs_explicit_credentials(self):
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch.object(
                trial.urllib.request, 'build_opener') as opener:
            with self.assertRaisesRegex(ValueError, 'OPENAI_API_KEY'):
                trial.transcribe('sample.wav')
            opener.assert_not_called()

    def test_audio_request_keeps_key_and_local_path_out_of_body(self):
        with tempfile.TemporaryDirectory() as directory:
            audio = pathlib.Path(directory) / 'private-user-recording.wav'
            audio.write_bytes(b'RIFF-test-audio')
            response = mock.MagicMock()
            response.__enter__.return_value.read.return_value = b'{"text":"hello"}'
            opener = mock.Mock()
            opener.open.return_value = response
            with mock.patch.dict(os.environ, {'OPENAI_API_KEY': 'test-key'}, clear=True), mock.patch.object(
                    trial.urllib.request, 'build_opener', return_value=opener):
                self.assertEqual(trial.transcribe(audio), 'hello')
            req = opener.open.call_args.args[0]
            self.assertEqual(req.full_url, 'https://api.openai.com/v1/audio/transcriptions')
            self.assertEqual(req.get_header('Authorization'), 'Bearer test-key')
            self.assertIn(b'gpt-transcribe', req.data)
            self.assertIn(b'RIFF-test-audio', req.data)
            self.assertNotIn(b'test-key', req.data)
            self.assertNotIn(str(audio).encode(), req.data)

    def test_live_trial_requires_key_before_recording(self):
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch.object(trial, 'record_remote') as record:
            with self.assertRaisesRegex(ValueError, 'OPENAI_API_KEY'):
                trial.live_transcript('http://tv:8099', '00:11:22:33:44:55')
            record.assert_not_called()

    def test_live_trial_wraps_tested_pcm_format_and_removes_local_audio(self):
        paths = []
        def transcribe(path):
            paths.append(path)
            with wave.open(str(path), 'rb') as wav:
                self.assertEqual((wav.getnchannels(), wav.getsampwidth(), wav.getframerate()), (1, 2, 16000))
                self.assertEqual(wav.readframes(4), b'\x01\x00' * 4)
            return 'hello'
        with mock.patch.dict(os.environ, {'OPENAI_API_KEY': 'test-key'}), mock.patch.object(
                trial, 'record_remote', return_value=b'\x01\x00' * 4), mock.patch.object(
                trial, 'transcribe', side_effect=transcribe):
            self.assertEqual(trial.live_transcript('http://tv:8099', '00:11:22:33:44:55'), 'hello')
        self.assertFalse(paths[0].exists())

    def test_recording_poll_failure_requests_native_cleanup(self):
        with mock.patch.object(trial, 'execute', side_effect=['', '', RuntimeError('lost connection'), '']) as execute:
            with self.assertRaisesRegex(RuntimeError, 'lost connection'):
                trial.record_remote('http://tv:8099', '00:11:22:33:44:55')
            self.assertIn('touch /tmp/vetro-voice-trial/', execute.call_args.args[1])
            self.assertTrue(execute.call_args.args[1].endswith('.pcm.cancel'))

    def test_collapsed_keyboard_blocks_dictation(self):
        with mock.patch.object(trial, 'execute', return_value="(9012,)\n[(1, 2, 1368, 'Keyboard', 0, 1079, 1920, 1, 200)]"):
            with self.assertRaisesRegex(RuntimeError, 'Open the TV keyboard'):
                trial.keyboard_target('http://tv:8099')

    def test_open_keyboard_preserves_focused_app_identity(self):
        with mock.patch.object(trial, 'execute', return_value="(9012,)\n[(1, 2, 1368, 'Keyboard', 0, 680, 1920, 400, 200)]"):
            self.assertEqual(trial.keyboard_target('http://tv:8099'), 9012)

    def test_focus_change_prevents_insertion_and_shows_error(self):
        with mock.patch.object(trial, 'keyboard_target', side_effect=[9012, 1234]), mock.patch.object(
                trial, 'live_transcript', return_value='hello'), mock.patch.object(
                trial, 'send_typing') as typing, mock.patch.object(trial, 'feedback_state') as feedback, contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, 'focused TV app changed'):
                trial.listen_once('http://tv:8099', '00:11:22:33:44:55')
            typing.assert_not_called()
            self.assertEqual(feedback.call_args.args[2], 'error')


if __name__ == '__main__':
    unittest.main()
