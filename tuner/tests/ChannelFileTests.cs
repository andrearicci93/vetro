using System;
using System.IO;
using Tuner.Core;

internal static partial class Tests
{
    // The Channel sensor's file (MQTT): valid JSON whatever the channel's name, written whole, removed on exit.
    private static void ChannelFileTests()
    {
        var c = new Channel { Id = 7, Major = 21, Name = "Rai 4", Virtual = false };
        Check(ChannelFile.Json(c, 42, 1700000000000) == "{\"number\":21,\"name\":\"Rai 4\",\"tvPlus\":false,\"pid\":42,\"at\":1700000000000}", "channel file: plain JSON");
        var odd = new Channel { Id = 8, Major = 5, Name = "A \"B\" \\ C\u0001\u0086 é 😀", Virtual = true };
        Check(ChannelFile.Json(odd, 1, 2) == "{\"number\":5,\"name\":\"A \\\"B\\\" \\\\ C\\u0001\u0086 é 😀\",\"tvPlus\":true,\"pid\":1,\"at\":2}", "channel file: quotes, backslash and control characters escaped, other text kept");
        var lone = new Channel { Id = 9, Major = 6, Name = "x\ud800y" };
        Check(ChannelFile.Json(lone, 1, 2).Contains("x\\ud800y"), "channel file: a lone surrogate is escaped");
        Check(ChannelFile.Json(null, 1, 2) == null, "channel file: no channel, no JSON");
        Check(ChannelFile.PathNextTo("/home/owner/vetro-tuner.pid") == "/home/owner/vetro-tuner-channel.json", "channel file: next to the pid file");
        Check(ChannelFile.PathNextTo(null) == null && ChannelFile.PathNextTo("") == null, "channel file: no pid file, no channel file");

        string dir = Path.Combine(Path.GetTempPath(), "vetro-channel-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        string path = Path.Combine(dir, ChannelFile.Name);
        Check(ChannelFile.Write(path, ChannelFile.Json(c, 42, 1)) && File.ReadAllText(path).StartsWith("{\"number\":21,"), "channel file: written");
        Check(ChannelFile.Write(path, ChannelFile.Json(odd, 42, 2)) && File.ReadAllText(path).Contains("\"number\":5") && !File.Exists(path + ".tmp"), "channel file: replaced whole, no temporary file left");
        Check(ChannelFile.Write(path, null) && !File.Exists(path), "channel file: removed");
        Check(!ChannelFile.Write(Path.Combine(dir, "missing", "x.json"), "{}"), "channel file: a folder that does not exist is reported, not thrown");
        Directory.Delete(dir, true);
    }
}
