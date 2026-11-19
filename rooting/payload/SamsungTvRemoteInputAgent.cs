using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

internal static class SamsungTvRemoteInputAgent
{
    private const string ProtocolVersion = "SAMSUNG-TV-REMOTE/1";
    private const string Libc = "libc";
    private const string VconfApi = "/usr/lib/libvconf.so.0";
    private const string CurrentSourceTypeKey = "memory/system/source_type";
    private const string CurrentFullscreenAppIdKey =
        "memory/appfw/current_fullscreen_appid";
    private const string CurrentPartialAppIdKey =
        "memory/appfw/current_partial_appid";
    private const int ConnectTimeoutMilliseconds = 5000;
    private const int MaximumLineBytes = 64 * 1024;
    private const int OpenReadOnly = 0;
    private const int OpenWriteOnly = 1;
    private const int OpenNonblock = 2048;
    private const int InterruptedSystemCall = 4;
    private const short PollIn = 1;
    private const short PollError = 8;
    private const short PollHangup = 16;
    private const short PollInvalid = 32;
    private const ushort EventSynchronization = 0;
    private const ushort EventKey = 1;
    private const ushort EventMiscellaneous = 4;
    private const ushort MiscellaneousScan = 4;
    private const int KeyMaximum = 0x2ff;
    private const uint EviocGrab = 0x40044590;
    private const uint UiSetEventBit = 0x40045564;
    private const uint UiSetKeyBit = 0x40045565;
    private const uint UiDeviceCreate = 0x00005501;
    private const uint UiDeviceDestroy = 0x00005502;
    private const uint UiSetPhysical32 = 0x4004556c;
    private const uint UiSetPhysical64 = 0x4008556c;
    // UI_GET_SYSNAME(64): the "inputN" name of the device uinput created.
    private const uint UiGetSysName = 0x8040552c;
    // Marks Vetro's own forwarding device; must match FORWARDED_PHYS in app/service/physical-input.js.
    private const string ForwardedPhys = "vetro-forwarded-remote";
    // Picture Off (screen off, sound on). deviced keeps its display state in memory/pm/state: 1 with the screen on, 3 while
    // it is off (read on a Q80A, fw 2310.0; the key is in deviced on Tizen 6.0, 6.5 and 9).
    private const string DisplayStateKey = "memory/pm/state";
    private const int DisplayStateOff = 3;
    private const string ScreenOnCommand = "--timeout=3 call org.tizen.system.deviced /Org/Tizen/System/DeviceD/Display "
        + "org.tizen.system.deviced.display ChangeState s lcdon";
    private const int DeviceBusy = 16;   // EBUSY
    private const int UinputUserDeviceSize = 1116;
    private const int UinputNameBytes = 80;

    [StructLayout(LayoutKind.Sequential)]
    private struct PollDescriptor
    {
        public int FileDescriptor;
        public short Events;
        public short ReturnedEvents;
    }

    private sealed class InputDevice
    {
        public string Node = "";
        public string Name = "";
        public ushort Bus;
        public ushort Vendor;
        public ushort Product;
        public ushort Version;
    }

    private sealed class PresentationSnapshot
    {
        public string FullscreenApplicationId = "";
        public string PartialApplicationId = "";
    }

    private sealed class UinputForwarder : IDisposable
    {
        private int descriptor = -1;
        private readonly HashSet<ushort> pressedKeys = new HashSet<ushort>();

        public UinputForwarder(InputDevice source)
        {
            descriptor = open("/dev/uinput", OpenWriteOnly | OpenNonblock);
            if (descriptor < 0)
            {
                throw NativeError("open /dev/uinput");
            }
            try
            {
                RequireIoctl(descriptor, UiSetEventBit, EventSynchronization);
                RequireIoctl(descriptor, UiSetEventBit, EventKey);
                for (int code = 0; code <= KeyMaximum; code++)
                {
                    RequireIoctl(descriptor, UiSetKeyBit, code);
                }
                uint setPhysical = IntPtr.Size == 8 ? UiSetPhysical64 : UiSetPhysical32;
                if (ioctl_string(descriptor, setPhysical, ForwardedPhys) != 0)
                {
                    throw NativeError("UI_SET_PHYS");
                }
                byte[] definition = new byte[UinputUserDeviceSize];
                WriteFixedString(
                    definition,
                    0,
                    UinputNameBytes,
                    source.Name);
                WriteUInt16(definition, 80, source.Bus == 0 ? (ushort)6 : source.Bus);
                WriteUInt16(definition, 82, source.Vendor);
                WriteUInt16(definition, 84, source.Product);
                WriteUInt16(definition, 86, source.Version);
                RequireWrite(descriptor, definition);
                if (ioctl_no_argument(descriptor, UiDeviceCreate) != 0)
                {
                    throw NativeError("UI_DEV_CREATE");
                }
                MarkAsRemoteControl();
            }
            catch
            {
                Dispose();
                throw;
            }
        }

        // The TV's keyrouter gives the Remocon subclass to a device by its name (a list of Samsung remotes) or
        // when it has neither 'a' nor Esc. A forwarded device under a name outside that list is taken for a
        // keyboard and the on-screen keyboard hides on the first key it gets (issue #143). Newer firmware can
        // be told the subclass directly; older firmware has no such command, so a failure here is not an error.
        private void MarkAsRemoteControl()
        {
            byte[] sysName = new byte[64];
            if (ioctl_buffer(descriptor, UiGetSysName, sysName) < 0)
            {
                return;
            }
            string inputName = Encoding.ASCII.GetString(sysName).TrimEnd('\0');
            if (inputName.Length == 0 || inputName.IndexOf('/') >= 0)
            {
                return;
            }
            // The outcome goes to the log as one fixed line ("remocon subtype: set / refused / no tool / no node / failed"), read by
            // the diagnostics: on Tizen 9 boards keys passed on through this copy seem not to reach Samsung's apps or Vetro's TV page
            // (S95C, Q70C, 2026-11-19), and whether the copy became a Remocon there is the first thing to know.
            Task.Run(() =>
            {
                bool asked = false;
                try
                {
                    for (int attempt = 0; attempt < 12; attempt++)
                    {
                        System.Threading.Thread.Sleep(250);
                        string folder = "/sys/devices/virtual/input/" + inputName;
                        if (!Directory.Exists(folder))
                        {
                            continue;
                        }
                        string node = null;
                        foreach (string entry in Directory.GetDirectories(folder, "event*"))
                        {
                            node = "/dev/input/" + Path.GetFileName(entry);
                        }
                        if (node == null)
                        {
                            continue;
                        }
                        if (!File.Exists("/usr/bin/enlightenment_info"))
                        {
                            Console.Error.WriteLine("remocon subtype: no tool");
                            return;
                        }
                        asked = true;
                        using (System.Diagnostics.Process process = new System.Diagnostics.Process())
                        {
                            process.StartInfo.FileName = "/usr/bin/enlightenment_info";
                            process.StartInfo.Arguments = "-input_subtype_set " + node + " Remocon";
                            process.StartInfo.UseShellExecute = false;
                            process.StartInfo.RedirectStandardOutput = true;
                            process.StartInfo.RedirectStandardError = true;
                            process.Start();
                            string output = process.StandardOutput.ReadToEnd() + process.StandardError.ReadToEnd();
                            process.WaitForExit(5000);
                            if (output.Contains("Success"))
                            {
                                Console.Error.WriteLine("remocon subtype: set");
                                return;
                            }
                        }
                    }
                    Console.Error.WriteLine(asked ? "remocon subtype: refused" : "remocon subtype: no node");
                }
                catch (Exception)
                {
                    Console.Error.WriteLine("remocon subtype: failed");
                }
            });
        }

        public void Forward(byte[] inputEvent)
        {
            RequireWrite(descriptor, inputEvent);
            int typeOffset = IntPtr.Size == 8 ? 16 : 8;
            int codeOffset = typeOffset + 2;
            int valueOffset = codeOffset + 2;
            ushort type = BitConverter.ToUInt16(inputEvent, typeOffset);
            if (type != EventKey)
            {
                return;
            }
            ushort code = BitConverter.ToUInt16(inputEvent, codeOffset);
            int value = BitConverter.ToInt32(inputEvent, valueOffset);
            if (value == 0)
            {
                pressedKeys.Remove(code);
            }
            else
            {
                pressedKeys.Add(code);
            }
        }

        public void Dispose()
        {
            int current = descriptor;
            descriptor = -1;
            if (current < 0)
            {
                return;
            }
            try
            {
                ReleasePressedKeys(current);
            }
            catch (Exception exception)
            {
                Console.Error.WriteLine(
                    "failed to release forwarded remote keys: " + exception.Message);
            }
            ioctl_no_argument(current, UiDeviceDestroy);
            close(current);
        }

        private void ReleasePressedKeys(int current)
        {
            int eventSize = IntPtr.Size == 8 ? 24 : 16;
            int typeOffset = IntPtr.Size == 8 ? 16 : 8;
            int codeOffset = typeOffset + 2;
            int valueOffset = codeOffset + 2;
            foreach (ushort code in pressedKeys)
            {
                byte[] release = new byte[eventSize];
                WriteUInt16(release, typeOffset, EventKey);
                WriteUInt16(release, codeOffset, code);
                WriteInt32(release, valueOffset, 0);
                RequireWrite(current, release);
            }
            if (pressedKeys.Count != 0)
            {
                byte[] synchronization = new byte[eventSize];
                WriteUInt16(
                    synchronization,
                    typeOffset,
                    EventSynchronization);
                RequireWrite(current, synchronization);
                pressedKeys.Clear();
            }
        }
    }

    [DllImport(Libc, SetLastError = true)]
    private static extern int open(string path, int flags);

    [DllImport(Libc, SetLastError = true)]
    private static extern int read(int descriptor, byte[] buffer, int count);

    [DllImport(Libc, SetLastError = true)]
    private static extern int write(int descriptor, byte[] buffer, int count);

    [DllImport(Libc, SetLastError = true)]
    private static extern int close(int descriptor);

    [DllImport(Libc, SetLastError = true)]
    private static extern int poll(
        [In, Out] PollDescriptor[] descriptors,
        uint count,
        int timeout);

    [DllImport(Libc, SetLastError = true, EntryPoint = "ioctl")]
    private static extern int ioctl_integer(int descriptor, uint request, int value);

    [DllImport(Libc, SetLastError = true, EntryPoint = "ioctl")]
    private static extern int ioctl_no_argument(int descriptor, uint request);

    [DllImport(Libc, SetLastError = true, EntryPoint = "ioctl")]
    private static extern int ioctl_buffer(int descriptor, uint request, [Out] byte[] buffer);

    [DllImport(Libc, SetLastError = true, EntryPoint = "ioctl", CharSet = CharSet.Ansi)]
    private static extern int ioctl_string(int descriptor, uint request, string value);

    [DllImport(Libc)]
    private static extern int getpid();

    [DllImport(Libc)]
    private static extern int getuid();

    [DllImport(Libc)]
    private static extern int getgid();

    [DllImport(VconfApi, EntryPoint = "vconf_get_int")]
    private static extern int VconfGetInt(string key, out int value);

    [DllImport(VconfApi, EntryPoint = "vconf_get_str")]
    private static extern IntPtr VconfGetString(string key);

    [DllImport(Libc)]
    private static extern void free(IntPtr pointer);

    public static int Main(string[] arguments)
    {
        byte[] secret = null;
        try
        {
            if (arguments.Length != 8)
            {
                throw new ArgumentException(
                    "usage: SamsungTvRemoteInputAgent.dll CALLBACK_IPV4 PORT "
                    + "TOKEN_FILE DEVICE_NAME TRANSPORT MODEL MODE BLOCKED_TOKENS");
            }
            int port;
            if (!int.TryParse(arguments[1], out port) || port < 1 || port > 65535)
            {
                throw new ArgumentException("invalid callback port");
            }
            bool filter;
            if (arguments[6] == "observe")
            {
                filter = false;
            }
            else if (arguments[6] == "filter")
            {
                filter = true;
            }
            else
            {
                throw new ArgumentException("remote-input mode must be observe or filter");
            }
            HashSet<string> blocked = ParseTokens(arguments[7]);
            if (!filter && blocked.Count != 0)
            {
                throw new ArgumentException("observe mode cannot block input tokens");
            }
            secret = ReadAndRemoveSecret(arguments[2]);
            if (secret.Length < 32)
            {
                throw new InvalidDataException(
                    "remote-input secret must contain at least 32 bytes");
            }
            Run(
                arguments[0],
                port,
                secret,
                arguments[3],
                arguments[4],
                arguments[5],
                filter,
                blocked);
            return 0;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine(
                exception.GetType().Name + ": " + exception.Message);
            return 1;
        }
        finally
        {
            if (secret != null)
            {
                Array.Clear(secret, 0, secret.Length);
            }
        }
    }

    private static void Run(
        string host,
        int port,
        byte[] secret,
        string deviceName,
        string transport,
        string model,
        bool filter,
        HashSet<string> blocked)
    {
        InputDevice device = FindInputDevice(deviceName);
        if (device == null)
        {
            throw new InvalidOperationException(
                "input device not found: " + deviceName);
        }
        using (TcpClient client = new TcpClient())
        {
            Task connection = client.ConnectAsync(host, port);
            if (!connection.Wait(ConnectTimeoutMilliseconds))
            {
                throw new TimeoutException("remote-input callback timed out");
            }
            connection.GetAwaiter().GetResult();
            client.NoDelay = true;
            client.SendTimeout = 2000;
            client.Client.SetSocketOption(
                SocketOptionLevel.Socket,
                SocketOptionName.KeepAlive,
                true);
            using (NetworkStream stream = client.GetStream())
            {
                // The service writes its hello at once; a helper whose service never speaks (or is gone) must not sit
                // there for ever holding nothing, so the first read gives up after 10 s.
                client.ReceiveTimeout = 10000;
                string hello = ReadLine(stream);
                client.ReceiveTimeout = 0;
                string[] helloFields = hello.Split('\t');
                if (helloFields.Length != 2 || helloFields[0] != ProtocolVersion)
                {
                    throw new InvalidDataException("invalid remote-input hello");
                }
                byte[] nonce = HexDecode(helloFields[1]);
                if (nonce.Length != 32)
                {
                    throw new InvalidDataException("invalid challenge length");
                }
                int inputDescriptor = open(device.Node, OpenReadOnly | OpenNonblock);
                if (inputDescriptor < 0)
                {
                    throw NativeError("open " + device.Node);
                }
                UinputForwarder forwarder = null;
                bool grabbed = false;
                try
                {
                    if (filter)
                    {
                        forwarder = new UinputForwarder(device);
                        // EBUSY: the helper of an earlier start may still be letting go of the remote (seen once on
                        // an AU7000); a short wait is enough, the service ends stale helpers before a new start.
                        int grab = ioctl_integer(inputDescriptor, EviocGrab, 1);
                        for (int attempt = 0; grab != 0 && Marshal.GetLastWin32Error() == DeviceBusy && attempt < 5; attempt++)
                        {
                            System.Threading.Thread.Sleep(300);
                            grab = ioctl_integer(inputDescriptor, EviocGrab, 1);
                        }
                        if (grab != 0)
                        {
                            throw NativeError("EVIOCGRAB " + device.Node);
                        }
                        grabbed = true;
                    }
                    WriteAuthenticated(
                        stream,
                        nonce,
                        secret,
                        string.Join(
                            "\t",
                            "AUTH",
                            getpid().ToString(),
                            getuid().ToString(),
                            getgid().ToString(),
                            Base64(device.Name),
                            Base64(device.Node),
                            Base64(transport),
                            Base64(model),
                            filter ? "filter" : "observe"));
                    ForwardEvents(
                        client,
                        stream,
                        inputDescriptor,
                        device,
                        transport,
                        model,
                        filter,
                        blocked,
                        forwarder,
                        nonce,
                        secret);
                }
                finally
                {
                    if (forwarder != null)
                    {
                        forwarder.Dispose();
                    }
                    if (grabbed)
                    {
                        ioctl_integer(inputDescriptor, EviocGrab, 0);
                    }
                    close(inputDescriptor);
                }
            }
        }
    }

    private static void ForwardEvents(
        TcpClient client,
        Stream stream,
        int inputDescriptor,
        InputDevice device,
        string transport,
        string model,
        bool filter,
        HashSet<string> blocked,
        UinputForwarder forwarder,
        byte[] nonce,
        byte[] secret)
    {
        int eventSize = IntPtr.Size == 8 ? 24 : 16;
        int typeOffset = IntPtr.Size == 8 ? 16 : 8;
        int codeOffset = typeOffset + 2;
        int valueOffset = codeOffset + 2;
        Dictionary<int, string> keyNames = ReadKeyNames();
        Dictionary<ushort, bool> pressedBlocked = new Dictionary<ushort, bool>();
        HashSet<ushort> pressedWake = new HashSet<ushort>();
        long sequence = 0;
        int? scanCode = null;
        byte[] buffer = new byte[eventSize];
        PollDescriptor[] descriptors = new PollDescriptor[]
        {
            new PollDescriptor { FileDescriptor = inputDescriptor, Events = PollIn },
            new PollDescriptor
            {
                FileDescriptor = client.Client.Handle.ToInt32(),
                Events = PollIn,
            },
        };
        while (true)
        {
            descriptors[0].ReturnedEvents = 0;
            descriptors[1].ReturnedEvents = 0;
            int ready = poll(descriptors, 2, -1);
            if (ready < 0)
            {
                if (Marshal.GetLastWin32Error() == InterruptedSystemCall)
                {
                    continue;
                }
                throw NativeError("poll remote input");
            }
            if ((descriptors[1].ReturnedEvents
                    & (PollError | PollHangup | PollInvalid)) != 0)
            {
                return;
            }
            if ((descriptors[1].ReturnedEvents & PollIn) != 0)
            {
                byte[] probe = new byte[1];
                int count = client.Client.Receive(probe, 0, 1, SocketFlags.Peek);
                if (count == 0)
                {
                    return;
                }
                throw new InvalidDataException(
                    "remote-input host sent unexpected data");
            }
            if ((descriptors[0].ReturnedEvents
                    & (PollError | PollHangup | PollInvalid)) != 0)
            {
                throw new IOException("remote input device disconnected");
            }
            if ((descriptors[0].ReturnedEvents & PollIn) == 0)
            {
                continue;
            }
            while (true)
            {
                int count = read(inputDescriptor, buffer, buffer.Length);
                if (count != eventSize)
                {
                    break;
                }
                ushort type = BitConverter.ToUInt16(buffer, typeOffset);
                ushort code = BitConverter.ToUInt16(buffer, codeOffset);
                int value = BitConverter.ToInt32(buffer, valueOffset);
                if (type == EventMiscellaneous && code == MiscellaneousScan)
                {
                    scanCode = value;
                }
                string key;
                if (!keyNames.TryGetValue(code, out key))
                {
                    key = "";
                }
                bool block = false;
                // With the screen off, Samsung turns it back on at the first key that is not a volume or power key and drops
                // that key. A key re-emitted through uinput only moves deviced's state back to "lcdon" and leaves the panel
                // dark (Q80A, 2026-11-19), so while this agent holds the remote it does the same itself: the key (down,
                // repeats and up) goes nowhere, not even to a shortcut, and deviced is asked for "lcdon".
                bool wake = false;
                if (filter && type == EventKey)
                {
                    if (value == 1 && !KeepsScreenOff(code) && ScreenIsOff())
                    {
                        pressedWake.Add(code);
                        TurnScreenOn();
                    }
                    wake = pressedWake.Contains(code);
                    if (wake && value == 0)
                    {
                        pressedWake.Remove(code);
                    }
                }
                if (type == EventKey && !wake)
                {
                    bool first = blocked.Contains(code.ToString())
                        || (!string.IsNullOrEmpty(key) && blocked.Contains(key));
                    bool original;
                    if (value == 1)
                    {
                        block = first;
                        pressedBlocked[code] = block;
                    }
                    else if (pressedBlocked.TryGetValue(code, out original))
                    {
                        block = original;
                    }
                    else
                    {
                        block = first;
                    }
                }
                if (filter
                    && !block
                    && !wake
                    && (type == EventKey || type == EventSynchronization))
                {
                    forwarder.Forward(buffer);
                }
                if (type == EventKey)
                {
                    sequence++;
                    WriteAuthenticated(
                        stream,
                        nonce,
                        secret,
                        "EVENT\t"
                        + sequence
                        + "\t"
                        + Convert.ToBase64String(
                            Encoding.UTF8.GetBytes(
                                EventJson(
                                    sequence,
                                    buffer,
                                    device,
                                    transport,
                                    model,
                                    filter,
                                    code,
                                    value,
                                    key,
                                    wake ? "wake" : block ? "blocked" : "native",
                                    scanCode))));
                    if (value == 0)
                    {
                        pressedBlocked.Remove(code);
                    }
                }
                if (type == EventSynchronization)
                {
                    scanCode = null;
                }
            }
        }
    }

    private static string EventJson(
        long sequence,
        byte[] buffer,
        InputDevice device,
        string transport,
        string model,
        bool filter,
        ushort code,
        int value,
        string key,
        string decision,
        int? scanCode)
    {
        long seconds = IntPtr.Size == 8
            ? BitConverter.ToInt64(buffer, 0)
            : BitConverter.ToInt32(buffer, 0);
        long microseconds = IntPtr.Size == 8
            ? BitConverter.ToInt64(buffer, 8)
            : BitConverter.ToInt32(buffer, 4);
        int sourceType = ReadCurrentSourceType();
        PresentationSnapshot presentation = ReadPresentationSnapshot();
        return "{"
            + "\"event\":\"input\""
            + ",\"sequence\":" + sequence
            + ",\"node\":\"" + EscapeJson(device.Node) + "\""
            + ",\"device\":\"" + EscapeJson(device.Name) + "\""
            + ",\"transport\":\"" + EscapeJson(transport) + "\""
            + ",\"model\":\"" + EscapeJson(model) + "\""
            + ",\"mode\":\"" + (filter ? "filter" : "observe") + "\""
            + ",\"time_seconds\":" + seconds
            + ",\"time_microseconds\":" + microseconds
            + ",\"type\":1"
            + ",\"code\":" + code
            + ",\"value\":" + value
            + ",\"type_name\":\"EV_KEY\""
            + ",\"key\":\"" + EscapeJson(key) + "\""
            + ",\"action\":\"" + ActionName(value) + "\""
            + ",\"decision\":\"" + decision + "\""
            + (scanCode.HasValue
                ? ",\"scan_code\":" + scanCode.Value
                    + ",\"scan_code_hex\":\"0x"
                    + unchecked((uint)scanCode.Value).ToString("X8") + "\""
                : "")
            + (sourceType >= 0
                ? ",\"tv_source\":\"" + SourceName(sourceType) + "\""
                    + ",\"tv_source_type\":" + sourceType
                : "")
            + (presentation != null
                ? ",\"tv_fullscreen_appid\":\""
                    + EscapeJson(presentation.FullscreenApplicationId)
                    + "\",\"tv_partial_appid\":\""
                    + EscapeJson(presentation.PartialApplicationId)
                    + "\""
                : "")
            + "}";
    }

    // Keys that leave the screen off in Samsung's Picture Off: volume and mute (66-68 on Samsung remotes, 113-115 on others)
    // and the power and sleep keys of tizen_key_layout.txt.tv.
    private static bool KeepsScreenOff(ushort code)
    {
        switch (code)
        {
            case 66: case 67: case 68: case 113: case 114: case 115:
            case 112: case 116: case 142: case 352: case 353: case 374:
            case 449: case 463: case 523: case 531:
                return true;
            default:
                return false;
        }
    }

    private static bool ScreenIsOff()
    {
        int state;
        return VconfGetInt(DisplayStateKey, out state) == 0 && state == DisplayStateOff;
    }

    private static void TurnScreenOn()
    {
        Task.Run(() =>
        {
            try
            {
                using (System.Diagnostics.Process process = new System.Diagnostics.Process())
                {
                    process.StartInfo.FileName = "/usr/bin/busctl";
                    process.StartInfo.Arguments = ScreenOnCommand;
                    process.StartInfo.UseShellExecute = false;
                    process.StartInfo.RedirectStandardOutput = true;
                    process.StartInfo.RedirectStandardError = true;
                    process.Start();
                    process.StandardOutput.ReadToEnd();
                    process.StandardError.ReadToEnd();
                    process.WaitForExit(5000);
                }
            }
            catch (Exception)
            {
            }
        });
    }

    private static int ReadCurrentSourceType()
    {
        int sourceType;
        return VconfGetInt(CurrentSourceTypeKey, out sourceType) == 0
            ? sourceType
            : -1;
    }

    private static PresentationSnapshot ReadPresentationSnapshot()
    {
        string fullscreen;
        string partial;
        if (!TryReadVconfString(CurrentFullscreenAppIdKey, out fullscreen)
            || !TryReadVconfString(CurrentPartialAppIdKey, out partial))
        {
            return null;
        }
        return new PresentationSnapshot
        {
            FullscreenApplicationId = fullscreen,
            PartialApplicationId = partial,
        };
    }

    private static bool TryReadVconfString(string key, out string value)
    {
        IntPtr pointer = VconfGetString(key);
        if (pointer == IntPtr.Zero)
        {
            value = "";
            return false;
        }
        try
        {
            value = Marshal.PtrToStringAnsi(pointer) ?? "";
            return true;
        }
        finally
        {
            free(pointer);
        }
    }

    private static string SourceName(int sourceType)
    {
        switch (sourceType)
        {
            case 13:
                return "HDMI1";
            case 14:
                return "HDMI2";
            case 15:
                return "HDMI3";
            case 16:
                return "HDMI4";
            default:
                return "TV";
        }
    }

    private static string ActionName(int value)
    {
        switch (value)
        {
            case 0:
                return "up";
            case 1:
                return "down";
            case 2:
                return "repeat";
            default:
                return value.ToString();
        }
    }

    private static InputDevice FindInputDevice(string expectedName)
    {
        // Vetro extension: bind an exact node as well as its registered name.
        string expectedNode = null;
        int separator = expectedName.LastIndexOf("@/dev/input/");
        if (separator >= 0)
        {
            expectedNode = expectedName.Substring(separator + 1);
            expectedName = expectedName.Substring(0, separator);
            if (!Regex.IsMatch(expectedNode, "^/dev/input/event[0-9]+$"))
                throw new ArgumentException("invalid exact input node");
        }
        if (!File.Exists("/proc/bus/input/devices"))
        {
            return null;
        }
        string text = File.ReadAllText("/proc/bus/input/devices");
        foreach (string block in Regex.Split(text.Trim(), "\\n\\s*\\n"))
        {
            Match nameMatch = Regex.Match(block, "N: Name=\\\"(.*)\\\"");
            if (!nameMatch.Success || nameMatch.Groups[1].Value != expectedName)
            {
                continue;
            }
            Match physMatch = Regex.Match(block, "P: Phys=(.*)");
            if (physMatch.Success && physMatch.Groups[1].Value.Trim() == ForwardedPhys)
            {
                continue;
            }
            Match eventMatch = Regex.Match(block, "\\bevent[0-9]+\\b");
            if (!eventMatch.Success)
            {
                continue;
            }
            Match identity = Regex.Match(
                block,
                "Bus=([0-9A-Fa-f]+) Vendor=([0-9A-Fa-f]+) "
                + "Product=([0-9A-Fa-f]+) Version=([0-9A-Fa-f]+)");
            InputDevice device = new InputDevice();
            device.Name = expectedName;
            device.Node = "/dev/input/" + eventMatch.Value;
            if (expectedNode != null && device.Node != expectedNode) continue;
            if (identity.Success)
            {
                device.Bus = ParseHex16(identity.Groups[1].Value);
                device.Vendor = ParseHex16(identity.Groups[2].Value);
                device.Product = ParseHex16(identity.Groups[3].Value);
                device.Version = ParseHex16(identity.Groups[4].Value);
            }
            return device;
        }
        return null;
    }

    private static Dictionary<int, string> ReadKeyNames()
    {
        Dictionary<int, string> result = new Dictionary<int, string>();
        AddFallbackKeyNames(result);
        string path = "/usr/share/X11/xkb/tizen_key_layout.txt.tv";
        if (!File.Exists(path))
        {
            return result;
        }
        foreach (string line in File.ReadLines(path))
        {
            string[] parts = Regex.Split(line.Trim(), "\\s+");
            int code;
            if (parts.Length >= 2 && int.TryParse(parts[1], out code))
            {
                result[code] = parts[0];
            }
        }
        return result;
    }

    private static void AddFallbackKeyNames(Dictionary<int, string> result)
    {
        result[1] = "XF86Back";
        result[28] = "Return";
        result[59] = "XF86Red";
        result[60] = "XF86Green";
        result[61] = "XF86Yellow";
        result[62] = "XF86Blue";
        result[63] = "XF86Home";
        result[66] = "XF86AudioMute";
        result[67] = "XF86AudioLowerVolume";
        result[68] = "XF86AudioRaiseVolume";
        result[103] = "Up";
        result[105] = "Left";
        result[106] = "Right";
        result[108] = "Down";
        result[116] = "XF86PowerOff";
        result[127] = "XF86SimpleMenu";
        result[174] = "XF86Exit";
        result[188] = "XF86Info";
        result[213] = "XF86Caption";
    }

    private static HashSet<string> ParseTokens(string value)
    {
        HashSet<string> result = new HashSet<string>(StringComparer.Ordinal);
        foreach (string token in (value ?? "").Split(','))
        {
            string normalized = token.Trim();
            if (normalized.Length > 0)
            {
                result.Add(normalized);
            }
        }
        return result;
    }

    private static byte[] ReadAndRemoveSecret(string path)
    {
        try
        {
            return Convert.FromBase64String(File.ReadAllText(path).Trim());
        }
        finally
        {
            try
            {
                File.Delete(path);
            }
            catch
            {
            }
        }
    }

    private static void WriteAuthenticated(
        Stream stream,
        byte[] nonce,
        byte[] secret,
        string payload)
    {
        string line = payload + "\t" + Authenticate(nonce, secret, payload);
        byte[] bytes = Encoding.UTF8.GetBytes(line + "\n");
        stream.Write(bytes, 0, bytes.Length);
        stream.Flush();
    }

    private static string Authenticate(
        byte[] nonce,
        byte[] secret,
        string payload)
    {
        byte[] payloadBytes = Encoding.UTF8.GetBytes(payload);
        byte[] message = new byte[nonce.Length + 1 + payloadBytes.Length];
        Buffer.BlockCopy(nonce, 0, message, 0, nonce.Length);
        Buffer.BlockCopy(
            payloadBytes,
            0,
            message,
            nonce.Length + 1,
            payloadBytes.Length);
        using (HMACSHA256 hmac = new HMACSHA256(secret))
        {
            return HexEncode(hmac.ComputeHash(message));
        }
    }

    private static string ReadLine(Stream stream)
    {
        using (MemoryStream buffer = new MemoryStream())
        {
            while (buffer.Length <= MaximumLineBytes)
            {
                int value = stream.ReadByte();
                if (value < 0)
                {
                    throw new EndOfStreamException(
                        "remote-input host disconnected");
                }
                if (value == '\n')
                {
                    return Encoding.UTF8.GetString(buffer.ToArray()).TrimEnd('\r');
                }
                buffer.WriteByte((byte)value);
            }
        }
        throw new InvalidDataException("remote-input frame exceeds size limit");
    }

    private static void RequireIoctl(int descriptor, uint request, int value)
    {
        if (ioctl_integer(descriptor, request, value) != 0)
        {
            throw NativeError("ioctl 0x" + request.ToString("x"));
        }
    }

    private static void RequireWrite(int descriptor, byte[] buffer)
    {
        int count = write(descriptor, buffer, buffer.Length);
        if (count != buffer.Length)
        {
            throw NativeError(
                "write returned " + count + ", expected " + buffer.Length);
        }
    }

    private static Exception NativeError(string operation)
    {
        return new IOException(
            operation + " failed with errno " + Marshal.GetLastWin32Error());
    }

    private static void WriteFixedString(
        byte[] target,
        int offset,
        int length,
        string value)
    {
        byte[] source = Encoding.UTF8.GetBytes(value ?? "");
        Buffer.BlockCopy(source, 0, target, offset, Math.Min(source.Length, length - 1));
    }

    private static void WriteUInt16(byte[] target, int offset, ushort value)
    {
        byte[] bytes = BitConverter.GetBytes(value);
        Buffer.BlockCopy(bytes, 0, target, offset, bytes.Length);
    }

    private static void WriteInt32(byte[] target, int offset, int value)
    {
        byte[] bytes = BitConverter.GetBytes(value);
        Buffer.BlockCopy(bytes, 0, target, offset, bytes.Length);
    }

    private static ushort ParseHex16(string value)
    {
        return Convert.ToUInt16(value, 16);
    }

    private static string Base64(string value)
    {
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(value ?? ""));
    }

    private static string EscapeJson(string value)
    {
        StringBuilder builder = new StringBuilder();
        foreach (char character in value ?? "")
        {
            switch (character)
            {
                case '"':
                case '\\':
                    builder.Append('\\').Append(character);
                    break;
                case '\n':
                    builder.Append("\\n");
                    break;
                case '\r':
                    builder.Append("\\r");
                    break;
                case '\t':
                    builder.Append("\\t");
                    break;
                default:
                    builder.Append(character);
                    break;
            }
        }
        return builder.ToString();
    }

    private static string HexEncode(byte[] bytes)
    {
        StringBuilder output = new StringBuilder(bytes.Length * 2);
        foreach (byte value in bytes)
        {
            output.Append(value.ToString("x2"));
        }
        return output.ToString();
    }

    private static byte[] HexDecode(string value)
    {
        if ((value.Length & 1) != 0)
        {
            throw new InvalidDataException("invalid hexadecimal length");
        }
        byte[] output = new byte[value.Length / 2];
        for (int index = 0; index < output.Length; index++)
        {
            output[index] = Convert.ToByte(value.Substring(index * 2, 2), 16);
        }
        return output;
    }
}
