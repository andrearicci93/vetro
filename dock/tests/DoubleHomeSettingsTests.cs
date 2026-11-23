using System;
using System.IO;
using Launcher.Core;

namespace Launcher.Tests
{
    internal static class DoubleHomeSettingsTests
    {
        private const string Prefix = "v1\t0123456789abcdef0123456789abcdef\t4242\t";
        public static void Run()
        {
            T.Run("Live double Home: fixed command survives split FIFO reads", () => {
                var commands = new CommandBuffer();
                byte[] first = System.Text.Encoding.ASCII.GetBytes("reload-double-");
                byte[] second = System.Text.Encoding.ASCII.GetBytes("home\nunknown\n");
                T.Eq(commands.Feed(first, first.Length).Count, 0, "partial command waits");
                var result = commands.Feed(second, second.Length);
                T.Eq(result.Count, 1, "one recognized command");
                T.Eq(result[0], Command.ReloadDoubleHome, "live update command");
            });
            T.Run("Live double Home: strict request and process identity", () => {
                DoubleHomeSettings value;
                T.True(DoubleHomeSettings.TryParse(Prefix + "app\tGlassHome1.Home\n", 4242, out value), "valid request");
                T.Eq(value.AppId, "GlassHome1.Home", "destination");
                foreach (string bad in new[] {Prefix + "app\tbad;id\n", Prefix + "app\t\n", Prefix + "off\tapp\n", Prefix + "unknown\t\n", Prefix + "shortcut\t\nextra", Prefix + "app\t" + new string('a',121) + "\n", Prefix + "off\t", "v2" + Prefix.Substring(2) + "off\t\n"})
                    T.True(!DoubleHomeSettings.TryParse(bad, 4242, out value), "invalid request rejected");
                T.True(!DoubleHomeSettings.TryParse(Prefix + "off\t\n", 4243, out value), "request for previous process rejected");
            });
            T.Run("Live double Home: enable, target changes, shortcut and disable", () => {
                var home = new AppEntry("customhome", "Home", "Tile.Home", "Samsung.Fallback");
                var apps = new[] {home};
                T.Eq(DoubleHomeSettings.Resolve("app", "GlassHome1.Home", apps).AppId, "GlassHome1.Home", "independent app");
                T.Eq(DoubleHomeSettings.Resolve("app", "Other.Home", apps).AppId, "Other.Home", "new app");
                T.Eq(DoubleHomeSettings.Resolve("shortcut", null, apps), home, "existing Home shortcut");
                T.Eq(DoubleHomeSettings.Resolve("app", "com.samsung.tv.csfs", apps).AppId, "Samsung.Fallback", "Samsung routing retained");
                T.Eq(DoubleHomeSettings.Resolve("off", null, apps), null, "disabled");
            });
            T.Run("Live double Home: acknowledge only after application", () => {
                string dir = Path.Combine(Path.GetTempPath(), "double-home-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(dir);
                string file = Path.Combine(dir, "request"), request = Prefix + "app\tGlassHome1.Home\n";
                try
                {
                    File.WriteAllText(file, request);
                    AppEntry applied = null;
                    DoubleHomeSettings.ApplyFile(file, 4242, new AppEntry[0], target => {
                        T.True(!File.Exists(file + ".applied"), "not acknowledged before application");
                        applied = target;
                    });
                    T.Eq(applied.AppId, "GlassHome1.Home", "runtime applied");
                    T.Eq(File.ReadAllText(file + ".applied"), request, "exact request acknowledged");
                    File.WriteAllText(file, Prefix + "off\t\n");
                    bool rejected = false;
                    try { DoubleHomeSettings.ApplyFile(file, 4243, new AppEntry[0], target => { throw new Exception("must not apply"); }); }
                    catch (InvalidDataException) { rejected = true; }
                    T.True(rejected, "stale process request rejected");
                    T.Eq(File.ReadAllText(file + ".applied"), request, "stale request never acknowledged");
                    try { DoubleHomeSettings.ApplyFile(file, 4242, new AppEntry[0], target => { throw new InvalidOperationException("apply failed"); }); }
                    catch (InvalidOperationException) { }
                    T.Eq(File.ReadAllText(file + ".applied"), request, "failed application never acknowledged");
                    try { DoubleHomeSettings.ApplyFile(file, 4242, new AppEntry[0], target => { applied = target; }, temporary => { throw new IOException("publish failed"); }); }
                    catch (IOException) { }
                    T.Eq(File.ReadAllText(file + ".applied"), request, "failed publication never acknowledged");
                    T.True(!File.Exists(file + ".applied.tmp"), "temporary response cleaned after failure");
                    DoubleHomeSettings.ApplyFile(file, 4242, new AppEntry[0], target => { applied = target; });
                    T.Eq(applied, null, "disabled in running process");
                    T.Eq(File.ReadAllText(file + ".applied"), Prefix + "off\t\n", "acknowledgement replaced");
                }
                finally { Directory.Delete(dir, true); }
            });
        }
    }
}
