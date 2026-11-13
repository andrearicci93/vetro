using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;

// Q80A firmware experiment. No autostart, network upload, or always-on capture.
// Samsung's private ABI is checked against the installed ARM32 library before
// use. An existing Vetro physical-input observer supplies button events.
partial class Program
{
    const string Bluetooth = "libcapi-network-bluetooth.so.0";
    const string BluetoothTv = "libcapi-network-bluetooth-tv.so.0";
    const string Glib = "libglib-2.0.so.0";
    const int MaxBytes = 640000;
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    delegate void AudioCallback(IntPtr data, IntPtr user);
    [DllImport(Bluetooth)] static extern int bt_initialize();
    [DllImport(Bluetooth)] static extern int bt_deinitialize();
    [DllImport(BluetoothTv)] static extern int get_size_of_bt_hid_voice_data_s();
    [DllImport(BluetoothTv)] static extern int bt_hid_set_audio_data_receive_cb(AudioCallback callback, IntPtr user);
    [DllImport(BluetoothTv)] static extern int bt_hid_unset_audio_data_receive_cb();
    [DllImport(BluetoothTv)] static extern int bt_hid_rc_start_sending_voice(string address);
    [DllImport(BluetoothTv)] static extern int bt_hid_rc_stop_sending_voice(string address);
    [DllImport(Glib)] static extern int g_main_context_iteration(IntPtr context, int mayBlock);

    static readonly object Gate = new object();
    static readonly MemoryStream Audio = new MemoryStream();
    static readonly AudioCallback Callback = OnAudio;
    static bool capturing;
    static int callbacks;
    static string callbackError;
    static long captureDeadline;
    static double audioLevel;

    static bool Readable(IntPtr pointer, int length)
    {
        if (length < 1 || length > 65536) return false;
        ulong start = unchecked((uint)pointer.ToInt32());
        if (start < 4096) return false;
        foreach (string line in File.ReadLines("/proc/self/maps"))
        {
            string[] parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 2 || !parts[1].StartsWith("r")) continue;
            string[] range = parts[0].Split('-');
            if (start >= Convert.ToUInt64(range[0], 16) &&
                start + (ulong)length <= Convert.ToUInt64(range[1], 16)) return true;
        }
        return false;
    }

    static void OnAudio(IntPtr data, IntPtr user)
    {
        lock (Gate)
        {
            if (!capturing || callbackError != null || Stopwatch.GetTimestamp() >= captureDeadline) return;
            try
            {
                if (!Readable(data, 8)) throw new Exception("Unreadable voice-data structure.");
                int first = Marshal.ReadInt32(data, 0), second = Marshal.ReadInt32(data, 4);
                // The firmware exports the structure size, but not its field
                // layout. Accept only a bounded length and a readable buffer.
                int length;
                IntPtr buffer;
                if (Readable(new IntPtr(first), second)) { buffer = new IntPtr(first); length = second; }
                else if (Readable(new IntPtr(second), first)) { buffer = new IntPtr(second); length = first; }
                else throw new Exception("Unknown voice buffer layout: " + first + ", " + second);
                if (Audio.Length + length > MaxBytes) throw new Exception("Audio byte limit reached.");
                byte[] bytes = new byte[length];
                Marshal.Copy(buffer, bytes, 0, length);
                Audio.Write(bytes, 0, bytes.Length);
                double squares = 0;
                for (int i = 0; i + 1 < bytes.Length; i += 2)
                {
                    short sample = (short)(bytes[i] | (bytes[i + 1] << 8));
                    squares += sample * (double)sample;
                }
                audioLevel = Math.Sqrt(squares / Math.Max(1, bytes.Length / 2)) / 32768.0;
                if (++callbacks == 1) Console.WriteLine("First voice packet: " + length + " bytes");
            }
            catch (Exception error) { callbackError = error.Message; }
        }
    }

    static JsonDocument Input(HttpClient client, string baseUrl)
    {
        return JsonDocument.Parse(client.GetStringAsync(baseUrl + "/input").GetAwaiter().GetResult());
    }

    static long Latest(JsonDocument doc)
    {
        long latest = 0;
        foreach (JsonElement e in doc.RootElement.GetProperty("status").GetProperty("events").EnumerateArray())
            latest = Math.Max(latest, e.GetProperty("sequence").GetInt64());
        return latest;
    }

    static int Main(string[] args)
    {
        if (args.Length == 3 && args[0] == "--check-transcription")
        {
            try
            {
                var options = JsonSerializer.Deserialize<VoiceOptions>(File.ReadAllText(args[1]));
                byte[] pcm = File.ReadAllBytes(args[2]);
                if (pcm.Length < 3200 || pcm.Length > MaxBytes) throw new Exception("Invalid sample size.");
                string text = Transcribe(options, pcm, CancellationToken.None).GetAwaiter().GetResult();
                DictationText.Keys(text);
                Console.WriteLine("Transcription OK (" + text.Length + " characters)."); return 0;
            }
            catch (Exception error) { Console.WriteLine("Transcription check: " + error.Message); return 1; }
        }
        if (args.Length == 1 && args[0] == "--check-keyboard")
        {
            var checkFeedback = new Feedback(); checkFeedback.Hide();
            try
            {
                Console.WriteLine("Bluetooth initialize: " + bt_initialize());
                Console.WriteLine("Callback registration: " + bt_hid_set_audio_data_receive_cb(Callback, IntPtr.Zero));
                for (int round = 0; round < 2; round++)
                {
                    for (int i = 0; i < 50; i++) { g_main_context_iteration(IntPtr.Zero, 0); checkFeedback.Tick(0); Thread.Sleep(20); }
                    Console.WriteLine("Keyboard inspection app: " + InspectKeyboard(checkFeedback, false));
                }
                return 0;
            }
            catch (Exception error) { Console.WriteLine("Keyboard check: " + error.Message); return 1; }
            finally { bt_hid_unset_audio_data_receive_cb(); bt_deinitialize(); }
        }
        if (args.Length == 2 && args[0] == "--watch") return Watch(args[1]);
        return RunCapture(args);
    }

    static int RunCapture(string[] args, VoiceOptions options = null, Feedback feedback = null)
    {
        if ((args.Length != 3 && (args.Length != 4 || args[3] != "--feedback")) || !Uri.TryCreate(args[0], UriKind.Absolute, out Uri uri) ||
            !uri.IsLoopback || (uri.Scheme != "http" && uri.Scheme != "https") ||
            !System.Text.RegularExpressions.Regex.IsMatch(args[1], "^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$") ||
            !args[2].StartsWith("/tmp/vetro-voice-"))
        {
            Console.Error.WriteLine("Usage: VetroVoiceTrial http://127.0.0.1:8099 REMOTE_MAC /tmp/vetro-voice-NAME.pcm");
            return 2;
        }
        if (IntPtr.Size != 4) { Console.Error.WriteLine("This trial requires the TV's ARM32 runtime."); return 2; }
        bool initialized = false, registered = false, started = false, ready = false;
        int target = 0;
        string address = args[1];
        controlBase = args[0].TrimEnd('/');
        lock (Gate) { Audio.SetLength(0); callbacks = 0; callbackError = null; audioLevel = 0; }
        try
        {
            if (args.Length == 4 && feedback == null) feedback = new Feedback();
            if (get_size_of_bt_hid_voice_data_s() != 8) throw new Exception("Unsupported voice-data ABI.");
            int result = bt_initialize();
            Console.WriteLine("Bluetooth initialize: " + result);
            if (result != 0) throw new Exception("Bluetooth initialization failed.");
            initialized = true;
            result = bt_hid_set_audio_data_receive_cb(Callback, IntPtr.Zero);
            Console.WriteLine("Voice callback registration: " + result);
            if (result != 0) throw new Exception("Voice callback registration failed.");
            registered = true;
            using (var client = new HttpClient(new HttpClientHandler { UseProxy = false }))
            {
                client.Timeout = TimeSpan.FromSeconds(2);
                long sequence;
                using (var initial = Input(client, args[0])) sequence = Latest(initial);
                Console.WriteLine(options == null ? "ARMED: waiting up to 90 seconds for microphone button 216." : "ARMED: microphone button ready.");
                if (options != null) VoiceStatus("ready");
                var waiting = Stopwatch.StartNew();
                var recording = new Stopwatch();
                var poll = Stopwatch.StartNew();
                bool done = false;
                while (!done && (options != null || started || waiting.Elapsed.TotalSeconds < 90))
                {
                    if (File.Exists(args[2] + ".cancel")) { Console.WriteLine("Trial cancelled."); break; }
                    // Keep Samsung's GLib callbacks moving on the initializing thread.
                    for (int i = 0; i < 50 && g_main_context_iteration(IntPtr.Zero, 0) != 0; i++) { }
                    double level;
                    lock (Gate) level = audioLevel;
                    feedback?.Tick(level);
                    if (callbackError != null) throw new Exception(callbackError);
                    if (started && !ready && callbacks > 0)
                    {
                        // Bluetooth start returning success is not audio readiness.
                        // Only cue once packets arrive, and keep all speech from
                        // this point: the user can speak as soon as the cue ends.
                        ready = true;
                        recording.Restart();
                        lock (Gate) captureDeadline = Stopwatch.GetTimestamp() + 10 * Stopwatch.Frequency;
                        feedback?.Set("listening");
                        if (options != null) VoiceStatus("listening");
                        if (feedback != null) PlayReadyCue(feedback);
                    }
                    if (started && recording.Elapsed.TotalSeconds >= 10) break;
                    if (poll.ElapsedMilliseconds >= 200)
                    {
                        poll.Restart();
                        using (var doc = Input(client, args[0]))
                        {
                            // Vetro recreates its input observer after a service
                            // restart. Its sequence starts over; do not wait for
                            // it to catch up to the previous observer's counter.
                            long newest = Latest(doc);
                            if (newest < sequence)
                            {
                                sequence = newest;
                                if (started) { callbackError = "Input observer reconnected during recording."; throw new Exception(callbackError); }
                                continue;
                            }
                            foreach (var e in doc.RootElement.GetProperty("status").GetProperty("events").EnumerateArray())
                            {
                                long next = e.GetProperty("sequence").GetInt64();
                                if (next <= sequence) continue;
                                sequence = next;
                                if (e.GetProperty("code").GetInt32() != 216) continue;
                                int value = e.GetProperty("value").GetInt32();
                                if (value == 1 && !started)
                                {
                                    if (options != null)
                                    {
                                        try { target = InspectKeyboard(feedback); }
                                        catch (Exception error) { BriefError(feedback, error.Message); continue; }
                                        VoiceStatus("starting");
                                    }
                                    feedback?.Set("starting");
                                    if (File.Exists(args[2] + ".cancel")) { done = true; break; }
                                    lock (Gate)
                                    {
                                        captureDeadline = Stopwatch.GetTimestamp() + 10 * Stopwatch.Frequency;
                                        capturing = true;
                                    }
                                    // Set before calling so finally always sends stop, including on failure.
                                    started = true;
                                    recording.Start();
                                    result = bt_hid_rc_start_sending_voice(address);
                                    Console.WriteLine("Microphone start: " + result);
                                    if (result != 0) throw new Exception("Remote refused microphone start.");
                                }
                                if (value == 0 && started) { done = true; break; }
                            }
                        }
                    }
                    Thread.Sleep(5);
                }
                Console.WriteLine("Capture ended: " + (started ? recording.Elapsed.TotalSeconds.ToString("F2") + " seconds" : "no button press"));
            }
            return Audio.Length > 0 ? 0 : 1;
        }
        catch (Exception error) { Console.Error.WriteLine("Voice capture: " + error.Message); return 1; }
        finally
        {
            lock (Gate) capturing = false;
            if (started) Console.WriteLine("Microphone stop: " + bt_hid_rc_stop_sending_voice(address));
            if (registered) Console.WriteLine("Unregister callback: " + bt_hid_unset_audio_data_receive_cb());
            if (initialized) Console.WriteLine("Bluetooth deinitialize: " + bt_deinitialize());
            lock (Gate)
            {
                if (Audio.Length > 0 && options == null) File.WriteAllBytes(args[2], Audio.ToArray());
                Console.WriteLine("Captured bytes: " + Audio.Length + "; packets: " + callbacks);
            }
            GC.KeepAlive(Callback);
            if (feedback != null)
            {
                if (options != null)
                {
                    if (!File.Exists(args[2] + ".cancel") && Audio.Length > 0 && callbackError == null)
                        DictateOnTv(options, target, Audio.ToArray(), feedback);
                    else if (!File.Exists(args[2] + ".cancel")) BriefError(feedback);
                    feedback.Hide();
                }
                else if (Audio.Length > 0 && callbackError == null)
                {
                    feedback.Set("transcribing");
                    feedback.AwaitResult(args[2] + ".status");
                }
                else
                {
                    feedback.Set("error");
                    for (int i = 0; i < 100; i++) { feedback.Tick(0); Thread.Sleep(20); }
                    feedback.Hide();
                }
            }
        }
    }
}
