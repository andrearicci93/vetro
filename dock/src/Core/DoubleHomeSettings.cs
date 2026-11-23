using System;
using System.Globalization;
using System.IO;
using System.Text;

namespace Launcher.Core
{
    // Small, bounded request shared with the service. The event loop applies it
    // before writing an exact acknowledgement for this process and request.
    internal sealed class DoubleHomeSettings
    {
        public readonly string Mode, AppId;
        private DoubleHomeSettings(string mode, string appId) { Mode = mode; AppId = appId; }

        public static bool TryParse(string text, int pid, out DoubleHomeSettings setting)
        {
            setting = null;
            if (text == null || text.Length > 256 || !text.EndsWith("\n", StringComparison.Ordinal)) return false;
            string[] fields = text.Substring(0, text.Length - 1).Split('\t');
            int requestPid;
            if (fields.Length != 5 || fields[0] != "v1" || fields[1].Length != 32 ||
                !int.TryParse(fields[2], NumberStyles.None, CultureInfo.InvariantCulture, out requestPid) ||
                requestPid <= 0 || requestPid != pid) return false;
            foreach (char c in fields[1]) if (!(c >= '0' && c <= '9') && !(c >= 'a' && c <= 'f')) return false;
            if (fields[3] == "app")
            {
                if (fields[4].Length > 120 || !Catalog.ValidAppId(fields[4])) return false;
            }
            else if ((fields[3] != "off" && fields[3] != "shortcut") || fields[4].Length != 0) return false;
            setting = new DoubleHomeSettings(fields[3], fields[4]);
            return true;
        }

        public static AppEntry Resolve(string mode, string appId, AppEntry[] apps)
        {
            if (mode == "off") return null;
            AppEntry shortcut = null;
            string fallback = "com.samsung.tv.csfs";
            foreach (AppEntry entry in apps)
            {
                if (entry.Slug == "customhome" || entry.Slug == "samsunghome") shortcut = entry;
                if (entry.Slug == "samsunghome") fallback = entry.AppId;
                else if (entry.Slug == "customhome" && Catalog.ValidAppId(entry.FallbackAppId)) fallback = entry.FallbackAppId;
            }
            if (mode == "shortcut") return shortcut ?? throw new InvalidOperationException("Home shortcut is unavailable");
            if (mode != "app" || appId == null || appId.Length > 120 || !Catalog.ValidAppId(appId)) throw new ArgumentException("Invalid double-press destination");
            return new AppEntry("doublehome", "Home", appId == "com.samsung.tv.csfs" ? fallback : appId, fallback, null, -1, null, true);
        }

        public static void ApplyFile(string path, int pid, AppEntry[] apps, Action<AppEntry> apply, Action<string> prepareAcknowledgement = null)
        {
            if (String.IsNullOrEmpty(path)) throw new InvalidOperationException("Live double-press settings are unavailable");
            var bytes = new byte[257];
            int count = 0;
            using (var file = File.OpenRead(path))
            {
                int read;
                while (count < bytes.Length && (read = file.Read(bytes, count, bytes.Length - count)) > 0) count += read;
            }
            if (count > 256) throw new InvalidDataException("Double-press request is too large");
            for (int i = 0; i < count; i++) if (bytes[i] > 127) throw new InvalidDataException("Invalid double-press request encoding");
            string text = Encoding.ASCII.GetString(bytes, 0, count);
            DoubleHomeSettings setting;
            if (!TryParse(text, pid, out setting)) throw new InvalidDataException("Invalid or stale double-press request");
            AppEntry target = Resolve(setting.Mode, setting.AppId, apps);
            apply(target);
            string temporary = path + ".applied.tmp";
            try
            {
                File.WriteAllText(temporary, text, Encoding.ASCII);
                if (prepareAcknowledgement != null) prepareAcknowledgement(temporary);
                File.Move(temporary, path + ".applied", true);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
    }
}
