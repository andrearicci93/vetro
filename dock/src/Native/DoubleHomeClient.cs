using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Launcher.Core;

namespace Launcher.Native
{
    // Runs through the root agent before EFL and instance setup. It never opens
    // a window, changes the pidfile, or starts/stops the resident launcher.
    internal static class DoubleHomeClient
    {
        internal static int NoFollowFlag(Architecture architecture) { return architecture == Architecture.Arm ? 1 << 15 : 1 << 17; }

        private static bool IsPipe(int fd)
        {
            // Inspect the opened descriptor, not a pathname that can be replaced.
            // The shell builtin avoids a stat structure ABI or newer libc dependency.
            using (var test = Process.Start(new ProcessStartInfo {
                FileName = "/bin/sh", Arguments = "-c \"test -p /proc/" + Libc.getpid() + "/fd/" + fd + "\"",
                UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true }))
            {
                if (!test.WaitForExit(1000)) { test.Kill(); test.WaitForExit(1000); return false; }
                return test.ExitCode == 0;
            }
        }

        private static bool IsLauncher(int pid, string file)
        {
            string[] args = File.ReadAllText("/proc/" + pid + "/cmdline").Split('\0');
            bool launcher = false, settings = false;
            for (int i = 0; i < args.Length; i++)
            {
                if (Path.GetFileName(args[i]) == "tvlauncher-dotnet.dll") launcher = true;
                if (args[i] == "--double-home-settings" && i + 1 < args.Length && args[i+1] == file) settings = true;
            }
            return launcher && settings;
        }

        internal static string Apply(string encoded, string runDir, string file, int waitMs = 3000)
        {
            if (encoded == null || encoded.Length > 344) throw new InvalidDataException("Invalid settings request");
            byte[] bytes = Convert.FromBase64String(encoded);
            if (bytes.Length > 256) throw new InvalidDataException("Settings request is too large");
            foreach (byte b in bytes) if (b > 127) throw new InvalidDataException("Invalid settings encoding");
            string request = Encoding.ASCII.GetString(bytes);
            string[] fields = request.Split('\t');
            int pid;
            DoubleHomeSettings setting;
            if (fields.Length != 5 || !int.TryParse(fields[2], NumberStyles.None, CultureInfo.InvariantCulture, out pid) ||
                !DoubleHomeSettings.TryParse(request, pid, out setting)) throw new InvalidDataException("Invalid settings request");
            if (String.IsNullOrEmpty(runDir) || String.IsNullOrEmpty(file) || !Directory.Exists(runDir) ||
                Path.GetFullPath(file) != Path.Combine(Path.GetFullPath(runDir), "tvlauncher-double-home.tsv"))
                throw new InvalidDataException("Invalid launcher settings location");
            if (File.ReadAllText(Path.Combine(runDir,"tvlauncher.pid")).Trim() != pid.ToString(CultureInfo.InvariantCulture) || !IsLauncher(pid,file))
                throw new InvalidOperationException("The running launcher changed or does not support live settings");

            int fd = -1;
            bool staged = false;
            string temporary = file + ".tmp";
            try
            {
                fd = Libc.open(Path.Combine(runDir,"tvlauncher.fifo"), Libc.O_WRONLY | Libc.O_NONBLOCK |
                    NoFollowFlag(RuntimeInformation.ProcessArchitecture) | 0x80000);
                if (fd < 0) throw new IOException("Cannot open launcher control pipe (errno " + Marshal.GetLastWin32Error() + ")");
                if (!IsPipe(fd)) throw new IOException("Launcher control path is not a pipe");
                File.WriteAllText(temporary, request, Encoding.ASCII);
                if (Libc.chmod(temporary,384u) != 0) throw new IOException("Cannot prepare private launcher settings");
                File.Move(temporary,file,true); staged = true;
                byte[] command = Encoding.ASCII.GetBytes("reload-double-home\n");
                if ((long)Libc.write(fd,command,(UIntPtr)command.Length) != command.Length) throw new IOException("Launcher control request was incomplete");
                var clock = Stopwatch.StartNew();
                do
                {
                    try
                    {
                        var info = new FileInfo(file + ".applied");
                        if (info.Exists && info.Length <= 256 && File.ReadAllText(info.FullName) == request)
                            return "double-home-applied " + fields[1];
                    }
                    catch (IOException) { }
                    Thread.Sleep(25);
                } while (clock.ElapsedMilliseconds < waitMs);
                throw new TimeoutException("The running launcher did not acknowledge the setting");
            }
            finally
            {
                if (fd >= 0) Libc.close(fd);
                if (staged) try { File.Delete(file); } catch (IOException) { }
                try { File.Delete(temporary); } catch (IOException) { }
            }
        }

        internal static int Run(string encoded, string runDir, string file)
        {
            try { Console.WriteLine(Apply(encoded,runDir,file)); return 0; }
            catch (Exception error) { Console.Error.WriteLine("Live double-press update failed: " + error.Message); return 2; }
        }
    }
}
