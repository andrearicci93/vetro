using System;
using System.IO;
using Tuner.Core;

internal static partial class Tests
{
    private static void HdrDimTests()
    {
        Check(HdrDim.NormalizeBrightness(-10) == 20, "hdr: clamp below 20");
        Check(HdrDim.NormalizeBrightness(140) == 100, "hdr: clamp above 100");
        Check(HdrDim.ParseBrightness(null) == 60 && HdrDim.ParseBrightness("bad") == 60, "hdr: parse fallback to default 60");
        Check(HdrDim.ParseBrightness(" 70 ") == 70 && HdrDim.ParseBrightness("150") == 100, "hdr: parse valid and clamp");
        Check(HdrDim.ParseBaseBrightness(null) == 100 && HdrDim.ParseBaseBrightness("bad") == 100, "hdr: base parse fallback to 100");
        Check(HdrDim.ParseBaseBrightness(" 80 ") == 80 && HdrDim.ParseBaseBrightness("10") == 20, "hdr: base parse valid and clamp");

        Check(Math.Abs(HdrDim.Factor(false, true, 20) - 1.0) < 1e-9, "hdr: disabled with default base stays 1.0");
        Check(Math.Abs(HdrDim.Factor(false, true, 60, 70) - 0.70) < 1e-9, "hdr: disabled uses base brightness");
        Check(Math.Abs(HdrDim.Factor(true, false, 20) - 1.0) < 1e-9, "hdr: SDR with default base stays 1.0");
        Check(Math.Abs(HdrDim.Factor(true, false, 60, 80) - 0.80) < 1e-9, "hdr: SDR uses base brightness");
        Check(Math.Abs(HdrDim.Factor(true, true, 20) - 0.20) < 1e-9, "hdr: 20% maps directly to 0.20");
        Check(Math.Abs(HdrDim.Factor(true, true, 60, 80) - 0.60) < 1e-9, "hdr: 60% maps directly to 0.60");
        Check(Math.Abs(HdrDim.Factor(true, true, 60, 40) - 0.40) < 1e-9, "hdr: HDR capped by lower base brightness");
        Check(Math.Abs(HdrDim.Factor(true, true, 100) - 1.0) < 1e-9, "hdr: 100% maps to 1.00");

        Check(HdrDim.Channel(255, 0.60) == 153, "hdr: premultiplied channel at alpha 255");
        Check(HdrDim.Channel(100, 0.50) == 50, "hdr: premultiplied channel never exceeds alpha");
        Check(HdrDim.Channel(0, 0.20) == 0, "hdr: alpha 0 stays 0");

        Check(HdrDim.ParseStatus("ii 1 0\n") == true, "hdr: busctl HDR active");
        Check(HdrDim.ParseStatus("ii 0 0") == false, "hdr: busctl SDR");
        Check(HdrDim.ParseStatus("ii 1 -1") == null, "hdr: non-zero rc is null");
        Check(HdrDim.ParseStatus("   int32 1\n   int32 0\n") == true, "hdr: dbus-send literal HDR active");
        Check(HdrDim.ParseStatus("   int32 0\n   int32 0\n") == false, "hdr: dbus-send literal SDR");
        Check(HdrDim.ParseStatus("Failed") == null && HdrDim.ParseStatus("") == null, "hdr: garbage is null");
        Check(HdrDim.IsHdrSignalLine("signal time=1.0 path=/org/tizen/tv/avoc; interface=org.tizen.tv.avoc.AvOutputControl; member=HdrModeChanged"), "hdr: signal line matched");
        Check(!HdrDim.IsHdrSignalLine("member=PictureModeChanged"), "hdr: other signal ignored");

        bool enabled;
        int brightness;
        Features.ParseHdrConfig("motion=0\nhdr_dim=1\nhdr_brightness=60\n", out enabled, out brightness);
        Check(enabled && brightness == 60, "features: hdr_dim and hdr_brightness parsed alongside motion");
        var set = Features.Parse("motion=0\nhdr_dim=1\nhdr_brightness=60\nui_brightness=70\n");
        Check(set.Contains("motion") && !set.Contains("hdr_dim") && !set.Contains("ui_brightness"), "features: Parse ignores hdr and ui brightness keys");

        string tmp = Path.Combine(Path.GetTempPath(), "vetro-tuner-hdr-" + Guid.NewGuid().ToString("N"));
        try
        {
            File.WriteAllText(tmp, "motion=0\nhdr_dim=1\nhdr_brightness=20\nui_brightness=70\n");
            var f = new Features(tmp, () => 1000L);
            Check(!f.On("motion") && f.HdrDimEnabled && f.HdrBrightness == 20 && f.UiBrightness == 70, "features: live read returns motion + hdr + ui brightness settings");
            Check(f.HdrDimOverride == true && f.HdrBrightnessOverride == 20 && f.UiBrightnessOverride == 70, "features: explicit override values returned");
            File.WriteAllText(tmp, "hdr_dim=0\n");
            var fOff = new Features(tmp, () => 2000L);
            Check(fOff.HdrDimOverride == false && fOff.HdrBrightnessOverride == null && fOff.UiBrightnessOverride == null && fOff.UiBrightness == 100, "features: hdr_dim=0 overrides CLI true and leaves brightness overrides null");
            File.WriteAllText(tmp, "motion=0\n");
            var fAbsent = new Features(tmp, () => 3000L);
            Check(fAbsent.HdrDimOverride == null && fAbsent.HdrBrightnessOverride == null && fAbsent.UiBrightnessOverride == null, "features: absent hdr keys yield null overrides");
        }
        finally
        {
            try { if (File.Exists(tmp)) File.Delete(tmp); } catch (Exception) { }
        }
    }
}
