namespace Launcher.Core
{
    internal enum HomeKeyAction { None, Show, Hide }

    // One owner for the raw press and its compositor copies. Keep the longer
    // firmware echo window independently of the short duplicate-event debounce.
    internal sealed class HomeKeyHandler
    {
        private double _lastHome = double.NegativeInfinity;
        private double _lastRaw = double.NegativeInfinity;

        public HomeKeyAction FromEvdev(double now, bool active)
        {
            // Even a raw copy delivered after the window event can have a later echo.
            _lastRaw = now;
            return Accept(now, active);
        }

        public HomeKeyAction FromWindow(double now, bool active)
        {
            if (!active || now - _lastRaw < 1.5) return HomeKeyAction.None;
            return Accept(now, true);
        }

        private HomeKeyAction Accept(double now, bool active)
        {
            if (now - _lastHome < 0.35) return HomeKeyAction.None;
            _lastHome = now;
            return active ? HomeKeyAction.Hide : HomeKeyAction.Show;
        }
    }
}
