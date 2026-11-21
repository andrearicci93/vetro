using System;
using System.IO;
using System.Text;

namespace Tuner.Core
{
    /// <summary>
    /// The channel on screen, for Vetro's service (MQTT's Channel sensor): a small JSON file next to the tuner's pid file, rewritten
    /// whole (temporary file, then a rename) every time the channel changes, and removed when the tuner ends. The service reads it
    /// only while this tuner runs (its pid is in the file) and the TV input is the tuner.
    /// </summary>
    internal static class ChannelFile
    {
        public const string Name = "vetro-tuner-channel.json";

        /// <summary>The file's path in the folder of the pid file, or null without one.</summary>
        public static string PathNextTo(string pidFile)
        {
            if (string.IsNullOrEmpty(pidFile)) return null;
            string dir = Path.GetDirectoryName(pidFile);
            return string.IsNullOrEmpty(dir) ? null : Path.Combine(dir, Name);
        }

        /// <summary>{"number":5,"name":"Rai 5","tvPlus":false,"pid":123,"at":1700000000000}. Null for no channel.</summary>
        public static string Json(Channel c, int pid, long atMs)
        {
            if (c == null) return null;
            var sb = new StringBuilder(96);
            sb.Append("{\"number\":").Append(c.Major.ToString(System.Globalization.CultureInfo.InvariantCulture));
            sb.Append(",\"name\":\"");
            string name = c.Name ?? "";
            for (int i = 0; i < name.Length; i++)
            {
                char ch = name[i];
                if (ch == '"' || ch == '\\') sb.Append('\\').Append(ch);
                else if (ch < 0x20 || ch == 0x7f || (char.IsSurrogate(ch) && !IsPaired(name, i))) sb.Append("\\u").Append(((int)ch).ToString("x4", System.Globalization.CultureInfo.InvariantCulture));
                else sb.Append(ch);
            }
            sb.Append("\",\"tvPlus\":").Append(c.Virtual ? "true" : "false");
            sb.Append(",\"pid\":").Append(pid.ToString(System.Globalization.CultureInfo.InvariantCulture));
            sb.Append(",\"at\":").Append(atMs.ToString(System.Globalization.CultureInfo.InvariantCulture)).Append('}');
            return sb.ToString();
        }

        // A lone surrogate cannot be written as UTF-8: such a character is escaped instead (valid pairs, e.g. emoji, stay as they are).
        private static bool IsPaired(string s, int i)
        {
            if (char.IsHighSurrogate(s[i])) return i + 1 < s.Length && char.IsLowSurrogate(s[i + 1]);
            return i > 0 && char.IsHighSurrogate(s[i - 1]);
        }

        /// <summary>Writes the text whole: a reader sees the old file or the new one, never half of it. False when it could not.</summary>
        public static bool Write(string path, string json)
        {
            if (path == null) return false;
            string temp = path + ".tmp";
            try
            {
                if (json == null) { File.Delete(path); return true; }
                File.WriteAllText(temp, json + "\n", new UTF8Encoding(false));
                File.Move(temp, path, true);
                return true;
            }
            catch (Exception) { try { File.Delete(temp); } catch (Exception) { } return false; }
        }
    }
}
