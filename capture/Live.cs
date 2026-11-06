// Based on zabique/vetro, branch fork/extras (https://github.com/zabique/vetro), MIT License.
// Copyright (c) 2026 Vetro contributors. Adapted for the screen-share Shard (capture/README.md).
// Live view: captures the scaler picture in a loop, encodes it with the TV's libturbojpeg (NEON) straight from
// the YUV planes, and serves it as MJPEG on 127.0.0.1 only. Vetro's service proxies it to the dashboard.
//
//   GET /stream     multipart/x-mixed-replace JPEG frames (an <img> plays it)
//   GET /frame.jpg  one fresh frame
//   GET /status     {"clients","fps","width","height","protect","error","frames"}
//   GET /quit       exit
//
// It captures only while someone watches, and exits after --idle-exit seconds without a viewer, so nothing keeps
// reading the screen in the background. Protected video is refused by Samsung's library (see Program.cs); the
// stream then shows black and /status says protect=1.
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static unsafe class Live
{
    const string Tj = "libturbojpeg.so.0";
    [DllImport(Tj)] static extern IntPtr tjInitCompress();
    [DllImport(Tj)] static extern IntPtr tjAlloc(int bytes);
    [DllImport(Tj)] static extern UIntPtr tjBufSize(int width, int height, int subsamp);
    [DllImport(Tj)] static extern IntPtr tjGetErrorStr2(IntPtr handle);
    [DllImport(Tj)] static extern int tjCompressFromYUVPlanes(IntPtr handle, IntPtr[] planes, int width, int[] strides,
        int height, int subsamp, ref IntPtr jpegBuf, ref UIntPtr jpegSize, int quality, int flags);
    const int TJSAMP_444 = 0, TJSAMP_422 = 1, TJSAMP_420 = 2, TJFLAG_NOREALLOC = 1024, TJFLAG_FASTDCT = 2048;

    static readonly object gate = new object();
    static byte[] frame = new byte[0];
    static long seq, frames;
    static int clients, width, height, protect = -1;
    static string error = "";
    static double fps;
    static long lastWanted;   // Stopwatch ms of the last request that needs frames
    static readonly Stopwatch clock = Stopwatch.StartNew();

    // Live controls, set from the request query (the dashboard passes ?fps=&q=&w=&h=). The capture loop reads
    // them each frame, so changing them takes effect without restarting the helper. Buffers are sized for MAX.
    const int MAXW = 1920, MAXH = 1088;
    static volatile int wantFps = 15, wantQ = 80, wantW = 1280, wantH = 720;

    static int ClampW(int w) => Math.Clamp(w & ~15, 160, MAXW);
    static int ClampH(int h) => Math.Clamp(h & ~15, 90, MAXH);

    public static int Run(string[] args)
    {
        int port = 8097, idleExit = 30;
        for (int i = 1; i < args.Length; i++)
        {
            string a = args[i], v = i + 1 < args.Length ? args[i + 1] : "";
            if (a == "--fps") { if (int.TryParse(v, out var n)) wantFps = Math.Clamp(n, 1, 30); i++; }
            else if (a == "--quality") { if (int.TryParse(v, out var n)) wantQ = Math.Clamp(n, 20, 95); i++; }
            else if (a == "--idle-exit") { int.TryParse(v, out idleExit); i++; }
            else if (a == "--size") { var p = v.Split('x'); if (p.Length == 2 && int.TryParse(p[0], out var pw) && int.TryParse(p[1], out var ph)) { wantW = ClampW(pw); wantH = ClampH(ph); } i++; }
            else if (int.TryParse(a, out var n)) port = n;
        }

        var listener = new HttpListener();
        listener.Prefixes.Add("http://127.0.0.1:" + port + "/");
        try { listener.Start(); }
        catch (Exception e) { Console.Error.WriteLine("listen " + port + ": " + e.Message); return 1; }
        Console.Error.WriteLine("live view on 127.0.0.1:" + port + " default " + wantW + "x" + wantH + " @" + wantFps + "fps q" + wantQ);
        lastWanted = clock.ElapsedMilliseconds;

        new Thread(() => CaptureLoop(idleExit)) { IsBackground = true, Name = "capture" }.Start();
        while (true)
        {
            HttpListenerContext ctx;
            try { ctx = listener.GetContext(); } catch { return 0; }
            ThreadPool.QueueUserWorkItem(_ => Handle(ctx));
        }
    }

    static void CaptureLoop(int idleExit)
    {
        IntPtr tj = tjInitCompress();
        int ySize = MAXW * MAXH, cSize = MAXW * MAXH * 2;    // sized for the largest frame; the request varies live
        IntPtr y = Marshal.AllocHGlobal(ySize), c = Marshal.AllocHGlobal(cSize);
        IntPtr u = Marshal.AllocHGlobal(MAXW * MAXH), v = Marshal.AllocHGlobal(MAXW * MAXH);
        int jpegCap = (int)tjBufSize(MAXW, MAXH, TJSAMP_444);
        IntPtr jpeg = tjAlloc(jpegCap);
        byte* yl = stackalloc byte[256]; byte* cl = stackalloc byte[256];
        for (int i = 0; i < 256; i++)
        {   // TV video is limited range (16-235 / 16-240); JPEG (JFIF) is full range.
            yl[i] = Sat((i - 16) * 255 / 219);
            cl[i] = Sat((i - 128) * 255 / 224 + 128);
        }
        long windowStart = clock.ElapsedMilliseconds, windowFrames = 0;
        while (true)
        {
            long now = clock.ElapsedMilliseconds;
            bool wanted = Volatile.Read(ref clients) > 0 || now - Interlocked.Read(ref lastWanted) < 2000;
            if (!wanted)
            {
                if (now - Interlocked.Read(ref lastWanted) > idleExit * 1000L) Environment.Exit(0);
                fps = 0; Thread.Sleep(200); continue;
            }
            int w = ClampW(wantW), h = ClampH(wantH), quality = Math.Clamp(wantQ, 20, 95);
            long interval = 1000 / Math.Clamp(wantFps, 1, 30);
            long t0 = now;
            var p = new Scaler.CaptureParam { YSize = ySize, CSize = cSize, Y = y, C = c };
            int rc, prot = -1;
            try { Scaler.secvideo_api_capture_is_protect(ref prot); rc = Scaler.secvideo_api_capture_screen(w, h, ref p); }
            catch (Exception e) { rc = -1; error = e.Message; }
            int cw = p.Width, ch = p.Height, fmt = p.Format;
            if (rc < 0 || cw <= 0 || ch <= 0 || cw > w || ch > h)
            {   // Refused (protected video) or failed: send black so the picture does not freeze on the last frame.
                error = prot == 1 ? "protected video (DRM/HDCP): the TV refuses to capture it" : (error.Length > 0 ? error : "capture failed rc=" + rc);
                cw = Math.Min(w, 640); ch = Math.Min(h, 360); fmt = 0;
                new Span<byte>((void*)y, cw * ch).Fill(16);
                new Span<byte>((void*)c, cw * ch / 2).Fill(128);
            }
            else error = "";
            protect = prot;

            // Semi-planar, U first (see Program.cs) -> planar U, V; range-expand everything.
            int cxs = fmt == 2 ? 0 : 1, cys = fmt == 0 ? 1 : 0;
            int pw = (cw + cxs) >> cxs, ph = (ch + cys) >> cys;
            byte* py = (byte*)y, pc = (byte*)c, pu = (byte*)u, pv = (byte*)v;
            for (int i = 0, n = cw * ch; i < n; i++) py[i] = yl[py[i]];
            for (int i = 0, n = pw * ph; i < n; i++) { pu[i] = cl[pc[2 * i]]; pv[i] = cl[pc[2 * i + 1]]; }

            var size = (UIntPtr)jpegCap;
            int sub = fmt == 2 ? TJSAMP_444 : fmt == 1 ? TJSAMP_422 : TJSAMP_420;
            int erc = tjCompressFromYUVPlanes(tj, new[] { y, u, v }, cw, new[] { cw, pw, pw }, ch, sub,
                ref jpeg, ref size, quality, TJFLAG_NOREALLOC | TJFLAG_FASTDCT);
            if (erc == 0)
            {
                var data = new byte[(int)size];
                Marshal.Copy(jpeg, data, 0, data.Length);
                lock (gate) { frame = data; width = cw; height = ch; seq++; frames++; Monitor.PulseAll(gate); }
                windowFrames++;
            }
            else error = "jpeg: " + Marshal.PtrToStringAnsi(tjGetErrorStr2(tj));

            now = clock.ElapsedMilliseconds;
            if (now - windowStart >= 1000) { fps = Math.Round(windowFrames * 1000.0 / (now - windowStart), 1); windowStart = now; windowFrames = 0; }
            long wait = (rc < 0 ? 500 : interval) - (now - t0);
            if (wait > 0) Thread.Sleep((int)wait);
        }
    }

    static byte Sat(int x) => (byte)(x < 0 ? 0 : x > 255 ? 255 : x);

    // fps / q / w / h (or size=WxH) from the request query; each is clamped and applies to the next frame.
    static void ApplyParams(System.Collections.Specialized.NameValueCollection q)
    {
        if (q == null) return;
        if (int.TryParse(q["fps"], out var f)) wantFps = Math.Clamp(f, 1, 30);
        if (int.TryParse(q["q"], out var qu)) wantQ = Math.Clamp(qu, 20, 95);
        var size = q["size"];
        if (size != null) { var p = size.Split('x'); if (p.Length == 2 && int.TryParse(p[0], out var pw) && int.TryParse(p[1], out var ph)) { wantW = ClampW(pw); wantH = ClampH(ph); } }
        else { if (int.TryParse(q["w"], out var w)) wantW = ClampW(w); if (int.TryParse(q["h"], out var h)) wantH = ClampH(h); }
    }

    static void Handle(HttpListenerContext ctx)
    {
        var res = ctx.Response;
        res.Headers["Cache-Control"] = "no-store";
        try
        {
            switch (ctx.Request.Url.AbsolutePath)
            {
                case "/stream": ApplyParams(ctx.Request.QueryString); ServeStream(res); break;
                case "/frame.jpg":
                    ApplyParams(ctx.Request.QueryString);
                    Interlocked.Exchange(ref lastWanted, clock.ElapsedMilliseconds);
                    var one = Next(-1, 3000);
                    if (one == null) { res.StatusCode = 503; break; }
                    res.ContentType = "image/jpeg"; res.ContentLength64 = one.Length; res.OutputStream.Write(one, 0, one.Length);
                    break;
                case "/status":
                    string json;
                    lock (gate) json = "{\"clients\":" + clients + ",\"fps\":" + fps.ToString(System.Globalization.CultureInfo.InvariantCulture) +
                        ",\"width\":" + width + ",\"height\":" + height + ",\"protect\":" + protect + ",\"frames\":" + frames +
                        ",\"maxFps\":" + wantFps + ",\"quality\":" + wantQ + ",\"reqWidth\":" + ClampW(wantW) + ",\"reqHeight\":" + ClampH(wantH) +
                        ",\"error\":\"" + error.Replace("\\", "/").Replace("\"", "'") + "\"}";
                    var b = Encoding.UTF8.GetBytes(json);
                    res.ContentType = "application/json"; res.ContentLength64 = b.Length; res.OutputStream.Write(b, 0, b.Length);
                    break;
                case "/quit": res.Close(); Environment.Exit(0); break;
                default: res.StatusCode = 404; break;
            }
        }
        catch { }
        finally { try { res.Close(); } catch { } }
    }

    static void ServeStream(HttpListenerResponse res)
    {
        res.ContentType = "multipart/x-mixed-replace; boundary=frame";
        res.SendChunked = true;
        Interlocked.Increment(ref clients);
        try
        {
            long last = -1;
            var o = res.OutputStream;
            while (true)
            {
                byte[] data; long s;
                lock (gate)
                {
                    while (seq == last) if (!Monitor.Wait(gate, 5000)) break;
                    data = frame; s = seq;
                }
                if (s == last || data.Length == 0) { last = s; continue; }
                last = s;
                var head = Encoding.ASCII.GetBytes("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + data.Length + "\r\n\r\n");
                o.Write(head, 0, head.Length); o.Write(data, 0, data.Length); o.Write(new byte[] { 13, 10 }, 0, 2);
                o.Flush();
            }
        }
        catch { }   // the viewer went away
        finally { Interlocked.Decrement(ref clients); Interlocked.Exchange(ref lastWanted, clock.ElapsedMilliseconds); }
    }

    static byte[] Next(long after, int timeoutMs)
    {
        long until = clock.ElapsedMilliseconds + timeoutMs;
        lock (gate)
        {
            long start = seq;
            while (seq == start || seq == after)
            {
                int left = (int)(until - clock.ElapsedMilliseconds);
                if (left <= 0 || !Monitor.Wait(gate, left)) break;
            }
            return seq == start ? null : frame;
        }
    }
}
