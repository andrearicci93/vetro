using System;
using System.Runtime.InteropServices;

namespace Tuner.Native
{
    /// <summary>
    /// The few libc calls the tuner needs. Environment.SetEnvironmentVariable only changes the managed copy on Unix,
    /// so EFL (which calls getenv) never sees it; setenv does.
    /// </summary>
    internal static class Libc
    {
        private const string C = "libc.so.6";
        public const int O_RDONLY = 0;
        public const int O_NONBLOCK = 0x800;   // Linux (ARM and x86)
        public const int O_RDWR = 2;
        public const int F_SETFL = 4;
        public const int EAGAIN = 11;

        [DllImport(C, SetLastError = true)] public static extern int setenv(string name, string value, int overwrite);
        // PR_SET_NAME (15): names the calling thread in /proc (15 bytes at most). .NET on these TVs leaves its threads named after the
        // process, so a diagnostics list of the tuner's threads could not tell the TV-service worker from the others.
        [DllImport(C)] private static extern int prctl(int option, string name, IntPtr a3, IntPtr a4, IntPtr a5);
        public static void NameThread(string name) { try { prctl(15, name, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero); } catch (Exception) { } }
        [DllImport(C, SetLastError = true)] public static extern int open(string path, int flags);
        [DllImport(C, SetLastError = true)] public static extern int close(int fd);
        [DllImport(C, SetLastError = true)] public static extern IntPtr read(int fd, byte[] buf, UIntPtr count);
        [DllImport(C, SetLastError = true)] public static extern IntPtr write(int fd, byte[] buf, UIntPtr count);
        [DllImport(C, SetLastError = true)] public static extern int pipe(int[] fds);
        [DllImport(C, SetLastError = true)] public static extern int fcntl(int fd, int cmd, int arg);
        [DllImport(C, SetLastError = true)] public static extern int mkfifo(string path, uint mode);
        [DllImport(C, SetLastError = true)] public static extern int chmod(string path, uint mode);
        [DllImport(C, SetLastError = true)] public static extern int unlink(string path);
        [DllImport(C)] public static extern uint getuid();
        [DllImport(C)] public static extern int getpid();
    }
}
