using System;
using System.Globalization;
using System.Text;

namespace Launcher.Core
{
    // The guard may close several Home windows, but choosing Home must retire every pending kill.
    internal static class HomeGuard
    {
        public static string[] Parse(string value)
        {
            if (value == null) return null;
            string[] ids = value.Split(',');
            return ids.Length > 0 && Array.TrueForAll(ids, Catalog.ValidAppId) ? ids : null;
        }

        public static bool ShouldCancel(string[] ids, string appId)
        {
            return ids != null && appId != null &&
                (Array.IndexOf(ids, appId) >= 0 || appId == "com.samsung.tv.coba.newhome");
        }

        public static string Command(string[] ids, string file, int generation)
        {
            if (ids == null || ids.Length == 0 || !Array.TrueForAll(ids, Catalog.ValidAppId))
                throw new ArgumentException("Invalid Home app ids");
            string quotedFile = "'" + file.Replace("'", "'\"'\"'") + "'";
            string gen = generation.ToString(CultureInfo.InvariantCulture);
            var command = new StringBuilder("(");
            foreach (string gap in new[] { "0.15", "0.3", "0.45", "0.7", "1.2" })
            {
                command.Append(" sleep ").Append(gap).Append(';');
                foreach (string id in ids)
                    command.Append(" [ \"$(cat ").Append(quotedFile).Append(")\" = ").Append(gen)
                        .Append(" ] || exit 0; /usr/bin/app_launcher -k ").Append(id).Append(';');
            }
            return command.Append(" ) >/dev/null 2>&1 &").ToString();
        }
    }
}
