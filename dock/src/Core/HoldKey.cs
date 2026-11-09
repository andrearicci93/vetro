namespace Launcher.Core
{
    internal enum HoldResult { None, Tap, Hold }

    /// <summary>
    /// One key that means one thing when tapped and another when held (OK on the task page: open or close).
    /// The host calls <see cref="Press"/> on every key down (auto-repeat and echoes included), arms a timer of
    /// <see cref="HoldSeconds"/> when it returns true, calls <see cref="Fire"/> when that timer runs out and
    /// <see cref="Release"/> on every key up. A key down while already held is a repeat and is ignored, a release
    /// after the hold has fired does nothing, and a second release (the raw node and the window both report
    /// one) finds nothing held.
    /// </summary>
    internal sealed class HoldKey
    {
        public const double HoldSeconds = 0.8;

        private bool _down, _fired;

        public bool IsDown { get { return _down; } }

        /// <summary>True when this starts a new press (arm the timer); false for a repeat of one already held.</summary>
        public bool Press()
        {
            if (_down) return false;
            _down = true;
            _fired = false;
            return true;
        }

        /// <summary>The timer ran out: <see cref="HoldResult.Hold"/> when the key is still down and has not fired yet.</summary>
        public HoldResult Fire()
        {
            if (!_down || _fired) return HoldResult.None;
            _fired = true;
            return HoldResult.Hold;
        }

        /// <summary>The key came up: <see cref="HoldResult.Tap"/> when it was let go before the hold fired.</summary>
        public HoldResult Release()
        {
            if (!_down) return HoldResult.None;
            _down = false;
            return _fired ? HoldResult.None : HoldResult.Tap;
        }

        /// <summary>Forgets a press (the page went away while the key was down): its release must not act.</summary>
        public void Cancel() { _down = false; _fired = false; }
    }
}
