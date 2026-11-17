using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Launcher.Core;

namespace Launcher.Native
{
    /// <summary>
    /// The TV's Bluetooth audio devices (libcapi-network-bluetooth). NOT YET TRIED ON A TV. What is known comes from the Tizen Bluetooth API the TV's own
    /// managed binding (Tizen.Network.Bluetooth) calls: <c>bt_initialize</c>, <c>bt_adapter_foreach_bonded_device</c> (the callback gets a
    /// bt_device_info_s: address, name, class, uuid list, count, paired, connected, authorized, ...), <c>bt_audio_connect</c>
    /// (profile 2 = A2DP, after <c>bt_audio_initialize</c>).
    /// The calls run on the launcher's main loop when OK is pressed: if the TV's bluetooth service is slow to answer, the launcher waits for it. The struct is read field by field at its C offsets, so the same code is right on the
    /// TV's 32-bit ARM and on a 64-bit desktop. Every call can fail (no Bluetooth, no permission for a root process while bt-service runs):
    /// the answer is then "no list", and the Audio output shows only the TV speakers.
    /// Switching the sound between the TV speakers and a connected device is <see cref="Sound.TrySetSpeakerSelection"/> (what Samsung's own list does).
    /// </summary>
    internal static class AudioOutputs
    {
        private const string Lib = "libcapi-network-bluetooth.so.0";
        private const int ProfileA2dp = 2;

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate bool BondedCb(IntPtr deviceInfo, IntPtr userData);

        [DllImport(Lib, EntryPoint = "bt_initialize")] private static extern int BtInitialize();
        [DllImport(Lib, EntryPoint = "bt_audio_initialize")] private static extern int AudioInitialize();
        [DllImport(Lib, EntryPoint = "bt_adapter_foreach_bonded_device")] private static extern int ForeachBonded(BondedCb cb, IntPtr userData);
        [DllImport(Lib, EntryPoint = "bt_audio_connect")] private static extern int AudioConnect(string address, int profile);

        private static bool _initialised, _audioInitialised;
        private static BondedCb _keep;   // the callback must outlive the call
        public static string LastError = "";

        public static bool TryList(out List<BondedDevice> devices)
        {
            devices = new List<BondedDevice>();
            try
            {
                // A refusal is not kept: right after a boot the Bluetooth service may not be ready, and the launcher lives for weeks.
                if (!_initialised) { int rc = BtInitialize(); _initialised = rc == 0; if (rc != 0) LastError = "bt_initialize rc=" + rc; }
                InitAudio();
                var found = new List<BondedDevice>();
                _keep = delegate (IntPtr info, IntPtr user)
                {
                    try { found.Add(Read(info)); } catch (Exception ex) { LastError = "device: " + ex.Message; }
                    return true;
                };
                int r = ForeachBonded(_keep, IntPtr.Zero);
                if (r != 0) { LastError = "bt_adapter_foreach_bonded_device rc=" + r; return false; }
                devices = found;
                return true;
            }
            catch (Exception ex) { LastError = ex.GetType().Name + ": " + ex.Message; return false; }
        }

        /// <summary>bt_audio_connect is used by Samsung's own binding only after bt_audio_initialize: once, and a refusal does not stop the device list.</summary>
        private static void InitAudio()
        {
            if (_audioInitialised) return;
            try { int rc = AudioInitialize(); _audioInitialised = rc == 0; if (rc != 0) LastError = "bt_audio_initialize rc=" + rc; }
            catch (Exception ex) { _audioInitialised = true; LastError = "bt_audio_initialize: " + ex.GetType().Name; }   // the call is not there: asking again will not bring it
        }

        public static bool TryConnect(string address)
        {
            try {
                InitAudio(); int rc = AudioConnect(address, ProfileA2dp); if (rc != 0) LastError = "bt_audio_connect rc=" + rc; return rc == 0; }
            catch (Exception ex) { LastError = ex.GetType().Name + ": " + ex.Message; return false; }
        }


        /// <summary>bt_device_info_s at its C offsets: char* address, char* name, bt_class_s {int major, int minor, int serviceMask}, char** uuids, int count, bool paired, bool connected, bool authorized.</summary>
        private static BondedDevice Read(IntPtr info)
        {
            int p = IntPtr.Size;
            var d = new BondedDevice();
            d.Address = Text(Marshal.ReadIntPtr(info, 0));
            d.Name = Text(Marshal.ReadIntPtr(info, p));
            d.MajorClass = Marshal.ReadInt32(info, 2 * p);
            int off = 2 * p + 12;
            off = (off + p - 1) / p * p;      // the uuid list is a pointer: aligned
            off += p;                          // service uuid list
            off += 4;                          // service count
            d.Connected = Marshal.ReadByte(info, off + 1) != 0;   // paired is at off, connected at off + 1
            return d;
        }

        private static string Text(IntPtr s) { return s == IntPtr.Zero ? null : Marshal.PtrToStringAnsi(s); }
    }
}
