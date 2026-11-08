using Launcher.Core;

namespace Launcher.Tests
{
    internal static class HomeCloseGuardTests
    {
        public static void Run()
        {
            T.Run("Home guard: cancel while any of three targets is closing", () =>
            {
                for (int selected = 0; selected < 3; selected++)
                {
                    var guard = new HomeCloseGuard(3); int launches = 0;
                    guard.Arm(0);
                    for (int target = 0; target <= selected; target++)
                    {
                        T.True(guard.TryBeginClose(.15), "all targets in the first round");
                        T.Eq(guard.TargetIndex, target, "target order");
                        if (target < selected) guard.CloseFinished();
                    }
                    guard.Release(() => launches++);
                    T.Eq(launches, 0, "selected Home waits for this target");
                    guard.CloseFinished();
                    T.Eq(launches, 1, "exactly one launch after completion");
                    T.True(!guard.TryBeginClose(10), "all remaining targets and rounds retired");
                }
            });

            T.Run("Home guard closes only during its scheduled burst", () =>
            {
                var guard = new HomeCloseGuard();
                T.True(!guard.NextDelay(0).HasValue, "idle guard has no timer");
                guard.Arm(0);
                T.Eq(guard.NextDelay(0).Value, 0.15, "first close waits for the TV");
                double[] times = { 0.15, 0.45, 0.9, 1.6, 2.8 };
                foreach (double at in times)
                {
                    T.True(!guard.TryBeginClose(at - 0.001), "does not close early at " + at);
                    T.True(guard.TryBeginClose(at), "closes at " + at);
                    T.True(!guard.TryBeginClose(at), "never overlaps a running close");
                    guard.CloseFinished();
                }
                T.True(!guard.NextDelay(3).HasValue, "no timer after the final close");
                T.True(!guard.TryBeginClose(60), "no closes while idle");
            });

            T.Run("Samsung Home selected quickly cancels every remaining close", () =>
            {
                double[] times = { 0.15, 0.45, 0.9, 1.6, 2.8 };
                // Select before the first close and after each possible completed close.
                for (int completed = 0; completed <= times.Length; completed++)
                {
                    var guard = new HomeCloseGuard();
                    int launches = 0;
                    guard.Arm(0);
                    for (int i = 0; i < completed; i++)
                    {
                        T.True(guard.TryBeginClose(times[i]), "preceding close starts");
                        guard.CloseFinished();
                    }
                    guard.Release(() => launches++);
                    T.Eq(launches, 1, "explicit Home launches without waiting for the rest of the burst");
                    foreach (double at in times)
                        T.True(!guard.TryBeginClose(at + 0.001), "newly opened Home cannot be closed by a pending retry");
                    T.True(!guard.NextDelay(4).HasValue, "release leaves no idle polling");
                }
            });

            T.Run("Samsung Home waits for a close already running", () =>
            {
                var guard = new HomeCloseGuard();
                int launches = 0;
                guard.Arm(0);
                T.True(guard.TryBeginClose(0.15), "close is in progress");
                guard.Release(() => launches++);
                T.Eq(launches, 0, "must not launch into an unfinished close command");
                T.True(guard.NextDelay(0.16).HasValue, "checks the running command without blocking input");
                T.True(!guard.TryBeginClose(4), "cancelled retries never start");
                guard.CloseFinished();
                T.Eq(launches, 1, "launch follows completion of the running close");
                guard.CloseFinished();
                T.Eq(launches, 1, "launch callback runs once");
                T.True(!guard.NextDelay(5).HasValue, "no timer after release completes");
            });

            T.Run("a new Home press supersedes a waiting Samsung Home launch", () =>
            {
                var guard = new HomeCloseGuard();
                int launches = 0;
                guard.Arm(0);
                guard.TryBeginClose(0.15);
                guard.Release(() => launches++);
                guard.Arm(1);
                T.True(!guard.TryBeginClose(1.15), "new press cannot overlap the previous close");
                guard.CloseFinished();
                T.Eq(launches, 0, "outdated request does not unexpectedly open Samsung Home");
                T.True(!guard.TryBeginClose(1.14), "new burst is timed from the new press");
                T.True(guard.TryBeginClose(1.15), "new Home press still suppresses Samsung Home");
                guard.CloseFinished();
                guard.Release(null);
                T.True(!guard.NextDelay(2).HasValue, "cancellation without a launch is supported");
            });

            T.Run("repeated Samsung Home selection retains only the latest request", () =>
            {
                var guard = new HomeCloseGuard();
                int first = 0, last = 0;
                guard.Arm(0);
                guard.TryBeginClose(0.15);
                guard.Release(() => first++);
                guard.Release(() => last++);
                guard.CloseFinished();
                T.Eq(first, 0, "superseded launch is discarded");
                T.Eq(last, 1, "latest launch occurs once");
            });
        }
    }
}
