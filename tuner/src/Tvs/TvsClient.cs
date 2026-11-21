using System;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.CompilerServices;
using Tizen.TV.Broadcast.TVService;
using Tizen.TV.Broadcast.TVService.API.Interface;
using Tizen.TV.Broadcast.TVService.Types;
using Tuner.Core;

namespace Tuner.Tvs
{
    /// <summary>
    /// The conversation with tvs-daemon, through Samsung's own managed client that the firmware ships
    /// (it serialises the calls and talks to libtvs-api-lite). The DLL is never bundled: it is found on the TV.
    /// Everything that touches it stays in this class so the rest of the app does not load it.
    /// </summary>
    internal sealed class TvsClient
    {
        // The client pulls in Tizen.TV.Security (a Cynara privilege check) and that pulls in Tizen.Log.
        private const string ClientRoot = "/opt/usr/dotnet/Tizen.TV.Broadcast.TVService/";   // one folder per version: 1.1.12 on the Q80A
        private static readonly string[] FixedDirs =
        {
            "/usr/apps/csapi-tv-tizenfx/shared/lib/",
            "/usr/share/dotnet.tizen/framework/",
        };
        private static string[] _dirs;

        /// <summary>Where assemblies are looked for: the version folders of the client (newest first), then the two firmware library folders.</summary>
        private static string[] Dirs
        {
            get
            {
                if (_dirs != null) return _dirs;
                var dirs = new List<string>();
                try
                {
                    var names = new List<string>();
                    foreach (string d in System.IO.Directory.GetDirectories(ClientRoot)) names.Add(System.IO.Path.GetFileName(d));
                    foreach (string n in ClientFolders.NewestFirst(names)) dirs.Add(ClientRoot + n + "/");
                }
                catch (Exception) { }          // no such folder: the TV has no client, the first call into it will say so
                dirs.AddRange(FixedDirs);
                _dirs = dirs.ToArray();
                return _dirs;
            }
        }

        private static bool _resolver;

        /// <summary>Where Samsung's client was loaded from and its version (for the log: 2021, 2022 and 2024 firmware keep it in different places).</summary>
        public static volatile string LoadedFrom;

        public static void InstallResolver()
        {
            if (_resolver) return;
            _resolver = true;
            AppDomain.CurrentDomain.AssemblyResolve += (s, e) =>
            {
                string file = new AssemblyName(e.Name).Name + ".dll";
                foreach (string d in Dirs)
                {
                    string p = d + file;
                    if (!System.IO.File.Exists(p)) continue;
                    Assembly a = Assembly.LoadFrom(p);
                    if (file == "Tizen.TV.Broadcast.TVService.dll") LoadedFrom = p + " " + a.GetName().Version;
                    return a;
                }
                return null;
            };
        }

        // NoInlining: the methods below must not be JIT-ed (and so must not load the Samsung assembly) before the resolver is in place.
        // All of them are called from one thread, the worker: the connection to tvs-daemon belongs to the thread that opened it.

        /// <summary>Connects to tvs-daemon and returns the channel the TV is on now (null if it cannot be read). Cheap: no list.</summary>
        [MethodImpl(MethodImplOptions.NoInlining)]
        public Channel ReadCurrent(out string status)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var api = TVServiceAPI.Instance();
            long tConnect = sw.ElapsedMilliseconds;
            Channel result = null;
            using (IServiceNavigation nav = api.CreateServiceNavigation(Profile.Main, 0))
            {
                var cur = new ServiceData();
                int r = nav.GetCurrentServiceInfo(Columns(), cur);
                if (r == 1) result = ToChannel(cur);
                status = "current r=" + r + " [connect=" + tConnect + " total=" + sw.ElapsedMilliseconds + "]";
            }
            return result;
        }

        [MethodImpl(MethodImplOptions.NoInlining)]
        public List<Channel> ReadChannels(out string status)
        {
            var channels = new List<Channel>();
            var sw = System.Diagnostics.Stopwatch.StartNew();
            using (IServiceNavigation nav = TVServiceAPI.Instance().CreateServiceNavigation(Profile.Main, 0))
            {
                var list = new List<ServiceData>();
                int r = nav.GetServiceList(Columns(), list);
                foreach (ServiceData d in list) channels.Add(ToChannel(d));
                status = "list r=" + r + " n=" + list.Count + " ms=" + sw.ElapsedMilliseconds;
            }
            return channels;
        }

        private static Channel ToChannel(ServiceData d)
        {
            return new Channel
            {
                Id = d.GetServiceId(), Major = d.GetMajor(), Name = d.Get(ServiceDataTag.ServiceName) as string ?? "",
                Onid = Number(d, ServiceDataTag.OriginalNetworkID), Tsid = Number(d, ServiceDataTag.TransportStreamID), Sid = Number(d, ServiceDataTag.ProgramNumber),
                Virtual = Number(d, ServiceDataTag.ChannelType) == (int)ChannelType.Virtual
            };
        }

        /// <summary>A numeric column of a service as an int, -1 when the daemon did not give it (the DVB triplet is only used to find a logo).</summary>
        private static int Number(ServiceData d, ServiceDataTag tag)
        {
            try { object v = d.Get(tag); return v == null ? -1 : Convert.ToInt32(v); }
            catch (Exception) { return -1; }
        }

        // Zapping. SetSource(TV, id) is the destructive path: mute, TuneStop, SiStopped, ~350 ms of teardown and a full relock even
        // on the same multiplex. Samsung's own tuner calls ServiceNavigation.SetService (function code 0) instead, which keeps the
        // tuner and the SI running when the multiplex does not change (measured on the Q80A: picture back in ~1.5 s instead of ~2.5 s).
        // The managed client does not expose it, so the call is built with its internal marshalling classes by reflection:
        // out int result, profile, subId, then (service id, direction 0, false, "NoAppId"). Any failure falls back to SetSource.
        private volatile bool _isTv;  // the source is known to be TV, so SetService is allowed
        private int _setServiceFails; // tries in a row of the fast call that did not work; at FastTries it is given up
        private const int FastTries = 3;
        /// <summary>Why the last tune did not use the fast call (null when it did, or was not tried): for the log.</summary>
        public string TuneNote { get; private set; }

        /// <summary>
        /// The tuner comes back on screen: the TV may be on another input now (it was shown from the dashboard while on HDMI), so
        /// the next tune asks which source is on instead of trusting what was true before.
        /// </summary>
        public void SourceUnknown() { _isTv = false; }
        private IServiceNavigation _nav;   // keeps the interface alive for the reflection call
        private object _conn, _helperType, _wrapType;

        [MethodImpl(MethodImplOptions.NoInlining)]
        public int Tune(ulong serviceId)
        {
            var api = TVServiceAPI.Instance();
            TuneNote = null;
            if (!_isTv)
            {
                using (ISourceControl s0 = api.CreateSourceControl(Profile.Main, 0))
                {
                    Source cur = Source.TV;
                    if (s0.GetCurrentSourceInfo(ref cur) == 1 && cur == Source.TV) _isTv = true;
                    else
                    {
                        int r0 = s0.SetSource(Source.TV, serviceId, "NoAppId");   // the appId Samsung's own source switcher passes
                        if (r0 == 1) _isTv = true;
                        return r0;
                    }
                }
            }
            // One refusal (a channel that is gone, a busy daemon) must not send every later zap down the slow path for the life of
            // the process: the fast call is given up after FastTries failures in a row, or at once when it cannot be built at all.
            if (_setServiceFails < FastTries)
            {
                try
                {
                    int r = SetService(api, serviceId);
                    if (r == 1) { _setServiceFails = 0; return r; }
                    _setServiceFails++;
                    TuneNote = "SetService r=" + r + (_setServiceFails >= FastTries ? ", given up: SetSource from now on" : ", SetSource this time");
                }
                catch (Exception ex)
                {
                    _setServiceFails = FastTries;
                    TuneNote = "SetService cannot be called (" + ex.GetType().Name + "): SetSource from now on";
                }
            }
            using (ISourceControl src = api.CreateSourceControl(Profile.Main, 0))
                return src.SetSource(Source.TV, serviceId, "NoAppId");
        }

        [MethodImpl(MethodImplOptions.NoInlining)]
        private unsafe int SetService(TVServiceAPI api, ulong id)
        {
            Assembly asm = typeof(TVServiceAPI).Assembly;
            if (_nav == null) _nav = api.CreateServiceNavigation(Profile.Main, 0);   // waits for the interface to exist
            if (_conn == null)
            {
                _conn = typeof(TVServiceAPI).GetField("pTVSConnection", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(api);
                _helperType = asm.GetType("Tizen.TV.Broadcast.TVService.Core.MarshalHelperProxy");
                _wrapType = asm.GetType("Tizen.TV.Broadcast.TVService.Types.ValueWrapper");
            }
            var helperType = (Type)_helperType;
            object helper = Activator.CreateInstance(helperType, true);
            int result = -1;
            object wrap = ((Type)_wrapType).GetConstructors()[0].Invoke(new object[] { Pointer.Box(&result, typeof(void*)), typeof(int) });
            var o = new[] { typeof(object) };
            MethodInfo pushIn = helperType.GetMethod("PushIn", o);
            helperType.GetMethod("PushOut", o).Invoke(helper, new object[] { wrap });
            pushIn.Invoke(helper, new object[] { Profile.Main });
            pushIn.Invoke(helper, new object[] { 0 });
            pushIn.Invoke(helper, new object[] { id });
            pushIn.Invoke(helper, new object[] { 0 });   // EServiceChangeDirection: none
            helperType.GetMethod("PushIn", new[] { typeof(bool) }).Invoke(helper, new object[] { false });
            pushIn.Invoke(helper, new object[] { new MarshalableStringUTF8("NoAppId") });
            bool ok = (bool)helperType.GetMethod("Run").Invoke(helper, new object[] { _conn, "com.samsung.IServiceNavigation", "SetService", (short)0, false });
            return ok ? result : -1000;
        }

        /// <summary>The programme on air on a service, from the daemon's guide: start (Unix UTC seconds) and length. Only services of the multiplex we are tuned to have one.</summary>
        [MethodImpl(MethodImplOptions.NoInlining)]
        public bool ReadPresent(ulong serviceId, out long start, out long duration)
        {
            start = 0; duration = 0;
            using (IServiceGuide g = TVServiceAPI.Instance().CreateServiceGuide())
            {
                var p = new ProgramData();
                if (g.GetPresentProgram(serviceId, p) != 1) return false;
                start = p.StartTime; duration = p.Duration;
                return duration > 0;
            }
        }

        private Type _fmtType, _bufType;

        /// <summary>
        /// The strings of the programme on air (title, description...) for a service. The client's own decoder drops them, so this makes
        /// the same call as GetPresentProgram (same bytes on the wire) with the client's marshalling classes and reads the reply itself.
        /// Empty when anything is not as expected.
        /// </summary>
        [MethodImpl(MethodImplOptions.NoInlining)]
        public string[] ReadPresentTexts(ulong serviceId)
        {
            var api = TVServiceAPI.Instance();
            using (IServiceGuide g = api.CreateServiceGuide())      // waits for the interface to exist
                return RawPresent(api, serviceId);
        }

        [MethodImpl(MethodImplOptions.NoInlining)]
        private unsafe string[] RawPresent(TVServiceAPI api, ulong id)
        {
            Assembly asm = typeof(TVServiceAPI).Assembly;
            if (_conn == null)
            {
                _conn = typeof(TVServiceAPI).GetField("pTVSConnection", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(api);
                _helperType = asm.GetType("Tizen.TV.Broadcast.TVService.Core.MarshalHelperProxy");
                _wrapType = asm.GetType("Tizen.TV.Broadcast.TVService.Types.ValueWrapper");
            }
            if (_fmtType == null)
            {
                _fmtType = asm.GetType("Tizen.TV.Broadcast.TVService.Core.Formatter");
                _bufType = asm.GetType("Tizen.TV.Broadcast.TVService.Core.MessageBuffer");
            }
            var helperType = (Type)_helperType;
            object helper = Activator.CreateInstance(helperType, true);
            int result = -1;
            object wrap = ((Type)_wrapType).GetConstructors()[0].Invoke(new object[] { Pointer.Box(&result, typeof(void*)), typeof(int) });
            var o = new[] { typeof(object) };
            helperType.GetMethod("PushOut", o).Invoke(helper, new object[] { wrap });
            helperType.GetMethod("PushIn", o).Invoke(helper, new object[] { id });
            helperType.GetMethod("PushOut", o).Invoke(helper, new object[] { new ProgramData() });
            object fmt = Activator.CreateInstance(_fmtType, true);
            BindingFlags nonPublic = BindingFlags.NonPublic | BindingFlags.Instance;
            _fmtType.GetMethod("Serialize", nonPublic).Invoke(fmt, new object[] { new TagAttribute((short)6), helperType.GetField("inList").GetValue(helper) });
            byte[] request = (byte[])_fmtType.GetMethod("GetInputStream", nonPublic).Invoke(fmt, null);
            object inBuf = Activator.CreateInstance(_bufType), outBuf = Activator.CreateInstance(_bufType);
            try
            {
                _bufType.GetMethod("PushConcatenated").Invoke(inBuf, new object[] { request });
                bool ok = (bool)_conn.GetType().GetMethod("Call").Invoke(_conn, new object[] { "com.samsung.IServiceGuide", (short)6, inBuf, outBuf });
                if (!ok) return new string[0];
                int size = (int)(uint)_bufType.GetMethod("GetFullBufferSize").Invoke(outBuf, null);
                if (size <= 0 || size > 65536) return new string[0];
                var reply = new byte[size];
                ReadConcatenated(outBuf, reply, size);
                return GuideText.Texts(reply);
            }
            finally { ((IDisposable)inBuf).Dispose(); ((IDisposable)outBuf).Dispose(); ((IDisposable)fmt).Dispose(); }
        }

        /// <summary>
        /// The schedule of a channel for a window of time: <c>IServiceGuide.GetProgramList</c> (function code 1), a call the managed client does not
        /// expose, built from its marshalling classes exactly as <see cref="RawPresent"/> builds the present-programme call. Only the "in" values
        /// travel in the request: service id (u64), window start (u32, Unix seconds) and window length (u32, seconds); the meaning of the two
        /// numbers was read in the daemon's own code (TCProgramMemory_DVB::GetProgramList), see <see cref="GuideReply"/>. The daemon answers for
        /// any channel, also on other multiplexes (30-50 ms). False when the call failed or the reply is not in the expected shape.
        /// </summary>
        [MethodImpl(MethodImplOptions.NoInlining)]
        public unsafe bool ReadSchedule(ulong serviceId, long start, long seconds, bool keepDescription, out List<GuideEvent> events)
        {
            events = new List<GuideEvent>();
            var api = TVServiceAPI.Instance();
            using (IServiceGuide g = api.CreateServiceGuide()) { }               // waits for the interface to exist
            Assembly asm = typeof(TVServiceAPI).Assembly;
            if (_conn == null)
            {
                _conn = typeof(TVServiceAPI).GetField("pTVSConnection", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(api);
                _helperType = asm.GetType("Tizen.TV.Broadcast.TVService.Core.MarshalHelperProxy");
                _wrapType = asm.GetType("Tizen.TV.Broadcast.TVService.Types.ValueWrapper");
            }
            if (_fmtType == null)
            {
                _fmtType = asm.GetType("Tizen.TV.Broadcast.TVService.Core.Formatter");
                _bufType = asm.GetType("Tizen.TV.Broadcast.TVService.Core.MessageBuffer");
            }
            var helperType = (Type)_helperType;
            object helper = Activator.CreateInstance(helperType, true);
            var o = new[] { typeof(object) };
            helperType.GetMethod("PushIn", o).Invoke(helper, new object[] { serviceId });
            helperType.GetMethod("PushIn", o).Invoke(helper, new object[] { (uint)start });
            helperType.GetMethod("PushIn", o).Invoke(helper, new object[] { (uint)seconds });
            object fmt = Activator.CreateInstance(_fmtType, true);
            BindingFlags nonPublic = BindingFlags.NonPublic | BindingFlags.Instance;
            _fmtType.GetMethod("Serialize", nonPublic).Invoke(fmt, new object[] { new TagAttribute((short)1), helperType.GetField("inList").GetValue(helper) });
            byte[] request = (byte[])_fmtType.GetMethod("GetInputStream", nonPublic).Invoke(fmt, null);
            object inBuf = Activator.CreateInstance(_bufType), outBuf = Activator.CreateInstance(_bufType);
            try
            {
                _bufType.GetMethod("PushConcatenated").Invoke(inBuf, new object[] { request });
                bool ok = (bool)_conn.GetType().GetMethod("Call").Invoke(_conn, new object[] { "com.samsung.IServiceGuide", (short)1, inBuf, outBuf });
                if (!ok) return false;
                int size = (int)(uint)_bufType.GetMethod("GetFullBufferSize").Invoke(outBuf, null);
                if (size <= 0 || size > 1 << 20) return false;
                var reply = new byte[size];
                ReadConcatenated(outBuf, reply, size);
                return GuideReply.Parse(reply, keepDescription, out events);
            }
            finally { ((IDisposable)inBuf).Dispose(); ((IDisposable)outBuf).Dispose(); ((IDisposable)fmt).Dispose(); }
        }

        /// <summary>
        /// <c>MessageBuffer.ReadConcatenated(byte[], offset/length...)</c>: (byte[], int, int) in the client of 2021-22 (1.1.12, 1.1.41), (byte[], uint, uint)
        /// in Tizen 9's 1.3.15, where boxed ints made Invoke throw and left the Banner's programme, Info and the guide empty. The two numbers are converted
        /// to whatever the method declares (found statically in the 1.3.15 client of a 2024 firmware, not yet run on a Tizen 9 TV).
        /// </summary>
        private void ReadConcatenated(object buffer, byte[] reply, int size)
        {
            MethodInfo m = _bufType.GetMethod("ReadConcatenated");
            ParameterInfo[] p = m.GetParameters();
            object[] args = { reply, size, 0 };
            for (int i = 1; i < args.Length && i < p.Length; i++)
                if (p[i].ParameterType != typeof(int)) args[i] = Convert.ChangeType(args[i], p[i].ParameterType, System.Globalization.CultureInfo.InvariantCulture);
            m.Invoke(buffer, args);
        }

        /// <summary>Where the TV takes its channels from: "Antenna", "Cable" or "Satellite" ("" when it cannot be read). Same call as the probe's `tvmode`.</summary>
        [MethodImpl(MethodImplOptions.NoInlining)]
        public string ReadSource()
        {
            using (IServiceNavigation nav = TVServiceAPI.Instance().CreateServiceNavigation(Profile.Main, 0))
            {
                var mode = new TvMode();
                if (nav.GetTvMode(mode) != 1) return "";
                switch (mode.antennaMode)
                {
                    case AntennaMode.Air: return "Antenna";
                    case AntennaMode.Cable: return "Cable";
                    case AntennaMode.Satellite: return "Satellite";
                    default: return "";
                }
            }
        }

        /// <summary>The audio track now playing: its language as three letters and its index (-1, "" when it cannot be read).</summary>
        [MethodImpl(MethodImplOptions.NoInlining)]
        public string ReadAudio(out int index)
        {
            index = -1;
            using (IAVControl av = TVServiceAPI.Instance().CreateAVControl(Profile.Main, 0))
            {
                LanguageCode lc = LanguageCode.Unknown; int idx = -1;
                if (av.GetCurrentAudioInfo(ref lc, ref idx) != 1) return "";
                index = idx;
                return lc == LanguageCode.Unknown ? "" : lc.ToString();
            }
        }

        /// <summary>
        /// Moves to the next audio track, or back to the first after the last. The client cannot list the tracks, so the next index is
        /// tried and read back: a track that does not exist (error, other index, unknown language) sends us back to index 0.
        /// </summary>
        [MethodImpl(MethodImplOptions.NoInlining)]
        public string NextAudio(out int index)
        {
            using (IAVControl av = TVServiceAPI.Instance().CreateAVControl(Profile.Main, 0))
            {
                LanguageCode lc = LanguageCode.Unknown; int idx = -1;
                index = -1;
                if (av.GetCurrentAudioInfo(ref lc, ref idx) != 1) return "";
                int next = idx + 1;
                LanguageCode lc2 = LanguageCode.Unknown; int idx2 = -1;
                bool ok = av.SetCurrentAudioByIndex(next) == 1 && av.GetCurrentAudioInfo(ref lc2, ref idx2) == 1 && idx2 == next && lc2 != LanguageCode.Unknown;
                if (!ok)
                {
                    av.SetCurrentAudioByIndex(0);
                    lc2 = LanguageCode.Unknown; idx2 = -1;
                    av.GetCurrentAudioInfo(ref lc2, ref idx2);
                }
                index = idx2;
                return lc2 == LanguageCode.Unknown ? "" : lc2.ToString();
            }
        }

        /// <summary>
        /// The subtitle tracks of a service (DVB and teletext alike), in the TV service's own order: the index of a track here is the index the
        /// TV's subtitle setting holds (<see cref="SubtitleSettings"/>). <c>IServiceDataAux.SizeOfHybridSBT</c>, then <c>GetHybridSBT</c> for each
        /// index, 1 = success. The language is the scalar the call fills (three letters packed in an int), or the track object's when that is
        /// unknown; "hard of hearing" only when the object says so. A track that cannot be read keeps its place, with no language. False when the
        /// number of tracks cannot be read. <paramref name="detail"/> is for the log: each track's raw fields, to check on the TV what the client
        /// really fills. Not tried on a TV yet.
        /// </summary>
        [MethodImpl(MethodImplOptions.NoInlining)]
        public bool ReadSubtitles(ulong serviceId, out List<SubtitleTrack> tracks, out string detail)
        {
            tracks = new List<SubtitleTrack>();
            using (IServiceDataAux aux = TVServiceAPI.Instance().CreateServiceDataAux(Profile.Main, 0))
            {
                uint size = 0;
                int r = aux.SizeOfHybridSBT(serviceId, ref size);
                var log = new System.Text.StringBuilder("size r=" + r + " n=" + size);
                if (r != 1) { detail = log.ToString(); return false; }
                int n = (int)Math.Min(size, (uint)Subtitles.MaxTracks);
                for (int i = 0; i < n; i++)
                {
                    LanguageCode lc = LanguageCode.Unknown;
                    var sbt = new HybridSBT();
                    int ri = -1;
                    try { ri = aux.GetHybridSBT(serviceId, (uint)i, ref lc, sbt); }
                    catch (Exception ex) { log.Append(" [" + i + " " + ex.GetType().Name + "]"); tracks.Add(new SubtitleTrack("", false)); continue; }
                    string lang = ri == 1 ? Subtitles.Unpack((int)lc) : "";
                    if (ri == 1 && lang.Length == 0) lang = Subtitles.Unpack((int)sbt.language);
                    bool hoh = ri == 1 && sbt.sbtMode == SBTType.HardOfHearing;
                    tracks.Add(new SubtitleTrack(lang, hoh));
                    log.Append(" [" + i + " r=" + ri + " lang=0x" + ((int)lc).ToString("x") + " obj.lang=0x" + ((int)sbt.language).ToString("x") +
                               " type=" + sbt.sbtType + " mode=" + sbt.sbtMode + " pid=" + sbt.pid + " page=" + sbt.magazine + "/" + sbt.page + "]");
                }
                detail = log.ToString();
                return true;
            }
        }

        private static CriteriaHelper Columns()
        {
            var c = new CriteriaHelper();
            c.Fetch((int)ServiceDataTag.ServiceID);
            c.Fetch((int)ServiceDataTag.Major);
            c.Fetch((int)ServiceDataTag.ServiceName);
            c.Fetch((int)ServiceDataTag.OriginalNetworkID);      // with the next two: the DVB triplet, the second way to find a channel's logo
            c.Fetch((int)ServiceDataTag.TransportStreamID);
            c.Fetch((int)ServiceDataTag.ProgramNumber);
            c.Fetch((int)ServiceDataTag.ChannelType);            // Virtual = a Samsung TV Plus channel
            return c;
        }
    }
}
