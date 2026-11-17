namespace Tuner.Core
{
    /// <summary>
    /// When the tuner may do a piece of work that only moves a cost out of a key press (making the guide's objects): the channel list is known,
    /// nothing of the tuner is on screen or moving, and no key or command came for <see cref="QuietSeconds"/>. A timer asks after
    /// <see cref="FirstDelay"/> and, while the answer is no, again every <see cref="RetryDelay"/>. Pure.
    /// </summary>
    internal static class IdleWork
    {
        public const double FirstDelay = 5.0, RetryDelay = 2.0, QuietSeconds = 3.0;

        public enum Answer { Now, Later, Never }

        /// <param name="wanted">The part is switched on (a part switched off is made, as before, the first time it opens).</param>
        /// <param name="done">Already made.</param>
        /// <param name="listKnown">The channel list has been read.</param>
        /// <param name="onScreen">Any panel or message of the tuner is on screen (or fading).</param>
        /// <param name="moving">A transition is running.</param>
        /// <param name="secondsSinceInput">Since the last key or command.</param>
        public static Answer Ask(bool wanted, bool done, bool listKnown, bool onScreen, bool moving, double secondsSinceInput)
        {
            if (done || !wanted) return Answer.Never;
            if (!listKnown || onScreen || moving || secondsSinceInput < QuietSeconds) return Answer.Later;
            return Answer.Now;
        }
    }
}
