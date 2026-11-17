using System.Collections.Generic;

namespace Tuner.Core
{
    /// <summary>One subtitle track of a channel, as the TV service lists it: its language (three lower-case letters, "" when unknown) and whether it is the hard-of-hearing one.</summary>
    internal struct SubtitleTrack
    {
        public string Language;
        public bool HardOfHearing;
        public SubtitleTrack(string language, bool hardOfHearing) { Language = language ?? ""; HardOfHearing = hardOfHearing; }
    }

    /// <summary>
    /// The subtitles of the Audio toast, as pure logic. The TV keeps two settings: whether subtitles are on, and which track (an index into the
    /// service's list of tracks). The tuner lists the tracks, shows the state as one "selection" (-1 = off, else the index), and on Down steps
    /// Off -> track 1 -> track 2 -> ... -> Off. Tested in tuner/tests.
    /// </summary>
    internal static class Subtitles
    {
        public const int Off = -1;
        /// <summary>More than this is not a real list (a bad answer): the rest is left out.</summary>
        public const int MaxTracks = 32;

        /// <summary>The Subtitles line's value when the channel has no track, and when the list (or the settings) cannot be read.</summary>
        public const string NoneText = "None on this channel", UnavailableText = "Not available", OffText = "Off";

        /// <summary>A language as the TV service packs it, three ISO 639-2 letters in one integer (0x697461 = "ita"); "" when it is not three letters.</summary>
        public static string Unpack(int code)
        {
            if (code <= 0 || code > 0xFFFFFF) return "";
            var c = new char[3];
            for (int i = 0; i < 3; i++)
            {
                int b = (code >> (16 - 8 * i)) & 255;
                if (b >= 'A' && b <= 'Z') b += 'a' - 'A';
                if (b < 'a' || b > 'z') return "";
                c[i] = (char)b;
            }
            return new string(c);
        }

        /// <summary>
        /// What is on now, from the two settings: -1 when subtitles are off (or there is no track), else the track's index. An index out of the
        /// list while subtitles are on counts as the first track: the TV puts the first one on in that case.
        /// </summary>
        public static int Selected(int count, bool on, int index)
        {
            if (!on || count <= 0) return Off;
            return index >= 0 && index < count ? index : 0;
        }

        /// <summary>The selection after one Down: Off -> 0 -> 1 -> ... -> the last -> Off. With no track it stays off.</summary>
        public static int Next(int count, int selected)
        {
            if (count <= 0) return Off;
            if (selected < 0) return 0;
            return selected + 1 < count ? selected + 1 : Off;
        }

        /// <summary>
        /// The two settings to write for a selection, index first: Off keeps the index there is (only "on" changes, so the track does not
        /// flicker before it goes), a track writes its index and on.
        /// </summary>
        public static void Settings(int selection, int currentIndex, out int index, out bool on)
        {
            on = selection >= 0;
            index = on ? selection : (currentIndex >= 0 ? currentIndex : 0);
        }

        /// <summary>
        /// The words for a track: the language ("Italian"), "(hard of hearing)" when the service says so, "Track N" when the language is not
        /// known; a label that an earlier track already has gets its number ("Italian (2)").
        /// </summary>
        public static string Label(IList<SubtitleTrack> tracks, int i)
        {
            if (tracks == null || i < 0 || i >= tracks.Count) return "";
            string own = Plain(tracks[i], i);
            for (int j = 0; j < i; j++)
                if (Plain(tracks[j], j) == own) return own + " (" + (i + 1) + ")";
            return own;
        }

        private static string Plain(SubtitleTrack t, int i)
        {
            string name = string.IsNullOrEmpty(t.Language) ? "Track " + (i + 1) : Languages.Name(t.Language);
            return t.HardOfHearing ? name + " (hard of hearing)" : name;
        }

        /// <summary>The Subtitles line's value. <paramref name="tracks"/> null with <paramref name="failed"/> false: still being read (empty, the line keeps its place).</summary>
        public static string Value(IList<SubtitleTrack> tracks, bool failed, int selected)
        {
            if (failed) return UnavailableText;
            if (tracks == null) return "";
            if (tracks.Count == 0) return NoneText;
            return selected < 0 ? OffText : Label(tracks, selected);
        }

        /// <summary>The Audio line's value: the language of the track ("Italian"), its number when it is not the first ("English (2)"); "Not available" when it cannot be read.</summary>
        public static string AudioValue(string languageCode, int index)
        {
            if (index < 0) return UnavailableText;
            return Languages.Name(languageCode) + (index > 0 ? " (" + (index + 1) + ")" : "");
        }
    }
}
