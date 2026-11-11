using System;
using System.Collections.Generic;
using System.IO;
using Tuner.Core;
using Tuner.Native;

namespace Tuner.Tvs
{
    /// <summary>
    /// The channel logos of Samsung's own tuner, read where the TV keeps them. The slive daemon holds a table of channels (gallery) with the
    /// address of each picture and a table that joins them to the tvs service ids, and it saves the pictures it downloads in a folder; this
    /// reads the two tables (read-only, once) and finds the files. It downloads nothing and writes nothing: a channel whose picture is not
    /// in the folder simply has no logo. The preview replaces this file (preview/host/tuner/LogoSource.Sim.cs) because the TV's files are not there.
    /// </summary>
    internal sealed class LogoSource
    {
        private const string DaemonDir = "/opt/usr/home/owner/apps_rw/com.samsung.tv.slive-daemon";
        private const string DbDir = DaemonDir + "/data", PictureDir = DaemonDir + "/shared/slive/data/logos/rf";
        private const long RecheckMs = 30000;       // a picture that was not on disk is looked for again after this long (the daemon may have saved it since)

        private LogoIndex _index;
        private readonly Dictionary<ulong, KeyValuePair<string, long>> _seen = new Dictionary<ulong, KeyValuePair<string, long>>();   // UI thread only

        /// <summary>True when the TV's tables gave something to look up. The views reserve room for a logo only then.</summary>
        public bool Available { get { return _index != null && _index.Any; } }

        /// <summary>Worker thread: reads the tables. Returns the index (null when the TV has none) and says in <paramref name="status"/> what happened. Never throws.</summary>
        public LogoIndex Read(IList<Channel> channels, out string status)
        {
            var gallery = new List<LogoRow>();
            var tunable = new List<KeyValuePair<ulong, string>>();
            string problems = "";
            int files = 0;
            for (int n = 0; n < 4; n++)
            {
                string path = DbDir + "/freesia_ontv_" + n + ".db";
                if (!File.Exists(path)) continue;
                files++;
                try { ReadFile(path, gallery, tunable); }
                catch (Exception ex) { problems += " " + n + "=" + ex.Message; }
            }
            var index = new LogoIndex(gallery, tunable);
            int found = 0, withFile = 0;
            if (channels != null)
                foreach (Channel c in channels)
                {
                    string url = index.UrlFor(c);
                    if (url == null) continue;
                    found++;
                    string name = LogoNames.CacheFile(url);
                    if (name != null && File.Exists(PictureDir + "/" + name)) withFile++;
                }
            status = "logos: " + files + " db, " + index.Rows + " gallery rows, " + tunable.Count + " tunable, channels " + (channels == null ? 0 : channels.Count) + " matched " + found + " with a file " + withFile + (problems.Length > 0 ? ", problems:" + problems : "");
            return index.Any ? index : null;
        }

        private static void ReadFile(string path, List<LogoRow> gallery, List<KeyValuePair<ulong, string>> tunable)
        {
            IntPtr db;
            int rc = Sqlite.sqlite3_open_v2(path, out db, Sqlite.OpenReadOnly, IntPtr.Zero);
            try
            {
                if (rc != Sqlite.Ok) throw new IOException("open " + rc);
                Sqlite.sqlite3_busy_timeout(db, 300);        // the daemon may be writing: wait a moment, then give up until the next start
                Query(db, "SELECT program_source_id, channel_name, icon_url, onid, tsid, sid FROM Gallery WHERE icon_url != ''", s =>
                {
                    gallery.Add(new LogoRow
                    {
                        SourceId = Sqlite.Text(s, 0), Name = Sqlite.Text(s, 1), IconUrl = Sqlite.Text(s, 2),
                        Onid = LogoNames.HexList(Sqlite.Text(s, 3)), Tsid = LogoNames.HexList(Sqlite.Text(s, 4)), Sid = LogoNames.HexList(Sqlite.Text(s, 5))
                    });
                });
                Query(db, "SELECT TCServiceId, program_source_id FROM TunableChannel", s =>
                {
                    ulong id;
                    if (ulong.TryParse(Sqlite.Text(s, 0), out id)) tunable.Add(new KeyValuePair<ulong, string>(id, Sqlite.Text(s, 1)));
                });
            }
            finally { if (db != IntPtr.Zero) Sqlite.sqlite3_close(db); }
        }

        private static void Query(IntPtr db, string sql, Action<IntPtr> row)
        {
            IntPtr stmt;
            int rc = Sqlite.sqlite3_prepare_v2(db, sql, -1, out stmt, IntPtr.Zero);
            if (rc != Sqlite.Ok) throw new IOException("prepare " + rc);
            try
            {
                while ((rc = Sqlite.sqlite3_step(stmt)) == Sqlite.Row) row(stmt);
                if (rc != Sqlite.Done) throw new IOException("step " + rc);
            }
            finally { Sqlite.sqlite3_finalize(stmt); }
        }

        /// <summary>UI thread: makes this the table the views look in (null: none, nothing is drawn).</summary>
        public void Install(LogoIndex index) { _index = index; _seen.Clear(); }

        /// <summary>UI thread: the picture file of a channel, or null when it has none (not in the gallery, or its file is not saved). Remembered, so a redraw costs a lookup.</summary>
        public string PathFor(Channel c)
        {
            LogoIndex index = _index;
            if (index == null || c == null) return null;
            long now = Environment.TickCount64;
            KeyValuePair<string, long> memo;
            if (_seen.TryGetValue(c.Id, out memo) && (memo.Key != null || now - memo.Value < RecheckMs)) return memo.Key;
            string path = null;
            string name = LogoNames.CacheFile(index.UrlFor(c));
            if (name != null)
            {
                string file = PictureDir + "/" + name;
                if (File.Exists(file)) path = file;
            }
            _seen[c.Id] = new KeyValuePair<string, long>(path, now);
            return path;
        }
    }
}
