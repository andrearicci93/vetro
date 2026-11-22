using System.Text.RegularExpressions;

namespace Launcher.Core
{
    /// <summary>
    /// The level of a receiver or soundbar on HDMI (ARC/eARC) as hdmicec-service keeps it in memory/multiscreen/volumeinfo_receiver,
    /// for example <c>{"mute":"off","volumekey":"none","volumelevel":"8"}</c>. Seen on an S95B (Tizen 6.5, 1720.7) with a Samsung
    /// HW-Q-Series soundbar on 2026-11-22: it followed every Vol and Mute within about a second and matched the soundbar's own display.
    /// The level is the CEC audio status, 0 to 100.
    /// </summary>
    public static class ReceiverVolume
    {
        public const string Key = "memory/multiscreen/volumeinfo_receiver";

        private static readonly Regex Level = new Regex("\"volumelevel\"\\s*:\\s*\"?(\\d{1,3})\"?");
        private static readonly Regex Mute = new Regex("\"mute\"\\s*:\\s*\"(on|off)\"");

        /// <summary>False when the text has no level (key missing, empty, another firmware's shape).</summary>
        public static bool TryParse(string json, out int level, out bool muted)
        {
            level = 0; muted = false;
            if (string.IsNullOrEmpty(json)) return false;
            Match l = Level.Match(json);
            if (!l.Success) return false;
            int v;
            if (!int.TryParse(l.Groups[1].Value, out v) || v < 0 || v > 100) return false;
            level = v;
            Match m = Mute.Match(json);
            muted = m.Success && m.Groups[1].Value == "on";
            return true;
        }

        /// <summary>The CEC device hdmicec-service writes to on the S95B; it takes the frame bytes as they are (no header, no checksum).</summary>
        public const string CecDevice = "/dev/micom-cec";

        // hdmicec-service's message (CCECMsgSender::MakeInterfaceMessage): byte 0 is the length minus one, byte 1 the CEC header
        // (initiator 0 = TV, destination 5 = audio system), then the opcode and its operands. Written by hand on an S95B with a
        // HW-Q-Series soundbar (2026-11-22): 03 05 44 41 and 02 05 45 took the soundbar from 6 to 7.
        private const byte UserControlPressed = 0x44, UserControlReleased = 0x45;
        public const byte UiVolumeUp = 0x41, UiVolumeDown = 0x42, UiMute = 0x43;

        public static byte[] Pressed(byte uiCommand) { return new byte[] { 3, 0x05, UserControlPressed, uiCommand }; }
        public static byte[] Released() { return new byte[] { 2, 0x05, UserControlReleased }; }
    }
}
