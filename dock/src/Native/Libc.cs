using System;
using System.Runtime.InteropServices;

namespace Launcher.Native
{
    /// <summary>
    /// The few libc calls the launcher needs. Environment.SetEnvironmentVariable only changes
    /// the managed copy on Unix, so EFL (which calls getenv) never sees it; setenv does.
    /// </summary>
    internal static class Libc
    {
        private const string C = "libc.so.6";
        public const int O_RDONLY = 0;
        public const int O_RDWR = 2;
        public const int O_NONBLOCK = 0x800;   // Linux (ARM and x86)
        public const int O_WRONLY = 1;
        public const int EAGAIN = 11;

        [DllImport(C, SetLastError = true)] public static extern int setenv(string name, string value, int overwrite);
        [DllImport(C, SetLastError = true)] public static extern int mkfifo(string path, uint mode);
        [DllImport(C, SetLastError = true)] public static extern int open(string path, int flags);
        [DllImport(C, SetLastError = true)] public static extern int close(int fd);
        [DllImport(C, SetLastError = true)] public static extern IntPtr read(int fd, byte[] buf, UIntPtr count);
        [DllImport(C, SetLastError = true)] public static extern IntPtr write(int fd, byte[] buf, UIntPtr count);
        [DllImport(C)] public static extern uint getuid();
        [DllImport(C)] public static extern int getpid();
        [DllImport(C, SetLastError = true)] public static extern int unlink(string path);
        [DllImport(C, SetLastError = true)] public static extern int kill(int pid, int sig);
        [DllImport(C, SetLastError = true)] public static extern int chmod(string path, uint mode);
        [DllImport(C)] public static extern int system(string command);
    }
}
