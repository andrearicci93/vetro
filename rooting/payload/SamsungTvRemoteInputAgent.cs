using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

internal static class SamsungTvRemoteInputAgent
{
    private const string ProtocolVersion = "SAMSUNG-TV-REMOTE/1";
    private const string Libc = "libc";
    private const string VconfApi = "libvconf.so.0";
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
    private const int ResourceTemporarilyUnavailable = 11;
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
    // EVIOCGKEY(96): the keys the remote holds down now, one bit per code up to KEY_MAX (0x2ff).
    private const uint EviocGetKeys = 0x80604518;
    private const int KeyBitmapBytes = (KeyMaximum + 1) / 8;
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
    private const string AllDevicesSpec = "*";
    private const int InNonblock = 0x800;
    private const uint InAttrib = 0x4, InMovedTo = 0x80, InCreate = 0x100;
    private static readonly Regex RemoteNameRegex = new Regex("smart control|rc device|mcirb", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex NotRemoteNameRegex = new Regex("keyboard|mouse|panel", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex BlockNameRegex = new Regex("^N: Name=\"(.*)\"$", RegexOptions.Multiline | RegexOptions.Compiled);
    private static readonly Regex BlockPhysRegex = new Regex("^P: Phys=(.*)$", RegexOptions.Multiline | RegexOptions.Compiled);
    private static readonly Regex BlockHandlersRegex = new Regex("^H: Handlers=(.*)$", RegexOptions.Multiline | RegexOptions.Compiled);
    private static readonly Regex BlockKeyRegex = new Regex("^B: KEY=(.*)$", RegexOptions.Multiline | RegexOptions.Compiled);
    private static readonly Regex BlockEvRegex = new Regex("^B: EV=([0-9a-f]+)$", RegexOptions.Multiline | RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex NonZeroHexRegex = new Regex("[1-9a-f]", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex EventNodeRegex = new Regex("\\bevent[0-9]+\\b", RegexOptions.Compiled);
    private static readonly Regex BlockIdentityRegex = new Regex("Bus=([0-9A-Fa-f]+) Vendor=([0-9A-Fa-f]+) Product=([0-9A-Fa-f]+) Version=([0-9A-Fa-f]+)", RegexOptions.Compiled);
    // Picture Off (screen off, sound on). deviced keeps its display state in memory/pm/state: 1 with the screen on, 3 while
    // it is off (read on a Q80A, fw 2310.0; the key is in deviced on Tizen 6.0, 6.5 and 9).
    private const string DisplayStateKey = "memory/pm/state";
    private const int DisplayStateOff = 3;
    private const string ScreenOnCommand = "--timeout=3 call org.tizen.system.deviced /Org/Tizen/System/DeviceD/Display "
        + "org.tizen.system.deviced.display ChangeState s lcdon";
    private const int DeviceBusy = 16;   // EBUSY
    private const int UinputUserDeviceSize = 1116;
    private const int UinputNameBytes = 80;
    private const long VconfCacheMs = 250;
    private static int wakingScreen;

    private struct PendingEvent
    {
        public string JsonPrefix;
        public long Sequence;
        public long Seconds;
        public long Microseconds;
        public ushort Code;
        public int Value;
        public string Key;
        public string Decision;
        public int? ScanCode;
    }

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

    private sealed class SourceDevice
    {
        public InputDevice Info;
        public int Fd = -1;
        public bool Grabbed;
        public readonly Dictionary<ushort, bool> PressedBlocked = new Dictionary<ushort, bool>();
        public readonly HashSet<ushort> PressedWake = new HashSet<ushort>();
        public readonly HashSet<ushort> ForwardedPressed = new HashSet<ushort>();
        public int? ScanCode;
        public bool ForwardSyn;
        public string JsonPrefix = "";
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
            // The copy's sysfs name, from UI_GET_SYSNAME. Where that call fails (seen as no "remocon subtype" line at all on a Q70C,
            // Tizen 9, 2026-11-20) the copy is found by its Phys instead. Which way it was found goes to the log as
            // "remocon node: sysname / phys / none", read by the diagnostics with the outcome line below.
            string inputName = null;
            byte[] sysName = new byte[64];
            if (ioctl_buffer(descriptor, UiGetSysName, sysName) >= 0)
            {
                inputName = Encoding.ASCII.GetString(sysName).TrimEnd('\0');
                if (inputName.Length == 0 || inputName.IndexOf('/') >= 0)
                {
                    inputName = null;
                }
            }
            // The outcome goes to the log as one fixed line ("remocon subtype: set / unsupported / refused / no tool / no node / failed"), read by
            // the diagnostics: on Tizen 9 boards keys passed on through this copy seem not to reach Samsung's apps or Vetro's TV page
            // (S95C, Q70C, 2026-11-19), and whether the copy became a Remocon there is the first thing to know.
            Task.Run(() =>
            {
                bool asked = false, told = false;
                string how = "none";
                try
                {
                    for (int attempt = 0; attempt < 12; attempt++)
                    {
                        if (Volatile.Read(ref descriptor) < 0)
                        {
                            return;
                        }
                        Thread.Sleep(250);
                        if (Volatile.Read(ref descriptor) < 0)
                        {
                            return;
                        }
                        string node = inputName == null ? null : EventNodeIn("/sys/devices/virtual/input/" + inputName);
                        how = node != null ? "sysname" : "none";
                        if (node == null)
                        {
                            node = FindForwardedNode();
                            if (node != null) how = "phys";
                        }
                        if (node == null)
                        {
                            continue;
                        }
                        if (!told)
                        {
                            Console.Error.WriteLine("remocon node: " + how);
                            told = true;
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
                            Task<string> outTask = process.StandardOutput.ReadToEndAsync();
                            Task<string> errTask = process.StandardError.ReadToEndAsync();
                            if (!process.WaitForExit(5000))
                            {
                                try { process.Kill(); } catch { }
                                continue;
                            }
                            Task.WhenAll(outTask, errTask).Wait(1000);
                            string output = (outTask.Status == TaskStatus.RanToCompletion ? outTask.Result : "")
                                + (errTask.Status == TaskStatus.RanToCompletion ? errTask.Result : "");
                            if (output.Contains("Success"))
                            {
                                Console.Error.WriteLine("remocon subtype: set");
                                return;
                            }
                            // Firmware without the command (Tizen 6.0 on the Q80A answers "unknown option"): asking again changes nothing.
                            if (output.Contains("unknown option"))
                            {
                                Console.Error.WriteLine("remocon subtype: unsupported");
                                return;
                            }
                        }
                    }
                    if (!asked) Console.Error.WriteLine("remocon node: none");
                    Console.Error.WriteLine(asked ? "remocon subtype: refused" : "remocon subtype: no node");
                }
                catch (Exception)
                {
                    Console.Error.WriteLine("remocon subtype: failed");
                }
            });
        }

        // The event node inside one input device's sysfs folder, or null.
        private static string EventNodeIn(string folder)
        {
            try
            {
                if (!Directory.Exists(folder))
                {
                    return null;
                }
                foreach (string entry in Directory.GetDirectories(folder, "event*"))
                {
                    return "/dev/input/" + Path.GetFileName(entry);
                }
            }
            catch (Exception)
            {
            }
            return null;
        }

        // This helper's copy found by its Phys among the virtual input devices (every uinput device is a real folder there; the
        // /sys/class/input entries are links): the newest one (highest inputN) if an older copy lingers.
        private static string FindForwardedNode()
        {
            string found = null;
            int newest = -1;
            try
            {
                foreach (string folder in Directory.GetDirectories("/sys/devices/virtual/input", "input*"))
                {
                    int number;
                    if (!int.TryParse(Path.GetFileName(folder).Substring(5), out number) || number <= newest)
                    {
                        continue;
                    }
                    string phys;
                    try
                    {
                        phys = File.ReadAllText(Path.Combine(folder, "phys")).Trim();
                    }
                    catch (Exception)
                    {
                        continue;
                    }
                    if (phys != ForwardedPhys)
                    {
                        continue;
                    }
                    string node = EventNodeIn(folder);
                    if (node != null)
                    {
                        found = node;
                        newest = number;
                    }
                }
            }
            catch (Exception)
            {
            }
            return found;
        }

        public bool ForwardKey(byte[] inputEvent, HashSet<ushort> sourceForwardedPressed, List<SourceDevice> allSources)
        {
            int typeOffset = IntPtr.Size == 8 ? 16 : 8;
            int codeOffset = typeOffset + 2;
            int valueOffset = codeOffset + 2;
            ushort code = BitConverter.ToUInt16(inputEvent, codeOffset);
            int value = BitConverter.ToInt32(inputEvent, valueOffset);
            // IR kernel drivers emit EV_REP (value == 2), whereas BT Smart Control (EV=3) does not. Suppressing
            // hardware repeat writes makes forwarded IR act identically to SolarCell (software hold/repeat).
            if (value == 2)
            {
                return false;
            }
            if (value == 0)
            {
                sourceForwardedPressed.Remove(code);
                if (!pressedKeys.Contains(code) || IsHeldByAnotherSource(allSources, sourceForwardedPressed, code))
                {
                    return false;
                }
                RequireWrite(descriptor, inputEvent);
                pressedKeys.Remove(code);
                return true;
            }
            sourceForwardedPressed.Add(code);
            if (pressedKeys.Contains(code))
            {
                return false;
            }
            RequireWrite(descriptor, inputEvent);
            pressedKeys.Add(code);
            return true;
        }

        public void ForwardSyn(byte[] synEvent)
        {
            RequireWrite(descriptor, synEvent);
        }

        public void ReleaseSourceKeys(SourceDevice dropped, List<SourceDevice> remaining)
        {
            int current = Volatile.Read(ref descriptor);
            if (current < 0 || dropped.ForwardedPressed.Count == 0)
            {
                dropped.ForwardedPressed.Clear();
                return;
            }
            int eventSize = IntPtr.Size == 8 ? 24 : 16;
            int typeOffset = IntPtr.Size == 8 ? 16 : 8;
            int codeOffset = typeOffset + 2;
            int valueOffset = codeOffset + 2;
            byte[] packet = new byte[eventSize];
            bool wroteAny = false;
            try
            {
                foreach (ushort code in dropped.ForwardedPressed)
                {
                    if (IsHeldByOtherSource(remaining, dropped, code) || !pressedKeys.Remove(code))
                    {
                        continue;
                    }
                    Array.Clear(packet, 0, eventSize);
                    WriteUInt16(packet, typeOffset, EventKey);
                    WriteUInt16(packet, codeOffset, code);
                    WriteInt32(packet, valueOffset, 0);
                    RequireWrite(current, packet);
                    wroteAny = true;
                }
                if (wroteAny)
                {
                    Array.Clear(packet, 0, eventSize);
                    WriteUInt16(packet, typeOffset, EventSynchronization);
                    RequireWrite(current, packet);
                }
            }
            catch (Exception exception)
            {
                Console.Error.WriteLine("failed to release source remote keys: " + exception.Message);
            }
            finally
            {
                dropped.ForwardedPressed.Clear();
            }
        }

        private static bool IsHeldByAnotherSource(List<SourceDevice> allSources, HashSet<ushort> currentSourceSet, ushort code)
        {
            if (allSources == null)
            {
                return false;
            }
            for (int i = 0; i < allSources.Count; i++)
            {
                if (!ReferenceEquals(allSources[i].ForwardedPressed, currentSourceSet)
                    && allSources[i].ForwardedPressed.Contains(code))
                {
                    return true;
                }
            }
            return false;
        }

        private static bool IsHeldByOtherSource(List<SourceDevice> remaining, SourceDevice dropped, ushort code)
        {
            if (remaining == null)
            {
                return false;
            }
            for (int i = 0; i < remaining.Count; i++)
            {
                if (!ReferenceEquals(remaining[i], dropped)
                    && remaining[i].ForwardedPressed.Contains(code))
                {
                    return true;
                }
            }
            return false;
        }

        public void Dispose()
        {
            int current = Interlocked.Exchange(ref descriptor, -1);
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
            if (pressedKeys.Count == 0)
            {
                return;
            }
            int eventSize = IntPtr.Size == 8 ? 24 : 16;
            int typeOffset = IntPtr.Size == 8 ? 16 : 8;
            int codeOffset = typeOffset + 2;
            int valueOffset = codeOffset + 2;
            byte[] packet = new byte[eventSize];
            try
            {
                foreach (ushort code in pressedKeys)
                {
                    Array.Clear(packet, 0, eventSize);
                    WriteUInt16(packet, typeOffset, EventKey);
                    WriteUInt16(packet, codeOffset, code);
                    WriteInt32(packet, valueOffset, 0);
                    write(current, packet, eventSize);
                }
                Array.Clear(packet, 0, eventSize);
                WriteUInt16(packet, typeOffset, EventSynchronization);
                RequireWrite(current, packet);
            }
            finally
            {
                pressedKeys.Clear();
            }
        }
    }

    private static void WaitForNoKeyDown(int descriptor)
    {
        var keys = new byte[KeyBitmapBytes];
        for (int attempt = 0; attempt < 20; attempt++)
        {
            Array.Clear(keys, 0, keys.Length);
            if (ioctl_buffer(descriptor, EviocGetKeys, keys) < 0) return;   // the driver cannot say: grab as before
            bool down = false;
            for (int i = 0; i < keys.Length && !down; i++) down = keys[i] != 0;
            if (!down) return;
            System.Threading.Thread.Sleep(50);
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

    [DllImport(Libc, SetLastError = true)]
    private static extern int inotify_init1(int flags);

    [DllImport(Libc, SetLastError = true)]
    private static extern int inotify_add_watch(int descriptor, string path, uint mask);

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
            string mode = arguments[6];
            if (mode != "observe" && mode != "filter" && mode != "capture")
            {
                throw new ArgumentException("remote-input mode must be observe, filter or capture");
            }
            bool grabMode = mode == "filter" || mode == "capture";
            HashSet<string> blocked = ParseTokens(arguments[7]);
            if (!grabMode && blocked.Count != 0)
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
                mode,
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

    private static string BuildJsonPrefix(InputDevice device, string transport, string model, string mode)
    {
        return ",\"node\":\"" + EscapeJson(device.Node)
            + "\",\"device\":\"" + EscapeJson(device.Name)
            + "\",\"transport\":\"" + EscapeJson(transport)
            + "\",\"model\":\"" + EscapeJson(model)
            + "\",\"mode\":\"" + EscapeJson(mode)
            + "\",\"time_seconds\":";
    }

    private static bool TryParseAllDeviceSpec(string deviceSpec, out HashSet<string> excludedNames)
    {
        excludedNames = new HashSet<string>(StringComparer.Ordinal);
        if (deviceSpec == AllDevicesSpec)
        {
            return true;
        }
        if (deviceSpec != null && deviceSpec.StartsWith("*!", StringComparison.Ordinal))
        {
            string rest = deviceSpec.Substring(2);
            foreach (string part in rest.Split(','))
            {
                if (string.IsNullOrEmpty(part))
                {
                    continue;
                }
                string decoded = Encoding.UTF8.GetString(Convert.FromBase64String(part));
                if (decoded.Length > 0)
                {
                    excludedNames.Add(decoded);
                }
            }
            return true;
        }
        return false;
    }

    private static InputDevice SelectForwarderSource(List<SourceDevice> sources)
    {
        for (int i = 0; i < sources.Count; i++)
        {
            if (string.Equals(sources[i].Info.Name, "Smart Control 2016", StringComparison.OrdinalIgnoreCase))
            {
                return sources[i].Info;
            }
        }
        for (int i = 0; i < sources.Count; i++)
        {
            if (sources[i].Info.Name.IndexOf("Smart Control", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return sources[i].Info;
            }
        }
        for (int i = 0; i < sources.Count; i++)
        {
            if (sources[i].Info.Name.IndexOf("rc device", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return sources[i].Info;
            }
        }
        return sources[0].Info;
    }

    private static void GrabDevice(int inputDescriptor, string node)
    {
        // A key held down at the moment of the grab would never be released for the window system: its release
        // then comes from the copy, while the remote still counts it as down, and Tizen 9 drops a release whose
        // code is down on another device (a Play/Pause that then reads as held). Wait up to a second for no key down.
        WaitForNoKeyDown(inputDescriptor);
        // EBUSY: the helper of an earlier start may still be letting go of the remote (seen once on
        // an AU7000); a short wait is enough, the service ends stale helpers before a new start.
        int grab = ioctl_integer(inputDescriptor, EviocGrab, 1);
        for (int attempt = 0; grab != 0 && Marshal.GetLastWin32Error() == DeviceBusy && attempt < 5; attempt++)
        {
            Thread.Sleep(300);
            grab = ioctl_integer(inputDescriptor, EviocGrab, 1);
        }
        if (grab != 0)
        {
            throw NativeError("EVIOCGRAB " + node);
        }
    }

    private static void DisposeSource(SourceDevice source, UinputForwarder forwarder, List<SourceDevice> remaining)
    {
        if (source == null)
        {
            return;
        }
        if (forwarder != null)
        {
            forwarder.ReleaseSourceKeys(source, remaining);
        }
        if (source.Grabbed && source.Fd >= 0)
        {
            ioctl_integer(source.Fd, EviocGrab, 0);
            source.Grabbed = false;
        }
        if (source.Fd >= 0)
        {
            close(source.Fd);
            source.Fd = -1;
        }
    }

    private static void Run(
        string host,
        int port,
        byte[] secret,
        string deviceName,
        string transport,
        string model,
        string mode,
        HashSet<string> blocked)
    {
        bool grabMode = mode == "filter" || mode == "capture";
        HashSet<string> excludedNames;
        bool allDevices = TryParseAllDeviceSpec(deviceName, out excludedNames);
        List<InputDevice> initialDevices;
        if (allDevices)
        {
            initialDevices = FindSelectableDevices(excludedNames);
            if (initialDevices.Count == 0)
            {
                throw new InvalidOperationException("no physical remote devices found");
            }
        }
        else
        {
            InputDevice device = FindInputDevice(deviceName);
            if (device == null)
            {
                throw new InvalidOperationException(
                    "input device not found: " + deviceName);
            }
            initialDevices = new List<InputDevice> { device };
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
                using (HMACSHA256 hmac = new HMACSHA256(secret))
                {
                    List<SourceDevice> sources = new List<SourceDevice>(initialDevices.Count);
                    UinputForwarder forwarder = null;
                    int inotifyFd = -1;
                    try
                    {
                        for (int i = 0; i < initialDevices.Count; i++)
                        {
                            InputDevice dev = initialDevices[i];
                            int fd = open(dev.Node, OpenReadOnly | OpenNonblock);
                            if (fd < 0)
                            {
                                Exception openError = NativeError("open " + dev.Node);
                                if (!allDevices)
                                {
                                    throw openError;
                                }
                                Console.Error.WriteLine("skipping " + dev.Node + ": " + openError.Message);
                                continue;
                            }
                            sources.Add(new SourceDevice
                            {
                                Info = dev,
                                Fd = fd,
                                JsonPrefix = BuildJsonPrefix(dev, transport, model, mode),
                            });
                        }
                        if (sources.Count == 0)
                        {
                            throw new InvalidOperationException("no physical remote device could be opened");
                        }
                        if (grabMode)
                        {
                            forwarder = new UinputForwarder(SelectForwarderSource(sources));
                            for (int i = sources.Count - 1; i >= 0; i--)
                            {
                                SourceDevice s = sources[i];
                                try
                                {
                                    GrabDevice(s.Fd, s.Info.Node);
                                    s.Grabbed = true;
                                }
                                catch (Exception grabError)
                                {
                                    if (!allDevices)
                                    {
                                        throw;
                                    }
                                    Console.Error.WriteLine("skipping " + s.Info.Node + ": " + grabError.Message);
                                    sources.RemoveAt(i);
                                    DisposeSource(s, null, null);
                                }
                            }
                            if (sources.Count == 0)
                            {
                                throw new IOException("failed to grab any physical remote device");
                            }
                        }
                        if (allDevices)
                        {
                            Console.Error.WriteLine("watching " + sources.Count + " device(s)");
                            inotifyFd = OpenInputDirectoryWatch();
                        }
                        string authDeviceName = allDevices ? "all" : sources[0].Info.Name;
                        string authDeviceNode = allDevices ? "all" : sources[0].Info.Node;
                        WriteAuthenticated(
                            stream,
                            nonce,
                            hmac,
                            string.Join(
                                "\t",
                                "AUTH",
                                getpid().ToString(),
                                getuid().ToString(),
                                getgid().ToString(),
                                Base64(authDeviceName),
                                Base64(authDeviceNode),
                                Base64(transport),
                                Base64(model),
                                mode));
                        ForwardEvents(
                            client,
                            stream,
                            sources,
                            allDevices,
                            excludedNames,
                            inotifyFd,
                            transport,
                            model,
                            mode,
                            blocked,
                            forwarder,
                            nonce,
                            hmac);
                    }
                    finally
                    {
                        if (inotifyFd >= 0)
                        {
                            close(inotifyFd);
                        }
                        if (forwarder != null)
                        {
                            forwarder.Dispose();
                        }
                        for (int i = 0; i < sources.Count; i++)
                        {
                            DisposeSource(sources[i], null, null);
                        }
                    }
                }
            }
        }
    }

    private static int OpenInputDirectoryWatch()
    {
        try
        {
            int fd = inotify_init1(InNonblock);
            if (fd < 0)
            {
                return -1;
            }
            if (inotify_add_watch(fd, "/dev/input", InCreate | InAttrib | InMovedTo) < 0)
            {
                close(fd);
                return -1;
            }
            return fd;
        }
        catch
        {
            return -1;
        }
    }

    private static bool TryAttachNewDevices(
        List<SourceDevice> sources,
        HashSet<string> excludedNames,
        string transport,
        string model,
        string mode,
        bool grabMode)
    {
        List<InputDevice> available = FindSelectableDevices(excludedNames);
        bool added = false;
        for (int i = 0; i < available.Count; i++)
        {
            InputDevice dev = available[i];
            bool known = false;
            for (int j = 0; j < sources.Count; j++)
            {
                if (sources[j].Info.Node == dev.Node)
                {
                    known = true;
                    break;
                }
            }
            if (known)
            {
                continue;
            }
            int fd = open(dev.Node, OpenReadOnly | OpenNonblock);
            if (fd < 0)
            {
                Console.Error.WriteLine("skipping " + dev.Node + ": open failed errno " + Marshal.GetLastWin32Error());
                continue;
            }
            bool grabbed = false;
            try
            {
                if (grabMode)
                {
                    GrabDevice(fd, dev.Node);
                    grabbed = true;
                }
                sources.Add(new SourceDevice
                {
                    Info = dev,
                    Fd = fd,
                    Grabbed = grabbed,
                    JsonPrefix = BuildJsonPrefix(dev, transport, model, mode),
                });
                added = true;
                Console.Error.WriteLine("attached " + dev.Node);
            }
            catch (Exception ex)
            {
                if (grabbed)
                {
                    ioctl_integer(fd, EviocGrab, 0);
                }
                close(fd);
                Console.Error.WriteLine("skipping " + dev.Node + ": " + ex.Message);
            }
        }
        return added;
    }

    private static PollDescriptor[] BuildPollDescriptors(
        List<SourceDevice> sources,
        int socketFd,
        int inotifyFd)
    {
        int extra = inotifyFd >= 0 ? 2 : 1;
        PollDescriptor[] descriptors = new PollDescriptor[sources.Count + extra];
        for (int i = 0; i < sources.Count; i++)
        {
            descriptors[i] = new PollDescriptor { FileDescriptor = sources[i].Fd, Events = PollIn };
        }
        descriptors[sources.Count] = new PollDescriptor { FileDescriptor = socketFd, Events = PollIn };
        if (inotifyFd >= 0)
        {
            descriptors[sources.Count + 1] = new PollDescriptor { FileDescriptor = inotifyFd, Events = PollIn };
        }
        return descriptors;
    }

    private static bool[] BuildBlockedTable(
        HashSet<string> blocked,
        Dictionary<int, string> keyNames)
    {
        bool[] table = new bool[KeyMaximum + 1];
        if (blocked == null || blocked.Count == 0)
        {
            return table;
        }
        for (int code = 0; code <= KeyMaximum; code++)
        {
            string key;
            if (blocked.Contains(code.ToString())
                || (keyNames.TryGetValue(code, out key)
                    && !string.IsNullOrEmpty(key)
                    && blocked.Contains(key)))
            {
                table[code] = true;
            }
        }
        return table;
    }

    private static void ForwardEvents(
        TcpClient client,
        Stream stream,
        List<SourceDevice> sources,
        bool allDevices,
        HashSet<string> excludedNames,
        int inotifyFd,
        string transport,
        string model,
        string mode,
        HashSet<string> blocked,
        UinputForwarder forwarder,
        byte[] nonce,
        HMACSHA256 hmac)
    {
        bool grabMode = mode == "filter" || mode == "capture";
        bool captureAll = mode == "capture";
        int eventSize = IntPtr.Size == 8 ? 24 : 16;
        int typeOffset = IntPtr.Size == 8 ? 16 : 8;
        int codeOffset = typeOffset + 2;
        int valueOffset = codeOffset + 2;
        Dictionary<int, string> keyNames = ReadKeyNames();
        bool[] blockedCodes = BuildBlockedTable(blocked, keyNames);
        List<PendingEvent> pendingEvents = new List<PendingEvent>(4);
        long sequence = 0;
        long vconfAt = long.MinValue;
        int cachedSourceType = -1;
        PresentationSnapshot cachedPresentation = null;
        StringBuilder jsonBuilder = new StringBuilder(512);
        byte[] probe = new byte[1];
        byte[] buffer = new byte[eventSize];
        byte[] inotifyBuf = inotifyFd >= 0 ? new byte[1024] : null;
        int socketFd = client.Client.Handle.ToInt32();
        PollDescriptor[] descriptors = BuildPollDescriptors(sources, socketFd, inotifyFd);
        bool sourcesDirty = false;
        long rescanAt = -1;
        while (true)
        {
            if (rescanAt >= 0 && Environment.TickCount64 >= rescanAt)
            {
                rescanAt = -1;
                if (TryAttachNewDevices(sources, excludedNames, transport, model, mode, grabMode))
                {
                    sourcesDirty = true;
                }
            }
            if (sourcesDirty)
            {
                descriptors = BuildPollDescriptors(sources, socketFd, inotifyFd);
                sourcesDirty = false;
            }
            int socketIndex = sources.Count;
            int inotifyIndex = inotifyFd >= 0 ? sources.Count + 1 : -1;
            for (int i = 0; i < descriptors.Length; i++)
            {
                descriptors[i].ReturnedEvents = 0;
            }
            int pollTimeout = rescanAt >= 0
                ? (int)Math.Max(1L, Math.Min((long)int.MaxValue, rescanAt - Environment.TickCount64))
                : -1;
            int ready = poll(descriptors, (uint)descriptors.Length, pollTimeout);
            if (ready < 0)
            {
                if (Marshal.GetLastWin32Error() == InterruptedSystemCall)
                {
                    continue;
                }
                throw NativeError("poll remote input");
            }
            if ((descriptors[socketIndex].ReturnedEvents
                    & (PollError | PollHangup | PollInvalid)) != 0)
            {
                return;
            }
            if ((descriptors[socketIndex].ReturnedEvents & PollIn) != 0)
            {
                int count = client.Client.Receive(probe, 0, 1, SocketFlags.Peek);
                if (count == 0)
                {
                    return;
                }
                throw new InvalidDataException(
                    "remote-input host sent unexpected data");
            }
            if (inotifyIndex >= 0 && (descriptors[inotifyIndex].ReturnedEvents & PollIn) != 0)
            {
                for (int round = 0; round < 8; round++)
                {
                    int n = read(inotifyFd, inotifyBuf, inotifyBuf.Length);
                    if (n <= 0)
                    {
                        break;
                    }
                }
                rescanAt = Environment.TickCount64 + 100;
            }
            for (int i = sources.Count - 1; i >= 0; i--)
            {
                SourceDevice source = sources[i];
                short revents = descriptors[i].ReturnedEvents;
                if ((revents & (PollError | PollHangup | PollInvalid)) != 0)
                {
                    sources.RemoveAt(i);
                    DisposeSource(source, forwarder, sources);
                    sourcesDirty = true;
                    if (!allDevices || sources.Count == 0)
                    {
                        throw new IOException("remote input device disconnected");
                    }
                    Console.Error.WriteLine("detached " + source.Info.Node);
                    continue;
                }
                if ((revents & PollIn) == 0)
                {
                    continue;
                }
                bool sourceRemoved = false;
                while (true)
                {
                    int count = read(source.Fd, buffer, buffer.Length);
                    if (count < 0)
                    {
                        int errno = Marshal.GetLastWin32Error();
                        if (errno == ResourceTemporarilyUnavailable)
                        {
                            break;
                        }
                        if (errno == InterruptedSystemCall)
                        {
                            continue;
                        }
                        sources.RemoveAt(i);
                        DisposeSource(source, forwarder, sources);
                        sourcesDirty = true;
                        sourceRemoved = true;
                        if (!allDevices || sources.Count == 0)
                        {
                            throw NativeError("read " + source.Info.Node);
                        }
                        Console.Error.WriteLine("detached " + source.Info.Node);
                        break;
                    }
                    if (count == 0)
                    {
                        sources.RemoveAt(i);
                        DisposeSource(source, forwarder, sources);
                        sourcesDirty = true;
                        sourceRemoved = true;
                        if (!allDevices || sources.Count == 0)
                        {
                            throw new IOException("remote input device disconnected");
                        }
                        Console.Error.WriteLine("detached " + source.Info.Node);
                        break;
                    }
                    if (count != eventSize)
                    {
                        break;
                    }
                    ushort type = BitConverter.ToUInt16(buffer, typeOffset);
                    ushort code = BitConverter.ToUInt16(buffer, codeOffset);
                    int value = BitConverter.ToInt32(buffer, valueOffset);
                    if (type == EventMiscellaneous && code == MiscellaneousScan)
                    {
                        source.ScanCode = value;
                    }
                    if (type == EventKey)
                    {
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
                        if (grabMode)
                        {
                            if (value == 1)
                            {
                                if (!KeepsScreenOff(code) && ScreenIsOff())
                                {
                                    source.PressedWake.Add(code);
                                    TurnScreenOn();
                                }
                                else
                                {
                                    source.PressedWake.Remove(code);
                                }
                            }
                            wake = source.PressedWake.Contains(code);
                            if (wake && value == 0)
                            {
                                source.PressedWake.Remove(code);
                            }
                        }
                        if (!wake)
                        {
                            bool first = captureAll || (code <= KeyMaximum
                                ? blockedCodes[code]
                                : (blocked.Contains(code.ToString())
                                    || (!string.IsNullOrEmpty(key) && blocked.Contains(key))));
                            bool original;
                            if (value == 1)
                            {
                                block = first;
                                source.PressedBlocked[code] = block;
                            }
                            else if (source.PressedBlocked.TryGetValue(code, out original))
                            {
                                block = original;
                            }
                            else
                            {
                                block = first;
                            }
                        }
                        if (grabMode && !block && !wake)
                        {
                            if (forwarder.ForwardKey(buffer, source.ForwardedPressed, sources))
                            {
                                source.ForwardSyn = true;
                            }
                        }
                        sequence++;
                        long seconds = IntPtr.Size == 8
                            ? BitConverter.ToInt64(buffer, 0)
                            : BitConverter.ToInt32(buffer, 0);
                        long microseconds = IntPtr.Size == 8
                            ? BitConverter.ToInt64(buffer, 8)
                            : BitConverter.ToInt32(buffer, 4);
                        pendingEvents.Add(new PendingEvent
                        {
                            JsonPrefix = source.JsonPrefix,
                            Sequence = sequence,
                            Seconds = seconds,
                            Microseconds = microseconds,
                            Code = code,
                            Value = value,
                            Key = key,
                            Decision = wake ? "wake" : block ? "blocked" : "native",
                            ScanCode = source.ScanCode,
                        });
                        if (value == 0)
                        {
                            source.PressedBlocked.Remove(code);
                        }
                    }
                    else if (type == EventSynchronization)
                    {
                        if (grabMode && source.ForwardSyn)
                        {
                            forwarder.ForwardSyn(buffer);
                            source.ForwardSyn = false;
                        }
                        source.ScanCode = null;
                        if (pendingEvents.Count > 0)
                        {
                            FlushPendingEvents(
                                pendingEvents,
                                stream,
                                nonce,
                                hmac,
                                jsonBuilder,
                                ref vconfAt,
                                ref cachedSourceType,
                                ref cachedPresentation);
                        }
                    }
                }
                if (pendingEvents.Count > 0)
                {
                    FlushPendingEvents(
                        pendingEvents,
                        stream,
                        nonce,
                        hmac,
                        jsonBuilder,
                        ref vconfAt,
                        ref cachedSourceType,
                        ref cachedPresentation);
                }
                if (sourceRemoved)
                {
                    continue;
                }
            }
        }
    }

    private static void FlushPendingEvents(
        List<PendingEvent> pendingEvents,
        Stream stream,
        byte[] nonce,
        HMACSHA256 hmac,
        StringBuilder jsonBuilder,
        ref long vconfAt,
        ref int cachedSourceType,
        ref PresentationSnapshot cachedPresentation)
    {
        for (int i = 0; i < pendingEvents.Count; i++)
        {
            PendingEvent ev = pendingEvents[i];
            long now = Environment.TickCount64;
            if (ev.Value == 1 || vconfAt == long.MinValue || now - vconfAt >= VconfCacheMs)
            {
                cachedSourceType = ReadCurrentSourceType();
                cachedPresentation = ReadPresentationSnapshot();
                vconfAt = now;
            }
            WriteAuthenticated(
                stream,
                nonce,
                hmac,
                "EVENT\t"
                + ev.Sequence
                + "\t"
                + Convert.ToBase64String(
                    Encoding.UTF8.GetBytes(
                        EventJson(
                            jsonBuilder,
                            ev.Sequence,
                            ev.JsonPrefix,
                            ev.Seconds,
                            ev.Microseconds,
                            ev.Code,
                            ev.Value,
                            ev.Key,
                            ev.Decision,
                            ev.ScanCode,
                            cachedSourceType,
                            cachedPresentation))));
        }
        pendingEvents.Clear();
    }

    private static string EventJson(
        StringBuilder builder,
        long sequence,
        string jsonPrefix,
        long seconds,
        long microseconds,
        ushort code,
        int value,
        string key,
        string decision,
        int? scanCode,
        int sourceType,
        PresentationSnapshot presentation)
    {
        builder.Clear();
        builder.Append("{\"event\":\"input\",\"sequence\":").Append(sequence)
            .Append(jsonPrefix).Append(seconds)
            .Append(",\"time_microseconds\":").Append(microseconds)
            .Append(",\"type\":1,\"code\":").Append(code)
            .Append(",\"value\":").Append(value)
            .Append(",\"type_name\":\"EV_KEY\",\"key\":\"").Append(EscapeJson(key))
            .Append("\",\"action\":\"").Append(ActionName(value))
            .Append("\",\"decision\":\"").Append(decision).Append('"');
        if (scanCode.HasValue)
        {
            builder.Append(",\"scan_code\":").Append(scanCode.Value)
                .Append(",\"scan_code_hex\":\"0x")
                .Append(unchecked((uint)scanCode.Value).ToString("X8")).Append('"');
        }
        if (sourceType >= 0)
        {
            builder.Append(",\"tv_source\":\"").Append(SourceName(sourceType))
                .Append("\",\"tv_source_type\":").Append(sourceType);
        }
        if (presentation != null)
        {
            builder.Append(",\"tv_fullscreen_appid\":\"")
                .Append(EscapeJson(presentation.FullscreenApplicationId))
                .Append("\",\"tv_partial_appid\":\"")
                .Append(EscapeJson(presentation.PartialApplicationId)).Append('"');
        }
        builder.Append('}');
        return builder.ToString();
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
        try
        {
            int state;
            return VconfGetInt(DisplayStateKey, out state) == 0 && state == DisplayStateOff;
        }
        catch (Exception ex) when (ex is DllNotFoundException || ex is EntryPointNotFoundException)
        {
            return false;
        }
    }

    private static void TurnScreenOn()
    {
        if (Interlocked.CompareExchange(ref wakingScreen, 1, 0) != 0)
        {
            return;
        }
        Task.Run(() =>
        {
            try
            {
                using (System.Diagnostics.Process process = new System.Diagnostics.Process())
                {
                    process.StartInfo.FileName = "/usr/bin/busctl";
                    process.StartInfo.Arguments = ScreenOnCommand;
                    process.StartInfo.UseShellExecute = false;
                    process.StartInfo.RedirectStandardOutput = false;
                    process.StartInfo.RedirectStandardError = false;
                    process.Start();
                    if (!process.WaitForExit(5000))
                    {
                        try { process.Kill(); } catch { }
                    }
                }
            }
            catch (Exception)
            {
            }
            finally
            {
                Volatile.Write(ref wakingScreen, 0);
            }
        });
    }

    private static int ReadCurrentSourceType()
    {
        try
        {
            int sourceType;
            return VconfGetInt(CurrentSourceTypeKey, out sourceType) == 0
                ? sourceType
                : -1;
        }
        catch (Exception ex) when (ex is DllNotFoundException || ex is EntryPointNotFoundException)
        {
            return -1;
        }
    }

    private static PresentationSnapshot ReadPresentationSnapshot()
    {
        string fullscreen;
        string partial;
        bool hasFull = TryReadVconfString(CurrentFullscreenAppIdKey, out fullscreen);
        bool hasPartial = TryReadVconfString(CurrentPartialAppIdKey, out partial);
        if (!hasFull && !hasPartial)
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
        IntPtr pointer;
        try
        {
            pointer = VconfGetString(key);
        }
        catch (Exception ex) when (ex is DllNotFoundException || ex is EntryPointNotFoundException)
        {
            value = "";
            return false;
        }
        if (pointer == IntPtr.Zero)
        {
            value = "";
            return false;
        }
        try
        {
            value = Marshal.PtrToStringUTF8(pointer) ?? "";
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

    private static bool BlockHasKeys(string block)
    {
        Match keyMatch = BlockKeyRegex.Match(block);
        if (keyMatch.Success)
        {
            return NonZeroHexRegex.IsMatch(keyMatch.Groups[1].Value);
        }
        Match evMatch = BlockEvRegex.Match(block);
        if (evMatch.Success)
        {
            string hex = evMatch.Groups[1].Value;
            if (hex.Length > 8)
            {
                hex = hex.Substring(hex.Length - 8);
            }
            uint evBits = Convert.ToUInt32(hex, 16);
            return (evBits & 2u) != 0;
        }
        return true;
    }

    private static InputDevice ParseInputDeviceBlock(string block)
    {
        Match physMatch = BlockPhysRegex.Match(block);
        if (physMatch.Success && physMatch.Groups[1].Value.Trim() == ForwardedPhys)
        {
            return null;
        }
        Match nameMatch = BlockNameRegex.Match(block);
        if (!nameMatch.Success)
        {
            return null;
        }
        Match handlersMatch = BlockHandlersRegex.Match(block);
        Match eventMatch = handlersMatch.Success
            ? EventNodeRegex.Match(handlersMatch.Groups[1].Value)
            : EventNodeRegex.Match(block);
        if (!eventMatch.Success)
        {
            return null;
        }
        Match identity = BlockIdentityRegex.Match(block);
        InputDevice device = new InputDevice();
        device.Name = nameMatch.Groups[1].Value;
        device.Node = "/dev/input/" + eventMatch.Value;
        if (identity.Success)
        {
            device.Bus = ParseHex16(identity.Groups[1].Value);
            device.Vendor = ParseHex16(identity.Groups[2].Value);
            device.Product = ParseHex16(identity.Groups[3].Value);
            device.Version = ParseHex16(identity.Groups[4].Value);
        }
        return device;
    }

    private static List<InputDevice> FindSelectableDevices(HashSet<string> excludedNames)
    {
        List<InputDevice> result = new List<InputDevice>();
        if (!File.Exists("/proc/bus/input/devices"))
        {
            return result;
        }
        string text = File.ReadAllText("/proc/bus/input/devices").Replace("\r", "");
        HashSet<string> seenNodes = new HashSet<string>(StringComparer.Ordinal);
        foreach (string block in Regex.Split(text.Trim(), "\\n\\s*\\n"))
        {
            InputDevice device = ParseInputDeviceBlock(block);
            if (device == null)
            {
                continue;
            }
            if (excludedNames != null && excludedNames.Contains(device.Name))
            {
                continue;
            }
            if (!RemoteNameRegex.IsMatch(device.Name)
                || NotRemoteNameRegex.IsMatch(device.Name)
                || !BlockHasKeys(block))
            {
                continue;
            }
            if (seenNodes.Add(device.Node))
            {
                result.Add(device);
            }
        }
        return result;
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
        string text = File.ReadAllText("/proc/bus/input/devices").Replace("\r", "");
        foreach (string block in Regex.Split(text.Trim(), "\\n\\s*\\n"))
        {
            InputDevice device = ParseInputDeviceBlock(block);
            if (device == null || device.Name != expectedName)
            {
                continue;
            }
            if (expectedNode != null && device.Node != expectedNode)
            {
                continue;
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
        HMACSHA256 hmac,
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
        byte[] hash = hmac.ComputeHash(message);
        byte[] frame = new byte[payloadBytes.Length + 1 + hash.Length * 2 + 1];
        Buffer.BlockCopy(payloadBytes, 0, frame, 0, payloadBytes.Length);
        int at = payloadBytes.Length;
        frame[at++] = (byte)'\t';
        const string hex = "0123456789abcdef";
        for (int i = 0; i < hash.Length; i++)
        {
            byte b = hash[i];
            frame[at++] = (byte)hex[b >> 4];
            frame[at++] = (byte)hex[b & 0xF];
        }
        frame[at] = (byte)'\n';
        stream.Write(frame, 0, frame.Length);
        stream.Flush();
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
        for (int attempt = 0; attempt < 3; attempt++)
        {
            int count = write(descriptor, buffer, buffer.Length);
            if (count == buffer.Length) return;
            if (count >= 0) throw NativeError("write returned " + count + ", expected " + buffer.Length);
            int errno = Marshal.GetLastWin32Error();
            if (errno != InterruptedSystemCall && errno != ResourceTemporarilyUnavailable)
            {
                throw NativeError("write returned " + count + ", expected " + buffer.Length);
            }
            Thread.Sleep(1);
        }
        throw NativeError("write returned -1 after retries, expected " + buffer.Length);
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
        target[offset] = (byte)value;
        target[offset + 1] = (byte)(value >> 8);
    }

    private static void WriteInt32(byte[] target, int offset, int value)
    {
        target[offset] = (byte)value;
        target[offset + 1] = (byte)(value >> 8);
        target[offset + 2] = (byte)(value >> 16);
        target[offset + 3] = (byte)(value >> 24);
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
        if (string.IsNullOrEmpty(value))
        {
            return "";
        }
        bool dirty = false;
        for (int i = 0; i < value.Length; i++)
        {
            char c = value[i];
            if (c == '"' || c == '\\' || c < ' ')
            {
                dirty = true;
                break;
            }
        }
        if (!dirty)
        {
            return value;
        }
        StringBuilder builder = new StringBuilder(value.Length + 8);
        foreach (char character in value)
        {
            switch (character)
            {
                case '"':
                case '\\':
                    builder.Append('\\').Append(character);
                    break;
                case '\b':
                    builder.Append("\\b");
                    break;
                case '\f':
                    builder.Append("\\f");
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
                    if (character < ' ')
                    {
                        builder.Append("\\u").Append(((int)character).ToString("x4"));
                    }
                    else
                    {
                        builder.Append(character);
                    }
                    break;
            }
        }
        return builder.ToString();
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
