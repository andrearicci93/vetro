using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using Launcher.Core;

namespace Launcher.Native
{
    /// <summary>
    /// Watches Samsung's AV output daemon (avocd) for HDR state transitions off the EFL main loop
    /// using an in-process private <c>libdbus-1.so.3</c> connection (never spawning child processes
    /// from an EFL host, which collides with EFL's SIGCHLD handler). Falls back to <c>popen</c>
    /// polling only if <c>libdbus-1.so.3</c> cannot be loaded.
    /// </summary>
    internal sealed class HdrWatcher : IDisposable
    {
        private const string LibDbus = "libdbus-1.so.3";
        private const int DbusBusSystem = 1;
        private const int DbusTypeInt32 = (int)'i';
        private const int DbusTypeUInt32 = (int)'u';
        private const int DbusCallTimeoutMs = 3000;
        private const int DbusReadTimeoutMs = 500;
        private const int PollFallbackMs = 3000;
        private const int PollResyncMs = 10000;
        private const int SettleRecheckMs = 350;
        private const double WakeJumpMs = 2500.0;

        private const string AvocDest = "org.tizen.tv.avoc";
        private const string AvocPath = "/org/tizen/tv/avoc";
        private const string AvocInterface = "org.tizen.tv.avoc.AvOutputControl";
        private const string StatusMethod = "GetHdrStatus";
        private const string SignalMember = "HdrModeChanged";
        private const string SignalMatch = "type='signal',interface='org.tizen.tv.avoc.AvOutputControl',member='HdrModeChanged'";

        private const string BusctlStatusCmd = "/usr/bin/busctl --system --timeout=3 call org.tizen.tv.avoc /org/tizen/tv/avoc org.tizen.tv.avoc.AvOutputControl GetHdrStatus";
        private const string DbusSendStatusCmd = "/usr/bin/dbus-send --system --reply-timeout=3000 --print-reply=literal --dest=org.tizen.tv.avoc /org/tizen/tv/avoc org.tizen.tv.avoc.AvOutputControl.GetHdrStatus";

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

        [DllImport(LibDbus)] private static extern int dbus_threads_init_default();
        [DllImport(LibDbus)] private static extern void dbus_error_init(ref DBusError error);
        [DllImport(LibDbus)] private static extern void dbus_error_free(ref DBusError error);
        [DllImport(LibDbus)] private static extern int dbus_error_is_set(ref DBusError error);
        [DllImport(LibDbus)] private static extern IntPtr dbus_bus_get_private(int type, ref DBusError error);
        [DllImport(LibDbus)] private static extern void dbus_bus_add_match(IntPtr connection, string rule, ref DBusError error);
        [DllImport(LibDbus)] private static extern void dbus_connection_set_exit_on_disconnect(IntPtr connection, int exitOnDisconnect);
        [DllImport(LibDbus)] private static extern void dbus_connection_flush(IntPtr connection);
        [DllImport(LibDbus)] private static extern int dbus_connection_read_write(IntPtr connection, int timeoutMilliseconds);
        [DllImport(LibDbus)] private static extern IntPtr dbus_connection_pop_message(IntPtr connection);
        [DllImport(LibDbus)] private static extern int dbus_connection_get_is_connected(IntPtr connection);
        [DllImport(LibDbus)] private static extern IntPtr dbus_connection_send_with_reply_and_block(IntPtr connection, IntPtr message, int timeoutMilliseconds, ref DBusError error);
        [DllImport(LibDbus)] private static extern void dbus_connection_close(IntPtr connection);
        [DllImport(LibDbus)] private static extern void dbus_connection_unref(IntPtr connection);
        [DllImport(LibDbus)] private static extern IntPtr dbus_message_new_method_call(string destination, string path, string iface, string method);
        [DllImport(LibDbus)] private static extern int dbus_message_is_signal(IntPtr message, string iface, string signalName);
        [DllImport(LibDbus)] private static extern void dbus_message_unref(IntPtr message);
        [DllImport(LibDbus)] private static extern int dbus_message_iter_init(IntPtr message, out DBusMessageIter iter);
        [DllImport(LibDbus)] private static extern int dbus_message_iter_get_arg_type(ref DBusMessageIter iter);
        [DllImport(LibDbus, EntryPoint = "dbus_message_iter_get_basic")]
        private static extern void dbus_message_iter_get_basic_i32(ref DBusMessageIter iter, out int value);
        [DllImport(LibDbus, EntryPoint = "dbus_message_iter_get_basic")]
        private static extern void dbus_message_iter_get_basic_u32(ref DBusMessageIter iter, out uint value);
        [DllImport(LibDbus)] private static extern int dbus_message_iter_next(ref DBusMessageIter iter);

        private readonly Action<string> _log;
        private readonly Action<bool> _onChange;
        private readonly Efl.FdCb _wakeCb;
        private readonly byte[] _wakeBuf = new byte[32];
        private readonly byte[] _wakeByte = { 1 };
        private readonly object _wakeLock = new object();

        private int _wakeRead = -1, _wakeWrite = -1;
        private IntPtr _wakeHandler;
        private volatile bool _stop;
        private volatile bool _isHdr;
        private bool _hasInitial;
        private bool _reportedHdr;
        private bool _nativeUnavailable;
        private bool _fallbackWarned;

        public HdrWatcher(Action<string> log, Action<bool> onChange)
        {
            _log = log ?? (_ => { });
            _onChange = onChange ?? (_ => { });
            _wakeCb = OnWake;

            int[] fds = new int[2];
            if (Libc.pipe(fds) != 0)
            {
                _log("hdr: wake pipe failed: " + Marshal.GetLastWin32Error());
                return;
            }
            _wakeRead = fds[0];
            _wakeWrite = fds[1];
            Libc.fcntl(_wakeRead, Libc.F_SETFL, Libc.O_NONBLOCK);
            Libc.fcntl(_wakeWrite, Libc.F_SETFL, Libc.O_NONBLOCK);
            _wakeHandler = Efl.ecore_main_fd_handler_add(_wakeRead, Efl.EcoreFdRead, _wakeCb, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);

            var thread = new Thread(Run) { IsBackground = true, Name = "vetro-hdr" };
            thread.Start();
        }

        private void Run()
        {
            try
            {
                if (!InitDbusThreads())
                    _nativeUnavailable = true;

                while (!_stop)
                {
                    if (!_nativeUnavailable && WatchDbusLoop())
                    {
                        if (_stop) break;
                        SleepInterruptible(PollFallbackMs);
                        continue;
                    }
                    if (!_nativeUnavailable)
                    {
                        SleepInterruptible(PollFallbackMs);
                        continue;
                    }

                    if (!_fallbackWarned)
                    {
                        _fallbackWarned = true;
                        _log("hdr: libdbus unavailable, using 3s popen polling");
                    }
                    UpdateState(QueryHdrStatusPopen());
                    SleepInterruptible(PollFallbackMs);
                }
            }
            catch (Exception ex)
            {
                if (!_stop) _log("hdr watcher: " + ex.Message);
            }
        }

        private bool InitDbusThreads()
        {
            try
            {
                dbus_threads_init_default();
                return true;
            }
            catch (DllNotFoundException) { return false; }
            catch (EntryPointNotFoundException) { return false; }
            catch (BadImageFormatException) { return false; }
        }

        private bool WatchDbusLoop()
        {
            IntPtr conn = IntPtr.Zero;
            var err = default(DBusError);
            try
            {
                dbus_error_init(ref err);
                conn = dbus_bus_get_private(DbusBusSystem, ref err);
                if (conn == IntPtr.Zero || dbus_error_is_set(ref err) != 0)
                    return false;

                dbus_connection_set_exit_on_disconnect(conn, 0);
                dbus_bus_add_match(conn, SignalMatch, ref err);
                if (dbus_error_is_set(ref err) != 0)
                    return false;
                dbus_connection_flush(conn);

                QueryAndNotifyDbus(conn);
                long lastQueryTick = Environment.TickCount64;
                long settleAtTick = 0;
                DateTime lastWall = DateTime.UtcNow;

                while (!_stop && dbus_connection_get_is_connected(conn) != 0)
                {
                    bool signalSeen = false;
                    IntPtr msg;
                    while ((msg = dbus_connection_pop_message(conn)) != IntPtr.Zero)
                    {
                        try
                        {
                            if (dbus_message_is_signal(msg, AvocInterface, SignalMember) != 0)
                                signalSeen = true;
                        }
                        finally
                        {
                            dbus_message_unref(msg);
                        }
                    }

                    long nowTick = Environment.TickCount64;
                    if (signalSeen)
                    {
                        QueryAndNotifyDbus(conn);
                        lastQueryTick = nowTick;
                        settleAtTick = nowTick + SettleRecheckMs;
                        lastWall = DateTime.UtcNow;
                        continue;
                    }

                    if (dbus_connection_read_write(conn, DbusReadTimeoutMs) == 0)
                        break;

                    nowTick = Environment.TickCount64;
                    DateTime nowWall = DateTime.UtcNow;
                    bool wallJump = Math.Abs((nowWall - lastWall).TotalMilliseconds) > WakeJumpMs;
                    lastWall = nowWall;
                    bool settleDue = settleAtTick > 0 && nowTick >= settleAtTick;
                    long interval = _hasInitial ? PollResyncMs : PollFallbackMs;
                    if (wallJump || settleDue || nowTick - lastQueryTick >= interval)
                    {
                        QueryAndNotifyDbus(conn);
                        lastQueryTick = nowTick;
                        if (settleDue) settleAtTick = 0;
                    }
                }
                return true;
            }
            catch (DllNotFoundException) { _nativeUnavailable = true; return false; }
            catch (EntryPointNotFoundException) { _nativeUnavailable = true; return false; }
            catch (BadImageFormatException) { _nativeUnavailable = true; return false; }
            catch (Exception ex)
            {
                if (!_stop) _log("hdr dbus: " + ex.Message);
                return false;
            }
            finally
            {
                try { dbus_error_free(ref err); } catch (Exception) { }
                if (conn != IntPtr.Zero)
                {
                    try { dbus_connection_close(conn); } catch (Exception) { }
                    try { dbus_connection_unref(conn); } catch (Exception) { }
                }
            }
        }

        private void QueryAndNotifyDbus(IntPtr conn)
        {
            UpdateState(QueryHdrStatusDbus(conn));
        }

        private void UpdateState(bool? state)
        {
            if (!state.HasValue) return;
            bool next = state.Value;
            bool changed = !_hasInitial || next != _isHdr;
            _hasInitial = true;
            _isHdr = next;
            if (changed) WakeMainLoop();
        }

        private static bool? QueryHdrStatusDbus(IntPtr conn)
        {
            IntPtr msg = IntPtr.Zero;
            IntPtr reply = IntPtr.Zero;
            var err = default(DBusError);
            try
            {
                dbus_error_init(ref err);
                msg = dbus_message_new_method_call(AvocDest, AvocPath, AvocInterface, StatusMethod);
                if (msg == IntPtr.Zero) return null;

                reply = dbus_connection_send_with_reply_and_block(conn, msg, DbusCallTimeoutMs, ref err);
                if (reply == IntPtr.Zero || dbus_error_is_set(ref err) != 0)
                    return null;

                DBusMessageIter iter;
                if (dbus_message_iter_init(reply, out iter) == 0) return null;
                int status;
                if (!ReadIntArg(ref iter, out status)) return null;
                if (dbus_message_iter_next(ref iter) == 0) return null;
                int rc;
                if (!ReadIntArg(ref iter, out rc)) return null;
                if (rc != 0) return null;
                return status != 0;
            }
            catch (Exception)
            {
                return null;
            }
            finally
            {
                if (reply != IntPtr.Zero) { try { dbus_message_unref(reply); } catch (Exception) { } }
                if (msg != IntPtr.Zero) { try { dbus_message_unref(msg); } catch (Exception) { } }
                try { dbus_error_free(ref err); } catch (Exception) { }
            }
        }

        private static bool ReadIntArg(ref DBusMessageIter iter, out int value)
        {
            int t = dbus_message_iter_get_arg_type(ref iter);
            if (t == DbusTypeInt32)
            {
                dbus_message_iter_get_basic_i32(ref iter, out value);
                return true;
            }
            if (t == DbusTypeUInt32)
            {
                uint u;
                dbus_message_iter_get_basic_u32(ref iter, out u);
                value = unchecked((int)u);
                return true;
            }
            value = 0;
            return false;
        }

        private static bool? QueryHdrStatusPopen()
        {
            if (File.Exists("/usr/bin/busctl"))
            {
                bool? res = HdrDim.ParseStatus(Shell.Read(BusctlStatusCmd));
                if (res.HasValue) return res;
            }
            if (File.Exists("/usr/bin/dbus-send"))
                return HdrDim.ParseStatus(Shell.Read(DbusSendStatusCmd));
            return null;
        }

        private void WakeMainLoop()
        {
            lock (_wakeLock)
            {
                if (_wakeWrite < 0 || _stop) return;
                try { Libc.write(_wakeWrite, _wakeByte, (UIntPtr)1); }
                catch (Exception) { }
            }
        }

        private byte OnWake(IntPtr data, IntPtr handler)
        {
            try
            {
                while (_wakeRead >= 0)
                {
                    long n = (long)Libc.read(_wakeRead, _wakeBuf, (UIntPtr)_wakeBuf.Length);
                    if (n > 0) continue;
                    if (n < 0)
                    {
                        int err = Marshal.GetLastWin32Error();
                        if (err == Libc.EINTR) continue;
                        if (err == Libc.EAGAIN) break;
                    }
                    _wakeHandler = IntPtr.Zero;
                    return 0;
                }
                bool active = _isHdr;
                if (active != _reportedHdr)
                {
                    _reportedHdr = active;
                    _onChange(active);
                }
            }
            catch (Exception ex) { _log("hdr wake: " + ex.Message); }
            return 1;
        }

        private void SleepInterruptible(int totalMs)
        {
            int elapsed = 0;
            while (!_stop && elapsed < totalMs)
            {
                int step = Math.Min(200, totalMs - elapsed);
                Thread.Sleep(step);
                elapsed += step;
            }
        }

        public void Dispose()
        {
            _stop = true;
            if (_wakeHandler != IntPtr.Zero)
            {
                try { Efl.ecore_main_fd_handler_del(_wakeHandler); } catch (Exception) { }
                _wakeHandler = IntPtr.Zero;
            }
            if (_wakeRead >= 0) { try { Libc.close(_wakeRead); } catch (Exception) { } _wakeRead = -1; }
            lock (_wakeLock)
            {
                if (_wakeWrite >= 0) { try { Libc.close(_wakeWrite); } catch (Exception) { } _wakeWrite = -1; }
            }
        }
    }
}
