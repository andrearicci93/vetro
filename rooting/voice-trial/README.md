# Remote microphone dictation (draft)

With the TV keyboard open, hold the microphone button, wait for the notification
cue, speak and release. The helper captures up to ten seconds, transcribes
through OpenAI, and types into the focused app. The feedback overlay shows
microphone startup, listening, transcription and insertion without taking focus.
The microphone is closed while idle. The persistent helper runs on the TV and
does not require a desktop relay.

This is opt-in developer functionality. **Additional work is needed to expose
it as an option in the web remote interface**, with setup, enable/disable,
credential management and feedback controls. A transcription-provider interface
is also needed so users can connect other providers. The current implementation
uses OpenAI only; choosing a different model does not change providers.

## Credentials and data

No OpenAI key, Vetro pairing token, remote address or runtime configuration is
included in source or the application package. Users supply their own values.
The developer scripts read the gitignored `.env` and `.env.voice-trial` as data.
Do not commit these files or recordings.

The persistent helper reads its OpenAI key from
`/opt/usr/home/owner/share/vetro-voice/config.json`: the directory is root-only
(mode 700) and the file is mode 600. Its enabled flag is stored separately in
`/opt/usr/home/owner/share/vetro-voice.json`. Audio is held in memory in persistent
mode and sent directly to OpenAI over HTTPS. The helper does not log recordings
or dictated text. Standalone development capture probes can save a recording
in their explicitly chosen private temporary location.

## Build and developer setup

Build the helper for the TV's .NET Core 3.1 runtime, then copy its DLL,
runtimeconfig, deps and `start-cue.wav` into `app/native/voice/`:

```sh
dotnet build rooting/voice-trial/VoiceTrial.csproj -c Release
```

Install a Vetro package built from this checkout before running setup. The
setup tool verifies the installed helper files and does not replace the main
service from a different Vetro version.

Set these values in the local environment or the gitignored environment files:

- `OPENAI_API_KEY`: the owner's transcription API key.
- `VETRO_REMOTE_BLUETOOTH_ADDRESS`: the paired remote's Bluetooth address.
- `TV_IP`, or `VETRO_BASE_URL`: the TV's Vetro dashboard origin.
- `VETRO_API_TOKEN`: the Vetro pairing credential, when pairing is required.
- `OPENAI_TRANSCRIBE_MODEL`: optional override for the configured model.

With Node 20.12 or newer, run:

```sh
node app/scripts/deploy-voice.cjs
```

This verifies the matching package, stops an existing voice helper before
reconfiguration, installs the private configuration, and enables voice through
Vetro's API. Errors never print credentials. Do not bypass Vetro pairing to run
setup.

`GET /voice` returns enabled/running state, readiness, a completed-dictation
counter and any status error. `POST /voice` with `{"enabled":false}` disables
and stops it; `true` enables it. These routes use Vetro's existing access checks.
The helper has a separate `vetro-voice.service` systemd unit with restart on
failure. Vetro restores it after root becomes available when voice is enabled.

## Cue and capture timing

The notification cue comes from the user-supplied
`lubecin123-info-computer-sound-299367.mp3`, converted to a 0.914-second mono
24 kHz PCM16 WAV. The source asset is `res/start-cue.wav`; the identical package
copy is `app/native/voice/start-cue.wav`.

The cue waits for the first Bluetooth audio packet. Capture continues while it
plays, so speaking immediately afterwards loses no words to microphone startup.
Playback uses `paplay` on `tizenaudio-sink` with the `voice-recognition` audio
role and the TV's current volume. The new cue still needs an on-TV check.

## Validation and limitations

Earlier Q80A trials confirmed 16 kHz mono PCM capture, repeated dictation in one
process, text insertion and a feedback overlay that keeps application focus.
Tests cover text normalization, capital letters, releasing Shift after failures,
focus changes, service lifecycle and keeping credentials out of package assets.
The version adapted to current upstream still needs a fresh TV and cold-boot
check, including normal remote navigation while voice is enabled.

The microphone bridge uses private symbols in
`libcapi-network-bluetooth-tv.so.0`; its ABI was checked on the Q80A. Other
firmware needs validation. The helper accepts printable ASCII for text entry.
It checks keyboard visibility and focused-app PID, but cannot yet prove the
same text field remains focused within that app.

Run local checks without recording or contacting a transcription provider:

```sh
node app/tests/voice.test.cjs
node app/tests/voice-package.test.cjs
python3 app/tests/voice-trial.test.py
dotnet run -c Release --project rooting/voice-trial/tests
```

The optional `node app/scripts/voice-trial.cjs listen` desktop probe handles one
utterance. Stop the persistent helper first. The probe requires the native
helper in `/tmp/vetro-voice-trial/`, an open TV keyboard and the same environment
values. The Python tool also offers `probe`, `type`, `transcribe` and `dictate`;
transcription commands explicitly send the selected audio to OpenAI. They are
development tools, not the web remote configuration UI.
