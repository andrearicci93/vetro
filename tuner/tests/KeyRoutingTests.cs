using System;
using Tuner.Core;

// Who owns a key of the remote: the tuner's window focus (KeyGate), the launcher's windows (OverlayFlag), the app in front (FrontApp),
// the TV's input and the launcher closing (Takeover: Poll with input and front, Resume, Reclaim).
internal static partial class Tests
{
    private static void KeyRoutingTests()
    {
        // ---- KeyGate ----
        var g = new KeyGate();
        g.Shown(10.0);
        Check(g.Accepts(10.1) && g.Accepts(99.0), "gate: a window that never reported the focus is not gated (old behaviour)");
        Check(!g.Sample(false), "gate: no change while it still says no focus");
        Check(g.Sample(true) && g.Learned && g.Accepts(10.2), "gate: the focus reported, keys are ours");
        Check(g.Sample(false) && !g.Accepts(10.3), "gate: focus gone to another window (an app, Samsung's pad): the key is not ours");
        Check(!g.Accepts(10.0 + KeyGate.GraceSeconds - 0.1), "gate: the grace is for a focus on its way, not for one that came and went");
        g.Hidden();
        Check(!g.Accepts(11.0), "gate: hidden and learned, nothing is accepted without the focus");
        g.Shown(20.0);
        Check(g.Accepts(20.1) && g.Accepts(20.0 + KeyGate.GraceSeconds - 0.01), "gate: just shown, the keys are ours while the focus is on its way");
        Check(!g.Accepts(20.0 + KeyGate.GraceSeconds + 0.01), "gate: the focus never came: the keys went to another window");
        g.Sample(true);
        Check(g.Accepts(25.0), "gate: the focus came later: ours again");
        g.Sample(false); g.Shown(30.0);
        Check(g.Accepts(30.2), "gate: a new show gives a new grace");

        // ---- OverlayFlag ----
        DateTime now = new DateTime(2026, 11, 12, 12, 0, 0, DateTimeKind.Utc);
        Func<int, bool> alive = pid => pid == 4242;
        Check(OverlayFlag.Judge("4242", now.AddSeconds(-3), now, 20, alive), "flag: fresh with its launcher alive");
        Check(!OverlayFlag.Judge("4242", now.AddSeconds(-21), now, 20, alive), "flag: older than the window's idle time is a leftover");
        Check(!OverlayFlag.Judge("777", now.AddSeconds(-1), now, 20, alive), "flag: its launcher is dead (killed with the window open): the tuner is not left deaf");
        Check(OverlayFlag.Judge("1", now.AddSeconds(-1), now, 20, alive), "flag: an older launcher wrote 1: judged by its age alone");
        Check(OverlayFlag.Judge("", now.AddSeconds(-1), now, 20, alive) && OverlayFlag.Judge(null, now, now, 20, alive), "flag: no pid, by age");
        Check(!OverlayFlag.Fresh("/nonexistent/vetro-flag", 20), "flag: a missing file is not fresh");
        string own = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "vetro-flag-own-" + System.Diagnostics.Process.GetCurrentProcess().Id);
        System.IO.File.WriteAllText(own, System.Diagnostics.Process.GetCurrentProcess().Id.ToString());
        Check(OverlayFlag.Fresh(own, 20), "flag: written now by a live process (this one) is fresh, with /proc (TV) or without (preview on a Mac)");
        System.IO.File.Delete(own);

        // ---- FrontApp ----
        const string tv = "org.tizen.tv-viewer";
        Check(FrontApp.Judge(true, 100, tv, 0.3, 50, tv) == FrontApp.Kind.Tv, "front: Samsung's app has the keys");
        Check(FrontApp.Judge(true, 50, null, 0.3, 50, tv) == FrontApp.Kind.Own, "front: the tuner's own window");
        Check(FrontApp.Judge(true, 101, "com.samsung.tv.cobalt-yt", 0.3, 50, tv) == FrontApp.Kind.Other, "front: YouTube has the keys");
        Check(FrontApp.Judge(true, 102, null, 0.3, 50, tv) == FrontApp.Kind.Unknown, "front: a window that is not an app (the launcher) is not known");
        Check(FrontApp.Judge(false, 0, null, 0.3, 50, tv) == FrontApp.Kind.Unknown, "front: a failed reading is not known");
        Check(FrontApp.Judge(true, 101, "com.samsung.tv.cobalt-yt", FrontApp.StaleSeconds + 0.1, 50, tv) == FrontApp.Kind.Unknown, "front: a stale reading is not trusted");

        // ---- Takeover: another app has the keys while Samsung's app is still "visible" (YouTube with see-through parts) ----
        var yt = new Takeover();
        Check(yt.Poll(3, false, true, FrontApp.Kind.Other) == Takeover.Step.None, "front: visible, but YouTube has the keys: the tuner does not pop up over it");
        Check(yt.Poll(2, false, true, FrontApp.Kind.Other) == Takeover.Step.None, "front: even with focus status, the window manager decides");
        Check(yt.Poll(2, false, true, FrontApp.Kind.Tv) == Takeover.Step.Show, "front: back on live TV the tuner shows");
        Check(yt.Poll(3, false, true, FrontApp.Kind.Unknown) == Takeover.Step.Show, "front: not known: the status decides, as before");
        Check(!new Takeover().KeyWake(2, true, FrontApp.Kind.Other), "front: CH+ over another app that has the keys does not wake the tuner");
        Check(new Takeover().KeyWake(2, true, FrontApp.Kind.Tv) && new Takeover().KeyWake(3, true, FrontApp.Kind.Unknown), "front: CH+ on live TV wakes it");

        // ---- Takeover: the TV's input ----
        var hdmi = new Takeover();
        Check(hdmi.Poll(2, false, false, FrontApp.Kind.Tv) == Takeover.Step.None, "input: Samsung's app on HDMI is not live TV: no show");
        Check(!hdmi.KeyWake(2, false, FrontApp.Kind.Tv), "input: CH+ on HDMI (passed to the device by HDMI-CEC) does not wake the tuner");
        var cec = new Takeover();
        cec.Poll(2, true, true, FrontApp.Kind.Own);
        Check(cec.Poll(2, true, false, FrontApp.Kind.Own) == Takeover.Step.None && cec.Poll(2, true, false, FrontApp.Kind.Own) == Takeover.Step.Hide,
            "input: a console switching the TV to HDMI (CEC) while the tuner is on screen: it steps aside after two polls");
        Check(cec.Poll(2, false, true, FrontApp.Kind.Tv) == Takeover.Step.Show, "input: back on the TV input, the tuner shows again");
        var home = new Takeover();
        home.Poll(2, true, true, FrontApp.Kind.Own); home.Dismissed();
        Check(home.Poll(2, false, false, FrontApp.Kind.Tv) == Takeover.Step.None && home.Poll(2, false, true, FrontApp.Kind.Tv) == Takeover.Step.Show,
            "input: Home, HDMI chosen in the launcher, then TV again: the hold ends with the input change");

        // ---- Takeover: Resume after the launcher closed ----
        var r = new Takeover();
        r.Poll(2, true, true, FrontApp.Kind.Own); r.Dismissed();                     // Home opened the launcher
        Check(r.Held && r.Poll(2, false, true, FrontApp.Kind.Unknown) == Takeover.Step.None, "resume: while the launcher is open the tuner stays away");
        Check(r.Resume(2, true, FrontApp.Kind.Unknown) && !r.Held, "resume: Back closed the launcher on live TV: the tuner comes back");
        var r2 = new Takeover();
        r2.Dismissed();
        Check(!r2.Resume(4, true, FrontApp.Kind.Other) && r2.Held, "resume: the launcher opened an app: nothing to resume");
        Check(!r2.Resume(2, true, FrontApp.Kind.Other), "resume: an app already has the keys: not shown now");
        // Home, Home again: the second Home also starts Samsung's Home, which the launcher's guard closes again; it may have the keys at the moment
        // the launcher says it closed. The hold still ends, and the next poll shows the tuner once Samsung's Home is gone.
        var hh = new Takeover();
        hh.Poll(2, true, true, FrontApp.Kind.Own); hh.Dismissed();
        Check(!hh.Resume(2, true, FrontApp.Kind.Other) && !hh.Held, "resume: Samsung's Home flashing at that moment: not shown, but no longer held");
        Check(hh.Poll(2, false, true, FrontApp.Kind.Other) == Takeover.Step.None && hh.Poll(2, false, true, FrontApp.Kind.Tv) == Takeover.Step.Show,
            "resume: once Samsung's Home is gone the poll shows the tuner");
        Check(!r2.Resume(2, false, FrontApp.Kind.Tv), "resume: the launcher switched to HDMI");
        Check(!r2.Resume(-1, true, FrontApp.Kind.Unknown), "resume: an unreadable status is not live TV");

        // ---- Takeover: Reclaim (on screen, Samsung's app holds the keys) ----
        var c = new Takeover();
        c.Poll(2, true, true, FrontApp.Kind.Own);
        Check(c.Poll(2, true, true, FrontApp.Kind.Tv) == Takeover.Step.None, "reclaim: one poll is not enough");
        Check(c.Poll(2, true, true, FrontApp.Kind.Tv) == Takeover.Step.Reclaim, "reclaim: two polls with Samsung's app holding the keys: ask for them back");
        bool again = false;
        for (int i = 0; i < Takeover.ReclaimEvery - 1; i++) again |= c.Poll(2, true, true, FrontApp.Kind.Tv) == Takeover.Step.Reclaim;
        Check(!again, "reclaim: never twice within " + Takeover.ReclaimEvery + " polls: it cannot fight a window");
        Check(c.Poll(2, true, true, FrontApp.Kind.Tv) == Takeover.Step.Reclaim, "reclaim: asked again after the pause when nothing changed");
        var c2 = new Takeover();
        c2.Poll(2, true, true, FrontApp.Kind.Own);
        Check(c2.Poll(2, true, true, FrontApp.Kind.Other) == Takeover.Step.None && c2.Poll(2, true, true, FrontApp.Kind.Other) == Takeover.Step.None,
            "reclaim: another app (Samsung's 123 pad, a popup) has the keys: never taken from it");
        Check(c2.Poll(2, true, true, FrontApp.Kind.Unknown) == Takeover.Step.None && c2.Poll(2, true, true, FrontApp.Kind.Unknown) == Takeover.Step.None,
            "reclaim: the launcher (not an app) has the keys: never taken from it");
        Check(c2.Poll(2, true, true, FrontApp.Kind.Tv) == Takeover.Step.None, "reclaim: the count starts again after another window");
    }
}

internal static partial class Tests
{
    private static void KeyRoutingTests2()
    {
        // Home with Samsung's Home as the launcher: Samsung's Home has the keys, then Back returns to live TV.
        var sh = new Takeover();
        sh.Poll(2, true, true, FrontApp.Kind.Own); sh.Dismissed();
        Check(sh.Poll(3, false, true, FrontApp.Kind.Other) == Takeover.Step.None && sh.Held, "held: one poll of another app holding the keys keeps the hold");
        Check(sh.Poll(3, false, true, FrontApp.Kind.Other) == Takeover.Step.None && !sh.Held, "held: two polls of Samsung's Home holding the keys end the hold");
        Check(sh.Poll(2, false, true, FrontApp.Kind.Tv) == Takeover.Step.Show, "held: back on live TV from Samsung's Home, the tuner shows");
        // Home with the Vetro launcher: the caller passes "not known" while the launcher is open, so a Samsung window flashing under it does not end the hold.
        var vl = new Takeover();
        vl.Poll(2, true, true, FrontApp.Kind.Own); vl.Dismissed();
        vl.Poll(2, false, true, FrontApp.Kind.Unknown); vl.Poll(2, false, true, FrontApp.Kind.Unknown);
        Check(vl.Held, "held: the launcher open (front not known) keeps the hold");
        Check(vl.Poll(2, false, true, FrontApp.Kind.Other) == Takeover.Step.None && vl.Poll(2, false, true, FrontApp.Kind.Tv) == Takeover.Step.None && vl.Held,
            "held: one poll of another app, then live TV again: still held (a flash is not leaving live TV)");
        // Teletext from the osd 123: the tuner steps aside (held) and Samsung's own app keeps the keys: it stays away.
        var tt = new Takeover();
        tt.Poll(2, true, true, FrontApp.Kind.Own); tt.Dismissed();
        bool shown = false;
        for (int i = 0; i < 6; i++) shown |= tt.Poll(2, false, true, FrontApp.Kind.Tv) == Takeover.Step.Show;
        Check(!shown && tt.Held, "held: teletext in Samsung's app (it keeps the keys): the tuner stays away until CH+/CH-");
    }
}

internal static partial class Tests
{
    private static void KeyRoutingTests3()
    {
        // On screen, and another app took the keys with Samsung's app still "visible" (YouTube opened by a remote key while the tuner was shown).
        var o = new Takeover();
        o.Poll(2, true, true, FrontApp.Kind.Own);
        bool early = false;
        for (int i = 0; i < Takeover.OtherLimit - 1; i++) early |= o.Poll(3, true, true, FrontApp.Kind.Other) != Takeover.Step.None;
        Check(!early, "other: a Samsung popup holding the keys for less than three seconds leaves the tuner on screen");
        Check(o.Poll(3, true, true, FrontApp.Kind.Other) == Takeover.Step.Hide, "other: another app holding the keys for three seconds: the tuner steps aside");
        Check(!o.Held && o.Poll(3, false, true, FrontApp.Kind.Other) == Takeover.Step.None, "other: not held, and never shown over that app");
        Check(o.Poll(2, false, true, FrontApp.Kind.Tv) == Takeover.Step.Show, "other: live TV has the keys again: the tuner is back");
        var o2 = new Takeover();
        o2.Poll(2, true, true, FrontApp.Kind.Own);
        for (int i = 0; i < Takeover.OtherLimit - 1; i++) o2.Poll(3, true, true, FrontApp.Kind.Other);
        Check(o2.Poll(2, true, true, FrontApp.Kind.Own) == Takeover.Step.None && o2.Poll(3, true, true, FrontApp.Kind.Other) == Takeover.Step.None,
            "other: the keys came back in between: the count starts again");

        // ---- Screensaver hold & !Ready() gate ----
        Check(Takeover.IsScreensaverApp("com.samsung.tv.spotlight-ss")
            && Takeover.IsScreensaverApp("com.samsung.tv.glscreensaver-launcher")
            && Takeover.IsScreensaverApp("org.tizen.rscm-screensaver")
            && Takeover.IsScreensaverApp("org.tizen.screen-saver")
            && Takeover.IsScreensaverApp("Default_Screensaver")
            && Takeover.IsScreensaverApp("DefaultScreensaver")
            && Takeover.IsScreensaverApp("/opt/usr/apps/com.samsung.tv.spotlight-ss/bin/spotlight-ss.dll"), "screensaver: matches Tizen 4-9 screensaver ids and paths");
        Check(!Takeover.IsScreensaverApp("org.tizen.tv-viewer")
            && !Takeover.IsScreensaverApp("com.samsung.tv.cobalt-yt")
            && !Takeover.IsScreensaverApp("")
            && !Takeover.IsScreensaverApp(null), "screensaver: rejects non-screensaver apps and empty/null");
        Check(Takeover.ReadBoolOrInt((out int b) => { b = 1; return true; }, (out int i) => { i = 0; return true; }), "screensaver: bool vconf true wins");
        Check(Takeover.ReadBoolOrInt((out int b) => { b = 0; return false; }, (out int i) => { i = 1; return true; }), "screensaver: falls back to int vconf");
        Check(!Takeover.ReadBoolOrInt((out int b) => { b = 0; return true; }, (out int i) => { i = 1; return true; }), "screensaver: bool vconf false stops without int fallback");
        Check(!Takeover.CanShow(false, false) && !Takeover.CanShow(true, true) && Takeover.CanShow(false, true), "ready: CanShow gates on !launcherOpen && ready");

        // Post-screensaver source_type == -1 preservation on antenna Live TV (S90C Tizen 9 spotlight-ss)
        bool postSs = false;
        postSs = Takeover.UpdatePostScreensaverTv(postSs, true, true, true, -1, false, 3, FrontApp.Kind.Other);
        Check(postSs && Takeover.EffectiveTvInput(-1, false, postSs), "screensaver: spotlight-ss over active Live TV arms postScreensaverTv across source=-1");
        for (int i = 0; i < 6; i++)
        {
            postSs = Takeover.UpdatePostScreensaverTv(postSs, false, true, true, -1, false, 2, FrontApp.Kind.Own);
            Check(postSs && Takeover.EffectiveTvInput(-1, false, postSs), "screensaver: post-exit source=-1 on Live TV stays EffectiveTvInput across AwayLimit+ polls");
        }
        postSs = Takeover.UpdatePostScreensaverTv(postSs, false, true, true, 0, false, 2, FrontApp.Kind.Own);
        Check(!postSs && Takeover.EffectiveTvInput(0, false, postSs), "screensaver: real source=0 clears postScreensaverTv cleanly");

        // Exiting screensaver into Netflix (FrontApp.Other or status=4) clears postScreensaverTv immediately
        bool postToApp = Takeover.UpdatePostScreensaverTv(false, true, true, true, -1, false, 3, FrontApp.Kind.Other);
        postToApp = Takeover.UpdatePostScreensaverTv(postToApp, false, true, false, -1, false, 3, FrontApp.Kind.Other);
        Check(!postToApp && !Takeover.EffectiveTvInput(-1, false, postToApp), "screensaver: exiting into FrontApp.Other clears postScreensaverTv immediately");

        // Entering screensaver from Samsung TV Plus (source=-1, tunerActive=false, tvUpMarked=false) or HDMI (source=13) NEVER arms postScreensaverTv
        bool fromTvPlus = Takeover.UpdatePostScreensaverTv(false, true, false, false, -1, false, 2, FrontApp.Kind.Other);
        Check(!fromTvPlus && !Takeover.EffectiveTvInput(-1, false, fromTvPlus), "screensaver: TV Plus before spotlight-ss never arms postScreensaverTv");
        bool fromHdmi = Takeover.UpdatePostScreensaverTv(false, true, false, false, 13, false, 2, FrontApp.Kind.Tv);
        Check(!fromHdmi && !Takeover.EffectiveTvInput(13, false, fromHdmi), "screensaver: HDMI never arms postScreensaverTv");

        // Default_Screensaver leaves frontApp on Tv while screensaver_on_off is True: must NEVER Reclaim (elm_win_raise kills screensaver!)
        var ssDef = new Takeover();
        ssDef.Poll(2, true, true, FrontApp.Kind.Own);
        bool defActed = false;
        for (int i = 0; i < 20; i++) defActed |= ssDef.Poll(2, true, true, FrontApp.Kind.Tv, true) != Takeover.Step.None;
        Check(!defActed, "screensaver: Default_Screensaver with front=Tv never triggers Reclaim");

        // spotlight-ss flips source_type to -1 (tvInput=false) and takes focus as FrontApp.Kind.Other for minutes:
        // must NEVER Hide/Deactivate during screensaver, and seamlessly keeps takeover state on return to live TV!
        var ssSpot = new Takeover();
        ssSpot.Poll(2, true, true, FrontApp.Kind.Own);
        bool spotActed = false;
        for (int i = 0; i < 24; i++) spotActed |= ssSpot.Poll(3, true, false, FrontApp.Kind.Other, true) != Takeover.Step.None;
        Check(!spotActed, "screensaver: spotlight-ss (tvInput=false, front=Other) never triggers Hide across 24 polls");
        // 1-poll transition gap as spotlight-ss exits (source_type still -1 for one poll) stays shown, then live TV reclaims focus
        Check(ssSpot.Poll(3, true, false, FrontApp.Kind.Tv, false) == Takeover.Step.None, "screensaver: 1-poll exit transition gap keeps tuner shown");
        Check(ssSpot.Poll(2, true, true, FrontApp.Kind.Tv, false) == Takeover.Step.None
            && ssSpot.Poll(2, true, true, FrontApp.Kind.Tv, false) == Takeover.Step.Reclaim,
            "screensaver: once back on live TV after screensaver exit, tuner reclaims focus cleanly");

        // If screensaver exits into another app (e.g. Netflix launched), preserved _seenUp still hides tuner after AwayLimit polls
        var ssToApp = new Takeover();
        ssToApp.Poll(2, true, true, FrontApp.Kind.Own);
        for (int i = 0; i < 10; i++) ssToApp.Poll(4, true, false, FrontApp.Kind.Other, true);
        Check(ssToApp.Poll(4, true, false, FrontApp.Kind.Other, false) == Takeover.Step.None
            && ssToApp.Poll(4, true, false, FrontApp.Kind.Other, false) == Takeover.Step.Hide,
            "screensaver: exiting screensaver into Netflix hides the tuner after AwayLimit polls");

        // Hidden tuner never shows over active screensaver, and dismissed hold is preserved across screensaver
        var ssHidden = new Takeover();
        Check(ssHidden.Poll(2, false, true, FrontApp.Kind.Tv, true) == Takeover.Step.None, "screensaver: hidden tuner never shows over active screensaver");
        Check(ssHidden.Poll(2, false, true, FrontApp.Kind.Tv, false) == Takeover.Step.Show, "screensaver: shows once screensaver ends on live TV");
        var ssHeld = new Takeover();
        ssHeld.Poll(2, true, true, FrontApp.Kind.Own); ssHeld.Dismissed();
        for (int i = 0; i < 10; i++) ssHeld.Poll(3, false, false, FrontApp.Kind.Other, true);
        Check(ssHeld.Held && !ssHeld.KeyWake(2, true, FrontApp.Kind.Tv, true), "screensaver: dismissed hold preserved and KeyWake ignored during screensaver");
        Check(!ssHeld.Resume(2, false, FrontApp.Kind.Tv, true) && ssHeld.Held, "screensaver: Resume on non-TV input during screensaver keeps hold");
        Check(!ssHeld.Resume(2, true, FrontApp.Kind.Tv, true) && !ssHeld.Held, "screensaver: Resume during screensaver lifts hold without raising over screensaver");
        Check(ssHeld.Poll(2, false, true, FrontApp.Kind.Tv, false) == Takeover.Step.Show, "screensaver: after Resume during screensaver, tuner shows once screensaver ends");
    }
}
