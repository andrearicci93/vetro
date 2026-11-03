using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using Launcher.Core;
using Launcher.Native;

internal static class Program
{
    [DllImport("libecore.so.1")] private static extern int ecore_init();
    [DllImport("libecore.so.1")] private static extern int ecore_shutdown();
    [DllImport("libecore.so.1")] private static extern int ecore_main_loop_iterate_may_block(int mayBlock);
    private static string _directory;
    private static double Now { get { return Efl.ecore_time_get(); } }
    private static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    private static void Pump() { ecore_main_loop_iterate_may_block(0); Thread.Sleep(2); }
    private static void Until(Func<bool> done, string message, double seconds = 5)
    {
        double deadline = Now + seconds;
        while (!done()) { Check(Now < deadline, message); Pump(); }
    }
    private static string Marker(string name, string letter, string delay = "0.025")
    {
        // The directory and fixture names contain no shell metacharacters.
        return "exec /bin/sh -c 'sleep " + delay + "; printf " + letter + " >> " + _directory + "/" + name + "'";
    }
    private static string Read(string name)
    {
        string path = Path.Combine(_directory, name);
        return File.Exists(path) ? File.ReadAllText(path) : "";
    }
    private static ChildExit Complete(EcoreChildProcess child)
    {
        Until(() => !child.IsRunning, "Ecore did not deliver the real child exit");
        ChildExit result;
        Check(child.TryTakeExit(out result), "Exit must be consumable exactly once");
        Check(!child.TryTakeExit(out _), "Exit must not be replayed");
        return result;
    }

    private static void RepeatedHome()
    {
        var guard = new HomeCloseGuard();
        using (var child = new EcoreChildProcess())
        {
            for (int press = 0; press < 2; press++)
            {
                guard.Arm(Now);
                int closes = 0;
                Until(() => {
                    ChildExit result;
                    if (child.TryTakeExit(out result))
                    {
                        Check(result.Code == 0 && result.Signal == 0, "Close fixture succeeded");
                        closes++;
                        guard.CloseFinished();
                    }
                    if (guard.TryBeginClose(Now)) child.Start(Marker("repeated", "C"));
                    return !guard.NextDelay(Now).HasValue && !child.IsRunning;
                }, "First and second Home bursts must both finish", 6);
                Check(closes == 5, "Every Home burst must run all five closes");
                Check(Read("repeated").Length == (press + 1) * 5, "Commands really executed on both presses");
            }
        }
    }

    private static void ExplicitHomeDuringClose()
    {
        var guard = new HomeCloseGuard();
        using (var child = new EcoreChildProcess())
        {
            guard.Arm(Now - 0.2);
            Check(guard.TryBeginClose(Now), "First close starts");
            child.Start(Marker("explicit", "C", "0.12"));
            double selected = Now;
            bool launched = false;
            guard.Release(() => {
                Check(Read("explicit") == "C", "Actual close must finish before launching Home");
                launched = true;
                child.Start(Marker("explicit", "H"));
            });
            Check(!launched, "In-flight close cannot be bypassed");
            Check(Complete(child).Code == 0, "Close succeeded");
            guard.CloseFinished();
            Check(launched, "Selection is released by the real exit event");
            Check(Complete(child).Code == 0, "Explicit launch succeeded");
            Check(Read("explicit") == "CH", "Close then launch, exactly once");
            Check(Now - selected < 2, "Selection must not wait for the 2.8-second burst");
            Check(!guard.NextDelay(Now).HasValue && !guard.TryBeginClose(Now + 5), "No delayed close can kill explicitly opened Home");
        }
    }

    private static void NewPressWhileClosing()
    {
        var guard = new HomeCloseGuard();
        using (var child = new EcoreChildProcess())
        {
            guard.Arm(Now - 0.2);
            Check(guard.TryBeginClose(Now), "Close starts");
            child.Start(Marker("new-press", "A", "0.08"));
            bool staleLaunch = false;
            guard.Release(() => staleLaunch = true);
            guard.Arm(Now);
            Check(!guard.TryBeginClose(Now + 1), "A new press cannot overlap the actual running command");
            Check(Complete(child).Code == 0, "Initial close completed");
            guard.CloseFinished();
            Check(!staleLaunch, "The new press supersedes a queued explicit launch");
            Until(() => guard.TryBeginClose(Now), "New burst should become ready");
            child.Start(Marker("new-press", "B"));
            Complete(child);
            guard.CloseFinished();
            guard.Release(null);
            Check(Read("new-press") == "AB", "Next press is not stuck behind the prior child's completion");
        }
    }

    private static void ExitStatusAndOwnership()
    {
        using (var child = new EcoreChildProcess())
        {
            child.Start("exec /bin/sh -c 'exit 7'");
            int pid = child.Pid;
            Check(pid > 0, "A real child PID is returned");
            Check(Efl.ecore_exe_run("/bin/true", IntPtr.Zero) != IntPtr.Zero, "Unrelated Ecore child starts");
            ChildExit failed = Complete(child);
            Check(failed.Pid == pid && failed.Code == 7 && failed.Signal == 0, "Read the correct process and exit status");
            child.Start("/bin/sleep 10");
            child.Kill();
            Check(child.IsRunning, "Sending a kill is not proof of exit");
            ChildExit killed = Complete(child);
            Check(killed.Signal == 9, "Ecore reports the actual termination signal");
            child.Start(Marker("after-kill", "K"));
            Check(Complete(child).Code == 0 && Read("after-kill") == "K", "A later command still completes");
        }
    }

    private static int Main()
    {
        _directory = Path.Combine(Path.GetTempPath(), "vetro-ecore-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_directory);
        try
        {
            Check(ecore_init() > 0, "Ecore initialized without a display");
            RepeatedHome(); Console.WriteLine("PASS: first and second Home bursts execute all real commands");
            ExplicitHomeDuringClose(); Console.WriteLine("PASS: explicit Home follows actual close, cancels remaining attempts");
            NewPressWhileClosing(); Console.WriteLine("PASS: new Home press during a close starts a fresh burst");
            ExitStatusAndOwnership(); Console.WriteLine("PASS: exit codes, unrelated children, and termination preserve ownership");
            Console.WriteLine("4 Ecore native process suites passed");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        finally { ecore_shutdown(); Directory.Delete(_directory, true); }
    }
}
