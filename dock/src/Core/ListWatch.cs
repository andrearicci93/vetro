using System;

namespace Launcher.Core
{
    /// <summary>
    /// Keeps the pages up to date when an app is installed or removed (from Samsung's store, TV-Store, Apps2Samsung or pkgcmd): every one of
    /// those goes through the package manager, whose database is then newer than the lists Vetro wrote. When the dock comes on screen it
    /// compares the two dates (two stat calls, no process) and, only when the database is newer, asks Vetro once to read the TV again. Vetro
    /// writes the lists (from then on newer than the database) and sends "reload" down the fifo when they changed. Samsung's web app registry
    /// is not watched: it is written each time an app starts (launch_date), and it would make every Home press ask.
    /// </summary>
    internal static class ListWatch
    {
        public const string PackageDb = "/opt/dbspace/.pkgmgr_parser.db";

        /// <summary>The same change is asked about again after this long, in case Vetro could not answer the first time.</summary>
        public const double RetrySeconds = 300;

        /// <summary>
        /// True when Vetro should read the lists again: the database (<paramref name="db"/>) is newer than the lists, and that change of the
        /// database has not been asked about yet, or was asked about long enough ago (<paramref name="sinceAsked"/> seconds) to ask again.
        /// A missing file is <see cref="DateTime.MinValue"/>: no question then (an older Vetro writes no All apps list, the preview has no database).
        /// </summary>
        public static bool ShouldAsk(DateTime db, DateTime lists, DateTime askedFor, double sinceAsked)
        {
            if (db == DateTime.MinValue || lists == DateTime.MinValue || db <= lists) return false;
            return db != askedFor || sinceAsked >= RetrySeconds;
        }

        /// <summary>The shell line that asks Vetro for the lists, in the background; null without a port to ask on.</summary>
        public static string Command(int port)
        {
            if (port <= 0 || port > 65535) return null;
            return "( /usr/bin/curl -sf -m 60 -X POST 'http://127.0.0.1:" + port + "/plugins/launcher/api/relist' >/dev/null 2>&1 ) &";
        }

        /// <summary>Two lists that would draw the same pages: the same entries, field by field, in the same order.</summary>
        public static bool Same(AppEntry[] a, AppEntry[] b)
        {
            if (a == null || b == null || a.Length != b.Length) return a == b;
            for (int i = 0; i < a.Length; i++) if (!Same(a[i], b[i])) return false;
            return true;
        }

        private static bool Same(AppEntry x, AppEntry y)
        {
            return x.Slug == y.Slug && x.Label == y.Label && x.AppId == y.AppId && x.FallbackAppId == y.FallbackAppId && x.Key == y.Key
                && x.SourceType == y.SourceType && x.Panel == y.Panel && x.SystemApp == y.SystemApp && x.IconPath == y.IconPath
                && x.KillFirst == y.KillFirst && x.ViaShard == y.ViaShard && x.RowKey == y.RowKey && x.HbbtvLink == y.HbbtvLink;
        }
    }
}
