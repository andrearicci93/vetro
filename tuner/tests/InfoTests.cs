using System;
using System.Collections.Generic;
using Tuner.Core;

internal static partial class Tests
{
    private static void InfoTests()
    {
        Func<string, int> m = s => s.Length * 10;          // every character 10 px wide: easy to count by hand

        // Date and audio.
        Check(InfoText.Date(1794103440, TimeSpan.FromHours(1)) == "Sunday 8 November", "info: the date is the weekday, day and month in full");
        Check(InfoText.Date(1794103440, TimeSpan.Zero) == "Sunday 8 November", "info: the date follows the offset");
        Check(InfoText.Date(1794103440 + 22 * 3600, TimeSpan.FromHours(1)) == "Monday 9 November", "info: after midnight local time it is the next day");
        Check(InfoText.Audio("ITA", 0) == "Italian", "info: the first track is just the language");
        Check(InfoText.Audio("ENG", 1) == "English · track 2", "info: another track says which");
        Check(InfoText.Audio("", 0) == "" && InfoText.Audio("ITA", -1) == "", "info: an audio track that cannot be read shows nothing");

        // Wrapping.
        List<string> l = InfoText.Wrap("one two three four", 100, 5, m);
        Check(l.Count == 2 && l[0] == "one two" && l[1] == "three four", "info: words go on the next line when the line is full");
        l = InfoText.Wrap("a  b\r\nc\td", 1000, 3, m);
        Check(l.Count == 1 && l[0] == "a b c d", "info: blanks and line breaks count as one space");
        Check(InfoText.Wrap("", 100, 3, m).Count == 0 && InfoText.Wrap("   ", 100, 3, m).Count == 0 && InfoText.Wrap(null, 100, 3, m).Count == 0, "info: nothing to wrap gives no lines");
        Check(InfoText.Wrap("x", 0, 3, m).Count == 0 && InfoText.Wrap("x", 100, 0, m).Count == 0, "info: no room gives no lines");
        l = InfoText.Wrap("aaa bbb ccc ddd eee fff", 70, 2, m);
        Check(l.Count == 2 && l[0] == "aaa bbb" && l[1].EndsWith("…") && m(l[1]) <= 70, "info: text that does not fit ends the last line with an ellipsis: " + string.Join("|", l));
        l = InfoText.Wrap("aaa bbb ccc ddd", 70, 2, m);
        Check(l.Count == 2 && l[1] == "ccc ddd" && !l[1].EndsWith("…"), "info: text that just fits is not cut");
        l = InfoText.Wrap("abcdefghijklmnop", 60, 4, m);
        Check(l.Count == 3 && l[0] == "abcdef" && l[1] == "ghijkl" && l[2] == "mnop", "info: a word wider than a line is cut: " + string.Join("|", l));
        l = InfoText.Wrap("abcdefghijklmnopqrstuvwxyz", 60, 2, m);
        Check(l.Count == 2 && l[1].EndsWith("…") && m(l[1]) <= 60, "info: a long word on the last line gets the ellipsis too: " + string.Join("|", l));
        bool wide = true;
        foreach (string line in InfoText.Wrap("Ezra Pound è stato un grande e controverso poeta americano, iniziatore di movimenti di avanguardia come l'Imagismo ed il Vorticismo", 300, 4, m)) wide &= m(line) <= 300;
        Check(wide, "info: no line is wider than the card");
        Check(InfoText.Ellipsize("hello world", 70, m) == "hello…", "info: the ellipsis takes back as many letters as it needs");
    }
}
