using Launcher.Core;

namespace Launcher.Tests
{
    internal static class HomeKeyTests
    {
        public static void Run()
        {
            T.Run("Home: raw first, including delayed firmware echo", () => {
                var h = new HomeKeyHandler();
                T.Eq(h.FromEvdev(1, false), HomeKeyAction.Show, "immediate raw press");
                T.Eq(h.FromWindow(1.02, true), HomeKeyAction.None, "immediate echo");
                T.Eq(h.FromWindow(1.6, true), HomeKeyAction.None, "0.6-second firmware echo");
                T.Eq(h.FromWindow(2.49, true), HomeKeyAction.None, "retain 1.5-second protection");
            });
            T.Run("Home: window first and its later raw copy", () => {
                var h = new HomeKeyHandler();
                T.Eq(h.FromWindow(1, true), HomeKeyAction.Hide, "window first");
                T.Eq(h.FromEvdev(1.02, false), HomeKeyAction.None, "same press does not reopen");
                T.Eq(h.FromWindow(1.62, true), HomeKeyAction.None, "late echo cannot close a reopened dock");
            });
            T.Run("Home: duplicate window delivery after an external reopen", () => {
                var h = new HomeKeyHandler();
                T.Eq(h.FromWindow(1, true), HomeKeyAction.Hide, "first event");
                T.Eq(h.FromWindow(1.04, true), HomeKeyAction.None, "duplicate cannot undo FIFO reopen");
                T.Eq(h.FromWindow(2, false), HomeKeyAction.None, "hidden window does not consume a press");
                T.Eq(h.FromEvdev(2.02, false), HomeKeyAction.Show, "next physical press survives");
            });
            T.Run("Home: genuine second raw press within the echo window", () => {
                var h = new HomeKeyHandler();
                h.FromEvdev(1, false);
                T.Eq(h.FromEvdev(1.45, true), HomeKeyAction.Hide, "echo suppression never blocks another raw press");
                T.Eq(h.FromWindow(2.05, true), HomeKeyAction.None, "second press echo");
            });
            T.Run("Home: first press after long idle and compositor-only fallback", () => {
                var h = new HomeKeyHandler();
                T.Eq(h.FromEvdev(3600, false), HomeKeyAction.Show, "long idle");
                T.Eq(h.FromWindow(3602, true), HomeKeyAction.Hide, "window-only Home remains supported");
            });
        }
    }
}
