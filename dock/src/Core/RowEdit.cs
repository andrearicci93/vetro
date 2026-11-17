using System;
using System.Collections.Generic;
using System.Text;

namespace Launcher.Core
{
    /// <summary>
    /// The user's own apps row: hold OK on a tile to move it (Left / Right) or take it out (Down), hold OK on an app of the All apps page
    /// or on an input of the Sources page (TV, HDMI 1-4) to add it to the row or take it out. The apps are the tiles before the pinned pills (All apps, Samsung Home), which never move.
    /// Every change is a new array; the row as the user leaves it is sent to Vetro by its row keys (<see cref="AppEntry.RowKey"/>), and
    /// Vetro lays it over Samsung's own Home row. Pure, so it is tested without a TV.
    /// </summary>
    internal static class RowEdit
    {
        /// <summary>Where the pinned pills start (the apps end), or the whole length when there are none.</summary>
        public static int AppsEnd(AppEntry[] row)
        {
            int g = Catalog.GroupStart(row);
            return g < 0 ? row.Length : g;
        }

        /// <summary>The row can be edited: every app carries a row key (a list written by an older Vetro does not).</summary>
        public static bool CanEdit(AppEntry[] row)
        {
            if (row == null || row.Length == 0) return false;
            int end = AppsEnd(row);
            if (end == 0) return false;
            for (int i = 0; i < end; i++) if (row[i].RowKey == null) return false;
            return true;
        }

        /// <summary>The tile at <paramref name="index"/> is an app of the row (not a pill).</summary>
        public static bool IsApp(AppEntry[] row, int index) { return index >= 0 && index < AppsEnd(row); }

        /// <summary>Where the app at <paramref name="index"/> goes one place left (-1) or right (+1) among the apps; <paramref name="index"/> itself at the ends.</summary>
        public static int Target(AppEntry[] row, int index, int step)
        {
            int to = index + step;
            return !IsApp(row, index) || to < 0 || to >= AppsEnd(row) ? index : to;
        }

        /// <summary>The row without the app at <paramref name="index"/>; the same row when it is the last app (a row is never empty).</summary>
        public static AppEntry[] Remove(AppEntry[] row, int index)
        {
            if (!IsApp(row, index) || AppsEnd(row) < 2) return row;
            var list = new List<AppEntry>(row);
            list.RemoveAt(index);
            return list.ToArray();
        }

        /// <summary>The row with <paramref name="app"/> added after the last app, before the pills; the same row when it is there already.</summary>
        public static AppEntry[] Add(AppEntry[] row, AppEntry app)
        {
            if (app == null || app.RowKey == null || IndexOf(row, app.RowKey) >= 0 || app.IsSystem) return row;
            var list = new List<AppEntry>(row);
            list.Insert(AppsEnd(row), app);
            if (list.Count > Catalog.MaxEntries) return row;
            return list.ToArray();
        }

        /// <summary>
        /// Holding OK on a page of entries (All apps, Sources) can add them to the row or take them out: the row can be edited and at least one
        /// entry of the page carries a row key. False for a Sources list written by an older Vetro (no keys): OK there only switches, and the page
        /// does not promise a hold that cannot happen.
        /// </summary>
        public static bool CanAddFrom(AppEntry[] page, AppEntry[] row)
        {
            if (page == null || !CanEdit(row)) return false;
            foreach (AppEntry e in page) if (!e.IsSystem && Catalog.ValidRowKey(e.RowKey)) return true;
            return false;
        }

        /// <summary>
        /// Held OK on an entry of All apps or Sources: the row without it when it is there (<paramref name="added"/> false), with it at the end
        /// when it is not (<paramref name="added"/> true). The same row when nothing can change: a pill, no row key, the row cannot be edited,
        /// the last app of the row, or the row is full.
        /// </summary>
        public static AppEntry[] Toggle(AppEntry[] row, AppEntry entry, out bool added)
        {
            added = false;
            if (entry == null || entry.IsSystem || entry.RowKey == null || !CanEdit(row)) return row;
            int at = IndexOf(row, entry.RowKey);
            if (at >= 0) return Remove(row, at);
            AppEntry[] next = Add(row, entry);
            added = next != row;
            return next;
        }

        /// <summary>The entries of a page (All apps, Sources) that the row holds, by their place on the page: they carry the tick.</summary>
        public static HashSet<int> Marks(AppEntry[] page, AppEntry[] row)
        {
            var marked = new HashSet<int>();
            if (page == null || row == null) return marked;
            for (int i = 0; i < page.Length; i++) if (IndexOf(row, page[i].RowKey) >= 0) marked.Add(i);
            return marked;
        }

        /// <summary>Where the app with this row key is in the row, or -1.</summary>
        public static int IndexOf(AppEntry[] row, string rowKey)
        {
            if (rowKey == null || row == null) return -1;
            int end = AppsEnd(row);
            for (int i = 0; i < end; i++) if (row[i].RowKey == rowKey) return i;
            return -1;
        }

        /// <summary>The apps' row keys in order, or null when one is missing or not plain.</summary>
        public static string[] Keys(AppEntry[] row)
        {
            int end = AppsEnd(row);
            var keys = new string[end];
            for (int i = 0; i < end; i++)
            {
                if (!Catalog.ValidRowKey(row[i].RowKey)) return null;
                keys[i] = row[i].RowKey;
            }
            return keys;
        }

        /// <summary>
        /// The shell command that sends the row to Vetro on this TV (the launcher plugin's <c>row</c> route, which saves it and writes the
        /// lists for the next start) and returns at once. Null when a key is not plain: nothing from the list reaches the shell but checked keys.
        /// </summary>
        public static string Command(string[] keys, int port)
        {
            if (keys == null || keys.Length == 0) return null;
            var body = new StringBuilder("{\"row\":[");
            for (int i = 0; i < keys.Length; i++)
            {
                if (!Catalog.ValidRowKey(keys[i])) return null;
                if (i > 0) body.Append(',');
                body.Append('"').Append(keys[i]).Append('"');
            }
            body.Append("]}");
            return "( /usr/bin/curl -sf -m 15 -X POST -H 'Content-Type: application/json' -d '" + body + "' 'http://127.0.0.1:" + port
                + "/plugins/launcher/api/row' >/dev/null 2>&1 ) &";
        }
    }
}
