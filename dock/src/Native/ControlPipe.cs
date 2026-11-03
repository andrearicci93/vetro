using System;
using System.Runtime.InteropServices;
using System.Text;

namespace Launcher.Native
{
    // A headless command client. The service runs it through the existing root
    // adapter so access is made with the same identity as the resident launcher.
    internal static class ControlPipe
    {
        private const string Marker = "VETRO_LAUNCHER_CONTROL_V1";

        // System.Native normalizes the platform-specific stat structure. Mode
        // is at offset 4 in both the TV's .NET Core 3.1 and desktop .NET 10 ABI.
        // Reserve the full 128-byte newer structure; only its stable prefix is read.
        [StructLayout(LayoutKind.Explicit, Size = 128)]
        private struct FileStatus { [FieldOffset(4)] public int Mode; }

        [DllImport("System.Native", EntryPoint = "SystemNative_FStat", SetLastError = true)]
        private static extern int FStat(IntPtr fd, out FileStatus status);

        private static int Result(string state, string reason, int error = 0)
        {
            Console.WriteLine(Marker + "\t" + state + "\t" + reason + "\t" + error);
            return state == "sent" ? 0 : state == "not-sent" ? 3 : 4;
        }

        public static int Send(string path, string command)
        {
            if (command != "show" && command != "hide" && command != "toggle")
                return Result("not-sent", "invalid-command");
            int fd = -1;
            bool writeStarted = false;
            try
            {
                // Linux ARM32 uses a different O_NOFOLLOW value from x86/ARM64.
                int noFollow = RuntimeInformation.ProcessArchitecture == Architecture.Arm ? 0x8000 : 0x20000;
                fd = Libc.open(path, Libc.O_WRONLY | Libc.O_NONBLOCK | noFollow);
                if (fd < 0) return Result("not-sent", "open", Marshal.GetLastWin32Error());
                FileStatus status;
                if (FStat((IntPtr)fd, out status) != 0)
                    return Result("not-sent", "stat", Marshal.GetLastWin32Error());
                if ((status.Mode & 0xF000) != 0x1000) return Result("not-sent", "not-fifo");
                byte[] bytes = Encoding.ASCII.GetBytes(command + "\n");
                // This is one atomic write below PIPE_BUF. Never retry a toggle.
                writeStarted = true;
                long count = Libc.write(fd, bytes, (UIntPtr)bytes.Length).ToInt64();
                if (count == bytes.Length) return Result("sent", "ok");
                if (count < 0) return Result("not-sent", "write", Marshal.GetLastWin32Error());
                return Result("unknown", "partial-write");
            }
            catch (Exception)
            {
                return Result(writeStarted ? "unknown" : "not-sent", "native-error");
            }
            finally
            {
                // Closing an already-written descriptor cannot undo delivery.
                if (fd >= 0) { try { Libc.close(fd); } catch (Exception) { } }
            }
        }
    }
}
