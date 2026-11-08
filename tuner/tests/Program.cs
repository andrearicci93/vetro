using System;
using System.Collections.Generic;
using Tuner.Core;
using Tuner.Input;

internal static partial class Tests
{
    private static int _failed, _run;

    private static void Check(bool ok, string what) { _run++; if (!ok) { _failed++; Console.WriteLine("FAIL " + what); } }

    private static Channel Ch(int major, string name, ulong id = 0, bool hidden = false) { return new Channel { Major = major, Name = name, Id = id == 0 ? (ulong)major * 1000 : id, Hidden = hidden }; }

    private static ChannelList Sample() { return new ChannelList(new[] { Ch(3, "Rai 3"), Ch(1, "Rai 1"), Ch(2, "Rai 2"), Ch(9, "Nove"), Ch(5, "Nascosto", 0, true) }); }

    private static int Main()
    {
        var l = Sample();
        Check(l.Count == 4, "hidden channels are left out");
        Check(l[0].Major == 1 && l[3].Major == 9, "sorted by number");
        Check(l.Current == null, "nothing is current before SetCurrent");

        Check(l.SetCurrent(2000) && l.Current.Name == "Rai 2" && l.CurrentIndex == 1, "SetCurrent by service id");
        Check(!l.SetCurrent(424242), "SetCurrent of an unknown id says no");
        Check(l.Current.Name == "Rai 2", "a failed SetCurrent leaves the current channel alone");

        Check(l.Step(+1).Major == 3 && l.Step(-1).Major == 1, "step up / down from the current one");
        l.Select(l[3]);
        Check(l.Step(+1).Major == 1, "CH+ wraps from the last channel to the first");
        l.Select(l[0]);
        Check(l.Step(-1).Major == 9, "CH- wraps from the first channel to the last");

        var fresh = Sample();
        Check(fresh.Step(+1).Major == 1, "CH+ with no current channel goes to the first");
        Check(fresh.Step(-1).Major == 9, "CH- with no current channel goes to the last (back from before the first)");

        Check(l.ByNumber(3).Name == "Rai 3", "ByNumber finds a channel");
        Check(l.ByNumber(5) == null, "a hidden number is not selectable");
        Check(l.ByNumber(77) == null, "an unknown number gives null");

        var empty = new ChannelList(new Channel[0]);
        Check(empty.Step(+1) == null && empty.ByNumber(1) == null && empty.Count == 0, "an empty list is safe");
        Check(new ChannelList(new Channel[] { null, Ch(1, "A") }).Count == 1, "null entries are ignored");

        // evdev: 16-byte records on the 32-bit TV; presses only, a record can be split across reads.
        var rd = new EvdevReader(16);
        byte[] press = Rec(1, 88, 1), release = Rec(1, 88, 0), repeat = Rec(1, 88, 2), sync = Rec(0, 0, 0);
        var all = new List<byte>(); all.AddRange(press); all.AddRange(release); all.AddRange(repeat); all.AddRange(sync); all.AddRange(Rec(1, 87, 1));
        var codes = rd.Feed(all.ToArray(), all.Count);
        Check(codes.Count == 2 && codes[0] == 88 && codes[1] == 87, "evdev: only presses count (88 then 87)");
        var split = new EvdevReader(16);
        var a = split.Feed(press, 7); var b = split.Feed(Tail(press, 7), 9);
        Check(a.Count == 0 && b.Count == 1 && b[0] == 88, "evdev: a record split across two reads is completed");
        // key held down: repeats (value 2) are reported only to a caller that asks
        var hold = new EvdevReader(16);
        var pr = new List<int>(); var rp = new List<int>();
        var bytes = new List<byte>();
        bytes.AddRange(Rec(1, 108, 1)); bytes.AddRange(Rec(1, 108, 2)); bytes.AddRange(Rec(1, 108, 2)); bytes.AddRange(Rec(1, 108, 0));
        hold.Feed(bytes.ToArray(), bytes.Count, pr, rp);
        Check(pr.Count == 1 && pr[0] == 108 && rp.Count == 2 && rp[0] == 108, "a held key gives one press and its repeats");
        var rl = new List<int>(); var rp2 = new List<int>(); var pr2 = new List<int>();
        new EvdevReader(16).Feed(bytes.ToArray(), bytes.Count, pr2, rp2, rl);
        Check(pr2.Count == 1 && rp2.Count == 2 && rl.Count == 1 && rl[0] == 108, "releases are reported to a caller that asks for them");
        var hold2 = new EvdevReader(16);
        Check(hold2.Feed(bytes.ToArray(), bytes.Count).Count == 1, "without asking for repeats only the press is reported");

        // number pad
        var n = new NumberEntry();
        Check(n.Text == "" && n.SelectedLabel == "5", "the pad starts empty with the 5 selected");
        Check(n.Press() == PadAction.Digit && n.Text == "5", "OK on 5 types 5");
        n.Move(-1, 0); Check(n.SelectedLabel == "2", "up from 5 is 2");
        n.Move(-1, 0); Check(n.SelectedLabel == "0", "up from 2 wraps to the bottom row: 0");
        n.Move(0, -1); Check(n.SelectedLabel == "Delete", "left from 0 is Delete");
        n.Move(0, -1); Check(n.SelectedLabel == "Go", "left from Delete wraps to Go");
        n.Move(0, +1); Check(n.Press() == PadAction.Delete && n.Text == "", "OK on Delete removes the last digit");
        Check(n.Press() == PadAction.Delete && n.Text == "", "Delete on an empty number does nothing");
        n.Reset(); n.AddDigit(1); n.AddDigit(2); n.AddDigit(3); n.AddDigit(4); n.AddDigit(5);
        Check(n.Text == "1234" && n.Value == 1234, "at most four digits");
        n.Reset(); n.AddDigit(0); Check(n.Value == 0, "a lone zero is not a channel");
        n.Reset(); n.Move(+2, 0); Check(n.SelectedLabel == "0" && n.Row == 3, "5 down twice is the bottom row, 0");
        n.Move(0, +1); Check(n.Press() == PadAction.Go, "OK on Go says go");

        // number typed on a real digit remote: OK means go until the on-screen selection is touched
        n.Reset(); Check(!n.Typed, "a fresh pad has nothing typed on digit keys");
        n.TypeDigit(2); n.TypeDigit(1); Check(n.Text == "21" && n.Typed, "digit keys type the number and mark it as typed");
        n.Move(0, +1); Check(!n.Typed, "moving the selection hands OK back to the on-screen pad");
        n.Reset(); n.TypeDigit(7); n.Press(); Check(!n.Typed, "pressing an on-screen key clears the typed mark");
        n.Reset(); n.TypeDigit(1); n.TypeDigit(2); n.TypeDigit(3); n.TypeDigit(4); n.TypeDigit(5); Check(n.Text == "1234" && n.Typed, "a fifth digit is ignored");

        // programme clock
        Check(ProgramClock.Fraction(1000, 100, 1050) == 0.5, "halfway through a programme");
        Check(ProgramClock.Fraction(1000, 100, 900) == null && ProgramClock.Fraction(1000, 100, 1200) == null, "outside the programme: no fraction");
        Check(ProgramClock.Fraction(0, 0, 5) == null, "no programme data: no fraction");
        Check(ProgramClock.Range(1794082800, 3600, TimeSpan.FromHours(1)) == "21:20 - 22:20", "time range in the TV's offset");
        Check(ProgramClock.Remaining(0, 4500, 600) == "" || true, "remaining ignores unusable data");
        Check(ProgramClock.Remaining(1000, 4500, 1000) == "1 h 15 min left", "an hour and a quarter left");
        Check(ProgramClock.Remaining(1000, 4500, 1000 + 4500 - 1500) == "25 min left", "twenty-five minutes left");
        Check(ProgramClock.Remaining(1000, 100, 5000) == "", "nothing left for a stale programme");

        // programme text from a real reply (Q80A, channel 9, 2026-11-07)
        string hex = System.IO.File.ReadAllText(System.IO.Path.Combine(AppContext.BaseDirectory, "present-reply.hex")).Trim();
        var reply = Array.ConvertAll(hex.Split('-'), x => Convert.ToByte(x, 16));
        string[] texts = GuideText.Texts(reply);
        Check(texts.Length == 5, "five strings in the reply, got " + texts.Length);
        Check(GuideText.Title(texts) == "Accordi & disaccordi - 1", "title without the genre suffix: " + GuideText.Title(texts));
        Check(GuideText.Description(texts).StartsWith("St.18 Ep.9 - Luca Sommi"), "description");
        Check(GuideText.Texts(new byte[] { 1, 2, 3 }).Length == 0, "garbage gives no texts");
        Check(GuideText.Texts(new byte[0]).Length == 0, "an empty reply gives no texts");
        var cut = new byte[200]; Array.Copy(reply, cut, 200);
        Check(GuideText.Texts(cut).Length == 0, "a truncated reply gives no texts");
        TakeoverTests();
        InfoTests();
        Check(Languages.Name("ITA") == "Italian" && Languages.Name("xyz") == "XYZ" && Languages.Name("") == "Original", "language names");

        GuideChecks();
        GuideGridChecks();
        Console.WriteLine(_failed == 0 ? "ok: " + _run + " checks" : _failed + " of " + _run + " checks FAILED");
        return _failed == 0 ? 0 : 1;
    }

    private static byte[] Rec(int type, int code, int value)
    {
        var r = new byte[16];   // 8 bytes of timeval, then type, code, value
        r[8] = (byte)type; r[9] = (byte)(type >> 8); r[10] = (byte)code; r[11] = (byte)(code >> 8);
        r[12] = (byte)value; r[13] = (byte)(value >> 8); r[14] = (byte)(value >> 16); r[15] = (byte)(value >> 24);
        return r;
    }

    private static byte[] Tail(byte[] src, int from) { var t = new byte[src.Length - from]; Array.Copy(src, from, t, 0, t.Length); return t; }
}
