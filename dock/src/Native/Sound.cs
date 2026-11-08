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
