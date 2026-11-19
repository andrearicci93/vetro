using System.IO;

namespace Tuner.Core
{
    /// <summary>
    /// Where a picture of the tuner is: its own res folder (native/tuner/res), or else the launcher's (native/dock/res). The osd 123's
    /// material (pill_bg, pill_rim, pill_cap) is the same file for both, so the package ships it once, with the launcher (app/build.cjs):
    /// every file costs room in the one script that updates a TV from 0.5.0.
    /// </summary>
    internal static class AssetPath
    {
        public static string Of(string assets, string name)
        {
            string own = Path.Combine(assets, name + ".png");
            if (File.Exists(own)) return own;
            string dock = Path.Combine(assets, "..", "..", "dock", "res", name + ".png");
            return File.Exists(dock) ? dock : own;
        }
    }
}
