using System;
using System.Collections.Generic;

namespace Launcher.Core
{
    internal enum OutputKind { TvSpeaker, Bluetooth, ScreenOff }

    /// <summary>A Bluetooth device the TV is paired with, as the system reports it (no EFL, no P/Invoke: the list is built from this).</summary>
    internal sealed class BondedDevice
    {
        public string Address, Name;
        public bool Connected;
        /// <summary>Bluetooth major device class (4 = audio / video, 0 = unknown).</summary>
        public int MajorClass;
    }

    /// <summary>One row of the Audio output list (the last one can be the "Turn off screen" action rather than an output).</summary>
    internal sealed class OutputEntry
    {
        public OutputKind Kind;
        public string Label, Address;
        /// <summary>The sound comes out of this one now.</summary>
        public bool Active;
        /// <summary>A Bluetooth device the TV is connected to (whether or not the sound goes there).</summary>
        public bool Connected;
    }

    /// <summary>
    /// The Audio output card's list (Control center): the TV's own speakers first, then the paired Bluetooth devices
    /// that can play sound, the connected one on top. Pure, so it is tested without a TV. What choosing a row does is
    /// <see cref="ActionFor"/>: the TV speakers and an already connected device switch the sound output (the way Samsung's own list does),
    /// a paired device that is not connected is connected first.
    /// </summary>
    internal static class OutputPickerModel
    {
        public const string TvLabel = "TV speakers";
        /// <summary>The last row: the screen goes off, the sound stays (Samsung's Picture Off); any key but volume and power brings the picture back.</summary>
        public const string ScreenOffLabel = "Turn off screen";
        private const int MajorAudioVideo = 4;

        /// <summary>Whether a paired device is something to play sound on (headphones, a speaker, a soundbar), not a keyboard or a phone.</summary>
        public static bool IsAudio(BondedDevice d)
        {
            // A device whose class was not reported is kept: hiding a speaker is worse than showing one extra row.
            return d != null && !string.IsNullOrEmpty(d.Address) && (d.MajorClass == MajorAudioVideo || d.MajorClass == 0);
        }

        /// <summary>The sound output reads as Bluetooth headphones (5, or 6 which Samsung's list reads as 5); -1 when it could not be read.</summary>
        public static bool IsBluetoothSelection(int selection) { return selection == 5 || selection == 6; }

        /// <summary>
        /// The rows for a list of paired devices: TV speakers, then the audio devices, connected first, then by name. <paramref name="selection"/> is
        /// the TV's sound output (<c>sound_manager_get_speaker_selection</c>, -1 when unknown): the sound is on the connected device only when
        /// it says Bluetooth (or is unknown, then a connected device is assumed to be playing).
        /// </summary>
        public static List<OutputEntry> Build(IEnumerable<BondedDevice> paired, int selection = -1, bool screenOff = false)
        {
            var devices = new List<BondedDevice>();
            if (paired != null) foreach (BondedDevice d in paired) if (IsAudio(d)) devices.Add(d);
            devices.Sort(delegate (BondedDevice a, BondedDevice b)
            {
                if (a.Connected != b.Connected) return a.Connected ? -1 : 1;
                return string.Compare(a.Name ?? "", b.Name ?? "", StringComparison.OrdinalIgnoreCase);
            });
            var rows = new List<OutputEntry>();
            bool anyConnected = devices.Exists(d => d.Connected);
            bool onBluetooth = anyConnected && (selection < 0 || IsBluetoothSelection(selection));
            rows.Add(new OutputEntry { Kind = OutputKind.TvSpeaker, Label = TvLabel, Active = !onBluetooth });
            bool first = true;
            foreach (BondedDevice d in devices)
            {
                // Only one device plays: the first connected one (the list puts it on top).
                bool plays = onBluetooth && d.Connected && first;
                if (d.Connected) first = false;
                rows.Add(new OutputEntry { Kind = OutputKind.Bluetooth, Label = string.IsNullOrEmpty(d.Name) ? d.Address : d.Name, Address = d.Address, Active = plays, Connected = d.Connected });
            }
            if (screenOff) rows.Add(new OutputEntry { Kind = OutputKind.ScreenOff, Label = ScreenOffLabel });
            return rows;
        }

        /// <summary>Whether the list has a Bluetooth device in it (the header says "No paired speakers" when it has none).</summary>
        public static bool HasDevices(List<OutputEntry> rows) { return rows != null && rows.Exists(r => r.Kind == OutputKind.Bluetooth); }

        /// <summary>What the system has to do for a row: nothing (already playing), send the sound to the TV speakers or to a device that is already connected, connect the device first, or turn the screen off.</summary>
        public static OutputAction ActionFor(OutputEntry choice)
        {
            if (choice == null) return OutputAction.None;
            if (choice.Kind == OutputKind.ScreenOff) return OutputAction.ScreenOff;
            if (choice.Active) return OutputAction.None;
            if (choice.Kind == OutputKind.TvSpeaker) return OutputAction.UseTv;
            return choice.Connected ? OutputAction.UseBluetooth : OutputAction.Connect;
        }
    }

    internal enum OutputAction { None, UseTv, UseBluetooth, Connect, ScreenOff }
}
