using System;
using System.Globalization;
using System.IO;

namespace Launcher.Core
{
    // The launcher and the service's one-shot command share this request. The
    // interface also lets desktop tests check every native call and its cleanup.
    internal interface ISourceControl
    {
        int Create(out IntPtr handle);
        int SetAppId(IntPtr handle, string appId);
        int AddData(IntPtr handle, string key, string value);
        int Send(IntPtr handle);
        void Destroy(IntPtr handle);
    }

    /// <summary>Chooses the resource tv-viewer needs without confusing it with optional dock artwork.</summary>
    internal static class SourceSwitch
    {
        private const string LegacyIconDir = "/usr/apps/com.samsung.tv.theme-resource/shared/res/org.tizen.menu/Settings_Popup/device_icon/";

        public static string ResolveIcon(AppEntry entry, Func<string, bool> exists)
        {
            if (entry == null || entry.SourceType < 0 || exists == null) return null;
            if (Catalog.ValidSourceIconPath(entry.SourceIcon) && exists(entry.SourceIcon)) return entry.SourceIcon;

            string name = entry.SourceType == 0 ? "tv"
                : entry.SourceType >= 13 && entry.SourceType <= 16 ? "hdmi" + (entry.SourceType - 12)
                : entry.SourceType == 33 ? "dpport" : null;
            if (name == null) return null;
            // Samsung's folder holds PNG files up to the 2024 firmware and WebP files from the 2025 Tizen 9 firmware (checked on the stock
            // 2025 package), so either is a real resource for tv-viewer.
            foreach (string extension in FallbackExtensions)
            {
                string fallback = LegacyIconDir + "r_icon_device_s_" + name + extension;
                if (exists(fallback)) return fallback;
            }
            return null;
        }

        private static readonly string[] FallbackExtensions = { ".png", ".webp" };

        /// <summary>The remote key the dashboard's Inputs page falls back to when no icon exists on this firmware (TV and HDMI 1-4 only).
        /// A key name is letters and digits only, so it is safe on a command line.</summary>
        public static string FallbackKey(AppEntry entry)
        {
            if (entry == null) return null;
            if (entry.SourceType == 0) return "XF86DiscretSourceTV";
            if (entry.SourceType >= 13 && entry.SourceType <= 16) return "XF86DiscretHDMI" + (entry.SourceType - 12).ToString(CultureInfo.InvariantCulture);
            return null;
        }

        public static int Send(int type, string label, string icon, Func<string, bool> exists, ISourceControl control)
        {
            if (type < 0 || type > 65535 || string.IsNullOrWhiteSpace(label) || label.Length > 80 ||
                !Catalog.ValidSourceIconPath(icon) || exists == null || control == null) return -22;
            foreach (char c in label) if (char.IsControl(c)) return -22;
            if (!exists(icon)) return -2;

            IntPtr handle;
            int rc = control.Create(out handle);
            if (rc != 0) return rc;
            if (handle == IntPtr.Zero) return -22;
            try
            {
                rc = control.SetAppId(handle, "org.tizen.tv-viewer");
                if (rc != 0) return rc;
                string n = type.ToString(CultureInfo.InvariantCulture);
                string[] data = { "change_source", n, "sourceType", n, "sourceName", label, "sourceIcon", icon,
                    "mbrIndex", "-2", "__K_EX_LAUNCH_REQUESTOR", "user" };
                for (int i = 0; i < data.Length; i += 2)
                {
                    rc = control.AddData(handle, data[i], data[i + 1]);
                    if (rc != 0) return rc;
                }
                return control.Send(handle);
            }
            finally { control.Destroy(handle); }
        }

        // A bounded command, not a general app launcher: exactly one numeric
        // source, one label and an existing firmware icon; no UI or persistent state.
        public static int RunCommand(string[] args, Func<string, bool> exists, ISourceControl control, TextWriter output)
        {
            int type;
            if (args == null || args.Length != 4 || args[0] != "--switch-source" ||
                !int.TryParse(args[1], NumberStyles.None, CultureInfo.InvariantCulture, out type))
            {
                output.WriteLine("Invalid source-switch arguments");
                return 2;
            }
            int rc = Send(type, args[2], args[3], exists, control);
            output.WriteLine("source_type=" + type.ToString(CultureInfo.InvariantCulture) + " rc=" + rc);
            return rc == 0 ? 0 : 1;
        }
    }
}
