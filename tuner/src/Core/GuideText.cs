using System;
using System.Collections.Generic;
using System.Text;

namespace Tuner.Core
{
    /// <summary>
    /// The text of a programme, read straight from the daemon's reply. Samsung's managed client decodes the numbers of a
    /// programme (times, event id) but drops its texts, so the title would come back empty; the bytes do carry them.
    /// The reply is Samsung's tagged tree: entry = tag (1 byte), kind (1 byte), length (4 bytes, little endian), body.
    /// Kind 4 is a leaf, kind 8 a branch. The message is one branch (the function) that holds the result and the programme;
    /// the programme holds, under tag 6, a list of strings: items are entries (tag 0) of kind 4 holding UTF-16BE.
    /// Order of the strings: title, description, raw descriptor data, source name, guidance (the client's TextType).
    /// Written from a reply captured on the Q80A (firmware 2310.0); anything unexpected gives an empty result.
    /// </summary>
    internal static class GuideText
    {
        private const byte KindLeaf = 4, KindBranch = 8;
        private const byte TagFunction = 6, TagTexts = 6;

        /// <summary>The strings of the programme in the reply, or an empty array when the reply is not in the expected shape.</summary>
        public static string[] Texts(byte[] reply)
        {
            try
            {
                int pos = 0, end = reply.Length;
                int bodyStart, bodyEnd;
                if (!Entry(reply, ref pos, end, TagFunction, KindBranch, out bodyStart, out bodyEnd)) return new string[0];
                // inside the function: the result (a leaf), then the programme (a branch)
                int p = bodyStart;
                while (p < bodyEnd)
                {
                    int s, e;
                    byte tag, kind;
                    if (!Header(reply, p, bodyEnd, out tag, out kind, out s, out e)) return new string[0];
                    if (kind == KindBranch) return TextsOfProgramme(reply, s, e);
                    p = e;
                }
            }
            catch (Exception) { }
            return new string[0];
        }

        private static string[] TextsOfProgramme(byte[] b, int start, int end)
        {
            int p = start;
            while (p < end)
            {
                int s, e;
                byte tag, kind;
                if (!Header(b, p, end, out tag, out kind, out s, out e)) break;
                if (tag == TagTexts && kind == KindBranch)
                {
                    var items = new List<string>();
                    int q = s;
                    while (q < e)
                    {
                        int is_, ie;
                        byte itag, ikind;
                        if (!Header(b, q, e, out itag, out ikind, out is_, out ie) || ikind != KindLeaf) break;
                        items.Add(Encoding.BigEndianUnicode.GetString(b, is_, (ie - is_) & ~1));
                        q = ie;
                    }
                    return items.ToArray();
                }
                p = e;
            }
            return new string[0];
        }

        private static bool Entry(byte[] b, ref int pos, int end, byte tag, byte kind, out int bodyStart, out int bodyEnd)
        {
            byte t, k;
            bodyStart = bodyEnd = 0;
            if (!Header(b, pos, end, out t, out k, out bodyStart, out bodyEnd)) return false;
            return t == tag && k == kind;
        }

        private static bool Header(byte[] b, int pos, int end, out byte tag, out byte kind, out int bodyStart, out int bodyEnd)
        {
            tag = kind = 0; bodyStart = bodyEnd = 0;
            if (pos + 6 > end) return false;
            tag = b[pos]; kind = b[pos + 1];
            long len = ReadU32(b, pos + 2);
            if (len < 0 || pos + 6 + len > end) return false;
            bodyStart = pos + 6; bodyEnd = (int)(pos + 6 + len);
            return true;
        }

        private static uint ReadU32(byte[] b, int at) { return (uint)(b[at] | b[at + 1] << 8 | b[at + 2] << 16 | b[at + 3] << 24); }

        /// <summary>Title and description, with the daemon's escape marks removed (a control character such as 0x7F or a soft hyphen splits words).</summary>
        public static string Clean(string s)
        {
            if (s == null) return "";
            var sb = new StringBuilder(s.Length);
            foreach (char c in s) if (c >= ' ' && c != '\u007f' && c != '­') sb.Append(c);
            return sb.ToString().Trim();
        }

        /// <summary>The channel's title text carries "Title^Genre" style suffixes on some broadcasters; this returns the part before the first '^'.</summary>
        public static string Title(string[] texts)
        {
            if (texts.Length == 0) return "";
            string t = Clean(texts[0]);
            int i = t.IndexOf('^');
            return i > 0 ? t.Substring(0, i).Trim() : t;
        }

        public static string Description(string[] texts) { return texts.Length > 1 ? Clean(texts[1]) : ""; }
    }
}
