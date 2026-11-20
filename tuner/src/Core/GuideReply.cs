using System;
using System.Collections.Generic;
using System.Text;

namespace Tuner.Core
{
    /// <summary>One programme of a channel's schedule. Times are Unix seconds (UTC), the clock <c>ProgramData.StartTime</c> uses.</summary>
    internal sealed class GuideEvent
    {
        public ushort EventId;
        public long Start;
        public long Duration;
        public string Title = "";
        public string Description = "";
        public long End { get { return Start + Duration; } }
    }

    /// <summary>
    /// The reply to <c>IServiceGuide.GetProgramList</c> (function code 1): the daemon's schedule of one channel for a window of time.
    /// The request carries three values (service id u64, window start u32, window length u32, in seconds; read in
    /// <c>TCProgramMemory_DVB::GetProgramList</c>). The reply is Samsung's tagged tree (entry = tag 1 byte, kind 1 byte, length 4 bytes LE,
    /// body; kind 4 is a leaf, kind 8 a branch): one branch holding the result (a leaf, 1 = ok) and the map, a branch whose children
    /// alternate: a leaf with the key (the programme's start time) and a branch with the programme. A programme's leaves are
    /// <c>ProgramData</c>'s tags: 1 event id (u16), 2 start (u32), 3 duration (u32); under tag 6 a branch of strings: title, description, ...
    /// Written from replies captured on the Q80A (tests/fixtures/sched_*.bin); anything unexpected gives no events.
    /// </summary>
    internal static class GuideReply
    {
        private const byte TagEventId = 1, TagStart = 2, TagDuration = 3;

        /// <summary>
        /// The programmes in the reply, in the daemon's order (by start). <paramref name="events"/> is empty when the reply is not in the
        /// expected shape, when the daemon reports no data for the channel (result 0, empty map), and for programmes without a length.
        /// Returns false only when the shape is wrong, so "no data" can be told from "garbled".
        /// </summary>
        public static bool Parse(byte[] reply, bool keepDescription, out List<GuideEvent> events)
        {
            events = new List<GuideEvent>();
            try
            {
                byte tag, kind; int s, e;
                if (reply == null || !GuideText.Header(reply, 0, reply.Length, out tag, out kind, out s, out e) || kind != GuideText.KindBranch) return false;
                int p = s;
                bool haveResult = false;
                while (p < e)
                {
                    int cs, ce; byte ct, ck;
                    if (!GuideText.Header(reply, p, e, out ct, out ck, out cs, out ce)) return false;
                    if (ck == GuideText.KindLeaf && !haveResult) haveResult = true;                  // the result code; the map decides whether there is anything
                    else if (ck == GuideText.KindBranch) { if (!ReadMap(reply, cs, ce, keepDescription, events)) { events.Clear(); return false; } return true; }
                    p = ce;
                }
                return haveResult;                                                          // a result and no map: nothing to list
            }
            catch (Exception) { events.Clear(); return false; }
        }

        private static bool ReadMap(byte[] b, int start, int end, bool keepDescription, List<GuideEvent> into)
        {
            int p = start;
            while (p < end)
            {
                int ks, ke, vs, ve; byte kt, kk, vt, vk;
                if (!GuideText.Header(b, p, end, out kt, out kk, out ks, out ke) || kk != GuideText.KindLeaf) return false;
                if (!GuideText.Header(b, ke, end, out vt, out vk, out vs, out ve) || vk != GuideText.KindBranch) return false;
                GuideEvent ev;
                if (!ReadProgramme(b, vs, ve, keepDescription, out ev)) return false;
                if (ev != null) into.Add(ev);
                p = ve;
            }
            return true;
        }

        private static bool ReadProgramme(byte[] b, int start, int end, bool keepDescription, out GuideEvent result)
        {
            result = null;
            var ev = new GuideEvent();
            bool haveStart = false;
            int p = start;
            while (p < end)
            {
                int s, e; byte tag, kind;
                if (!GuideText.Header(b, p, end, out tag, out kind, out s, out e)) return false;
                if (kind == GuideText.KindLeaf)
                {
                    if (tag == TagEventId && e - s >= 2) ev.EventId = (ushort)(b[s] | b[s + 1] << 8);
                    else if (tag == TagStart && e - s >= 4) { ev.Start = GuideText.ReadU32(b, s); haveStart = true; }
                    else if (tag == TagDuration && e - s >= 4) ev.Duration = GuideText.ReadU32(b, s);
                }
                else if (tag == GuideText.TagTexts && kind == GuideText.KindBranch)
                {
                    int q = s, index = 0;
                    while (q < e)
                    {
                        int is_, ie; byte it, ik;
                        if (!GuideText.Header(b, q, e, out it, out ik, out is_, out ie) || ik != GuideText.KindLeaf) break;
                        if (index == 0) ev.Title = GuideText.Title(Encoding.BigEndianUnicode.GetString(b, is_, (ie - is_) & ~1));
                        else if (index == 1 && keepDescription) ev.Description = GuideText.Clean(Encoding.BigEndianUnicode.GetString(b, is_, (ie - is_) & ~1));
                        index++;
                        if (index > (keepDescription ? 1 : 0)) break;
                        q = ie;
                    }
                }
                p = e;
            }
            if (haveStart && ev.Duration > 0) result = ev;
            return true;
        }
    }
}
