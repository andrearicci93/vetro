using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Launcher.Core;

namespace Launcher.Native
{
    /// <summary>
    /// Persistent private <c>libdbus-1.so.3</c> system-bus client with serialized locking and automatic
    /// fallback to <see cref="Shell.Read"/> / <see cref="Libc.system"/> on non-Unix hosts or transport errors.
    /// Never call blocking D-Bus round-trips synchronously on the EFL UI main loop.
    /// </summary>
    internal static class DbusBus
    {
        private const string LibDbus = "libdbus-1.so.3";
        private const int DbusBusSystem = 1;
        private const int DefaultTimeoutMs = 1500;
        private const int ScreensaverTimeoutMs = 500;

        private const int DbusTypeInvalid = 0;
        private const int DbusTypeBoolean = (int)'b';
        private const int DbusTypeInt32 = (int)'i';
        private const int DbusTypeUInt32 = (int)'u';
        private const int DbusTypeDouble = (int)'d';
        private const int DbusTypeString = (int)'s';
        private const int DbusTypeArray = (int)'a';
        private const int DbusTypeStruct = (int)'r';

        [StructLayout(LayoutKind.Sequential)]
        private struct DBusError
        {
            public IntPtr Name;
            public IntPtr Message;
            public uint Flags;
            public IntPtr Padding1;
            public IntPtr Padding2;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct DBusMessageIter
        {
            public IntPtr D0;
            public IntPtr D1;
            public IntPtr D2;
            public IntPtr D3;
            public IntPtr D4;
            public IntPtr D5;
            public IntPtr D6;
            public IntPtr D7;
            public IntPtr D8;
            public IntPtr D9;
            public IntPtr D10;
            public IntPtr D11;
            public IntPtr D12;
            public IntPtr D13;
            public IntPtr D14;
            public IntPtr D15;
        }

        [DllImport(LibDbus)] private static extern IntPtr dbus_bus_get_private(int type, ref DBusError error);
        [DllImport(LibDbus)] private static extern void dbus_error_init(ref DBusError error);
        [DllImport(LibDbus)] private static extern void dbus_error_free(ref DBusError error);
        [DllImport(LibDbus)] private static extern int dbus_error_is_set(ref DBusError error);
        [DllImport(LibDbus)] private static extern void dbus_connection_set_exit_on_disconnect(IntPtr connection, int exitOnDisconnect);
        [DllImport(LibDbus)] private static extern void dbus_connection_close(IntPtr connection);
        [DllImport(LibDbus)] private static extern void dbus_connection_unref(IntPtr connection);
        [DllImport(LibDbus)] private static extern IntPtr dbus_connection_send_with_reply_and_block(IntPtr connection, IntPtr message, int timeoutMilliseconds, ref DBusError error);
        [DllImport(LibDbus)] private static extern IntPtr dbus_message_new_method_call(string destination, string path, string iface, string method);
        [DllImport(LibDbus)] private static extern void dbus_message_unref(IntPtr message);
        [DllImport(LibDbus)] private static extern int dbus_message_iter_init(IntPtr message, out DBusMessageIter iter);
        [DllImport(LibDbus)] private static extern void dbus_message_iter_init_append(IntPtr message, out DBusMessageIter iter);
        [DllImport(LibDbus, EntryPoint = "dbus_message_iter_append_basic")]
        private static extern int dbus_message_iter_append_basic_u32(ref DBusMessageIter iter, int type, ref uint value);
        [DllImport(LibDbus, EntryPoint = "dbus_message_iter_append_basic")]
        private static extern int dbus_message_iter_append_basic_i32(ref DBusMessageIter iter, int type, ref int value);
        [DllImport(LibDbus, EntryPoint = "dbus_message_iter_append_basic")]
        private static extern int dbus_message_iter_append_basic_dbl(ref DBusMessageIter iter, int type, ref double value);
        [DllImport(LibDbus, EntryPoint = "dbus_message_iter_append_basic")]
        private static extern int dbus_message_iter_append_basic_ptr(ref DBusMessageIter iter, int type, ref IntPtr value);
        [DllImport(LibDbus)] private static extern int dbus_message_iter_get_arg_type(ref DBusMessageIter iter);
        [DllImport(LibDbus, EntryPoint = "dbus_message_iter_get_basic")]
        private static extern void dbus_message_iter_get_basic_u32(ref DBusMessageIter iter, out uint value);
        [DllImport(LibDbus, EntryPoint = "dbus_message_iter_get_basic")]
        private static extern void dbus_message_iter_get_basic_i32(ref DBusMessageIter iter, out int value);
        [DllImport(LibDbus, EntryPoint = "dbus_message_iter_get_basic")]
        private static extern void dbus_message_iter_get_basic_ptr(ref DBusMessageIter iter, out IntPtr value);
        [DllImport(LibDbus)] private static extern int dbus_message_iter_next(ref DBusMessageIter iter);
        [DllImport(LibDbus)] private static extern void dbus_message_iter_recurse(ref DBusMessageIter iter, out DBusMessageIter sub);

        private static readonly object BusLock = new object();
        private static readonly bool IsUnix = RuntimeInformation.IsOSPlatform(OSPlatform.Linux) || Environment.OSVersion.Platform == PlatformID.Unix;
        private static IntPtr _conn;
        private static bool _nativeUnavailable;

        public static void Close()
        {
            lock (BusLock)
            {
                ResetConnectionLocked();
            }
        }

        private static void ResetConnectionLocked()
        {
            if (_conn != IntPtr.Zero)
            {
                try { dbus_connection_close(_conn); } catch (Exception) { }
                try { dbus_connection_unref(_conn); } catch (Exception) { }
                _conn = IntPtr.Zero;
            }
        }

        private static IntPtr EnsureConnectionLocked()
        {
            if (!IsUnix || _nativeUnavailable) return IntPtr.Zero;
            if (_conn != IntPtr.Zero) return _conn;
            var err = default(DBusError);
            try
            {
                dbus_error_init(ref err);
                IntPtr conn = dbus_bus_get_private(DbusBusSystem, ref err);
                if (conn == IntPtr.Zero || dbus_error_is_set(ref err) != 0)
                {
                    if (conn != IntPtr.Zero)
                    {
                        try { dbus_connection_close(conn); } catch (Exception) { }
                        try { dbus_connection_unref(conn); } catch (Exception) { }
                    }
                    return IntPtr.Zero;
                }
                dbus_connection_set_exit_on_disconnect(conn, 0);
                _conn = conn;
                return _conn;
            }
            catch (DllNotFoundException) { _nativeUnavailable = true; return IntPtr.Zero; }
            catch (EntryPointNotFoundException) { _nativeUnavailable = true; return IntPtr.Zero; }
            catch (BadImageFormatException) { _nativeUnavailable = true; return IntPtr.Zero; }
            catch (Exception) { return IntPtr.Zero; }
            finally
            {
                try { dbus_error_free(ref err); } catch (Exception) { }
            }
        }

        private static bool IsTransportError(string errorName)
        {
            if (string.IsNullOrEmpty(errorName)) return true;
            return errorName.IndexOf("Disconnected", StringComparison.Ordinal) >= 0
                || errorName.IndexOf("IOError", StringComparison.Ordinal) >= 0
                || errorName.IndexOf("NoServer", StringComparison.Ordinal) >= 0;
        }

        private static bool AppendString(ref DBusMessageIter iter, string value)
        {
            byte[] utf8 = Encoding.UTF8.GetBytes(value ?? "");
            IntPtr buf = Marshal.AllocHGlobal(utf8.Length + 1);
            try
            {
                Marshal.Copy(utf8, 0, buf, utf8.Length);
                Marshal.WriteByte(buf, utf8.Length, 0);
                IntPtr ptr = buf;
                return dbus_message_iter_append_basic_ptr(ref iter, DbusTypeString, ref ptr) != 0;
            }
            finally
            {
                Marshal.FreeHGlobal(buf);
            }
        }

        private delegate bool AppendArgsFn(ref DBusMessageIter iter);

        private static bool CallMethod(
            string destination,
            string path,
            string iface,
            string method,
            int timeoutMs,
            AppendArgsFn appendArgs,
            out IntPtr reply,
            out string errorName)
        {
            reply = IntPtr.Zero;
            errorName = "";
            if (!IsUnix || _nativeUnavailable) return false;

            lock (BusLock)
            {
                for (int attempt = 0; attempt < 2; attempt++)
                {
                    IntPtr conn = EnsureConnectionLocked();
                    if (conn == IntPtr.Zero) return false;
                    IntPtr msg = IntPtr.Zero;
                    var err = default(DBusError);
                    try
                    {
                        msg = dbus_message_new_method_call(destination, path, iface, method);
                        if (msg == IntPtr.Zero) return false;
                        if (appendArgs != null)
                        {
                            dbus_message_iter_init_append(msg, out DBusMessageIter appendIter);
                            if (!appendArgs(ref appendIter)) return false;
                        }
                        dbus_error_init(ref err);
                        IntPtr res = dbus_connection_send_with_reply_and_block(conn, msg, timeoutMs, ref err);
                        if (res == IntPtr.Zero || dbus_error_is_set(ref err) != 0)
                        {
                            if (res != IntPtr.Zero) dbus_message_unref(res);
                            errorName = err.Name != IntPtr.Zero ? (Marshal.PtrToStringUTF8(err.Name) ?? "") : "";
                            if (IsTransportError(errorName))
                            {
                                ResetConnectionLocked();
                                if (attempt == 0) continue;
                            }
                            return false;
                        }
                        reply = res;
                        return true;
                    }
                    catch (DllNotFoundException) { _nativeUnavailable = true; ResetConnectionLocked(); return false; }
                    catch (EntryPointNotFoundException) { _nativeUnavailable = true; ResetConnectionLocked(); return false; }
                    catch (BadImageFormatException) { _nativeUnavailable = true; ResetConnectionLocked(); return false; }
                    catch (Exception) { ResetConnectionLocked(); return false; }
                    finally
                    {
                        if (msg != IntPtr.Zero)
                        {
                            try { dbus_message_unref(msg); } catch (Exception) { }
                        }
                        try { dbus_error_free(ref err); } catch (Exception) { }
                    }
                }
            }
            return false;
        }

        private static bool CallMethodNoReply(string destination, string path, string iface, string method, int timeoutMs, AppendArgsFn appendArgs, out string errorName)
        {
            if (!CallMethod(destination, path, iface, method, timeoutMs, appendArgs, out IntPtr reply, out errorName))
                return false;
            if (reply != IntPtr.Zero)
            {
                try { dbus_message_unref(reply); } catch (Exception) { }
            }
            return true;
        }

        public static bool TryGetWinsInfo(out List<WmStackLogic.WinInfo> wins)
        {
            wins = null;
            if (CallMethod("org.enlightenment.wm", "/org/enlightenment/wm", "org.enlightenment.wm.Test", "GetWinsInfo", DefaultTimeoutMs, null, out IntPtr reply, out _))
            {
                try
                {
                    if (ParseWinsInfoReply(reply, out wins)) return true;
                }
                finally
                {
                    if (reply != IntPtr.Zero)
                    {
                        try { dbus_message_unref(reply); } catch (Exception) { }
                    }
                }
            }
            if (!IsUnix) return false;
            return new ShellEnlightenmentWmBackend(Shell.Read).TryGetWinsInfo(out wins);
        }

        private static bool ParseWinsInfoReply(IntPtr reply, out List<WmStackLogic.WinInfo> wins)
        {
            wins = null;
            if (reply == IntPtr.Zero) return false;
            if (dbus_message_iter_init(reply, out DBusMessageIter root) == 0) return false;
            if (dbus_message_iter_get_arg_type(ref root) != DbusTypeUInt32) return false;
            dbus_message_iter_get_basic_u32(ref root, out uint count);
            if (dbus_message_iter_next(ref root) == 0) return false;
            if (dbus_message_iter_get_arg_type(ref root) != DbusTypeArray) return false;

            dbus_message_iter_recurse(ref root, out DBusMessageIter arr);
            var list = new List<WmStackLogic.WinInfo>((int)Math.Min(count, 128u));
            int idx = 0;
            while (dbus_message_iter_get_arg_type(ref arr) == DbusTypeStruct)
            {
                dbus_message_iter_recurse(ref arr, out DBusMessageIter s);
                if (TryReadWinStruct(ref s, idx, out WmStackLogic.WinInfo info))
                    list.Add(info);
                idx++;
                if (dbus_message_iter_next(ref arr) == 0) break;
            }
            wins = list;
            return true;
        }

        private static bool TryReadWinStruct(ref DBusMessageIter s, int index, out WmStackLogic.WinInfo info)
        {
            info = new WmStackLogic.WinInfo { Index = index, Width = 1920, Height = 1080, Layer = -1, Visible = true, IsHidden = false, IsFrameVisible = true };
            if (dbus_message_iter_get_arg_type(ref s) != DbusTypeUInt32) return false;
            dbus_message_iter_get_basic_u32(ref s, out uint winId);
            if (winId == 0 || dbus_message_iter_next(ref s) == 0) return false;
            info.WinId = winId;

            if (dbus_message_iter_get_arg_type(ref s) != DbusTypeString) return false;
            dbus_message_iter_get_basic_ptr(ref s, out IntPtr titlePtr);
            info.Title = titlePtr != IntPtr.Zero ? (Marshal.PtrToStringUTF8(titlePtr) ?? "") : "";
            if (dbus_message_iter_next(ref s) == 0) return false;

            if (dbus_message_iter_get_arg_type(ref s) != DbusTypeInt32) return false;
            dbus_message_iter_get_basic_i32(ref s, out info.X);
            if (dbus_message_iter_next(ref s) == 0 || dbus_message_iter_get_arg_type(ref s) != DbusTypeInt32) return false;
            dbus_message_iter_get_basic_i32(ref s, out info.Y);
            if (dbus_message_iter_next(ref s) == 0 || dbus_message_iter_get_arg_type(ref s) != DbusTypeInt32) return false;
            dbus_message_iter_get_basic_i32(ref s, out info.Width);
            if (dbus_message_iter_next(ref s) == 0 || dbus_message_iter_get_arg_type(ref s) != DbusTypeInt32) return false;
            dbus_message_iter_get_basic_i32(ref s, out info.Height);
            if (dbus_message_iter_next(ref s) == 0 || dbus_message_iter_get_arg_type(ref s) != DbusTypeInt32) return false;
            dbus_message_iter_get_basic_i32(ref s, out info.Layer);

            int boolCount = 0;
            int postBoolIntCount = 0;
            while (dbus_message_iter_next(ref s) != 0)
            {
                int t = dbus_message_iter_get_arg_type(ref s);
                if (t == DbusTypeInvalid) break;
                if (t == DbusTypeBoolean)
                {
                    dbus_message_iter_get_basic_u32(ref s, out uint bv);
                    bool b = bv != 0;
                    if (boolCount == 0) info.IsHidden = b;
                    else if (boolCount == 1) info.Visible = b;
                    else if (boolCount == 2) info.IsFrameVisible = b;
                    boolCount++;
                }
                else if (t == DbusTypeInt32)
                {
                    dbus_message_iter_get_basic_i32(ref s, out int iv);
                    if (postBoolIntCount == 2) info.Iconic = iv;
                    postBoolIntCount++;
                }
            }
            info.BoolCount = boolCount;
            if (boolCount == 2) info.IsFrameVisible = info.Visible;
            else if (boolCount == 1) { info.Visible = info.IsHidden; info.IsHidden = !info.Visible; info.IsFrameVisible = info.Visible; }
            return boolCount >= 1;
        }

        public static bool TryGetWindowNotiLevel(uint winId, out int level)
        {
            level = -1;
            if (CallMethod(
                "org.enlightenment.wm",
                "/org/enlightenment/wm",
                "org.enlightenment.wm.Test",
                "GetWindowNotiLevel",
                DefaultTimeoutMs,
                (ref DBusMessageIter iter) => dbus_message_iter_append_basic_u32(ref iter, DbusTypeUInt32, ref winId) != 0,
                out IntPtr reply,
                out _))
            {
                try
                {
                    if (dbus_message_iter_init(reply, out DBusMessageIter iter) != 0)
                    {
                        int t = dbus_message_iter_get_arg_type(ref iter);
                        if (t == DbusTypeInt32)
                        {
                            dbus_message_iter_get_basic_i32(ref iter, out level);
                            return level >= 0;
                        }
                        if (t == DbusTypeUInt32)
                        {
                            dbus_message_iter_get_basic_u32(ref iter, out uint u);
                            level = (int)u;
                            return level >= 0;
                        }
                    }
                }
                finally
                {
                    if (reply != IntPtr.Zero)
                    {
                        try { dbus_message_unref(reply); } catch (Exception) { }
                    }
                }
            }
            if (!IsUnix) return false;
            return new ShellEnlightenmentWmBackend(Shell.Read).TryGetWindowNotiLevel(winId, out level);
        }

        public static bool TrySetWindowNotiLevel(uint winId, int level)
        {
            if (CallMethodNoReply(
                "org.enlightenment.wm",
                "/org/enlightenment/wm",
                "org.enlightenment.wm.Test",
                "SetWindowNotiLevel",
                DefaultTimeoutMs,
                (ref DBusMessageIter iter) =>
                    dbus_message_iter_append_basic_u32(ref iter, DbusTypeUInt32, ref winId) != 0
                    && dbus_message_iter_append_basic_i32(ref iter, DbusTypeInt32, ref level) != 0,
                out _))
            {
                return true;
            }
            if (!IsUnix) return false;
            return new ShellEnlightenmentWmBackend(Shell.Read).TrySetWindowNotiLevel(winId, level);
        }

        public static bool TrySetWindowStack(uint winId, uint baseWinId, int mode)
        {
            if (CallMethodNoReply(
                "org.enlightenment.wm",
                "/org/enlightenment/wm",
                "org.enlightenment.wm.Test",
                "SetWindowStack",
                DefaultTimeoutMs,
                (ref DBusMessageIter iter) =>
                    dbus_message_iter_append_basic_u32(ref iter, DbusTypeUInt32, ref winId) != 0
                    && dbus_message_iter_append_basic_u32(ref iter, DbusTypeUInt32, ref baseWinId) != 0
                    && dbus_message_iter_append_basic_i32(ref iter, DbusTypeInt32, ref mode) != 0,
                out _))
            {
                return true;
            }
            if (!IsUnix) return false;
            return new ShellEnlightenmentWmBackend(Shell.Read).TrySetWindowStack(winId, baseWinId, mode);
        }

        private static bool TryCallEnlightenmentScrsaver(int cmd, out string replyText)
        {
            replyText = null;
            double arg1 = 0.0;
            if (!CallMethod(
                "org.enlightenment.wm",
                "/org/enlightenment/wm",
                "org.enlightenment.wm.info",
                "scrsaver",
                1000,
                (ref DBusMessageIter iter) =>
                    dbus_message_iter_append_basic_i32(ref iter, DbusTypeInt32, ref cmd) != 0
                    && dbus_message_iter_append_basic_dbl(ref iter, DbusTypeDouble, ref arg1) != 0,
                out IntPtr reply,
                out _))
            {
                return false;
            }
            try
            {
                if (dbus_message_iter_init(reply, out DBusMessageIter iter) != 0
                    && dbus_message_iter_get_arg_type(ref iter) == DbusTypeString)
                {
                    dbus_message_iter_get_basic_ptr(ref iter, out IntPtr ptr);
                    replyText = ptr != IntPtr.Zero ? Marshal.PtrToStringUTF8(ptr) : "";
                }
                return true;
            }
            finally
            {
                if (reply != IntPtr.Zero)
                {
                    try { dbus_message_unref(reply); } catch (Exception) { }
                }
            }
        }

        private static bool TryResetScreensaverActivityNative(string lockDir = "/tmp/vetro-scrsaver.lock")
        {
            if (!IsUnix || _nativeUnavailable) return false;
            string pidPath = lockDir + "/p";
            string disablePath = lockDir + "/d";
            if (Libc.mkdir(lockDir, 493u) != 0)
            {
                int oldPid = 0;
                try
                {
                    if (File.Exists(pidPath))
                    {
                        int.TryParse((File.ReadAllText(pidPath) ?? "").Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out oldPid);
                    }
                }
                catch (Exception) { }
                if (oldPid > 1 && Libc.kill(oldPid, 0) == 0)
                    return true;

                if (File.Exists(disablePath))
                {
                    bool restored = TryCallEnlightenmentScrsaver(2, out _) || TryCallEnlightenmentScrsaver(2, out _);
                    if (!restored) return false;
                    try { File.Delete(disablePath); } catch (Exception) { }
                }
                try { Libc.unlink(pidPath); } catch (Exception) { }
                try { Libc.rmdir(lockDir); } catch (Exception) { }
                if (Libc.mkdir(lockDir, 493u) != 0)
                    return true;
            }

            try
            {
                File.WriteAllText(pidPath, Libc.getpid().ToString(CultureInfo.InvariantCulture));
            }
            catch (Exception) { }

            string stateText;
            if (!TryCallEnlightenmentScrsaver(1, out stateText))
            {
                try { Libc.unlink(pidPath); } catch (Exception) { }
                try { Libc.rmdir(lockDir); } catch (Exception) { }
                return false;
            }

            if (stateText != null && stateText.IndexOf("State: Enabled", StringComparison.Ordinal) >= 0)
            {
                try { File.WriteAllText(disablePath, ""); } catch (Exception) { }
                TryCallEnlightenmentScrsaver(3, out _);
                if (TryCallEnlightenmentScrsaver(2, out _) || TryCallEnlightenmentScrsaver(2, out _))
                {
                    try { File.Delete(disablePath); } catch (Exception) { }
                }
            }

            if (!File.Exists(disablePath))
            {
                try { Libc.unlink(pidPath); } catch (Exception) { }
                try { Libc.rmdir(lockDir); } catch (Exception) { }
            }
            return true;
        }

        public static bool TryDismissAndResetScreensaver()
        {
            return TryResetScreensaverActivity(true);
        }

        public static bool TryResetScreensaverActivity(bool dismissActive = false)
        {
            bool nativeOk = TryResetScreensaverActivityNative();
            if (!dismissActive && nativeOk)
                return true;
            bool ssOk = CallMethodNoReply(
                "org.tizen.ScreenSaver",
                "/Org/Tizen/ScreenSaver",
                "org.tizen.ScreenSaver",
                "SetActivity",
                ScreensaverTimeoutMs,
                null,
                out string ssErr);
            if (!ssOk && ssErr.IndexOf("UnknownObject", StringComparison.Ordinal) >= 0)
            {
                ssOk = CallMethodNoReply(
                    "org.tizen.ScreenSaver",
                    "/org/tizen/ScreenSaver",
                    "org.tizen.ScreenSaver",
                    "SetActivity",
                    ScreensaverTimeoutMs,
                    null,
                    out _);
            }
            bool wmOk = CallMethodNoReply(
                "org.enlightenment.wm",
                "/org/enlightenment/wm",
                "org.enlightenment.wm.Screensaver",
                "Unset",
                ScreensaverTimeoutMs,
                null,
                out _);
            if (nativeOk || (ssOk && wmOk)) return true;
            if (!IsUnix) return false;
            try
            {
                Libc.system(IdleBackdropModel.BuildScreensaverActivityCommand());
                return true;
            }
            catch (Exception) { return false; }
        }

        private static bool IsSafeKeyName(string key)
        {
            if (string.IsNullOrEmpty(key) || key.Length > 32) return false;
            for (int i = 0; i < key.Length; i++)
            {
                char c = key[i];
                bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
                if (!ok) return false;
            }
            return true;
        }

        public static bool TrySetLongpressKeyInfo(bool enable, string key, double durationSec, int pid)
        {
            if (!IsSafeKeyName(key) || pid <= 0) return false;
            string method = enable ? "set_longpress_key_info" : "unset_longpress_key_info";
            if (CallMethodNoReply(
                "keyrouter.dbus.server",
                "/com/burtonini/dbus/ping",
                "wm.keyroutertv.longpress.info",
                method,
                DefaultTimeoutMs,
                (ref DBusMessageIter iter) =>
                    AppendString(ref iter, key)
                    && dbus_message_iter_append_basic_dbl(ref iter, DbusTypeDouble, ref durationSec) != 0
                    && dbus_message_iter_append_basic_i32(ref iter, DbusTypeInt32, ref pid) != 0,
                out _))
            {
                return true;
            }
            if (!IsUnix) return false;
            string cmd = "dbus-send --system --reply-timeout=1500 --print-reply=literal --dest=keyrouter.dbus.server /com/burtonini/dbus/ping "
                + "wm.keyroutertv.longpress.info." + method
                + " string:\"" + key + "\""
                + " double:" + durationSec.ToString("0.0", CultureInfo.InvariantCulture)
                + " int32:" + pid.ToString(CultureInfo.InvariantCulture) + " 2>/dev/null";
            Shell.Read(cmd);
            return true;
        }
    }
}
