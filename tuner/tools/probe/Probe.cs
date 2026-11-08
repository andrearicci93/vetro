// Read-only probe of the TV service (tvs-daemon). Prints what the daemon says about the current source,
// the current channel and the first channels of the list. It changes nothing on the TV.
using System;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Threading;
using Tizen.TV.Broadcast.TVService;
using Tizen.TV.Broadcast.TVService.API.Interface;
using Tizen.TV.Broadcast.TVService.Types;

static class Probe
{
    static readonly string[] Dirs = { "/opt/usr/dotnet/Tizen.TV.Broadcast.TVService/1.1.12/", "/usr/apps/csapi-tv-tizenfx/shared/lib/", "/usr/share/dotnet.tizen/framework/" };
    const string Dll = "/opt/usr/dotnet/Tizen.TV.Broadcast.TVService/1.1.12/Tizen.TV.Broadcast.TVService.dll";

    static int Main(string[] args)
    {
        AppDomain.CurrentDomain.AssemblyResolve += (s, e) =>
        {
            string n = new AssemblyName(e.Name).Name + ".dll";
            foreach (var d in Dirs) { string p = d + n; if (System.IO.File.Exists(p)) return Assembly.LoadFrom(p); }
            return null;
        };
        try
        {
            // tunerprobe [N]            read-only: source, current channel, first N channels
            // tunerprobe tune <major>   WRITES: tunes the main screen to the channel with that number
            if (args.Length == 2 && args[0] == "tune") Tune(int.Parse(args[1]));
            else if (args.Length == 2 && args[0] == "listen") Events(0, 0, 0, int.Parse(args[1]));     // read-only: prints the tvs events, e.g. while the owner zaps with Samsung's UI
            else if (args.Length == 4 && args[0] == "signals") Events(int.Parse(args[1]), int.Parse(args[2]), int.Parse(args[3]), 0);
            else if (args.Length >= 2 && args[0] == "guide") Guide(int.Parse(args[1]));   // read-only: present program, audio/caption components, program list for a channel
            else if (args.Length >= 1 && args[0] == "schedule") Schedule(args);   // read-only: GetProgramList (code 1) with window values read from libtvs-dvbbase-guide; saves the raw replies
            else if (args.Length >= 1 && args[0] == "logos") Logos();   // read-only: LogoID / LogoVersion / IconRoute columns of the first channels
            else if (args.Length == 2 && args[0] == "rawpresent") RawPresent(int.Parse(args[1]));   // read-only: same call as GetPresentProgram, prints the reply bytes
            else if (args.Length == 4 && args[0] == "nd") { _nonDestructive = true; if (Environment.GetEnvironmentVariable("ND_CODE") != null) _ndCode = short.Parse(Environment.GetEnvironmentVariable("ND_CODE")); Events(int.Parse(args[1]), int.Parse(args[2]), int.Parse(args[3]), 0); }   // WRITES: same, but with SetServiceNonDestructive (function code 21) called by reflection   // WRITES: tunes from->to, rounds times, with the event timeline
            else if (args.Length == 4 && args[0] == "bench") Bench(int.Parse(args[1]), int.Parse(args[2]), int.Parse(args[3]));   // WRITES: from-major to-major rounds
            else Run(args.Length > 0 ? int.Parse(args[0]) : 15);
            return 0;
        }
        catch (Exception ex) { Console.WriteLine("EXC " + ex); return 1; }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static void Run(int max)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var api = TVServiceAPI.Instance();
        Console.WriteLine("connect ms=" + sw.ElapsedMilliseconds);

        using (var src = api.CreateSourceControl(Profile.Main, 0))
        {
            Source s = default;
            int r = src.GetCurrentSourceInfo(ref s);
            Console.WriteLine("source r=" + r + " source=" + s);
            SourceState st = default;
            r = src.GetSourceState(ref st);
            Console.WriteLine("sourceState r=" + r + " state=" + st);
        }

        using (var nav = api.CreateServiceNavigation(Profile.Main, 0))
        {
            var mode = new TvMode();
            int r = nav.GetTvMode(mode);
            Console.WriteLine("tvmode r=" + r + " antenna=" + mode.antennaMode + " service=" + mode.serviceMode);

            int count = 0;
            r = nav.GetServiceCount(new CriteriaHelper(), ref count);
            Console.WriteLine("count r=" + r + " n=" + count);

            var cur = new ServiceData();
            var crit = Columns();
            r = nav.GetCurrentServiceInfo(crit, cur);
            Console.WriteLine("current r=" + r + " " + Describe(cur));

            var list = new List<ServiceData>();
            var c2 = Columns();
            r = nav.GetServiceList(c2, list);
            Console.WriteLine("list r=" + r + " n=" + list.Count + " ms=" + sw.ElapsedMilliseconds);
            for (int i = 0; i < list.Count && i < max; i++) Console.WriteLine("  " + Describe(list[i]));
        }
    }

    // schedule MAJOR[:HOURS] [MAJOR[:HOURS] ...]
    // GetProgramList(serviceId, start, duration) is function code 1 of com.samsung.IServiceGuide. What the daemon does with the two uints was read in
    // TCProgramMemory_DVB::GetProgramList (libtvs-dvbbase-guide.so): start = first second of the window (StartTime's clock, Unix UTC), duration = its length
    // in seconds; the programmes kept are those with EndTime > start and StartTime <= start + duration. The old call that hung passed the GPS-epoch
    // start and "start + 6 h" as the duration: a window of decades. Only "in" parameters travel in the request (id, start, duration).
    // Each call runs on its own thread with a 8 s limit; the first that does not answer stops the run.
    [MethodImpl(MethodImplOptions.NoInlining)]
    static void Schedule(string[] args)
    {
        var api = TVServiceAPI.Instance();
        var channels = new Dictionary<int, ulong>();
        using (var nav = api.CreateServiceNavigation(Profile.Main, 0))
        {
            var list = new List<ServiceData>();
            nav.GetServiceList(Columns(), list);
            foreach (var d in list) channels[d.GetMajor()] = d.GetServiceId();
        }
        for (int i = 1; i < args.Length; i++)
        {
            string[] parts = args[i].Split(':');
            int major = int.Parse(parts[0]);
            int hours = parts.Length > 1 ? int.Parse(parts[1]) : 3;
            ulong id;
            if (!channels.TryGetValue(major, out id)) { Console.WriteLine("no channel " + major); continue; }
            uint start = (uint)DateTimeOffset.UtcNow.ToUnixTimeSeconds(), duration = (uint)(hours * 3600);
            byte[] reply = null; int res = -9;
            string error = null;
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var th = new Thread(() => { try { reply = ListRaw(api, id, start, duration, out res); } catch (Exception e) { error = (e.InnerException ?? e).Message; } });
            th.IsBackground = true; th.Start();
            if (!th.Join(8000)) { Console.WriteLine("major " + major + ": NO ANSWER in 8 s, stopping"); Environment.Exit(2); }
            Console.WriteLine("major " + major + " id=" + id + " start=" + start + " duration=" + duration + ": " + (error != null ? "EXC " + error : "r=" + res + " bytes=" + (reply == null ? -1 : reply.Length)) + " ms=" + sw.ElapsedMilliseconds);
            if (reply != null && reply.Length > 0)
            {
                string path = "/tmp/vtsched_" + major + "_" + hours + "h.bin";
                System.IO.File.WriteAllBytes(path, reply);
                Console.WriteLine("  saved " + path);
            }
        }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static unsafe byte[] ListRaw(TVServiceAPI api, ulong id, uint start, uint duration, out int result)
    {
        Assembly asm = typeof(TVServiceAPI).Assembly;
        using (IServiceGuide g = api.CreateServiceGuide()) { }            // waits for the interface to exist
        object conn = typeof(TVServiceAPI).GetField("pTVSConnection", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(api);
        Type helperType = asm.GetType("Tizen.TV.Broadcast.TVService.Core.MarshalHelperProxy");
        Type fmtType = asm.GetType("Tizen.TV.Broadcast.TVService.Core.Formatter");
        Type bufType = asm.GetType("Tizen.TV.Broadcast.TVService.Core.MessageBuffer");
        object helper = Activator.CreateInstance(helperType, true);
        var o = new[] { typeof(object) };
        helperType.GetMethod("PushIn", o).Invoke(helper, new object[] { id });
        helperType.GetMethod("PushIn", o).Invoke(helper, new object[] { start });
        helperType.GetMethod("PushIn", o).Invoke(helper, new object[] { duration });
        object fmt = Activator.CreateInstance(fmtType, true);
        BindingFlags nonPublic = BindingFlags.NonPublic | BindingFlags.Instance;
        fmtType.GetMethod("Serialize", nonPublic).Invoke(fmt, new object[] { new TagAttribute((short)1), helperType.GetField("inList").GetValue(helper) });
        byte[] request = (byte[])fmtType.GetMethod("GetInputStream", nonPublic).Invoke(fmt, null);
        Console.WriteLine("  request " + request.Length + " bytes: " + BitConverter.ToString(request).Replace("-", ""));
        object inBuf = Activator.CreateInstance(bufType), outBuf = Activator.CreateInstance(bufType);
        try
        {
            bufType.GetMethod("PushConcatenated").Invoke(inBuf, new object[] { request });
            bool ok = (bool)conn.GetType().GetMethod("Call").Invoke(conn, new object[] { "com.samsung.IServiceGuide", (short)1, inBuf, outBuf });
            result = ok ? 1 : 0;
            if (!ok) return new byte[0];
            int size = (int)(uint)bufType.GetMethod("GetFullBufferSize").Invoke(outBuf, null);
            if (size <= 0 || size > 1 << 20) return new byte[0];
            var reply = new byte[size];
            bufType.GetMethod("ReadConcatenated").Invoke(outBuf, new object[] { reply, size, 0 });
            return reply;
        }
        finally { ((IDisposable)inBuf).Dispose(); ((IDisposable)outBuf).Dispose(); ((IDisposable)fmt).Dispose(); }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static void Logos()
    {
        var api = TVServiceAPI.Instance();
        using (var nav = api.CreateServiceNavigation(Profile.Main, 0))
        {
            var c = new CriteriaHelper();
            c.Fetch((int)ServiceDataTag.ServiceID);
            c.Fetch((int)ServiceDataTag.Major);
            c.Fetch((int)ServiceDataTag.ServiceName);
            c.Fetch((int)ServiceDataTag.LogoID);
            c.Fetch((int)ServiceDataTag.LogoVersion);
            c.Fetch((int)ServiceDataTag.IconRoute);
            var list = new List<ServiceData>();
            int r = nav.GetServiceList(c, list);
            Console.WriteLine("list r=" + r + " n=" + list.Count);
            for (int i = 0; i < list.Count && i < 40; i++)
            {
                var d = list[i];
                Console.WriteLine("  " + d.GetMajor() + " " + d.Get(ServiceDataTag.ServiceName)
                    + " logoId=" + d.Get(ServiceDataTag.LogoID) + " logoVer=" + d.Get(ServiceDataTag.LogoVersion)
                    + " iconRoute=" + d.Get(ServiceDataTag.IconRoute));
            }
        }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static void Tune(int major)
    {
        var api = TVServiceAPI.Instance();
        ulong id = 0; string name = null;
        using (var nav = api.CreateServiceNavigation(Profile.Main, 0))
        {
            var list = new List<ServiceData>();
            nav.GetServiceList(Columns(), list);
            _nav = nav;
            foreach (var d in list)
                if (d.GetMajor() == major) { id = d.GetServiceId(); name = d.Get(ServiceDataTag.ServiceName) as string; break; }
        }
        if (id == 0) { Console.WriteLine("no channel with major " + major); return; }
        var sw = System.Diagnostics.Stopwatch.StartNew();
        using (var src = api.CreateSourceControl(Profile.Main, 0))
        {
            int r = src.SetSource(Source.TV, id, "NoAppId");   // same appId Samsung's own source switcher passes
            Console.WriteLine("SetSource TV id=" + id + " (" + name + ") r=" + r + " ms=" + sw.ElapsedMilliseconds);
        }
    }

    // Tunes to `from`, then to `to`, `rounds` times. For the `to` step it reports the SetSource call and the time until
    // the daemon itself reports the new channel as current. (Not the moment the picture appears: that is not observable here.)
    [MethodImpl(MethodImplOptions.NoInlining)]
    static void Bench(int from, int to, int rounds)
    {
        var api = TVServiceAPI.Instance();
        var ids = new Dictionary<int, ulong>();
        using (var nav = api.CreateServiceNavigation(Profile.Main, 0))
        {
            var list = new List<ServiceData>();
            nav.GetServiceList(Columns(), list);
            foreach (var d in list) ids[d.GetMajor()] = d.GetServiceId();
            if (!ids.ContainsKey(from) || !ids.ContainsKey(to)) { Console.WriteLine("missing channel"); return; }
            using (var src = api.CreateSourceControl(Profile.Main, 0))
            {
                var times = new List<long[]>();
                for (int i = 0; i < rounds; i++)
                {
                    src.SetSource(Source.TV, ids[from], "NoAppId");
                    System.Threading.Thread.Sleep(2500);               // let it settle
                    var sw = System.Diagnostics.Stopwatch.StartNew();
                    int r = _nonDestructive ? NdTune(api, ids[to], _ndCode) : src.SetSource(Source.TV, ids[to], "NoAppId");
                    long call = sw.ElapsedMilliseconds, seen = -1;
                    while (sw.ElapsedMilliseconds < 5000)
                    {
                        var cur = new ServiceData();
                        if (nav.GetCurrentServiceInfo(Columns(), cur) == 1 && cur.GetServiceId() == ids[to]) { seen = sw.ElapsedMilliseconds; break; }
                        System.Threading.Thread.Sleep(2);
                    }
                    Console.WriteLine("round " + i + " " + from + "->" + to + " r=" + r + " SetSource=" + call + " ms, daemon reports new channel at " + seen + " ms");
                    System.Threading.Thread.Sleep(1000);
                }
            }
        }
    }

    // ---- event timeline: what tvs-daemon announces between SetSource and the picture ----

    [DllImport("libglib-2.0.so.0")] static extern IntPtr g_main_loop_new(IntPtr ctx, bool running);
    [DllImport("libglib-2.0.so.0")] static extern void g_main_loop_run(IntPtr loop);
    [DllImport("libglib-2.0.so.0")] static extern void g_main_loop_quit(IntPtr loop);

    static readonly System.Diagnostics.Stopwatch Clock = System.Diagnostics.Stopwatch.StartNew();
    static SignalCallbackObject _cb;      // kept alive: native code holds it
    static long _t0;
    static bool _nonDestructive;
    static short _ndCode = 21;
    static object _nav;   // keeps the ServiceNavigation (and its interface wait) alive for the reflection call

    // SetServiceNonDestructive is in the daemon's interface but the managed client does not expose it, so build the call
    // with the client's own internal marshalling classes: out int result, profile, subId, then the service id.
    [MethodImpl(MethodImplOptions.NoInlining)]
    static unsafe int NdTune(TVServiceAPI api, ulong id, short code)
    {
        var asm = typeof(TVServiceAPI).Assembly;
        object conn = typeof(TVServiceAPI).GetField("pTVSConnection", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(api);
        Type helperType = asm.GetType("Tizen.TV.Broadcast.TVService.Core.MarshalHelperProxy");
        Type wrapType = asm.GetType("Tizen.TV.Broadcast.TVService.Types.ValueWrapper");
        object helper = Activator.CreateInstance(helperType, true);
        int result = -1;
        object wrap = wrapType.GetConstructors()[0].Invoke(new object[] { Pointer.Box(&result, typeof(void*)), typeof(int) });
        var o = new[] { typeof(object) };
        helperType.GetMethod("PushOut", o).Invoke(helper, new object[] { wrap });
        helperType.GetMethod("PushIn", o).Invoke(helper, new object[] { Profile.Main });
        helperType.GetMethod("PushIn", o).Invoke(helper, new object[] { 0 });
        helperType.GetMethod("PushIn", o).Invoke(helper, new object[] { id });
        if (code == 0)   // SetService(id&, EServiceChangeDirection, bool, std::string const&)
        {
            helperType.GetMethod("PushIn", o).Invoke(helper, new object[] { 0 });
            helperType.GetMethod("PushIn", new[] { typeof(bool) }).Invoke(helper, new object[] { false });
            helperType.GetMethod("PushIn", o).Invoke(helper, new object[] { new MarshalableStringUTF8("NoAppId") });
        }
        var run = helperType.GetMethod("Run");
        bool ok = (bool)run.Invoke(helper, new object[] { conn, "com.samsung.IServiceNavigation", _ndCode == 0 ? "SetService" : "SetServiceNonDestructive", code, false });
        return ok ? result : -1000;
    }

    // The client delivers signals through a GLib main loop, so this thread runs one while a second thread does the tuning.
    [MethodImpl(MethodImplOptions.NoInlining)]
    static void Events(int from, int to, int rounds, int listenSeconds)
    {
        var api = TVServiceAPI.Instance();
        _cb = (type, profile, screen, data, user) =>
        {
            Console.WriteLine("  +" + (Clock.ElapsedMilliseconds - _t0).ToString().PadLeft(5) + " ms  " + type + " (" + (int)type + ")");
            return 0;
        };
        ISignalSubscriber sub = api.CreateSignalSubscriber(_cb);
        foreach (var t in new[] {
            SignalType.SignalTunePreparation, SignalType.SignalTuneStart, SignalType.SignalTuneSuccess, SignalType.SignalTunerLockFail, SignalType.SignalLockSuccess,
            SignalType.SignalServiceLocked, SignalType.SignalTuneStop, SignalType.SignalTuneAbandoned, SignalType.SignalTuneWeakSignal, SignalType.SignalSiStarted,
            SignalType.SignalSIChanged, SignalType.SignalSiStopped, SignalType.SignalSITimeOut, SignalType.SignalPesChanged, SignalType.SignalResolutionChanged,
            SignalType.SignalPictureSizeChange, SignalType.SignalUpdateSizeInfo, SignalType.SignalUnmuteVideo, SignalType.SignalMuteVideo, SignalType.SignalTvSourceRealUnmute,
            SignalType.SignalTvSourceRealMute, SignalType.SignalMajorTune, SignalType.SignalTuningServiceId, SignalType.SignalTuneToServiceID, SignalType.SignalSourceStateChanged,
            SignalType.SignalPipelineActivateFail, SignalType.SignalPipelineDeactive, SignalType.SignalAsmDeactivatePipeline, SignalType.SignalEventRestartPipeline,
            SignalType.SignalPresentEitChanged, SignalType.SignalAudioChanged, SignalType.SignalSubtitleChanged, SignalType.SignalMtsChanged, SignalType.SignalClearService,
            SignalType.SignalScrambledService, SignalType.SignalNotAvailableService, SignalType.SignalTvsActivate, SignalType.SignalTvsDeactivate, SignalType.SignalChangeTVMode })
        {
            int r = sub.Subscribe(t);
            if (r != 1) Console.WriteLine("subscribe " + t + " r=" + r);
        }
        IntPtr loop = g_main_loop_new(IntPtr.Zero, false);
        _t0 = Clock.ElapsedMilliseconds;
        var worker = new Thread(() =>
        {
            try
            {
                if (listenSeconds > 0) { Console.WriteLine("listening " + listenSeconds + " s (press keys on the remote now)"); Thread.Sleep(listenSeconds * 1000); }
                else DoRounds(api, from, to, rounds);
            }
            catch (Exception ex) { Console.WriteLine("EXC " + ex); }
            g_main_loop_quit(loop);
        });
        worker.Start();
        g_main_loop_run(loop);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static void DoRounds(TVServiceAPI api, int from, int to, int rounds)
    {
        var ids = new Dictionary<int, ulong>();
        using (var nav = api.CreateServiceNavigation(Profile.Main, 0))
        {
            var list = new List<ServiceData>();
            nav.GetServiceList(Columns(), list);
            foreach (var d in list) ids[d.GetMajor()] = d.GetServiceId();
        }
        if (!ids.ContainsKey(from) || !ids.ContainsKey(to)) { Console.WriteLine("missing channel"); return; }
        using (var src = api.CreateSourceControl(Profile.Main, 0))
        {
            for (int i = 0; i < rounds; i++)
            {
                Console.WriteLine("round " + i + ": settle on " + from);
                src.SetSource(Source.TV, ids[from], "NoAppId");   // settle with the regular call, only the measured zap differs
                Thread.Sleep(5000);
                Console.WriteLine("round " + i + ": " + from + " -> " + to);
                _t0 = Clock.ElapsedMilliseconds;
                int r = _nonDestructive ? NdTune(api, ids[to], _ndCode) : src.SetSource(Source.TV, ids[to], "NoAppId");
                Console.WriteLine("  +" + (Clock.ElapsedMilliseconds - _t0).ToString().PadLeft(5) + " ms  SetSource returned r=" + r);
                Thread.Sleep(5000);
            }
        }
    }


    static string Txt(ProgramData p, Func<uint> len, Func<string, int, string> _) { return null; }

    static string TitleOf(ProgramData p)
    {
        string t = ""; int n = 4096;
        p.Title(ref t, ref n);
        return t;
    }

    static string Time(uint t) { return DateTimeOffset.FromUnixTimeSeconds(t).ToLocalTime().ToString("HH:mm"); }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static void Guide(int major)
    {
        var api = TVServiceAPI.Instance();
        ulong id = 0;
        using (var nav = api.CreateServiceNavigation(Profile.Main, 0))
        {
            var list = new List<ServiceData>();
            nav.GetServiceList(Columns(), list);
            foreach (var d in list) if (d.GetMajor() == major) id = d.GetServiceId();
        }
        Console.WriteLine("service " + major + " id=" + id);
        var cur = new ServiceData();
        using (var nav = api.CreateServiceNavigation(Profile.Main, 0)) { nav.GetCurrentServiceInfo(Columns(), cur); Console.WriteLine("on air now: major " + cur.GetMajor() + " id=" + cur.GetServiceId()); }
        using (var g = api.CreateServiceGuide())
        {
            var p = new ProgramData();
            int r = g.GetPresentProgram(id, p);
            Console.WriteLine("present r=" + r + " event=" + p.EventId + " start=" + p.StartTime + " (" + Time(p.StartTime) + ") dur=" + p.Duration + " utcStart=" + p.UtcStartTime + " (" + Time(p.UtcStartTime) + ") utcDur=" + p.UtcDuration);
            Console.WriteLine("  title=" + TitleOf(p));
            string st = ""; int sn = 4096; bool sok = p.ShortText(ref st, ref sn); Console.WriteLine("  short=" + sok + " " + st);
            string et = ""; int en = 4096; bool eok = p.ExtendedText(ref et, ref en); Console.WriteLine("  ext=" + eok + " " + (et.Length > 160 ? et.Substring(0, 160) : et));
            var texts = (List<string>)typeof(ProgramData).GetField("containTexts", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(p);
            Console.WriteLine("  containTexts n=" + texts.Count + ": " + string.Join(" | ", texts.ConvertAll(x => x == null ? "<null>" : "[" + x.Length + "]" + (x.Length > 50 ? x.Substring(0, 50) : x))));
            Console.WriteLine("  titleLen=" + p.TitleLength() + " shortLen=" + p.ShortTextLength() + " extLen=" + p.ExtendedTextLength());
            var pc = (ProgramComponentData)typeof(ProgramData).GetField("ProgComp", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(p);
            if (pc != null)
                for (int k = 0; k < pc.comp.Length; k++)
                    if (pc.comp[k] != null)
                        foreach (var c in pc.comp[k])
                            Console.WriteLine("  comp[" + k + "] tag=" + c.componentTag + " type=" + c.componentType + " multi=" + c.multiSound + " q=" + c.quality + " text=" + c.componentText);
            // GetProgramList (function codes 1, 2, 15) is deliberately NOT called: a guessed layout hung and tvs-daemon restarted (2026-11-07)
        }
        using (var av = api.CreateAVControl(Profile.Main, 0))
        {
            LanguageCode lc = default(LanguageCode); int idx = -1;
            int r = av.GetCurrentAudioInfo(ref lc, ref idx);
            Console.WriteLine("audio r=" + r + " lang=" + lc + " index=" + idx);
        }
        using (var dc = api.CreateDataControl(Profile.Main, 0))
        {
            CaptionDataMode m = default(CaptionDataMode);
            Console.WriteLine("captionmode r=" + dc.GetCaptionDataMode(ref m) + " " + m);
        }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static unsafe void RawPresent(int major)
    {
        var api = TVServiceAPI.Instance();
        ulong id = 0;
        using (var nav = api.CreateServiceNavigation(Profile.Main, 0))
        {
            var list = new List<ServiceData>();
            nav.GetServiceList(Columns(), list);
            foreach (var d in list) if (d.GetMajor() == major) id = d.GetServiceId();
        }
        using (var g = api.CreateServiceGuide())   // waits for the interface, as the public call does
        {
            var asm = typeof(TVServiceAPI).Assembly;
            object conn = typeof(TVServiceAPI).GetField("pTVSConnection", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(api);
            Type helperType = asm.GetType("Tizen.TV.Broadcast.TVService.Core.MarshalHelperProxy");
            Type wrapType = asm.GetType("Tizen.TV.Broadcast.TVService.Types.ValueWrapper");
            Type fmtType = asm.GetType("Tizen.TV.Broadcast.TVService.Core.Formatter");
            Type bufType = asm.GetType("Tizen.TV.Broadcast.TVService.Core.MessageBuffer");
            object helper = Activator.CreateInstance(helperType, true);
            int result = -1;
            object wrap = wrapType.GetConstructors()[0].Invoke(new object[] { Pointer.Box(&result, typeof(void*)), typeof(int) });
            var o = new[] { typeof(object) };
            var prog = new ProgramData();
            helperType.GetMethod("PushOut", o).Invoke(helper, new object[] { wrap });
            helperType.GetMethod("PushIn", o).Invoke(helper, new object[] { id });
            helperType.GetMethod("PushOut", o).Invoke(helper, new object[] { prog });
            var inList = helperType.GetField("inList").GetValue(helper);
            object fmt = Activator.CreateInstance(fmtType, true);
            var attr = new TagAttribute((short)6);
            fmtType.GetMethod("Serialize", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(fmt, new object[] { attr, inList });
            byte[] req = (byte[])fmtType.GetMethod("GetInputStream", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(fmt, null);
            Console.WriteLine("request " + req.Length + " bytes: " + BitConverter.ToString(req));
            object inBuf = Activator.CreateInstance(bufType), outBuf = Activator.CreateInstance(bufType);
            bufType.GetMethod("PushConcatenated").Invoke(inBuf, new object[] { req });
            var callM = conn.GetType().GetMethod("Call");
            bool ok = (bool)callM.Invoke(conn, new object[] { "com.samsung.IServiceGuide", (short)6, inBuf, outBuf });
            IntPtr oh = (IntPtr)bufType.GetProperty("Handle").GetValue(outBuf);
            int size = (int)(uint)bufType.GetMethod("GetFullBufferSize").Invoke(outBuf, null);
            byte[] reply = new byte[size];
            bufType.GetMethod("ReadConcatenated").Invoke(outBuf, new object[] { reply, size, 0 });
            Console.WriteLine("call ok=" + ok + " reply " + size + " bytes");
            Console.WriteLine(BitConverter.ToString(reply));
            var sb = new System.Text.StringBuilder();
            foreach (byte b in reply) sb.Append(b >= 32 && b < 127 ? (char)b : '.');
            Console.WriteLine("ascii: " + sb);
            var sb16 = new System.Text.StringBuilder();
            for (int i = 0; i + 1 < reply.Length; i += 2) sb16.Append(reply[i + 1] == 0 && reply[i] >= 32 && reply[i] < 127 ? (char)reply[i] : '.');
            Console.WriteLine("utf16: " + sb16);
        }
    }

    static CriteriaHelper Columns()
    {
        var c = new CriteriaHelper();
        foreach (var t in new[] { ServiceDataTag.ServiceID, ServiceDataTag.Major, ServiceDataTag.Minor, ServiceDataTag.ChannelNumber,
            ServiceDataTag.ServiceName, ServiceDataTag.ServiceType, ServiceDataTag.Digital, ServiceDataTag.Frequency, ServiceDataTag.VideoEncodeType })
            c.Fetch((int)t);
        return c;
    }

    static string Describe(ServiceData d)
    {
        string one(ServiceDataTag t) { try { var v = d.Get(t); return t + "=" + (v ?? "null"); } catch (Exception e) { return t + "=!" + e.GetType().Name; } }
        return string.Join(" ", one(ServiceDataTag.ServiceID), one(ServiceDataTag.Major), one(ServiceDataTag.Minor),
            one(ServiceDataTag.ChannelNumber), one(ServiceDataTag.ServiceName), one(ServiceDataTag.ServiceType),
            one(ServiceDataTag.Digital), one(ServiceDataTag.Frequency), one(ServiceDataTag.VideoEncodeType));
    }
}
