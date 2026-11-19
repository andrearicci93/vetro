namespace Launcher.Core
{
    /// <summary>
    /// How a key is passed on with input_keyevent from the main loop (a Vol key when the sound goes to a receiver). The tool is only known
    /// on 2021 firmware, so a call waits for it until one has answered 0: its exit code says whether the key went through, and when it did
    /// not the caller changes the TV's level itself. Once the tool has worked, later calls start it in the background: a held Vol repeats
    /// several times a second, and waiting each time for a shell and the tool held the frames of the volume bar.
    /// </summary>
    internal sealed class KeyToolRun
    {
        /// <summary>Appended to a call started in the background (the form ListWatch uses): nothing is waited for or written.</summary>
        public const string Detach = " >/dev/null 2>&1 &";

        private bool _works;

        /// <summary>A call has answered 0 while it was waited for: the next ones go to the background.</summary>
        public bool Works { get { return _works; } }

        /// <summary>The shell line for <paramref name="line"/> (the tool and its key): waited for until the tool has worked once.</summary>
        public string Command(string line) { return _works ? line + Detach : line; }

        /// <summary>
        /// The exit code of the line <see cref="Command"/> gave (<paramref name="detached"/>: it was the background form). True when the key
        /// went through: a 0. In the background a 0 only says the shell started (and a failed start still falls back).
        /// </summary>
        public bool Passed(int rc, bool detached)
        {
            if (rc == 0 && !detached) _works = true;
            return rc == 0;
        }
    }
}
