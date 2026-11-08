using System;

namespace Tuner.Core
{
    /// <summary>
    /// Decides when a resident tuner takes the screen over from Samsung's live TV app. It is fed the application manager's
    /// status of that app (AUL: 2 focus, 3 visible, 0/1 starting, 4 background, 5/6/7/8 anything else) about twice a second
    /// and answers "show now" or not. Pure logic: the call that reads the status lives in Program.cs.
    ///
    /// Rules:
    ///  * the tuner shows itself once, when the TV app is up (focus or visible) and the tuner is hidden;
    ///  * when the viewer sends the tuner away (Back, Home, ...) it stays away while the TV app is still up, so Back is not undone
    ///    by the next poll; it may come back after the TV app has been away (another app in front, closed) and returned;
    ///  * a reading that failed changes nothing, unless it keeps failing: four in a row (two seconds) count as "the app is not
    ///    running", because the service may answer an error rather than a status for an app that is not there.
    /// </summary>
    internal sealed class Takeover
    {
        public const int Focus = 2, Visible = 3;
        public const int UnreadableLimit = 4;

        private bool _held;          // the tuner was sent away while the TV app was up: leave it away until the app has been gone
        private int _unreadable;     // consecutive failed readings

        /// <summary>True when the status means the TV app is on screen.</summary>
        public static bool IsUp(int status) { return status == Focus || status == Visible; }

        /// <param name="status">AUL status of the TV app; any negative number means the reading failed.</param>
        /// <param name="tunerShown">Whether the tuner window is on screen now.</param>
        /// <returns>True when the tuner should be shown now.</returns>
        public bool Observe(int status, bool tunerShown)
        {
            bool up;
            if (status < 0)
            {
                if (++_unreadable < UnreadableLimit) return false;       // a single failed reading is not an answer
                up = false;
            }
            else
            {
                _unreadable = 0;
                up = IsUp(status);
            }
            if (!up) { _held = false; return false; }
            return !tunerShown && !_held;
        }

        /// <summary>The tuner was hidden (by a key, the control pipe or an app change). It stays hidden while the TV app stays up.</summary>
        public void Dismissed() { _held = true; }
    }
}
