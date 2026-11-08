using System.Collections.Generic;
using Tuner.Core;

internal static partial class Tests
{
    private static void TakeoverTests()
    {
        // The app comes up: show once; once shown, nothing more to do.
        var t = new Takeover();
        Check(!t.Observe(4, false), "takeover: an app in the background does not bring the tuner");
        Check(!t.Observe(7, false), "takeover: an app that is not running does not bring the tuner");
        Check(t.Observe(2, false), "takeover: the app in focus brings the tuner");
        Check(!t.Observe(3, true), "takeover: nothing to show while the tuner is on screen (the tuner took the focus: visible)");
        Check(!t.Observe(2, true), "takeover: still nothing to show");

        // Sent away with Back while the app stays up: stays away.
        t.Dismissed();
        Check(!t.Observe(2, false) && !t.Observe(3, false) && !t.Observe(2, false), "takeover: Back is not undone by the next polls");
        // The app leaves (Home opened another app) and returns: the tuner comes back.
        Check(!t.Observe(4, false), "takeover: the app went to the background");
        Check(t.Observe(2, false), "takeover: the app returned, the tuner shows again");

        // First poll after a start with the app already up (the TV woke on live TV).
        var boot = new Takeover();
        Check(boot.Observe(3, false), "takeover: visible at the first poll counts as up");
        Check(boot.Observe(2, false), "takeover: still asked while it has not been shown");

        // Failed readings: one or two change nothing, four in a row mean the app is gone.
        var u = new Takeover();
        u.Observe(2, true); u.Dismissed();
        Check(!u.Observe(-1, false) && !u.Observe(-1, false) && !u.Observe(-1, false), "takeover: failed readings do not show the tuner");
        Check(!u.Observe(3, false), "takeover: a good reading after three failures keeps the tuner away (still dismissed)");
        var gone = new Takeover();
        gone.Observe(2, true); gone.Dismissed();
        for (int i = 0; i < Takeover.UnreadableLimit; i++) gone.Observe(-1, false);
        Check(gone.Observe(2, false), "takeover: after enough failed readings the app counts as gone, so its return shows the tuner");
        Check(!Takeover.IsUp(0) && !Takeover.IsUp(1) && !Takeover.IsUp(4) && !Takeover.IsUp(5) && !Takeover.IsUp(8) && Takeover.IsUp(2) && Takeover.IsUp(3), "takeover: only focus and visible count as up");

        // Version folders of Samsung's client.
        var names = ClientFolders.NewestFirst(new[] { "1.1.12", "1.0.3", "1.10.0", "latest", "", "a/b", "2.0" });
        Check(string.Join(",", names) == "2.0,1.10.0,1.1.12,1.0.3", "client folders: newest first, numeric not alphabetic, junk ignored: " + string.Join(",", names));
        Check(ClientFolders.NewestFirst(new string[0]).Count == 0, "client folders: none");
    }
}
