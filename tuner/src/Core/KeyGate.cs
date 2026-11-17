namespace Tuner.Core
{
    /// <summary>
    /// Whether a key read from the remote's input device is the tuner's. The tuner reads evdev, so it sees every key whatever window
    /// the system gives it to: the launcher, its 123 pad, Samsung's own 123 pad or panels, an app that came in front. While the tuner is
    /// on screen it keeps the keyboard focus; when another window has it, that window answers the key and the tuner must not answer too.
    /// Pure logic: the caller samples the window's focus (elm_win_focus_get) and asks.
    ///
    /// Rules:
    ///  * until the window has once reported the focus, nothing is gated: a TV whose compositor never tells us keeps the old behaviour;
    ///  * focused: the key is ours;
    ///  * just shown and the focus not seen yet: the key is ours for <see cref="GraceSeconds"/> (the focus is on its way, and a key that
    ///    woke the tuner must not be lost);
    ///  * otherwise (the focus went to another window, or never came after the grace): the key is not ours.
    /// </summary>
    internal sealed class KeyGate
    {
        public const double GraceSeconds = 0.6;

        private bool _learned;          // the window has reported the focus at least once: the compositor tells us
        private bool _focused;          // last sampled state
        private bool _seenSinceShown;   // the focus came at least once since the last show
        private double _shownAt = -1;   // when the window was last put on screen; negative while hidden

        public bool Learned { get { return _learned; } }

        /// <summary>The window was put on screen (and asked for the focus).</summary>
        public void Shown(double now) { _shownAt = now; _seenSinceShown = false; }

        /// <summary>The window was taken off the screen.</summary>
        public void Hidden() { _shownAt = -1; _seenSinceShown = false; }

        /// <summary>Records the focus as read now. True when it changed (for the log).</summary>
        public bool Sample(bool focused)
        {
            bool changed = focused != _focused;
            _focused = focused;
            if (focused) { _learned = true; _seenSinceShown = true; }
            return changed;
        }

        /// <summary>True when a key read now, with the window on screen, belongs to the tuner.</summary>
        public bool Accepts(double now)
        {
            if (!_learned || _focused) return true;
            return !_seenSinceShown && _shownAt >= 0 && now - _shownAt < GraceSeconds;
        }
    }
}
