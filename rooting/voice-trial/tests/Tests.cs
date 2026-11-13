using System;
using System.IO;
using System.Linq;
using System.Diagnostics;
class Tests
{
    static void Equal<T>(T expected, T actual) { if (!Equals(expected, actual)) throw new Exception($"Expected {expected}; got {actual}"); }
    static (int code, string events) Run(string text, string fail = "")
    {
        string folder = Path.Combine(Path.GetTempPath(), "vetro-key-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        try
        {
            string tool = Path.Combine(folder, "key"), log = Path.Combine(folder, "log");
            File.WriteAllText(tool, "#!/bin/sh\nprintf '%s:%s\\n' \"$1\" \"$2\" >> \"$KEY_LOG\"\n[ \"$1\" != \"$FAIL_KEY\" ]\n");
            File.SetUnixFileMode(tool, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            var info = new ProcessStartInfo("/bin/sh") { UseShellExecute = false };
            info.ArgumentList.Add("-c"); info.ArgumentList.Add(DictationText.Shell(text).Replace("/usr/bin/input_keyevent", tool));
            info.Environment["KEY_LOG"] = log; info.Environment["FAIL_KEY"] = fail;
            using var p = Process.Start(info); p.WaitForExit();
            return (p.ExitCode, File.ReadAllText(log).Trim().Replace('\n', ','));
        }
        finally { Directory.Delete(folder, true); }
    }
    static void Main()
    {
        Equal("Terminator 3", DictationText.Normalize(" Terminator 3.\n"));
        Equal("version 3.14", DictationText.Normalize("version 3.14."));
        var typed = Run("Tt TV"); Equal(0, typed.code);
        Equal("Shift_L:down,t:,Shift_L:up,t:,space:,Shift_L:down,t:,v:,Shift_L:up", typed.events);
        var failed = Run("TV", "t"); Equal(false, failed.code == 0);
        Equal("Shift_L:down,t:,Shift_L:up", failed.events);
        foreach (var invalid in new[] { "hello\nworld", "café", "", new string('x', 161) })
        {
            bool rejected = false;
            try { DictationText.Shell(invalid); } catch { rejected = true; }
            Equal(true, rejected);
        }
        var keys = DictationText.Keys("$(touch /tmp/nope); `cmd`");
        Equal(false, keys.Any(k => k.key.Contains("$") || k.key.Contains("`") || k.key.Contains("/")));
        Console.WriteLine("PASS native dictation: capitals, punctuation normalization, validation, Shift cleanup, literal key arguments");
    }
}
