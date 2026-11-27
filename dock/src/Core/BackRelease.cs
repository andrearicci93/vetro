namespace Launcher.Core
{
    /// <summary>
    /// Back (and Exit) close the launcher when the key comes up, not when it goes down (#284, reproduced on a Q80A over YouTube). Closed on
    /// the press, the launcher gave the keyboard focus back to the app under it while the key was still down; the compositor then handed
    /// that app the rest of Back, and YouTube left the video it was playing. Held until the release, the whole key stays with the launcher.
    /// The window's own release closes it; the kernel's release (read from the remote's node) only after a short grace, for a press that
    /// reached the launcher only through the node; and a release that never comes closes it after a limit.
    /// </summary>
    internal sealed class BackRelease
    {
        public const double KernelGraceSeconds = 0.15;
        public const double LimitSeconds = 1.5;
        private string _key;
        private double _since = -1, _kernelAt = -1, _lastKernelReleaseAt = -1;

        public bool Pending { get { return _key != null; } }

        public static bool Closes(string key) { return key == "XF86Back" || key == "Escape" || key == "XF86Exit"; }

        /// <summary>A key that would close the launcher. True: wait for its release (a repeat while waiting changes nothing).</summary>
        public bool Press(string key, double now)
        {
            if (!Closes(key)) return false;
            if (_key == null)
            {
                _key = key;
                _since = now;
                _kernelAt = (_lastKernelReleaseAt >= 0 && now >= _lastKernelReleaseAt && (now - _lastKernelReleaseAt) <= 0.05)
                    ? now
                    : -1;
            }
            return true;
        }

        /// <summary>The window's key up. True: close now.</summary>
        public bool WindowRelease(string key)
        {
            if (_key == null || !Closes(key)) return false;
            Cancel();
            return true;
        }

        /// <summary>The kernel reported the release on the remote's node; the window's copy may still be on its way.</summary>
        public void KernelRelease(double now)
        {
            _lastKernelReleaseAt = now;
            if (_key != null && _kernelAt < 0) _kernelAt = now;
        }

        /// <summary>True when the launcher should close without the window's release.</summary>
        public bool Due(double now)
        {
            return _key != null && ((_kernelAt >= 0 && now - _kernelAt >= KernelGraceSeconds) || now - _since >= LimitSeconds);
        }

        public void Cancel() { _key = null; _since = -1; _kernelAt = -1; _lastKernelReleaseAt = -1; }
    }
}
