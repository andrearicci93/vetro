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
        private const byte KindLeaf = 4, KindBranch = 8;
        private const byte TagEventId = 1, TagStart = 2, TagDuration = 3, TagTexts = 6;

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
                if (reply == null || !Header(reply, 0, reply.Length, out tag, out kind, out s, out e) || kind != KindBranch) return false;
                int p = s;
                bool haveResult = false;
                while (p < e)
                {
                    int cs, ce; byte ct, ck;
                    if (!Header(reply, p, e, out ct, out ck, out cs, out ce)) return false;
                    if (ck == KindLeaf && !haveResult) haveResult = true;                  // the result code; the map decides whether there is anything
                    else if (ck == KindBranch) return ReadMap(reply, cs, ce, keepDescription, events);
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
                if (!Header(b, p, end, out kt, out kk, out ks, out ke) || kk != KindLeaf) return false;
                if (!Header(b, ke, end, out vt, out vk, out vs, out ve) || vk != KindBranch) return false;
                GuideEvent ev = ReadProgramme(b, vs, ve, keepDescription);
                if (ev != null) into.Add(ev);
                p = ve;
            }
            return true;
        }

        private static GuideEvent ReadProgramme(byte[] b, int start, int end, bool keepDescription)
        {
            var ev = new GuideEvent();
            bool haveStart = false;
            int p = start;
            while (p < end)
            {
                int s, e; byte tag, kind;
                if (!Header(b, p, end, out tag, out kind, out s, out e)) return null;
                if (kind == KindLeaf)
                {
                    if (tag == TagEventId && e - s >= 2) ev.EventId = (ushort)(b[s] | b[s + 1] << 8);
                    else if (tag == TagStart && e - s >= 4) { ev.Start = U32(b, s); haveStart = true; }
                    else if (tag == TagDuration && e - s >= 4) ev.Duration = U32(b, s);
                }
                else if (tag == TagTexts)
                {
                    int q = s, index = 0;
                    while (q < e)
                    {
                        int is_, ie; byte it, ik;
                        if (!Header(b, q, e, out it, out ik, out is_, out ie) || ik != KindLeaf) break;
                        if (index == 0) ev.Title = Title(Encoding.BigEndianUnicode.GetString(b, is_, (ie - is_) & ~1));
                        else if (index == 1 && keepDescription) ev.Description = GuideText.Clean(Encoding.BigEndianUnicode.GetString(b, is_, (ie - is_) & ~1));
                        index++;
                        q = ie;
                    }
                }
                p = e;
            }
            return haveStart && ev.Duration > 0 ? ev : null;
        }

        private static string Title(string raw) { return GuideText.Title(new[] { raw }); }

        private static bool Header(byte[] b, int pos, int end, out byte tag, out byte kind, out int bodyStart, out int bodyEnd)
        {
            tag = kind = 0; bodyStart = bodyEnd = 0;
            if (pos + 6 > end) return false;
            tag = b[pos]; kind = b[pos + 1];
            long len = U32(b, pos + 2);
            if (pos + 6 + len > end) return false;
            bodyStart = pos + 6; bodyEnd = (int)(pos + 6 + len);
            return true;
        }

        private static long U32(byte[] b, int at) { return (uint)(b[at] | b[at + 1] << 8 | b[at + 2] << 16 | b[at + 3] << 24); }
    }
}
