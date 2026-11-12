namespace Tuner.Core
{
    /// <summary>
    /// Which app has the keyboard focus, as the window manager says, sorted for the takeover. The application manager's status of Samsung's
    /// live TV app (focus or visible) does not say that the app is the one in front: an app that came in front with see-through parts may
    /// leave it "visible". The window manager's focused process does. Pure logic: the reading is done on a thread of its own (Program.cs).
    /// </summary>
    internal static class FrontApp
    {
        public enum Kind
        {
            /// <summary>Not known: no reading, a stale or failed one, or a window that is not an app's (the launcher and its osd 123).</summary>
            Unknown,
            /// <summary>The tuner's own window has the keys.</summary>
            Own,
            /// <summary>Samsung's live TV app itself has the keys.</summary>
            Tv,
            /// <summary>Another app is in front (YouTube, Netflix, Samsung's Home, a Samsung panel that is an app).</summary>
            Other
        }

        /// <summary>A reading older than this is not trusted (the reading thread is stuck, or the call stopped answering).</summary>
        public const double StaleSeconds = 2.0;

        /// <param name="ok">The reading succeeded and named a process.</param>
        /// <param name="pid">The focused process.</param>
        /// <param name="appId">Its app id; null when the process is not an app.</param>
        /// <param name="ageSeconds">How old the reading is.</param>
        /// <param name="ownPid">The tuner's own pid.</param>
        /// <param name="target">Samsung's live TV app id.</param>
        public static Kind Judge(bool ok, int pid, string appId, double ageSeconds, int ownPid, string target)
        {
            if (!ok || pid <= 0 || ageSeconds < 0 || ageSeconds > StaleSeconds) return Kind.Unknown;
            if (pid == ownPid) return Kind.Own;
            if (string.IsNullOrEmpty(appId)) return Kind.Unknown;
            return appId == target ? Kind.Tv : Kind.Other;
        }
    }
}
