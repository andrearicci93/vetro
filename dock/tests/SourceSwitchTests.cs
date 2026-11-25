using System;
using System.Collections.Generic;
using System.IO;
using Launcher.Core;

namespace Launcher.Tests
{
    internal static class SourceSwitchTests
    {
        private const string ResourceRoot = "/usr/apps/com.samsung.tv.theme-resource/shared/res/";
        private const string HdmiIcon = ResourceRoot + "VD_ICONS/i_icon_device_m_microhdmi.svg";
        private const string PcIcon = ResourceRoot + "VD_ICONS/i_icon_device_m_pc.svg";
        private const string HdmiFallback = ResourceRoot + "org.tizen.menu/Settings_Popup/device_icon/r_icon_device_s_hdmi1.png";

        private static string Line(string source, string icon, string artwork = "")
        {
            return string.Join("\t", new[] { "in-usbc", "USB-C", source, "", artwork, "", "", source, "", icon });
        }

        private sealed class Control : ISourceControl
        {
            public readonly List<string> Calls = new List<string>();
            public int FailAt;
            private int Step(string call) { Calls.Add(call); return Calls.Count == FailAt ? -13 : 0; }
            public int Create(out IntPtr handle) { handle = new IntPtr(1); return Step("create"); }
            public int SetAppId(IntPtr handle, string id) { return Step("app=" + id); }
            public int AddData(IntPtr handle, string key, string value) { return Step(key + "=" + value); }
            public int Send(IntPtr handle) { return Step("send"); }
            public void Destroy(IntPtr handle) { Calls.Add("destroy"); }
        }

        public static void Run()
        {
            T.Run("source request: launcher and service send the complete native request", () =>
            {
                var api = new Control();
                T.Eq(SourceSwitch.Send(41, "USB-C", PcIcon, p => p == PcIcon, api), 0, "native request accepted");
                T.Eq(string.Join("|", api.Calls), "create|app=org.tizen.tv-viewer|change_source=41|sourceType=41|sourceName=USB-C|sourceIcon=" + PcIcon + "|mbrIndex=-2|__K_EX_LAUNCH_REQUESTOR=user|send|destroy", "all extra data and cleanup are sent in order");
                for (int fail = 1; fail <= 9; fail++)
                {
                    api = new Control { FailAt = fail };
                    T.Eq(SourceSwitch.Send(13, "HDMI", HdmiIcon, p => true, api), -13, "native failure propagates at step " + fail);
                    T.Eq(api.Calls.Contains("destroy"), fail != 1, "only a created handle is destroyed at step " + fail);
                    if (fail < 9) T.True(!api.Calls.Contains("send"), "incomplete request is never launched at step " + fail);
                }
            });

            T.Run("source command: bounded arguments, no GUI state and nonzero failure status", () =>
            {
                var api = new Control();
                var output = new StringWriter();
                T.Eq(SourceSwitch.RunCommand(new[] { "--switch-source", "33", "DisplayPort", PcIcon }, p => true, api, output), 0, "one-shot service request succeeds");
                T.True(output.ToString().Contains("source_type=33 rc=0"), "result identifies the request without private metadata");
                foreach (string value in new[] { "-1", "65536", "41;id", "+41", " 41", "invalid" })
                {
                    api = new Control();
                    T.True(SourceSwitch.RunCommand(new[] { "--switch-source", value, "USB-C", PcIcon }, p => true, api, output) != 0, "invalid ID refused: " + value);
                    T.Eq(api.Calls.Count, 0, "invalid command never creates a request");
                }
                foreach (string label in new[] { "", "bad\nname", new string('x', 81) })
                {
                    api = new Control();
                    T.True(SourceSwitch.Send(41, label, PcIcon, p => true, api) != 0, "invalid label refused");
                    T.Eq(api.Calls.Count, 0, "invalid label cannot launch");
                }
                api = new Control();
                T.True(SourceSwitch.Send(41, "USB-C", "/tmp/private.svg", p => true, api) != 0, "non-firmware icon refused");
                T.True(SourceSwitch.Send(41, "USB-C", PcIcon, p => false, api) != 0, "missing icon refused");
                T.Eq(api.Calls.Count, 0, "invalid or missing icons never reach the API");
                api = new Control { FailAt = 9 };
                T.Eq(SourceSwitch.RunCommand(new[] { "--switch-source", "41", "USB-C", PcIcon }, p => true, api, output), 1, "a rejected native launch cannot look successful to the service");
            });

            T.Run("monitor sources: USB-C retains its source icon independently of artwork", () =>
            {
                var result = Catalog.Parse(Line("source:41", PcIcon));
                T.Eq(result.Problems.Length, 0, "the G8's USB-C source is accepted");
                T.Eq(result.Entries.Length, 1, "one physical input");
                var usb = result.Entries[0];
                T.Eq(usb.SourceType, 41, "the native source ID stays unchanged");
                T.Eq(usb.RowKey, "source:41", "USB-C can be kept in the row");
                T.Eq(usb.SourceIcon, PcIcon, "the SVG path reaches source switching");
                T.Eq(usb.IconPath, null, "Samsung artwork may remain disabled");
                T.True(!Catalog.ValidIconPath(PcIcon), "source SVG support does not change the PNG-only artwork renderer");
                var artwork = ResourceRoot + "icon.png";
                var separate = Catalog.Parse(Line("source:41", PcIcon, artwork)).Entries[0];
                T.Eq(separate.IconPath, artwork, "optional tile artwork has its own value");
                T.Eq(separate.SourceIcon, PcIcon, "the input resource does not follow tile artwork");
                T.True(!ListWatch.Same(result.Entries, Catalog.Parse(Line("source:41", HdmiIcon)).Entries), "a changed source icon reloads the list");
                T.True(ListWatch.Same(result.Entries, Catalog.Parse(Line("source:41", PcIcon)).Entries), "an unchanged resource does not reload");
            });

            T.Run("monitor sources: source resource paths are bounded and apply only to inputs", () =>
            {
                T.True(Catalog.ValidSourceIconPath(HdmiIcon), "Samsung's micro-HDMI SVG is accepted");
                T.True(Catalog.ValidSourceIconPath("/opt/usr/apps/com.samsung.tv.theme-resource/shared/res/a.png"), "the installed-package PNG location is accepted");
                foreach (string path in new[] { "/etc/shadow.svg", "https://example.com/a.svg", "/usr/apps/a/../b.svg", "/usr/apps//a.svg", "/usr/apps/a b.svg", "/usr/apps/a.svg;id", "/usr/apps/a.jpg", "/usr/apps/" + new string('a', 230) + ".svg" })
                {
                    T.True(!Catalog.ValidSourceIconPath(path), "invalid source resource rejected: " + path);
                    T.Eq(Catalog.Parse(Line("source:41", path)).Entries.Length, 0, "invalid resource does not reach native switching");
                }
                T.Eq(Catalog.Parse(Line("org.tizen.browser", PcIcon)).Entries.Length, 0, "an ordinary app cannot carry a source resource");
                T.Eq(Catalog.Parse(Line("key:XF86Menu", PcIcon)).Entries.Length, 0, "a key shortcut cannot carry a source resource");
                var old = Catalog.Parse("in-hdmi1\tHDMI 1\tsource:13");
                T.Eq(old.Entries.Length, 1, "older three-column input lists still parse");
                T.Eq(old.Entries[0].SourceIcon, null, "older lists have no source resource");
            });

            T.Run("monitor sources: use an existing native resource or report it unavailable", () =>
            {
                var hdmi = Catalog.Parse(Line("source:13", HdmiIcon)).Entries[0];
                var usb = Catalog.Parse(Line("source:41", PcIcon)).Entries[0];
                T.Eq(SourceSwitch.ResolveIcon(hdmi, p => p == HdmiIcon || p == HdmiFallback), HdmiIcon, "the monitor's SVG wins over a TV fallback");
                T.Eq(SourceSwitch.ResolveIcon(hdmi, p => p == HdmiFallback), HdmiFallback, "an existing legacy HDMI icon remains usable");
                T.Eq(SourceSwitch.ResolveIcon(hdmi, p => false), null, "a missing resource prevents the request");
                T.Eq(SourceSwitch.ResolveIcon(usb, p => p == PcIcon), PcIcon, "USB-C uses its discovered resource");
                T.Eq(SourceSwitch.ResolveIcon(usb, p => p.EndsWith("r_icon_device_s_tv.png", StringComparison.Ordinal)), null, "USB-C never guesses a TV icon");
                T.Eq(SourceSwitch.ResolveIcon(new AppEntry("a", "A", "org.a", null), p => true), null, "an ordinary app is not a source");
                T.Eq(SourceSwitch.ResolveIcon(null, p => true), null, "a missing entry cannot switch input");
            });
        }
    }
}
