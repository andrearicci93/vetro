using System;

namespace Tuner.Core
{
    /// <summary>
    /// Decides when a resident tuner takes the screen over from Samsung's live TV app. It is fed the application manager's
    /// status of that app (AUL: 2 focus, 3 visible, 0/1 starting, 4 background, 5/6/7/8 anything else) about twice a second
    /// and answers "show now", "hide now", "take the keys back" or nothing. Pure logic: the calls that read the TV live in Program.cs.
    ///
    /// Two more readings refine "Samsung's live TV app is up" (both optional: the old two-argument calls mean "not known"):
    ///  * the TV's input. Samsung's app also shows the HDMI inputs; the tuner is a replacement for the TV tuner only, so on HDMI (a console,
    ///    a stick driven by the TV remote through HDMI-CEC) the app does not count as up and the tuner steps aside;
    ///  * which app the window manager gives the keys to (<see cref="FrontApp"/>). An app in front can leave Samsung's app "visible"
    ///    (see-through parts); the tuner never shows itself over another app that has the keys.
    ///
    /// Rules:
    ///  * the tuner shows itself once, when the TV app is up and the tuner is hidden, unless another app has the keys;
    ///  * when the viewer sends the tuner away (Home, the control pipe) it stays away while the TV app is still up, so the next poll does
    ///    not undo it; it comes back after the TV app has been away (another app in front, closed, another input, or another app holding the
    ///    keys for two polls: Samsung's Home, its 123 pad) and returned, on a TV key (<see cref="KeyWake"/>) or when the launcher closes
    ///    without opening anything (<see cref="Resume"/>). The caller passes "not known" for the front while a launcher window is open;
    ///  * a TV key (CH+/-, Info, Guide) while the tuner is hidden and the TV app is up brings it back at once, ahead of the poll and of the
    ///    rule above: Samsung's app must not be the one that answers CH+, Info or Guide;
    ///  * the reverse holds as well: once the TV app has been seen up while the tuner was on screen, and then it is not up for two polls in a row
    ///    (Netflix or any other app came in front: its status is 4; or the input changed to HDMI), the tuner takes itself off the screen and stops
    ///    reading the remote. It reads the remote's input devices itself, whatever is in front, so without this OK in Netflix's profile screen
    ///    opened the channel list. A tuner shown by hand (the control pipe) while the TV app was never up is left alone until Back or Home: that
    ///    was asked for;
    ///  * on screen with another app holding the keys for <see cref="OtherLimit"/> polls (three seconds; a short Samsung popup does not count),
    ///    the tuner steps aside without a hold, and comes back when live TV has the keys again;
    ///  * on screen with Samsung's app holding the keys itself (the window manager says so for two polls in a row) the tuner asks for the focus
    ///    again (<see cref="Step.Reclaim"/>): with the tuner on screen every key of live TV is the tuner's, and a window that closed may have
    ///    handed the focus to Samsung's app instead. At most once every <see cref="ReclaimEvery"/> polls, so it can never fight a window;
    ///  * a reading that failed changes nothing, unless it keeps failing: four in a row (two seconds) count as "the app is not
    ///    running", because the service may answer an error rather than a status for an app that is not there.
    /// </summary>
    internal sealed class Takeover
    {
        public const int Focus = 2, Visible = 3;
        public const int UnreadableLimit = 4;
        public const int AwayLimit = 2;      // polls in a row (1 s) with the TV app not up before the shown tuner steps aside
        public const int ReclaimAfter = 2;   // polls in a row with Samsung's app holding the keys before the tuner asks for them back
        public const int ReclaimEvery = 6;   // polls (3 s) between two such requests
        public const int OtherLimit = 6;     // polls (3 s) with the tuner on screen and another app holding the keys before it steps aside

        public enum Step { None, Show, Hide, Reclaim }

        private bool _held;          // the tuner was sent away while the TV app was up: leave it away until the app has been gone
        private int _unreadable;     // consecutive failed readings
        private bool _seenUp;        // the TV app has been up while the tuner was on screen (so the tuner is there because of it)
        private int _away;          // consecutive polls with the tuner on screen and the TV app not up
        private int _tvHasKeys;      // consecutive polls with the tuner on screen and Samsung's app holding the keys
        private int _otherHasKeys;   // consecutive polls with the TV app up and another app holding the keys
        private int _reclaimWait;    // polls left before another reclaim may be asked for

        /// <summary>True when the status means the TV app is on screen.</summary>
        public static bool IsUp(int status) { return status == Focus || status == Visible; }

        /// <summary>True while the tuner is held away (sent away while the TV app stayed up).</summary>
        public bool Held { get { return _held; } }

        /// <param name="status">AUL status of the TV app; any negative number means the reading failed.</param>
        /// <param name="tunerShown">Whether the tuner window is on screen now.</param>
        /// <returns>True when the tuner should be shown now.</returns>
        public bool Observe(int status, bool tunerShown) { return Poll(status, tunerShown) == Step.Show; }

        /// <summary>One poll, with the input and the focused app not known.</summary>
        public Step Poll(int status, bool tunerShown) { return Poll(status, tunerShown, true, FrontApp.Kind.Unknown); }

        /// <summary>One poll: show the tuner, hide it (the TV app has been left while it was on screen), take the keys back, or leave it.</summary>
        /// <param name="tvInput">The TV's input is the tuner (true when it could not be read).</param>
        /// <param name="front">Who has the keys, as the window manager says.</param>
        public Step Poll(int status, bool tunerShown, bool tvInput, FrontApp.Kind front)
        {
            bool up;
            if (status < 0)
            {
                if (++_unreadable < UnreadableLimit) return Step.None;       // a single failed reading is not an answer
                up = false;
            }
            else
            {
                _unreadable = 0;
                up = IsUp(status) && tvInput;
            }
            if (!tunerShown) { _seenUp = false; _away = 0; _tvHasKeys = 0; }
            if (_reclaimWait > 0) _reclaimWait--;
            if (!up)
            {
                _held = false;
                _tvHasKeys = 0; _otherHasKeys = 0;
                if (!tunerShown || !_seenUp) return Step.None;
                if (++_away < AwayLimit) return Step.None;
                _seenUp = false; _away = 0;
                return Step.Hide;
            }
            _away = 0;
            if (tunerShown)
            {
                _seenUp = true;
                if (front == FrontApp.Kind.Other)
                {
                    // Another app has had the keys for three seconds with Samsung's app still "up" under it (an app with see-through parts,
                    // Samsung's 123 pad left open): the tuner leaves the screen to it, not held, and comes back with live TV.
                    _tvHasKeys = 0;
                    if (++_otherHasKeys < OtherLimit) return Step.None;
                    _otherHasKeys = 0; _seenUp = false;
                    return Step.Hide;
                }
                _otherHasKeys = 0;
                if (front != FrontApp.Kind.Tv) { _tvHasKeys = 0; return Step.None; }
                if (++_tvHasKeys < ReclaimAfter || _reclaimWait > 0) return Step.None;
                _tvHasKeys = 0; _reclaimWait = ReclaimEvery;
                return Step.Reclaim;
            }
            if (front == FrontApp.Kind.Other)
            {
                // The TV app is "up" but another app has the keys (Samsung's Home, its 123 pad, YouTube): never over it. Once that app has held
                // them for two polls the viewer has left live TV, as when the TV app goes to the background: the hold ends, and the tuner
                // comes back with live TV.
                if (++_otherHasKeys >= AwayLimit) _held = false;
                return Step.None;
            }
            _otherHasKeys = 0;
            return _held ? Step.None : Step.Show;
        }

        /// <summary>The tuner was hidden (by a key, the control pipe or an app change). It stays hidden while the TV app stays up.</summary>
        public void Dismissed() { _held = true; }

        /// <summary>A key wake with the input and the focused app not known.</summary>
        public bool KeyWake(int status) { return KeyWake(status, true, FrontApp.Kind.Unknown); }

        /// <summary>
        /// The viewer pressed a key that belongs to watching TV (CH+/-, Info, Guide) while the tuner is hidden. The caller decides which keys count: not the arrows or OK, which the launcher and Samsung's overlays use while the TV app is still "in front". Waiting for
        /// the next poll would leave Samsung's own app to react to that key and draw its own banner or list, so the tuner answers at once: when
        /// the TV app is on screen it comes back and the key is its own, whether or not it had been sent away. A reading that failed, another
        /// input (HDMI) or any other app in front changes nothing (the key is not ours).
        /// </summary>
        /// <param name="status">AUL status of the TV app, read now; negative when the reading failed.</param>
        public bool KeyWake(int status, bool tvInput, FrontApp.Kind front)
        {
            if (!IsUp(status) || !tvInput || front == FrontApp.Kind.Other) return false;
            _held = false;
            _unreadable = 0;
            return true;
        }

        /// <summary>
        /// The launcher closed without opening anything (Back, Home, its idle time), or switched to the TV input: the viewer is back on live
        /// TV, so a tuner sent away by the Home key that opened the launcher comes back. The hold ends whenever the TV app is up on the TV input:
        /// the launcher only says this when it opened nothing. The tuner shows itself at once unless another app has the keys right now (the
        /// Home key also starts Samsung's Home, which the launcher's guard closes again within three seconds); then the next poll shows it once
        /// that app has gone.
        /// </summary>
        /// <returns>True when the tuner should be shown now.</returns>
        public bool Resume(int status, bool tvInput, FrontApp.Kind front)
        {
            if (!IsUp(status) || !tvInput) return false;
            _held = false;
            _unreadable = 0;
            return front != FrontApp.Kind.Other;
        }
    }
}
