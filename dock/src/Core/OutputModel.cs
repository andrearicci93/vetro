using System;
using System.Collections.Generic;

namespace Launcher.Core
{
    internal enum OutputKind { TvSpeaker, Bluetooth, ScreenOff, External }

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
        /// <summary>An external output: its speaker-selection value (1 optical, 2 receiver...), the one to select again; -1 for the other rows.</summary>
        public int Selection = -1;
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
        /// The name of a sound output that is neither the TV speakers nor Bluetooth, from Samsung's route list (Tizen.TV.Multimedia
        /// SoundTvOutputRoute, the same values on the 2021, 2022 and 2024 firmware, read from the firmware on 2026-11-19); null for the TV
        /// speakers (0), Bluetooth (5, 6) and an unknown or unread value.
        /// </summary>
        public static string ExternalName(int selection)
        {
            switch (selection)
            {
                case 1: return "Optical";
                case 2: return "Receiver (HDMI)";
                case 3: return "Sound Share";
                case 4: return "Wi-Fi speaker";
                case 8: return "TV + receiver";
                case 9: return "TV + optical";
                case 10: return "TV + Wi-Fi speaker";
                case 11: return "Optical (centre mode)";
                case 12: return "Receiver (centre mode)";
                case 13: return "Headphones";
                case 14: return "Line out";
                case 15: return "USB headset";
                case 16: return "TV + Wi-Fi speaker";
                case 17: return "TV + receiver";
                case 18: return "TV + optical";
                case 19: return "Auracast";
                default: return null;
            }
        }

        /// <summary>
        /// Whether Vetro's volume bar changes the level itself. A receiver on HDMI (2; TV + receiver and the centre mode: 8, 12, 17) and the
        /// optical outputs (1; TV + optical 9, 18; optical centre mode 11) send the key back to Samsung instead: Samsung passes it on over
        /// HDMI-CEC, or to an optical soundbar through its universal remote (IR) or Q-Symphony, while a change of the TV's own level does not
        /// move the soundbar. Seen on three TVs on 2026-11-20: S95C + IR soundbar, S90D + HW-B650 (1) and S90F with Q-Symphony (9) followed
        /// Vol with Vetro's bar off and not with it on. Bluetooth (5, 6) too: headphones follow the level Samsung sends them, not the TV's
        /// own (LS03B, 2026-11-20: Vetro's Vol did nothing, the headphones' own buttons moved them and brought up Samsung's bar).
        /// TV speakers, Wi-Fi speakers and unknown (-1) stay with Vetro.
        /// </summary>
        public static bool VetroSetsLevel(int selection)
        {
            switch (selection)
            {
                case 1: case 2: case 5: case 6: case 8: case 9: case 11: case 12: case 17: case 18: return false;
                default: return true;
            }
        }

        /// <summary>
        /// An external output that the Audio output card offers again once the sound has gone elsewhere: optical, a receiver, the combined
        /// and centre modes, line out. Not the Wi-Fi speakers (Samsung's own list never selects 4 by this call), Sound Share, Auracast or the
        /// headphone outputs, which come and go with their device.
        /// </summary>
        /// <summary>An output that plays through the optical port: optical (1), TV + optical (9, 18), the optical centre mode (11).</summary>
        public static bool IsOpticalSelection(int selection) { return selection == 1 || selection == 9 || selection == 11 || selection == 18; }

        public static bool CanChooseAgain(int selection)
        {
            switch (selection)
            {
                case 1: case 2: case 8: case 9: case 11: case 12: case 14: case 17: case 18: return true;
                default: return false;
            }
        }

        /// <summary>
        /// The rows for a list of paired devices: TV speakers, then the audio devices, connected first, then by name. <paramref name="selection"/> is
        /// the TV's sound output (<c>sound_manager_get_speaker_selection</c>, -1 when unknown): the sound is on the connected device only when
        /// it says Bluetooth (or is unknown, then a connected device is assumed to be playing). <paramref name="lastExternal"/> is the external
        /// output the launcher last saw playing (-1 for none): while the sound is elsewhere it stays in the list, so it can be chosen again.
        /// <paramref name="opticalPort"/>: the TV has an optical output (Samsung's spdif_support flag), so Optical is offered as Samsung's own
        /// list offers it, even before the launcher has seen the sound go there (Q70BA, 2026-11-20: switched in Samsung's menu, no row).
        /// </summary>
        public static List<OutputEntry> Build(IEnumerable<BondedDevice> paired, int selection = -1, bool screenOff = false, int lastExternal = -1, bool opticalPort = false)
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
            // Another output (optical, a receiver on HDMI...) plays: it gets its own ticked row, and the TV speakers are not ticked (an S95C
            // on optical showed "TV speakers" ticked). Once the sound has gone to the TV speakers or a device, that output keeps its row,
            // not ticked, so it can be chosen again (the same S95C lost its Optical row after choosing TV speakers).
            string external = ExternalName(selection);
            rows.Add(new OutputEntry { Kind = OutputKind.TvSpeaker, Label = TvLabel, Active = !onBluetooth && external == null });
            if (external != null) rows.Add(new OutputEntry { Kind = OutputKind.External, Label = external, Active = true, Selection = selection });
            else if (selection >= 0 && CanChooseAgain(lastExternal)) rows.Add(new OutputEntry { Kind = OutputKind.External, Label = ExternalName(lastExternal), Selection = lastExternal });
            // Optical once: not again when the row already there is an optical one (optical, TV + optical, the optical centre mode).
            if (opticalPort && selection >= 0 && !rows.Exists(r => r.Kind == OutputKind.External && IsOpticalSelection(r.Selection)))
                rows.Add(new OutputEntry { Kind = OutputKind.External, Label = ExternalName(1), Selection = 1 });
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

        /// <summary>What the system has to do for a row: nothing (already playing), send the sound to the TV speakers, back to an external output or to a device that is already connected, connect the device first, or turn the screen off.</summary>
        public static OutputAction ActionFor(OutputEntry choice)
        {
            if (choice == null) return OutputAction.None;
            if (choice.Kind == OutputKind.ScreenOff) return OutputAction.ScreenOff;
            if (choice.Active) return OutputAction.None;
            if (choice.Kind == OutputKind.TvSpeaker) return OutputAction.UseTv;
            if (choice.Kind == OutputKind.External) return CanChooseAgain(choice.Selection) ? OutputAction.UseExternal : OutputAction.None;
            return choice.Connected ? OutputAction.UseBluetooth : OutputAction.Connect;
        }
    }

    internal enum OutputAction { None, UseTv, UseBluetooth, Connect, ScreenOff, UseExternal }
}
