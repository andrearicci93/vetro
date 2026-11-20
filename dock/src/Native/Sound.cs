using System;
using System.Runtime.InteropServices;

namespace Launcher.Native
{
    /// <summary>
    /// The TV's master volume (libcapi-media-sound-manager-tv). Checked on the Q80A (2026-11-08): reading and
    /// <c>sound_manager_set_master_volume</c> both return 0 as root, and a volume set this way does not make Samsung's
    /// tv-viewer draw its own bar. The mute is NOT here: with the TV muted by its own key, get_master_mute and
    /// get_tv_master_mute both still say false (tv-viewer mutes audio and video through the tuner daemon and keeps its
    /// state in the vconf key memory/org.tizen.tv-viewer/mute_status).
    /// </summary>
    internal static class Sound
    {
        private const string Lib = "libcapi-media-sound-manager-tv.so.0";
        [DllImport(Lib, EntryPoint = "sound_manager_get_master_volume")] private static extern int GetVolume(out int value);
        [DllImport(Lib, EntryPoint = "sound_manager_set_master_volume")] private static extern int SetVolume(int value);
        [DllImport(Lib, EntryPoint = "sound_manager_get_speaker_selection")] private static extern int GetSpeaker(out int type);
        [DllImport(Lib, EntryPoint = "sound_manager_set_speaker_selection")] private static extern int SetSpeaker(int type);

        /// <summary>
        /// Where the sound goes, as Samsung's own Sound output list sets it (Ghidra on volume-setting, 2026-11-15, NOT tried on a TV):
        /// 0 TV speaker, 1 optical, 2 receiver (ARC), 3 sound share, 4 network speaker, 5 Bluetooth headphones (6 is read as 5).
        /// </summary>
        public const int SpeakerTv = 0, SpeakerBluetooth = 5;

        [DllImport("libcapi-system-info.so.0", EntryPoint = "system_info_get_custom_bool")]
        private static extern int GetCustomBool(string key, [MarshalAs(UnmanagedType.I1)] out bool value);
        private static int _optical = -1;   // read once: -1 not read, 0 no, 1 yes

        /// <summary>
        /// Whether the TV has an optical output: Samsung's own Sound output list adds its Optical row only when the feature flag
        /// com.samsung/featureconf/spdif_support is true (Tizen 6.5 volume-setting, Tizen 9 volume-app; static, 2026-11-20; the Q80A's says
        /// true). False when it cannot be read.
        /// </summary>
        public static bool HasOpticalOutput()
        {
            if (_optical < 0)
            {
                bool v = false;
                try { _optical = GetCustomBool("com.samsung/featureconf/spdif_support", out v) == 0 && v ? 1 : 0; } catch (Exception) { _optical = 0; }
            }
            return _optical == 1;
        }

        public static bool TryGetSpeakerSelection(out int type)
        {
            type = -1;
            try { return GetSpeaker(out type) == 0; } catch (Exception) { type = -1; return false; }
        }

        public static bool TrySetSpeakerSelection(int type)
        {
            try { return SetSpeaker(type) == 0; } catch (Exception) { return false; }
        }

        public static bool TryGetVolume(out int volume)
        {
            volume = 0;
            try { return GetVolume(out volume) == 0 && volume >= 0 && volume <= 100; }
            catch (Exception) { return false; }
        }

        public static bool TrySetVolume(int volume)
        {
            try { return SetVolume(volume) == 0; } catch (Exception) { return false; }
        }
    }
}
