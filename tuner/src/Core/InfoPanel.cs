using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Tuner.Core
{
    /// <summary>Everything the info panel shows, as plain text, so what goes on screen can be checked without the TV. Empty text means "not known (yet)": the row stays empty.</summary>
    internal sealed class InfoData
    {
        public string Number = "", Name = "";
        public string Title = "", Range = "", Left = "", Description = "";
        public double? Fraction;           // how far the programme is, null when there is no programme on air
        public string Clock = "", Date = "";
        public string Source = "", Audio = "";
        public bool NoProgram;             // the daemon has none for this channel: the title row says so
    }

    /// <summary>The text side of the info panel (the card at the top that the Info key opens): date and time, word wrapping.</summary>
    internal static class InfoText
    {
        /// <summary>"Sunday 8 November" in the given offset from UTC.</summary>
        public static string Date(long unix, TimeSpan offset)
        {
            return DateTimeOffset.FromUnixTimeSeconds(unix).ToOffset(offset).ToString("dddd d MMMM", CultureInfo.InvariantCulture);
        }

        /// <summary>"Italian" or "Italian · track 2" (the audio track on air, when the channel has more than one).</summary>
        public static string Audio(string languageCode, int index)
        {
            if (string.IsNullOrEmpty(languageCode) || index < 0) return "";
            string name = Languages.Name(languageCode);
            return index > 0 ? name + " · track " + (index + 1) : name;
        }

        /// <summary>
        /// Breaks <paramref name="text"/> into at most <paramref name="maxLines"/> lines no wider than <paramref name="maxWidth"/> (as
        /// <paramref name="measure"/> counts it), on word boundaries; a word wider than a line is cut. If the text does not fit, the last line ends with
        /// an ellipsis. Blank input gives no lines; runs of blanks and line breaks count as one space.
        /// </summary>
        public static List<string> Wrap(string text, int maxWidth, int maxLines, Func<string, int> measure)
        {
            var lines = new List<string>();
            if (maxLines <= 0 || maxWidth <= 0 || string.IsNullOrWhiteSpace(text)) return lines;
            string[] words = text.Split(new[] { ' ', '\t', '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            var line = new StringBuilder();
            bool cut = false;
            for (int i = 0; i < words.Length && !cut; i++)
            {
                string w = words[i];
                while (true)
                {
                    string tryLine = line.Length == 0 ? w : line + " " + w;
                    if (measure(tryLine) <= maxWidth) { line.Clear(); line.Append(tryLine); break; }
                    if (line.Length > 0)
                    {
                        if (lines.Count + 1 >= maxLines) { cut = true; break; }   // this line would be the last and the rest does not fit
                        lines.Add(line.ToString()); line.Clear();
                        continue;                                                // the word starts the next line
                    }
                    // one word wider than a whole line: keep as much of it as fits
                    int n = w.Length;
                    while (n > 1 && measure(w.Substring(0, n)) > maxWidth) n--;
                    if (n >= w.Length) { line.Append(w); break; }
                    if (lines.Count + 1 >= maxLines) { line.Append(w.Substring(0, n)); cut = true; break; }
                    lines.Add(w.Substring(0, n));
                    w = w.Substring(n);
                }
            }
            if (line.Length > 0) lines.Add(line.ToString());
            if (cut && lines.Count > 0) lines[lines.Count - 1] = Ellipsize(lines[lines.Count - 1], maxWidth, measure);
            return lines;
        }

        /// <summary>The line with "…" at its end, cut back until it fits.</summary>
        public static string Ellipsize(string s, int maxWidth, Func<string, int> measure)
        {
            s = s.TrimEnd();
            while (s.Length > 1 && measure(s + "…") > maxWidth) s = s.Substring(0, s.Length - 1).TrimEnd();
            return s + "…";
        }
    }
}
