using System;
using System.Runtime.InteropServices;

namespace Launcher.Native
{
    internal struct ChildExit
    {
        public int Pid, Code, Signal;
    }

    /// <summary>
    /// One command owned by Ecore, including its exit notification. All calls
    /// run on the main loop. A command cannot be replaced until its exit has
    /// been consumed. This never installs a competing SIGCHLD handler.
    /// </summary>
    internal sealed class EcoreChildProcess : IDisposable
    {
        private readonly Efl.EventCb _exitCallback;
        private IntPtr _handler, _exe;
        private ChildExit? _exit;
        public int Pid { get; private set; }
        public bool IsRunning { get { return _exe != IntPtr.Zero; } }

        public EcoreChildProcess() { _exitCallback = OnExit; }

        public void Start(string command)
        {
            if (IsRunning || _exit.HasValue) throw new InvalidOperationException("Previous command has not been consumed");
            if (string.IsNullOrWhiteSpace(command)) throw new ArgumentException("Command is required", nameof(command));
            if (_handler == IntPtr.Zero)
            {
                _handler = Efl.ecore_event_handler_add(Efl.ExeExitEventType(), _exitCallback, IntPtr.Zero);
                if (_handler == IntPtr.Zero) throw new InvalidOperationException("Ecore process handler could not be registered");
            }
            _exe = Efl.ecore_exe_run(command, IntPtr.Zero);
            if (_exe == IntPtr.Zero) throw new InvalidOperationException("Ecore command did not start");
            Pid = Efl.ecore_exe_pid_get(_exe);
        }

        private byte OnExit(IntPtr data, int type, IntPtr ev)
        {
            // Read only the stable prefix of Ecore_Exe_Event_Del: pid, exit_code,
            // exe pointer, exit_signal. Bitfields/siginfo_t are platform-specific.
            if (_exe != IntPtr.Zero && ev != IntPtr.Zero && Marshal.ReadIntPtr(ev, 8) == _exe)
            {
                _exit = new ChildExit {
                    Pid = Marshal.ReadInt32(ev), Code = Marshal.ReadInt32(ev, 4),
                    Signal = Marshal.ReadInt32(ev, 8 + IntPtr.Size)
                };
                _exe = IntPtr.Zero;
            }
            // Ecore frees the handle after event dispatch. Do not free it here,
            // invoke application callbacks, or consume other handlers' events.
            return 1;
        }

        public bool TryTakeExit(out ChildExit result)
        {
            result = _exit.GetValueOrDefault();
            if (!_exit.HasValue) return false;
            _exit = null;
            Pid = 0;
            return true;
        }

        public void Kill()
        {
            // Killing is not completion: wait for the normal exit event before
            // releasing any operation that must follow this command.
            if (IsRunning) Efl.ecore_exe_kill(_exe);
        }

        public void Dispose()
        {
            if (IsRunning) throw new InvalidOperationException("Cannot discard a running Ecore command");
            if (_handler != IntPtr.Zero) Efl.ecore_event_handler_del(_handler);
            _handler = IntPtr.Zero;
            GC.KeepAlive(_exitCallback);
        }
    }
}
