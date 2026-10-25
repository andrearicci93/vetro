using System;
using System.Collections.Generic;

namespace Launcher.Core
{
    /// <summary>One entry of the dock. <see cref="Slug"/> names the icon file (res/icons/slug.png).</summary>
    internal sealed class AppEntry
    {
        public readonly string Slug;
        public readonly string Label;
        public readonly string AppId;
        /// <summary>Tried when launching <see cref="AppId"/> fails. May be null.</summary>
        public readonly string FallbackAppId;
        /// <summary>
        /// X key name (for example XF86Menu) injected through the platform's key tool, as if the
        /// remote had sent it: opens Samsung's own Settings, Source and so on without knowing the
        /// app behind them. When set, <see cref="AppId"/> is only the fallback and may be null.
        /// </summary>
        public readonly string Key;
        /// <summary>
        /// Samsung's input number (TV 0, HDMI 1-4 are 13-16, as in Tizen's SourceType and the
        /// firmware's source_type value) to switch to, or -1. Switching asks tv-viewer, exactly as
        /// Samsung's own Source tile does.
        /// </summary>
        public readonly int SourceType;
        /// <summary>Name of a dock page to open (for example "inputs") instead of launching anything; null otherwise.</summary>
        public readonly string Panel;

        /// <summary>An app that is launched normally but belongs with the TV's own controls (the Samsung Home behind Settings).</summary>
        public readonly bool SystemApp;

        /// <summary>A function of the TV itself (Settings, Source) rather than an app to launch.</summary>
        public bool IsSystem { get { return Key != null || Panel != null || SystemApp; } }

        /// <summary>
        /// Absolute path of the app's own icon, as Samsung's registry holds it; null when the icon
        /// is the pre-made res/icons/slug.png. The dock rounds it and sets loose logos on a tile.
        /// </summary>
        public readonly string IconPath;

        /// <summary>
        /// Id of an app to kill just before this one is launched (for example YouTube's own process, which
        /// gets in the way of TizenTube); null when nothing needs to be closed first.
        /// </summary>
        public readonly string KillFirst;

        public AppEntry(string slug, string label, string appId, string fallbackAppId)
            : this(slug, label, appId, fallbackAppId, null) { }

        public AppEntry(string slug, string label, string appId, string fallbackAppId, string key)
            : this(slug, label, appId, fallbackAppId, key, -1, null) { }

        public AppEntry(string slug, string label, string appId, string fallbackAppId, string key, int sourceType, string panel)
            : this(slug, label, appId, fallbackAppId, key, sourceType, panel, false) { }

        public AppEntry(string slug, string label, string appId, string fallbackAppId, string key, int sourceType, string panel, bool systemApp)
            : this(slug, label, appId, fallbackAppId, key, sourceType, panel, systemApp, null) { }

        public AppEntry(string slug, string label, string appId, string fallbackAppId, string key, int sourceType, string panel, bool systemApp, string iconPath)
            : this(slug, label, appId, fallbackAppId, key, sourceType, panel, systemApp, iconPath, null) { }

        public AppEntry(string slug, string label, string appId, string fallbackAppId, string key, int sourceType, string panel, bool systemApp, string iconPath, string killFirst)
        {
            Slug = slug; Label = label; AppId = appId; FallbackAppId = fallbackAppId; Key = key;
            SourceType = sourceType; Panel = panel; SystemApp = systemApp; IconPath = iconPath; KillFirst = killFirst;
        }
    }

    internal sealed class CatalogResult
    {
        public readonly AppEntry[] Entries;
        public readonly string[] Problems;
        public CatalogResult(AppEntry[] entries, string[] problems) { Entries = entries; Problems = problems; }
    }

    /// <summary>
    /// Parses the app list written by tools/gen-apps.py. One tab-separated entry per line:
    /// <c>slug TAB label TAB appId [TAB fallbackAppId [TAB iconPath [TAB killFirstAppId]]]</c>, where the third field may also be
    /// <c>key:XF86Menu</c> (inject that remote key; the fourth field is then an app to open if the
    /// key tool is missing), <c>source:13</c> (switch to that input) or <c>panel:inputs</c> (open
    /// that dock page) or <c>sys:appId</c> (launch that app, drawn as a system control); blank lines and lines starting with '#' are ignored. Bad lines are skipped and reported, never fatal: a launcher
    /// that refuses to start because of one typo would leave the TV without a home.
    /// </summary>
    internal static class Catalog
    {
        public const int MaxEntries = 40;

        // Plain character checks: a Regex here would pull in the regex engine (and, compiled,
        // generate IL) just to validate a dozen short strings at startup.
        private static bool Chars(string s, int max, bool upper, bool dot)
        {
            if (s.Length == 0 || s.Length > max) return false;
            foreach (char c in s)
            {
                bool ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-'
                          || (upper && c >= 'A' && c <= 'Z') || (dot && c == '.');
                if (!ok) return false;
            }
            return true;
        }

        private static bool IsSlug(string s) { return Chars(s, 40, false, false); }

        private static readonly string[] IconRoots =
        {
            "/opt/share/webappservice/apps_icon/", "/opt/usr/apps/", "/usr/apps/"
        };

        /// <summary>
        /// A PNG under one of the places the TV keeps app icons. The path is only ever opened as a
        /// file, but it comes from a file other software can write, so it is kept to plain names.
        /// </summary>
        public static bool ValidIconPath(string s)
        {
            if (s == null || s.Length == 0 || s.Length > 200 || !s.EndsWith(".png", StringComparison.Ordinal)) return false;
            if (s.Contains("..") || s.Contains("//")) return false;
            foreach (char c in s)
            {
                bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '.' || c == '/';
                if (!ok) return false;
            }
            foreach (string root in IconRoots) if (s.StartsWith(root, StringComparison.Ordinal)) return true;
            return false;
        }
        private static bool IsAppId(string s) { return Chars(s, 120, true, true); }
        /// <summary>True for a plain Tizen app id (letters, digits, dot, dash, underscore): safe to put on a command line.</summary>
        public static bool ValidAppId(string s) { return s != null && IsAppId(s); }
        // Plain digits, at most five: it is only ever formatted back into a number string.
        private static bool IsSourceType(string s, out int value)
        {
            value = 0;
            if (s.Length == 0 || s.Length > 5) return false;
            foreach (char c in s)
            {
                if (c < '0' || c > '9') return false;
                value = value * 10 + (c - '0');
            }
            return true;
        }

        // Letters and digits only: the name ends up on a command line, so nothing else may pass.
        private static bool IsKeyName(string s)
        {
            if (s.Length == 0 || s.Length > 32) return false;
            foreach (char c in s)
                if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'))) return false;
            return true;
        }

        public static CatalogResult Parse(string text)
        {
            var entries = new List<AppEntry>();
            var problems = new List<string>();
            var seen = new HashSet<string>();
            string[] lines = (text ?? "").Replace("\r", "").Split('\n');
            for (int n = 0; n < lines.Length; n++)
            {
                string line = lines[n];
                if (line.Trim().Length == 0 || line.TrimStart().StartsWith("#", StringComparison.Ordinal)) continue;
                string[] f = line.Split('\t');
                if (f.Length < 3) { problems.Add("line " + (n + 1) + ": expected slug, label, appId"); continue; }
                string slug = f[0].Trim(), label = f[1].Trim(), appId = f[2].Trim();
                string fallback = f.Length > 3 ? f[3].Trim() : "";
                string icon = f.Length > 4 ? f[4].Trim() : "";
                string killFirst = f.Length > 5 ? f[5].Trim() : "";
                string key = null, panel = null;
                int sourceType = -1;
                bool special = false, systemApp = false;
                if (appId.StartsWith("sys:", StringComparison.Ordinal))
                {
                    appId = appId.Substring(4);     // a normal app launch, shown as a system control
                    systemApp = true;
                }
                else if (appId.StartsWith("key:", StringComparison.Ordinal))
                {
                    key = appId.Substring(4);
                    if (!IsKeyName(key)) { problems.Add("line " + (n + 1) + ": bad key name"); continue; }
                    special = true;
                }
                else if (appId.StartsWith("source:", StringComparison.Ordinal))
                {
                    if (!IsSourceType(appId.Substring(7), out sourceType)) { problems.Add("line " + (n + 1) + ": bad source number"); continue; }
                    special = true;
                }
                else if (appId.StartsWith("panel:", StringComparison.Ordinal))
                {
                    panel = appId.Substring(6);
                    if (!IsSlug(panel)) { problems.Add("line " + (n + 1) + ": bad panel name"); continue; }
                    special = true;
                }
                if (special)
                {
                    appId = fallback;       // the app (if any) is only the fallback
                    fallback = "";
                }
                if (!IsSlug(slug)) { problems.Add("line " + (n + 1) + ": bad slug"); continue; }
                if (label.Length == 0 || label.Length > 40) { problems.Add("line " + (n + 1) + ": bad label"); continue; }
                if (!(special && appId.Length == 0) && !IsAppId(appId)) { problems.Add("line " + (n + 1) + ": bad appId"); continue; }
                if (fallback.Length > 0 && !IsAppId(fallback)) { problems.Add("line " + (n + 1) + ": bad fallback appId"); continue; }
                if (icon.Length > 0 && !ValidIconPath(icon)) { problems.Add("line " + (n + 1) + ": bad icon path"); continue; }
                if (killFirst.Length > 0 && !IsAppId(killFirst)) { problems.Add("line " + (n + 1) + ": bad kill-first app id"); continue; }
                if (!seen.Add(slug)) { problems.Add("line " + (n + 1) + ": duplicate slug " + slug); continue; }
                if (entries.Count >= MaxEntries) { problems.Add("line " + (n + 1) + ": more than " + MaxEntries + " entries, ignored"); continue; }
                entries.Add(new AppEntry(slug, label, appId.Length > 0 ? appId : null, fallback.Length > 0 ? fallback : null, key, sourceType, panel, systemApp, icon.Length > 0 ? icon : null, killFirst.Length > 0 ? killFirst : null));
            }
            return new CatalogResult(entries.ToArray(), problems.ToArray());
        }

        /// <summary>
        /// Index of the first of a run of system entries that ends the list (the dock draws a divider
        /// before it), or -1 when there are none, they are all of it, or they are not at the end.
        /// </summary>
        public static int GroupStart(AppEntry[] entries)
        {
            int g = entries.Length;
            while (g > 0 && entries[g - 1].IsSystem) g--;
            return g > 0 && g < entries.Length ? g : -1;
        }

        /// <summary>TV and the four HDMI inputs; used when res/inputs.tsv is missing or empty.</summary>
        public static AppEntry[] BuiltInInputs()
        {
            return new[]
            {
                new AppEntry("in-tv", "TV", null, null, null, 0, null),
                new AppEntry("in-hdmi1", "HDMI 1", null, null, null, 13, null),
                new AppEntry("in-hdmi2", "HDMI 2", null, null, null, 14, null),
                new AppEntry("in-hdmi3", "HDMI 3", null, null, null, 15, null),
                new AppEntry("in-hdmi4", "HDMI 4", null, null, null, 16, null),
            };
        }

        /// <summary>Samsung's own preinstalled apps only; used when res/apps.tsv is missing or empty.</summary>
        public static AppEntry[] BuiltIn()
        {
            return new[]
            {
                new AppEntry("tvplus", "Samsung TV Plus", "org.tizen.tv-viewer", null),
                new AppEntry("livetv", "Live TV", "org.tizen.tv-viewer", null),
                new AppEntry("netflix", "Netflix", "org.tizen.netflix-app", null),
                new AppEntry("prime", "Prime Video", "org.tizen.primevideo", null),
                new AppEntry("appletv", "Apple TV", "com.samsung.tv.aria-video", null),
            };
        }
    }
}
