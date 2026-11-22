using System;
using System.Collections.Generic;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;
using Launcher.Native;

namespace Launcher.Ui
{
    /// <summary>
    /// Enforces C1 Enlightenment window layering on Tizen 9 via <c>org.enlightenment.wm.Test</c> (uid=0):
    /// moves <c>vetro-idle</c> from layer 250 to layer 200 above <c>tv-viewer</c>/<c>tv-viewer-graphics</c>
    /// so translucent partial overlays (<c>com.samsung.tv.shortcut</c>, <c>org.tizen.menu</c>) render above
    /// <c>vetro-idle</c> while <c>vetro-idle</c> keeps covering <c>org.tizen.tv-viewer</c>.
    /// </summary>
    internal sealed class WmStackController
    {
        private const int LayerNormal = 200;
        private readonly Action<string> _log;
        private readonly object _gate = new object();
        private bool _busy, _pending, _probed, _active;
        private uint _idleWinId;
        private long _burstUntilMs;

        public WmStackController(Action<string> log)
        {
            _log = log;
        }

        public bool IsActive { get { return _active; } }

        /// <summary>Requests an immediate stack check and a short follow-up burst (~450 ms) for async overlay mapping.</summary>
        public void EnsureStack(bool burst = true)
        {
            long now = Environment.TickCount;
            if (burst) _burstUntilMs = now + 450;
            lock (_gate)
            {
                if (_busy) { _pending = true; return; }
                _busy = true;
            }
            Task.Run(() => Worker());
        }

        private void Worker()
        {
            try
            {
                while (true)
                {
                    Step();
                    long rem = _burstUntilMs - Environment.TickCount;
                    bool again;
                    lock (_gate)
                    {
                        again = _pending || rem > 0;
                        _pending = false;
                        if (!again) { _busy = false; return; }
                    }
                    if (rem > 0) Thread.Sleep(150);
                }
            }
            catch (Exception ex)
            {
                if (_log != null) _log("wm stack: " + ex.Message);
                lock (_gate) { _busy = false; _pending = false; }
            }
        }

        private void Step()
        {
            string raw = Shell.Read("dbus-send --system --dest=org.enlightenment.wm --print-reply=literal /org/enlightenment/wm org.enlightenment.wm.Test.GetWinsInfo 2>/dev/null");
            if (string.IsNullOrEmpty(raw))
            {
                if (!_probed) { _probed = true; if (_log != null) _log("wm stack: GetWinsInfo unavailable, using PartialAppId hide fallback"); }
                return;
            }

            uint idleWin = 0, tvViewerWin = 0, tvGraphicsWin = 0;
            int idleIndex = -1, tvViewerIndex = -1, tvGraphicsIndex = -1;
            int idx = 0;
            string[] structs = raw.Split(new[] { "struct {" }, StringSplitOptions.RemoveEmptyEntries);
            foreach (string block in structs)
            {
                uint winId;
                string title;
                if (!TryParseWin(block, out winId, out title)) continue;
                if (title == "vetro-idle") { idleWin = winId; idleIndex = idx; }
                else if (title == "tv-viewer") { tvViewerWin = winId; tvViewerIndex = idx; }
                else if (title == "tv-viewer-graphics") { tvGraphicsWin = winId; tvGraphicsIndex = idx; }
                idx++;
            }

            if (idleWin == 0) return;
            _idleWinId = idleWin;

            string lvlReply = Shell.Read("dbus-send --system --dest=org.enlightenment.wm --print-reply=literal /org/enlightenment/wm org.enlightenment.wm.Test.GetWindowNotiLevel uint32:" + idleWin.ToString(CultureInfo.InvariantCulture) + " 2>/dev/null");
            int curLayer = ParseIntReply(lvlReply);
            if (curLayer != LayerNormal)
            {
                Shell.Read("dbus-send --system --dest=org.enlightenment.wm --print-reply=literal /org/enlightenment/wm org.enlightenment.wm.Test.SetWindowNotiLevel uint32:" + idleWin.ToString(CultureInfo.InvariantCulture) + " int32:" + LayerNormal + " 2>/dev/null");
                lvlReply = Shell.Read("dbus-send --system --dest=org.enlightenment.wm --print-reply=literal /org/enlightenment/wm org.enlightenment.wm.Test.GetWindowNotiLevel uint32:" + idleWin.ToString(CultureInfo.InvariantCulture) + " 2>/dev/null");
                curLayer = ParseIntReply(lvlReply);
            }

            if (curLayer == LayerNormal)
            {
                if (!_active)
                {
                    _active = true;
                    _probed = true;
                    if (_log != null) _log("wm stack: C1 active (win=" + idleWin + " layer=200)");
                }
                // GetWinsInfo lists top-to-bottom: smaller index is higher in Z-order.
                uint topTv = 0;
                int topTvIndex = int.MaxValue;
                if (tvGraphicsWin != 0 && tvGraphicsIndex < topTvIndex) { topTv = tvGraphicsWin; topTvIndex = tvGraphicsIndex; }
                if (tvViewerWin != 0 && tvViewerIndex < topTvIndex) { topTv = tvViewerWin; topTvIndex = tvViewerIndex; }
                if (topTv != 0 && idleIndex > topTvIndex)
                {
                    Shell.Read("dbus-send --system --dest=org.enlightenment.wm --print-reply=literal /org/enlightenment/wm org.enlightenment.wm.Test.SetWindowStack uint32:" + idleWin.ToString(CultureInfo.InvariantCulture) + " uint32:" + topTv.ToString(CultureInfo.InvariantCulture) + " int32:1 2>/dev/null");
                }
            }
            else if (!_probed)
            {
                _probed = true;
                if (_log != null) _log("wm stack: C1 refused (layer=" + curLayer + "), using fallback");
            }
        }

        private static bool TryParseWin(string block, out uint winId, out string title)
        {
            winId = 0;
            title = null;
            string[] lines = block.Split('\n');
            foreach (string rawLine in lines)
            {
                string line = rawLine.Trim();
                if (winId == 0 && line.StartsWith("uint32 ", StringComparison.Ordinal))
                {
                    uint.TryParse(line.Substring(7).Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out winId);
                }
                else if (winId != 0 && title == null && line.Length > 0
                    && !line.StartsWith("int32 ", StringComparison.Ordinal)
                    && !line.StartsWith("boolean ", StringComparison.Ordinal)
                    && !line.StartsWith("}", StringComparison.Ordinal))
                {
                    int cut = line.IndexOf("         ", StringComparison.Ordinal);
                    title = (cut >= 0 ? line.Substring(0, cut) : line).Trim();
                    return true;
                }
            }
            return false;
        }

        private static int ParseIntReply(string reply)
        {
            if (string.IsNullOrEmpty(reply)) return -1;
            string[] parts = reply.Trim().Split(new[] { ' ', '\t', '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            int val;
            return parts.Length >= 2 && int.TryParse(parts[parts.Length - 1], NumberStyles.Integer, CultureInfo.InvariantCulture, out val) ? val : -1;
        }
    }
}
