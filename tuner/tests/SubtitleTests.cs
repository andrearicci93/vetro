using System.Collections.Generic;
using Tuner.Core;

internal static partial class Tests
{
    private static void SubtitleTests()
    {
        // Languages: three letters packed in an integer, as the TV service gives them.
        Check(Subtitles.Unpack(0x697461) == "ita" && Subtitles.Unpack(0x656E67) == "eng", "subtitles: packed language codes are unpacked");
        Check(Subtitles.Unpack(0x495441) == "ita", "subtitles: upper-case letters are read too");
        Check(Subtitles.Unpack(-1) == "" && Subtitles.Unpack(0) == "" && Subtitles.Unpack(0x7A7A7B) == "" && Subtitles.Unpack(0x1697461) == "", "subtitles: unknown, empty, not letters or too long: no language");
        Check(Languages.Name("ita") == "Italian" && Languages.Name("eng") == "English" && Languages.Name("deu") == "German" && Languages.Name("ger") == "German"
              && Languages.Name("fra") == "French" && Languages.Name("fre") == "French" && Languages.Name("spa") == "Spanish" && Languages.Name("por") == "Portuguese",
              "subtitles: the common languages have English names");
        Check(Languages.Name("qaa") == "Original", "subtitles: qaa is the original language");
        Check(Languages.Name("fin") == "FIN", "subtitles: another code is shown in capitals");

        // The selection from the two settings.
        Check(Subtitles.Selected(3, false, 1) == Subtitles.Off, "subtitles: off is off whatever the index");
        Check(Subtitles.Selected(3, true, 1) == 1, "subtitles: on shows the track of the index");
        Check(Subtitles.Selected(2, true, 5) == 0 && Subtitles.Selected(2, true, -3) == 0, "subtitles: an index outside the list counts as the first track (the TV puts it back to 0)");
        Check(Subtitles.Selected(0, true, 0) == Subtitles.Off, "subtitles: no track: off");

        // The cycle: Off -> 1 -> 2 -> ... -> Off.
        Check(Subtitles.Next(3, Subtitles.Off) == 0 && Subtitles.Next(3, 0) == 1 && Subtitles.Next(3, 1) == 2 && Subtitles.Next(3, 2) == Subtitles.Off, "subtitles: Down walks Off, the tracks in order, Off");
        Check(Subtitles.Next(1, Subtitles.Off) == 0 && Subtitles.Next(1, 0) == Subtitles.Off, "subtitles: one track: Off and back");
        Check(Subtitles.Next(0, Subtitles.Off) == Subtitles.Off && Subtitles.Next(0, 2) == Subtitles.Off, "subtitles: no track: it stays off");
        int sel = Subtitles.Off, steps = 0;
        do { sel = Subtitles.Next(4, sel); steps++; } while (sel != Subtitles.Off && steps < 10);
        Check(steps == 5, "subtitles: four tracks come back to Off after five presses");

        // What is written, index first.
        int idx; bool on;
        Subtitles.Settings(2, 0, out idx, out on);
        Check(idx == 2 && on, "subtitles: a track writes its index and on");
        Subtitles.Settings(Subtitles.Off, 2, out idx, out on);
        Check(idx == 2 && !on, "subtitles: off keeps the index there is and writes off");
        Subtitles.Settings(Subtitles.Off, -4, out idx, out on);
        Check(idx == 0 && !on, "subtitles: off with no usable index writes 0");

        // Labels and the line's value.
        var three = new List<SubtitleTrack> { new SubtitleTrack("ita", false), new SubtitleTrack("eng", false), new SubtitleTrack("ita", true) };
        Check(Subtitles.Label(three, 0) == "Italian" && Subtitles.Label(three, 1) == "English", "subtitles: a track is its language");
        Check(Subtitles.Label(three, 2) == "Italian (hard of hearing)", "subtitles: the hard-of-hearing track says so");
        var twins = new List<SubtitleTrack> { new SubtitleTrack("ita", false), new SubtitleTrack("ita", false), new SubtitleTrack("", false), new SubtitleTrack("qaa", false) };
        Check(Subtitles.Label(twins, 1) == "Italian (2)", "subtitles: a second track of the same language gets its number");
        Check(Subtitles.Label(twins, 2) == "Track 3", "subtitles: a track with no language is called by its number");
        Check(Subtitles.Label(twins, 3) == "Original", "subtitles: qaa reads Original");
        Check(Subtitles.Label(twins, 9) == "" && Subtitles.Label(null, 0) == "", "subtitles: no such track: no label");
        Check(Subtitles.Value(three, false, Subtitles.Off) == "Off" && Subtitles.Value(three, false, 1) == "English", "subtitles: the line says Off or the track");
        Check(Subtitles.Value(new List<SubtitleTrack>(), false, Subtitles.Off) == "None on this channel", "subtitles: a channel with no track says so");
        Check(Subtitles.Value(null, true, 0) == "Not available" && Subtitles.Value(three, true, 1) == "Not available", "subtitles: a failed read says Not available");
        Check(Subtitles.Value(null, false, 0) == "", "subtitles: while the list is read the line is empty (it keeps its place)");
        Check(Subtitles.AudioValue("ita", 0) == "Italian" && Subtitles.AudioValue("eng", 1) == "English (2)" && Subtitles.AudioValue("", -1) == "Not available", "subtitles: the Audio line's value");
    }
}
