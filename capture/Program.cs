// Based on zabique/vetro, branch fork/extras (https://github.com/zabique/vetro), MIT License.
// Copyright (c) 2026 Vetro contributors. Adapted for the screen-share Shard (capture/README.md).
// Whole-screen capture for the Samsung QN85A (Tizen 6) through Samsung's own scaler capture API
// (libvideo-capture.so -> libvideo-capture-impl-sec.so -> DRM_IOCTL_SDP_HW_CAPTURE on /dev/dri/card1).
// Unlike `enlightenment_info -dump topvwins`, this reads the post-scaler picture, so tuner / HDMI / app video
// is included together with the on-screen graphics.
//
// Protected content (HDCP inputs, Widevine/PlayReady streams) is left alone: for those the library takes the
// TrustZone path, which only whitelisted Samsung processes may use, and this tool reports "protected".
//
// usage: dotnet TvCapture.dll <out.png|out.yuv> [width] [height] [--video-only] [--vu]
//        dotnet TvCapture.dll --serve <port> [--fps N] [--size WxH] [--quality Q] [--idle-exit S]   (MJPEG, see Live.cs)
// prints one JSON line: {"ok":..,"width":..,"height":..,"format":..,"protect":..,"ms":..,"error":..}
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Runtime.InteropServices;

static class Program
{
    static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--serve") return Live.Run(args);
        if (args.Length < 1) { Console.Error.WriteLine("usage: TvCapture <out.png|out.yuv> [width] [height] [--video-only] [--vu]"); return 2; }
        string outPath = args[0];
        int w = args.Length > 1 && int.TryParse(args[1], out var a) ? a : 960;
        int h = args.Length > 2 && int.TryParse(args[2], out var b) ? b : 540;
        bool videoOnly = Array.IndexOf(args, "--video-only") >= 0;
        // Chroma bytes come U first (NV12-style), although the library logs its formats as NV21/NV61/NV42;
        // checked on a live frame (red/yellow came out blue with V first). --vu flips it for testing.
        bool uvOrder = Array.IndexOf(args, "--vu") < 0;

        int protect = -1;
        try { Scaler.secvideo_api_capture_is_protect(ref protect); } catch (Exception e) { return Fail("is_protect: " + e.Message, protect, 0); }

        int ySize = w * h, cSize = w * h * 2;   // C sized for 4:4:4, the largest format
        IntPtr y = Marshal.AllocHGlobal(ySize), c = Marshal.AllocHGlobal(cSize);
        unsafe { new Span<byte>((void*)y, ySize).Clear(); new Span<byte>((void*)c, cSize).Clear(); }
        try
        {
            var p = new Scaler.CaptureParam { YSize = ySize, CSize = cSize, Y = y, C = c };
            var sw = Stopwatch.StartNew();
            int rc = videoOnly ? Scaler.secvideo_api_capture_screen_video_only(w, h, ref p) : Scaler.secvideo_api_capture_screen(w, h, ref p);
            long ms = sw.ElapsedMilliseconds;
            if (rc < 0) return Fail(protect == 1 ? "protected content (DRM/HDCP): capture refused" : "capture failed rc=" + rc, protect, ms);
            int cw = p.Width > 0 ? p.Width : w, ch = p.Height > 0 ? p.Height : h;

            var yb = new byte[ySize]; Marshal.Copy(y, yb, 0, ySize);
            var cb = new byte[cSize]; Marshal.Copy(c, cb, 0, cSize);
            if (outPath.EndsWith(".yuv", StringComparison.OrdinalIgnoreCase))
            {
                using var f = File.Create(outPath); f.Write(yb, 0, cw * ch); f.Write(cb, 0, cSize);   // whole chroma buffer, for format checks
            }
            else
            {
                var rgb = ToRgb(yb, cb, cw, ch, p.Format, uvOrder);
                WritePng(outPath, rgb, cw, ch);
            }
            Console.WriteLine("{\"ok\":true,\"width\":" + cw + ",\"height\":" + ch + ",\"format\":" + p.Format +
                ",\"protect\":" + protect + ",\"ms\":" + ms + ",\"rotation\":" + p.Rotation + ",\"flip\":" + p.Flip +
                ",\"mode3d\":" + p.Mode3D + ",\"raw\":[" + p.Out10 + "," + p.Out14 + "," + p.Out18 + "," + p.Out1c + "," + p.Out20 + "]}");
            return 0;
        }
        catch (Exception e) { return Fail(e.GetType().Name + ": " + e.Message, protect, 0); }
        finally { Marshal.FreeHGlobal(y); Marshal.FreeHGlobal(c); }
    }

    static int Fail(string msg, int protect, long ms)
    {
        Console.WriteLine("{\"ok\":false,\"protect\":" + protect + ",\"ms\":" + ms + ",\"error\":\"" + msg.Replace("\\", "/").Replace("\"", "'") + "\"}");
        return 1;
    }

    static int ChromaBytes(int fmt, int w, int h) => fmt == 2 ? w * h * 2 : fmt == 1 ? w * h : w * h / 2;

    // Semi-planar YUV (BT.709, limited range) -> RGB24.
    static byte[] ToRgb(byte[] Y, byte[] C, int w, int h, int fmt, bool uvOrder)
    {
        var rgb = new byte[w * h * 3];
        int cxShift = fmt == 2 ? 0 : 1, cyShift = fmt == 0 ? 1 : 0;
        int cStride = (w >> cxShift) * 2;
        int ui = uvOrder ? 0 : 1, vi = uvOrder ? 1 : 0;
        for (int j = 0; j < h; j++)
        {
            int crow = (j >> cyShift) * cStride, o = j * w * 3, yrow = j * w;
            for (int i = 0; i < w; i++)
            {
                int ci = crow + (i >> cxShift) * 2;
                int yy = (Y[yrow + i] - 16) * 298, u = C[ci + ui] - 128, v = C[ci + vi] - 128;
                rgb[o++] = Clamp((yy + 459 * v + 128) >> 8);
                rgb[o++] = Clamp((yy - 55 * u - 136 * v + 128) >> 8);
                rgb[o++] = Clamp((yy + 541 * u + 128) >> 8);
            }
        }
        return rgb;
    }

    static byte Clamp(int x) => (byte)(x < 0 ? 0 : x > 255 ? 255 : x);

    static void WritePng(string path, byte[] rgb, int w, int h)
    {
        var raw = new byte[(w * 3 + 1) * h];
        for (int j = 0; j < h; j++) Buffer.BlockCopy(rgb, j * w * 3, raw, j * (w * 3 + 1) + 1, w * 3);
        byte[] deflated;
        using (var ms = new MemoryStream())
        {
            using (var ds = new DeflateStream(ms, CompressionLevel.Fastest, true)) ds.Write(raw, 0, raw.Length);
            deflated = ms.ToArray();
        }
        uint s1 = 1, s2 = 0;
        foreach (var x in raw) { s1 = (s1 + x) % 65521; s2 = (s2 + s1) % 65521; }
        var idat = new byte[deflated.Length + 6];
        idat[0] = 0x78; idat[1] = 0x01;
        Buffer.BlockCopy(deflated, 0, idat, 2, deflated.Length);
        uint ad = (s2 << 16) | s1; int n = idat.Length;
        idat[n - 4] = (byte)(ad >> 24); idat[n - 3] = (byte)(ad >> 16); idat[n - 2] = (byte)(ad >> 8); idat[n - 1] = (byte)ad;

        var ihdr = new byte[13];
        BE(ihdr, 0, (uint)w); BE(ihdr, 4, (uint)h); ihdr[8] = 8; ihdr[9] = 2;
        string tmp = path + ".tmp";
        using (var f = File.Create(tmp))
        {
            f.Write(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }, 0, 8);
            Chunk(f, "IHDR", ihdr); Chunk(f, "IDAT", idat); Chunk(f, "IEND", new byte[0]);
        }
        File.Move(tmp, path, true);
    }

    static void BE(byte[] b, int o, uint v) { b[o] = (byte)(v >> 24); b[o + 1] = (byte)(v >> 16); b[o + 2] = (byte)(v >> 8); b[o + 3] = (byte)v; }

    static void Chunk(Stream f, string type, byte[] data)
    {
        var hdr = new byte[8]; BE(hdr, 0, (uint)data.Length);
        for (int i = 0; i < 4; i++) hdr[4 + i] = (byte)type[i];
        f.Write(hdr, 0, 8); f.Write(data, 0, data.Length);
        uint crc = Crc(Crc(0xffffffff, hdr, 4, 4), data, 0, data.Length) ^ 0xffffffff;
        var t = new byte[4]; BE(t, 0, crc); f.Write(t, 0, 4);
    }

    static uint[] crcTable;
    static uint Crc(uint crc, byte[] b, int off, int len)
    {
        if (crcTable == null)
        {
            crcTable = new uint[256];
            for (uint n = 0; n < 256; n++) { uint c = n; for (int k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xedb88320 ^ (c >> 1) : c >> 1; crcTable[n] = c; }
        }
        for (int i = off; i < off + len; i++) crc = crcTable[(crc ^ b[i]) & 0xff] ^ (crc >> 8);
        return crc;
    }
}

// Samsung scaler capture (libvideo-capture.so).
static class Scaler
{
    // secvideo_capture_param, 0x4c bytes; layout read from setParameters()/updateParameters() and
    // scaler_capture_buffer_memcpy()/scaler_capture_fill_captbuff() in the Samsung libraries.
    [StructLayout(LayoutKind.Explicit, Size = 0x4c)]
    internal struct CaptureParam
    {
        [FieldOffset(0x00)] public int YSize;       // in: bytes available at Y
        [FieldOffset(0x04)] public int CSize;       // in: bytes available at C
        [FieldOffset(0x08)] public int Width;       // out
        [FieldOffset(0x0c)] public int Height;      // out
        [FieldOffset(0x10)] public IntPtr Y;        // in: luma buffer
        [FieldOffset(0x14)] public IntPtr C;        // in: interleaved chroma buffer
        [FieldOffset(0x18)] public int Flag18;      // in: left 0 (keeps the library's protected-content path)
        [FieldOffset(0x1c)] public int Format;      // out: 0 = 4:2:0, 1 = 4:2:2, 2 = 4:4:4 (see below)
        [FieldOffset(0x20)] public int Out10;
        [FieldOffset(0x24)] public int Mode3D;      // out
        [FieldOffset(0x28)] public int Out14;
        [FieldOffset(0x2c)] public int Out18;
        [FieldOffset(0x30)] public int Out1c;
        [FieldOffset(0x38)] public long Out20;
        [FieldOffset(0x44)] public int Flip;        // out
        [FieldOffset(0x48)] public int Rotation;    // out
    }

    const string Lib = "libvideo-capture.so.0";
    [DllImport(Lib)] internal static extern int secvideo_api_capture_screen(int width, int height, ref CaptureParam p);
    [DllImport(Lib)] internal static extern int secvideo_api_capture_screen_video_only(int width, int height, ref CaptureParam p);
    [DllImport(Lib)] internal static extern int secvideo_api_capture_is_protect(ref int isProtect);
}
