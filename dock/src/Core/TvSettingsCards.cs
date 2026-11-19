using System;
using System.Collections.Generic;
using System.Globalization;

namespace Launcher.Core
{
    /// <summary>One row of a choice card (Picture mode, Sleep timer, a Shard card): what it says, what choosing it sets, and whether it is the current one.</summary>
    internal sealed class ChoiceRow
    {
        public string Label;
        public int Value;
        public bool Active;
        /// <summary>A Shard card's own name for the row (what a choice sends back); null on the TV's own cards.</summary>
        public string Id;
    }

    /// <summary>What a choice card shows after a read: its rows, a line for the header, and whether the rows can be chosen.</summary>
    internal sealed class ChoiceState
    {
        public List<ChoiceRow> Rows = new List<ChoiceRow>();
        public string Note = "";
        /// <summary>False: the rows are only shown (the TV's own menu holds the setting now, or nothing could be read).</summary>
        public bool Choosable = true;
    }

    /// <summary>
    /// The Picture mode card. The mode belongs to Samsung's AV output daemon (avocd), on D-Bus: the current mode is read with
    /// <c>GetPictureMode i 1</c>, each candidate is offered when <c>CheckPictureModeByMode i id</c> answers 1, and a choice is set with
    /// <c>SetPictureMode ii id 1</c> (saved for the current source, as Samsung's own menu does). The candidates and their order are
    /// Samsung's own list (its Settings panel); the HDR variants share the SDR names, since the TV offers one or the other. A mode that is
    /// not among them (Game, See colours, AI picture) locks the list, as on Samsung's own menu. Read on a Q80A; setting is not tried yet.
    /// </summary>
    internal static class PictureModes
    {
        public static readonly int[] Candidates = { 65536, 65541, 65537, 393216, 65542, 65538, 393217, 65539, 65540, 393218, 393219, 655360, 655361 };

        /// <summary>
        /// The mode a 2022-or-later TV reports while Auto Filmmaker Mode has switched to Filmmaker Mode for the content (an S95C on 2220.4 read
        /// 327705 while Samsung's own list ticked FILMMAKER MODE, 2026-11-19; 16 sets on 2022+ firmware report it, none on 2021). Read as 655360.
        /// </summary>
        public const int AutoFilmmaker = 327705;

        public static string Name(int id)
        {
            switch (id)
            {
                case 65536: return "Dynamic";
                case 65541: return "Entertain";
                case 65537: case 393216: return "Standard";
                case 65542: return "Natural";
                case 65538: case 393217: return "Movie";
                case 65539: case 393218: return "Calibrated Night";
                case 65540: case 393219: return "Calibrated Day";
                case 655360: case 655361: case AutoFilmmaker: return "Filmmaker Mode";
                case 65547: case 393222: return "Game";
                case 327687: return "See colours";
                case 589824: case 589825: return "AI picture";
                default: return null;
            }
        }

        private const string Avoc = "busctl call org.tizen.tv.avoc /org/tizen/tv/avoc org.tizen.tv.avoc.AvOutputControl ";

        // The reads give up after 3 s each (busctl waits 25 s by default): with avocd stuck, the 14 calls of one opening
        // would otherwise keep the card "Reading…" for minutes. The set keeps the default: the switch itself may take a moment.
        private const string AvocRead = "busctl --timeout=3 call org.tizen.tv.avoc /org/tizen/tv/avoc org.tizen.tv.avoc.AvOutputControl ";

        public static string GetCommand() { return AvocRead + "GetPictureMode i 1"; }

        /// <summary>One call for every candidate: each answer on its own line, in the candidates' order.</summary>
        public static string CheckCommand()
        {
            var parts = new List<string>();
            foreach (int id in Candidates) parts.Add(AvocRead + "CheckPictureModeByMode i " + id.ToString(CultureInfo.InvariantCulture) + " || echo x");
            return "{ " + string.Join("; ", parts.ToArray()) + "; }";
        }

        /// <summary>The command that sets mode <paramref name="id"/>, or null for a mode that is not a candidate (nothing else reaches the shell).</summary>
        public static string SetCommand(int id)
        {
            return Array.IndexOf(Candidates, id) < 0 ? null : Avoc + "SetPictureMode ii " + id.ToString(CultureInfo.InvariantCulture) + " 1";
        }

        /// <summary>The numbers in a busctl answer ("ii 65538 0" gives 65538, 0; "i 1" gives 1); empty when it is not one.</summary>
        public static List<int> Numbers(string line)
        {
            var list = new List<int>();
            string[] f = (line ?? "").Trim().Split(' ');
            if (f.Length < 2 || f[0].Length == 0 || f[0].Trim('i') != "") return list;
            for (int i = 1; i < f.Length; i++) { int v; if (!int.TryParse(f[i], NumberStyles.Integer, CultureInfo.InvariantCulture, out v)) return new List<int>(); list.Add(v); }
            return list;
        }

        /// <summary>The card's rows from the two reads: the offered modes, one row per name, the current one ticked.</summary>
        public static ChoiceState Build(string getAnswer, string checkAnswer)
        {
            var st = new ChoiceState();
            List<int> cur = Numbers(getAnswer);
            int current = cur.Count >= 2 && cur[1] == 0 ? cur[0] : -1;
            if (current == AutoFilmmaker) current = 655360;    // Filmmaker Mode turned on by the content: Samsung's list ticks Filmmaker Mode and keeps every other mode
            string[] lines = (checkAnswer ?? "").Replace("\r", "").Split('\n');
            var seen = new HashSet<string>();
            for (int i = 0, k = 0; i < lines.Length && k < Candidates.Length; i++)
            {
                if (lines[i].Trim().Length == 0) continue;
                int id = Candidates[k++];
                List<int> n = Numbers(lines[i]);
                bool offered = n.Count == 1 && n[0] == 1;
                string name = Name(id);
                if (!offered || name == null || seen.Contains(name)) { if (id == current && name != null && seen.Contains(name)) MarkActive(st, name); continue; }
                seen.Add(name);
                st.Rows.Add(new ChoiceRow { Label = name, Value = id, Active = id == current });
            }
            if (current < 0) { st.Note = "Not available"; st.Choosable = false; st.Rows.Clear(); return st; }
            if (Array.IndexOf(Candidates, current) < 0)
            {
                // Game, See colours, AI picture: Samsung's own menu shows only that mode and asks to turn it off first.
                st.Rows.Clear();
                st.Rows.Add(new ChoiceRow { Label = Name(current) ?? "Another mode", Value = current, Active = true });
                st.Note = "Set in Samsung's menu";   // short: it shares the header's line with the title, on a card that may be 520 px wide
                st.Choosable = false;
                return st;
            }
            if (st.Rows.Count == 0) { st.Note = "Not available"; st.Choosable = false; }
            return st;
        }

        private static void MarkActive(ChoiceState st, string name)
        {
            foreach (ChoiceRow r in st.Rows) if (r.Label == name) r.Active = true;
        }
    }

    /// <summary>
    /// The Sleep timer card. Samsung's own timer: two vconf keys that its app-control-service watches, counts down and acts on (a warning
    /// a minute before, then the TV switches off). <c>savetime</c> is the index of Samsung's choice (0 off, 1 30 min, 2 60, 3 120, 4 180);
    /// <c>time_t</c> the minutes left. Set in Samsung's order: the index, then the minutes; off is index 0. Read on a Q80A (off); setting is
    /// not tried yet.
    /// </summary>
    internal static class SleepTimer
    {
        public const string IndexKey = "memory/menu/system/time/sleeptimer/savetime";
        public const string LeftKey = "db/menu/system/time/sleeptimer/time_t";
        public static readonly int[] Minutes = { 0, 30, 60, 120, 180 };

        public static string ReadCommand() { return "vconftool get " + IndexKey + "; vconftool get " + LeftKey; }

        /// <summary>The command that sets choice <paramref name="index"/> (0 off), or null outside Samsung's five.</summary>
        public static string SetCommand(int index)
        {
            if (index < 0 || index >= Minutes.Length) return null;
            string i = index.ToString(CultureInfo.InvariantCulture), m = Minutes[index].ToString(CultureInfo.InvariantCulture);
            return "vconftool set -f -t int " + IndexKey + " " + i + " && vconftool set -f -t string " + LeftKey + " " + m;
        }

        /// <summary>"memory/.../savetime, value = 2 (Int32)" gives "2".</summary>
        public static string Value(string text, string key)
        {
            foreach (string line in (text ?? "").Replace("\r", "").Split('\n'))
            {
                if (!line.StartsWith(key + ",", StringComparison.Ordinal)) continue;
                int at = line.IndexOf("value = ", StringComparison.Ordinal);
                if (at < 0) return null;
                string v = line.Substring(at + 8);
                int sp = v.LastIndexOf(" (", StringComparison.Ordinal);
                return (sp >= 0 ? v.Substring(0, sp) : v).Trim();
            }
            return null;
        }

        public static ChoiceState Build(string read)
        {
            var st = new ChoiceState();
            int index, left;
            bool known = int.TryParse(Value(read, IndexKey), NumberStyles.Integer, CultureInfo.InvariantCulture, out index) && index >= 0 && index < Minutes.Length;
            for (int i = 0; i < Minutes.Length; i++)
                st.Rows.Add(new ChoiceRow { Label = i == 0 ? "Off" : Minutes[i] + " min", Value = i, Active = known && i == index });
            if (!known) { st.Note = "Not available"; st.Choosable = false; return st; }
            if (index > 0 && int.TryParse(Value(read, LeftKey), NumberStyles.Integer, CultureInfo.InvariantCulture, out left) && left > 0)
                st.Note = "TV off in " + left + " min";
            return st;
        }
    }
}
