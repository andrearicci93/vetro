using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace Launcher.Native
{
    /// <summary>
    /// Output of a fixed command, through libc's popen rather than System.Diagnostics.Process (EFL's own SIGCHLD handler can reap the child
    /// before .NET sees it exit: see TaskSource). Used off the main loop by the Control center's Picture mode and Sleep timer cards, for
    /// <c>busctl</c> and <c>vconftool</c>. Only commands built from fixed text and checked numbers reach it.
    /// </summary>
    internal static class Shell
    {
        [DllImport("libc", SetLastError = true)] private static extern IntPtr popen(string command, string mode);
        [DllImport("libc")] private static extern int pclose(IntPtr stream);
        [DllImport("libc")] private static extern UIntPtr fread(byte[] buffer, UIntPtr size, UIntPtr count, IntPtr stream);

        public static string Read(string command)
        {
            IntPtr f = IntPtr.Zero;
            try
            {
                f = popen(command + " 2>/dev/null", "r");
                if (f == IntPtr.Zero) return "";
                var buf = new byte[4096];
                var ms = new MemoryStream();
                while (true)
                {
                    int n = (int)fread(buf, (UIntPtr)1, (UIntPtr)buf.Length, f);
                    if (n <= 0) break;
                    ms.Write(buf, 0, n);
                    if (ms.Length > 256 * 1024) break;
                }
                return Encoding.UTF8.GetString(ms.GetBuffer(), 0, (int)ms.Length);
            }
            catch (Exception) { return ""; }
            finally { if (f != IntPtr.Zero) pclose(f); }
        }
    }
}
