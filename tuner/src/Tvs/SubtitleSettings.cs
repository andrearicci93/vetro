using System;
using Tuner.Native;

namespace Tuner.Tvs
{
    /// <summary>
    /// The TV's own subtitle settings, two vconf keys: on/off (0 = off) and the chosen track (an index into the list the TV service gives for the
    /// channel, <see cref="TvsClient.ReadSubtitles"/>). Switching subtitles is writing them: Samsung's live TV app draws the subtitles and follows
    /// these keys, so the tuner never asks the daemon to change the track itself. The TV may put the index back to 0 after a channel change when the
    /// new channel has fewer tracks, so the keys are read again after every tune, never kept. Written from the worker thread; nothing here throws.
    /// Worked out from the firmware, not tried on a TV yet.
    /// </summary>
    internal static class SubtitleSettings
    {
        public const string OnKey = "db/menu/subtitle/subtitle", IndexKey = "db/menu/subtitle/subtitlelanguage";

        /// <summary>Reads both keys. False when either cannot be read (then nothing is known and nothing should be written).</summary>
        public static bool Read(out bool on, out int index, out string note)
        {
            on = false; index = 0;
            try
            {
                int v, i;
                int r1 = Efl.vconf_get_int(OnKey, out v);
                int r2 = Efl.vconf_get_int(IndexKey, out i);
                note = "subtitle=" + (r1 == 0 ? v.ToString() : "r" + r1) + " subtitlelanguage=" + (r2 == 0 ? i.ToString() : "r" + r2);
                if (r1 != 0 || r2 != 0) return false;
                on = v != 0; index = i;
                return true;
            }
            catch (Exception ex) { note = "settings: " + ex.Message; return false; }
        }

        /// <summary>Writes the track first, then on/off, so the right track is in place when the subtitles come on. False when a write failed (on/off is not written after a failed index).</summary>
        public static bool Write(int index, bool on, out string note)
        {
            try
            {
                int r1 = Efl.vconf_set_int(IndexKey, index);
                if (r1 != 0) { note = "write subtitlelanguage=" + index + " r=" + r1 + " (on/off left alone)"; return false; }
                int r2 = Efl.vconf_set_int(OnKey, on ? 1 : 0);
                note = "write subtitlelanguage=" + index + " subtitle=" + (on ? 1 : 0) + (r2 != 0 ? " r=" + r2 : "");
                return r2 == 0;
            }
            catch (Exception ex) { note = "write: " + ex.Message; return false; }
        }
    }
}
