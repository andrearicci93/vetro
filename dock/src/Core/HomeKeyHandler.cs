namespace Launcher.Core
{
    internal enum HomeKeyAction { None, Show, Hide }

    /// <summary>
    /// Shares one debounce window between evdev and Evas: either can deliver the
    /// same Home press first. One instance serves both the apps and inputs pages.
    /// </summary>
    internal sealed class HomeKeyHandler
    {
        private const double DebounceSeconds = 0.35;
        private double _lastHome = double.NegativeInfinity;

        public HomeKeyAction FromEvdev(double now, bool active)
        {
            return Accept(now, active);
        }

        public HomeKeyAction FromWindow(double now, bool active)
        {
            // A queued event for a hidden window must not consume the next press.
            return active ? Accept(now, true) : HomeKeyAction.None;
        }

        private HomeKeyAction Accept(double now, bool active)
        {
            if (now - _lastHome < DebounceSeconds) return HomeKeyAction.None;
            _lastHome = now;
            return active ? HomeKeyAction.Hide : HomeKeyAction.Show;
        }
    }
}
