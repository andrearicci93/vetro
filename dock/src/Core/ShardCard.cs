using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Launcher.Core
{
    /// <summary>
    /// The card a Shard (a third-party Vetro plugin) may add to the Control center. The dock never runs the Shard: it asks the Vetro
    /// service on this TV with curl, as <see cref="ShardLaunch"/> does, and the service asks the Shard (giving up after 3 s for a read,
    /// 10 s for a choice). Both routes answer tab-separated lines (<c>status</c>, <c>note</c>, <c>choosable</c>, <c>result</c>, up to seven
    /// <c>row</c>s); a choice answers the card's new state, so one call is enough. Everything that comes back is checked again here, and
    /// only checked ids reach the shell. Pure, so it is tested without a TV; the routes and their timings are not tried on a TV yet.
    /// </summary>
    internal static class ShardCard
    {
        public const int MaxTitle = 24, MaxNote = 80, MaxRowLabel = 40, MaxValue = 24, MaxRowId = 40;
        /// <summary>Rows a Shard may send (plugins.md promises seven); the card shows <see cref="TaskLayout.MaxRows"/> of them and scrolls.</summary>
        public const int MaxRows = 7;

        /// <summary>A Shard's id, as the service names it: a lower-case letter, then 1 to 31 lower-case letters, digits or "-".</summary>
        public static bool ValidId(string id)
        {
            if (id == null || id.Length < 2 || id.Length > 32 || id[0] < 'a' || id[0] > 'z') return false;
            foreach (char c in id) if (!(c >= 'a' && c <= 'z') && !(c >= '0' && c <= '9') && c != '-') return false;
            return true;
        }

        /// <summary>A row's id: 1 to 40 letters, digits or ". _ -".</summary>
        public static bool ValidRowId(string id)
        {
            if (id == null || id.Length < 1 || id.Length > MaxRowId) return false;
            foreach (char c in id) if (!IsPlain(c) && c != '_') return false;
            return true;
        }

        // The characters a label may carry unescaped on the command line: everything else is "=HH" (UTF-8 bytes, hex).
        private static bool IsPlain(char c) { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '-'; }

        /// <summary>
        /// The label of a <c>shard:&lt;id&gt;:&lt;label&gt;</c> token: "=HH" escapes decoded as UTF-8. Null for anything that is not a clean
        /// label (a bad escape, a character that should have been escaped, bytes that are not UTF-8, a control character, an empty label or
        /// one longer than <see cref="MaxTitle"/>): the card then goes by the Shard's id.
        /// </summary>
        public static string DecodeLabel(string text)
        {
            if (string.IsNullOrEmpty(text)) return null;
            var bytes = new List<byte>();
            for (int i = 0; i < text.Length; i++)
            {
                char c = text[i];
                if (IsPlain(c)) { bytes.Add((byte)c); continue; }
                int hi, lo;
                if (c != '=' || i + 2 >= text.Length || (hi = Hex(text[i + 1])) < 0 || (lo = Hex(text[i + 2])) < 0) return null;
                bytes.Add((byte)(hi * 16 + lo));
                i += 2;
            }
            string label;
            try { label = new UTF8Encoding(false, true).GetString(bytes.ToArray()); }
            catch (ArgumentException) { return null; }
            label = label.Trim();
            if (label.Length == 0 || label.Length > MaxTitle) return null;
            foreach (char c in label) if (char.IsControl(c)) return null;
            return label;
        }

        /// <summary>The other way round (what the service writes): every byte outside [A-Za-z0-9.-] as "=HH". For the tests and the preview.</summary>
        public static string EncodeLabel(string label)
        {
            var sb = new StringBuilder();
            foreach (byte b in Encoding.UTF8.GetBytes(label ?? ""))
            {
                if (b < 128 && IsPlain((char)b)) sb.Append((char)b);
                else sb.Append('=').Append(b.ToString("X2", CultureInfo.InvariantCulture));
            }
            return sb.ToString();
        }

        private static int Hex(char c)
        {
            if (c >= '0' && c <= '9') return c - '0';
            if (c >= 'A' && c <= 'F') return c - 'A' + 10;
            if (c >= 'a' && c <= 'f') return c - 'a' + 10;
            return -1;
        }

        private static string Base(int port) { return "http://127.0.0.1:" + port.ToString(CultureInfo.InvariantCulture) + "/plugins/launcher/api/"; }

        /// <summary>The read: curl gives up after 5 s (the service gives the Shard 3). Null for an id that is not a Shard's.</summary>
        public static string ReadCommand(string id, int port)
        {
            if (!ValidId(id)) return null;
            return "/usr/bin/curl -sf -m 5 '" + Base(port) + "card?plugin=" + id + "'";
        }

        /// <summary>The choice of row <paramref name="rowId"/>: curl gives up after 12 s (the service gives the Shard 10). Null unless both ids are clean.</summary>
        public static string SelectCommand(string id, string rowId, int port)
        {
            if (!ValidId(id) || !ValidRowId(rowId)) return null;
            return "/usr/bin/curl -sf -m 12 -X POST '" + Base(port) + "card-select?plugin=" + id + "&row=" + rowId + "'";
        }

        /// <summary>The card from the service's answer (a read or a choice). <paramref name="result"/>: the choice's own "ok" or "fail", for the log.</summary>
        public static ChoiceState Parse(string body, out string result)
        {
            result = null;
            string status = null, note = "", choosable = null;
            var rows = new List<ChoiceRow>();
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (string raw in (body ?? "").Split('\n'))
            {
                string line = raw.TrimEnd('\r');
                if (line.Length == 0) continue;
                string[] f = line.Split('\t');
                switch (f[0])
                {
                    case "status": if (f.Length >= 2) status = f[1].Trim(); break;
                    // A note with a tab in it: its parts joined, the tab read as a space.
                    case "note": if (f.Length >= 2) note = Cut(Clean(string.Join(" ", f, 1, f.Length - 1)), MaxNote); break;
                    case "choosable": if (f.Length >= 2) choosable = f[1].Trim(); break;
                    case "result": if (f.Length >= 2) result = f[1].Trim(); break;
                    case "row":
                        // Exactly id, label, value, ticked: a label or a value with a tab in it would shift the fields, so the row is dropped.
                        if (f.Length != 5 || rows.Count == MaxRows) break;
                        string id = f[1], label = Cut(Clean(f[2]), MaxRowLabel), value = Cut(Clean(f[3]), MaxValue);
                        if (!ValidRowId(id) || ids.Contains(id) || label.Length == 0 || (f[4] != "0" && f[4] != "1")) break;
                        ids.Add(id);
                        rows.Add(new ChoiceRow { Id = id, Label = value.Length > 0 ? label + " · " + value : label, Value = rows.Count, Active = f[4] == "1" });
                        break;
                }
            }
            var st = new ChoiceState();
            if (status != "ok")
            {
                // "unavailable", a status this dock does not know, no status at all, an empty answer (the service is down): nothing to choose.
                st.Note = status == "unavailable" && note.Length > 0 ? note : "Not available";
                st.Choosable = false;
                return st;
            }
            st.Rows = rows;
            st.Note = note;
            st.Choosable = choosable != "0";
            if (rows.Count == 0) { st.Note = note.Length > 0 ? note : "Not available"; st.Choosable = false; }
            return st;
        }

        public static ChoiceState Parse(string body) { string result; return Parse(body, out result); }

        // Control characters (a stray tab or CR in a text) read as spaces, ends trimmed.
        private static string Clean(string s)
        {
            var sb = new StringBuilder(s.Length);
            foreach (char c in s) sb.Append(char.IsControl(c) ? ' ' : c);
            return sb.ToString().Trim();
        }

        // Longer than max: cut, the last character an ellipsis (as the card cuts a row that does not fit). A surrogate pair is not split.
        private static string Cut(string s, int max)
        {
            if (s.Length <= max) return s;
            int n = max - 1;
            if (n > 0 && char.IsHighSurrogate(s[n - 1])) n--;
            return s.Substring(0, n).TrimEnd() + "…";
        }
    }
}
