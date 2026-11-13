using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

partial class Program
{
    const string ServiceCapture = "/tmp/vetro-voice-service";
    const string StatusPath = "/tmp/vetro-voice-status.json";
    static int completed;
    static long lastAudioBytes;
    static int lastPackets, lastTranscriptCharacters;
    static string controlBase = "http://127.0.0.1:8099";
    sealed class VoiceOptions
    {
        public string apiKey { get; set; }
        public string remoteAddress { get; set; }
        public string baseUrl { get; set; } = "http://127.0.0.1:8099";
        public string model { get; set; } = "gpt-transcribe";
    }

    static void VoiceStatus(string state, string error = null)
    {
        File.WriteAllText(StatusPath + ".new", JsonSerializer.Serialize(new {
            pid = Process.GetCurrentProcess().Id, state, completed, error, lastAudioBytes, lastPackets, lastTranscriptCharacters,
            updatedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds()
        }));
        File.Move(StatusPath + ".new", StatusPath, true);
    }

    static int Watch(string configPath)
    {
        try
        {
            using var singleton = new FileStream("/tmp/vetro-voice.lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            var options = JsonSerializer.Deserialize<VoiceOptions>(File.ReadAllText(configPath));
            if (options == null || string.IsNullOrWhiteSpace(options.apiKey) ||
                !Regex.IsMatch(options.remoteAddress ?? "", "^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$") ||
                !Uri.TryCreate(options.baseUrl, UriKind.Absolute, out var uri) || !uri.IsLoopback || uri.Scheme != "http")
                throw new Exception("Voice configuration is incomplete.");
            controlBase = options.baseUrl.TrimEnd('/');
            Console.CancelKeyPress += (_, e) => { e.Cancel = true; File.WriteAllText(ServiceCapture + ".cancel", "stop"); };
            var feedback = new Feedback();
            feedback.Hide();
            while (!File.Exists(ServiceCapture + ".cancel"))
            {
                int result = RunCapture(new[] { options.baseUrl, options.remoteAddress, ServiceCapture, "--feedback" }, options, feedback);
                if (result != 0 && !File.Exists(ServiceCapture + ".cancel")) Thread.Sleep(2000);
            }
            VoiceStatus("stopped");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("Voice service could not run: " + error.GetType().Name);
            return 1;
        }
    }

    static async Task<string> AgentCommand(string command)
    {
        // Keep TV input subprocesses in Vetro's root agent, away from the
        // Bluetooth/display libraries' child-process handling. This is the
        // same local input path verified by the original desktop prototype.
        using var client = new HttpClient(new HttpClientHandler { UseProxy = false, AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(40) };
        using var body = new StringContent(JsonSerializer.Serialize(new { cmd = command }), Encoding.UTF8, "application/json");
        using var response = await client.PostAsync(controlBase + "/exec", body);
        using var result = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        if (!response.IsSuccessStatusCode || !result.RootElement.TryGetProperty("ok", out var ok) || !ok.GetBoolean())
            throw new Exception("TV input operation failed; check the field before retrying.");
        return result.RootElement.GetProperty("output").GetString();
    }

    static async Task<int> KeyboardTarget(bool requireOpen = true)
    {
        string output = await AgentCommand("gdbus call --system --dest org.enlightenment.wm --object-path /org/enlightenment/wm --method org.enlightenment.wm.proc.GetFocusProc; " +
            "gdbus call --system --dest org.enlightenment.wm --object-path /org/enlightenment/wm --method org.enlightenment.wm.info.get_window_info");
        string focus = output.Split('\n')[0], windows = output;
        var pid = Regex.Match(focus, @"^\((\d+),\)");
        var keyboard = Regex.Match(windows, @"'Keyboard',\s*-?\d+,\s*-?\d+,\s*(\d+),\s*(\d+),");
        if (!pid.Success || !keyboard.Success) throw new Exception("Keyboard inspection could not be parsed: " + focus.Trim() + "; keyboard=" + keyboard.Success);
        if (requireOpen && (int.Parse(keyboard.Groups[1].Value) < 100 || int.Parse(keyboard.Groups[2].Value) < 100))
            throw new Exception("Open a text field and try again.");
        return int.Parse(pid.Groups[1].Value);
    }

    static int InspectKeyboard(Feedback feedback, bool requireOpen = true)
    {
        // Keep the overlay responsive while Vetro's root agent checks focus.
        using var cancel = new CancellationTokenSource();
        return Pump(KeyboardTarget(requireOpen), feedback, cancel);
    }

    static void BriefError(Feedback feedback, string message = "Open a text field and try again.")
    {
        VoiceStatus("error", message);
        feedback.Set("error");
        BriefWait(feedback, 2000);
        feedback.Hide();
    }

    static void BriefWait(Feedback feedback, int milliseconds)
    {
        var watch = Stopwatch.StartNew();
        while (watch.ElapsedMilliseconds < milliseconds && !File.Exists(ServiceCapture + ".cancel"))
        { feedback.Tick(0); Thread.Sleep(20); }
    }

    static byte[] Wav(byte[] pcm)
    {
        using var stream = new MemoryStream();
        using var writer = new BinaryWriter(stream, Encoding.ASCII, true);
        writer.Write(Encoding.ASCII.GetBytes("RIFF")); writer.Write(36 + pcm.Length);
        writer.Write(Encoding.ASCII.GetBytes("WAVEfmt ")); writer.Write(16);
        writer.Write((short)1); writer.Write((short)1); writer.Write(16000); writer.Write(32000);
        writer.Write((short)2); writer.Write((short)16);
        writer.Write(Encoding.ASCII.GetBytes("data")); writer.Write(pcm.Length); writer.Write(pcm);
        writer.Flush(); return stream.ToArray();
    }

    static async Task<string> Transcribe(VoiceOptions options, byte[] pcm, CancellationToken cancellation)
    {
        using var client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseProxy = false }) { Timeout = TimeSpan.FromSeconds(45) };
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", options.apiKey);
        using var body = new MultipartFormDataContent();
        body.Add(new StringContent(options.model), "model");
        using var audio = new ByteArrayContent(Wav(pcm));
        audio.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        body.Add(audio, "file", "recording.wav");
        using var response = await client.PostAsync("https://api.openai.com/v1/audio/transcriptions", body, cancellation);
        if (!response.IsSuccessStatusCode) throw new Exception("Transcription returned HTTP " + (int)response.StatusCode + ".");
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return DictationText.Normalize(json.RootElement.GetProperty("text").GetString());
    }

    static T Pump<T>(Task<T> task, Feedback feedback, CancellationTokenSource cancel)
    {
        while (!task.IsCompleted)
        {
            if (File.Exists(ServiceCapture + ".cancel")) cancel.Cancel();
            // Keep receiving remote audio while the readiness cue plays.
            for (int i = 0; i < 50 && g_main_context_iteration(IntPtr.Zero, 0) != 0; i++) { }
            feedback.Tick(0); Thread.Sleep(20);
        }
        return task.GetAwaiter().GetResult();
    }

    static void PlayReadyCue(Feedback feedback)
    {
        using var cancel = new CancellationTokenSource();
        string path = Path.Combine(AppContext.BaseDirectory, "start-cue.wav");
        try
        {
            Pump(AgentCommand("paplay --device=tizenaudio-sink --property=media.role=voice-recognition '" +
                path.Replace("'", "'\\''") + "'"), feedback, cancel);
            Console.WriteLine("Ready cue completed with microphone streaming.");
        }
        catch { Console.WriteLine("Ready cue unavailable; microphone is streaming."); }
    }

    static void DictateOnTv(VoiceOptions options, int target, byte[] pcm, Feedback feedback)
    {
        lastAudioBytes = pcm.Length;
        lastPackets = callbacks;
        lastTranscriptCharacters = 0;
        using var cancel = new CancellationTokenSource();
        try
        {
            if (pcm.Length < 3200) throw new Exception("No speech captured. Hold the microphone button longer.");
            feedback.Set("transcribing"); VoiceStatus("transcribing");
            string text = Pump(Transcribe(options, pcm, cancel.Token), feedback, cancel);
            lastTranscriptCharacters = text.Length;
            if (text.Length == 0)
            {
                throw new Exception("No speech recognized. Please try again.");
            }
            DictationText.Keys(text);
            if (InspectKeyboard(feedback) != target) throw new Exception("The focused app changed. No text was sent.");
            feedback.Set("typing"); VoiceStatus("typing");
            cancel.Token.ThrowIfCancellationRequested();
            if (File.Exists(ServiceCapture + ".cancel")) throw new OperationCanceledException();
            Pump(AgentCommand(DictationText.Shell(text)), feedback, cancel);
            completed++;
            feedback.Set("done"); VoiceStatus("done");
            BriefWait(feedback, 1200);
        }
        catch (Exception error)
        {
            // Never log the API key, audio, response body, or dictated text.
            string message = error is HttpRequestException ? "Could not reach transcription service." :
                error is OperationCanceledException ? "Dictation cancelled or timed out." : error.Message;
            BriefError(feedback, message);
        }
    }
}
