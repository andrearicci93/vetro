using System;
using System.Collections.Generic;
using System.Linq;
using Tuner.Core;

internal static partial class Tests
{
    private static LogoRow Row(string source, string url, string onid, string tsid, string sid)
    {
        return new LogoRow { SourceId = source, Name = "n" + source, IconUrl = url, Onid = LogoNames.HexList(onid), Tsid = LogoNames.HexList(tsid), Sid = LogoNames.HexList(sid) };
    }

    private static void LogoChecks()
    {
        const string tms = "https://round-logo.samsungnyc.com/round?idx=%02d&url=http://eden-prod-images.s3.amazonaws.com/processed/gvd/sung.tmsimg.com/assets/assets/s84638_ll_h8_ab.png";
        const string cddb = "https://round-logo.samsungnyc.com/round?idx=%02d&url=http://eden-prod-images.s3.amazonaws.com/processed/gvd/akamai-b.cdn.cddbp.net/cds/2.0/image/572E/2643/F1B4/7FAB_220.png";

        // The file name the TV gives a downloaded picture (checked against the files in the TV's folder).
        Check(LogoNames.CacheFile(tms) == "assets_assets_s84638_ll_h8_ab.png", "logo file: a station logo keeps its last three parts");
        Check(LogoNames.CacheFile(cddb) == "2643_F1B4_7FAB_220.png", "logo file: an image path keeps its last three parts, not the host or the first folders");
        Check(LogoNames.CacheFile("http://host/a/b.png") == "a_b.png", "logo file: two parts after the host are both used");
        Check(LogoNames.CacheFile("http://host/b.png") == "b.png", "logo file: a single part after the host is the name");
        Check(LogoNames.CacheFile("http://host") == null && LogoNames.CacheFile("") == null && LogoNames.CacheFile(null) == null, "logo file: no name from an address with no file in it");
        Check(LogoNames.CacheFile("http://host/x/..\\y.png") == null, "logo file: a name that could leave the folder is refused");

        Check(LogoNames.HexList("0x217C,0x2,1F").SequenceEqual(new[] { 0x217C, 2, 0x1F }), "hex list: with and without the prefix");
        Check(LogoNames.HexList("").Length == 0 && LogoNames.HexList(null).Length == 0, "hex list: empty text is no numbers");
        Check(LogoNames.HexList("0x1,zz,0x3").SequenceEqual(new[] { 1, -1, 3 }), "hex list: a bad part is -1 and the others keep their place");

        var gallery = new[]
        {
            Row("100", tms, "0x217C,0x1", "0x2,0x9", "0x41B,0x3E9"),
            Row("200", cddb, "0x217C", "0x85", "0x3E9"),
            Row("300", "", "0x217C", "0x7", "0x7"),                    // no picture: not a row at all
            Row("400", cddb, "0x217C", "0x2", "0x41B"),                // the same triplet as row 100: the first row keeps it
        };
        var tunable = new List<KeyValuePair<ulong, string>>
        {
            new KeyValuePair<ulong, string>(2654873089082394622UL, "200"),
            new KeyValuePair<ulong, string>(77, "999"),                // a source id the gallery does not have
        };
        var idx = new LogoIndex(gallery, tunable);
        Check(idx.Rows == 3 && idx.Any, "logo index: rows with a picture are counted");

        var byId = new Channel { Id = 2654873089082394622UL, Major = 5, Name = "Canale 5" };
        Check(idx.UrlFor(byId) == cddb, "logo: found by the service id through the tunable table");
        var byTriplet = new Channel { Id = 1, Onid = 0x217C, Tsid = 0x2, Sid = 0x41B };
        Check(idx.UrlFor(byTriplet) == tms, "logo: found by the DVB triplet, and the first gallery row wins a shared triplet");
        var second = new Channel { Id = 2, Onid = 0x1, Tsid = 0x9, Sid = 0x3E9 };
        Check(idx.UrlFor(second) == tms, "logo: the second triplet of a row works too (the lists are parallel)");
        var mixed = new Channel { Id = 3, Onid = 0x217C, Tsid = 0x9, Sid = 0x3E9 };
        Check(idx.UrlFor(mixed) == null, "logo: parts of different triplets do not make a match");
        Check(idx.UrlFor(new Channel { Id = 77 }) == null, "logo: a tunable row that points at no gallery row gives nothing");
        Check(idx.UrlFor(new Channel { Id = 5, Name = "Rai 1" }) == null && idx.UrlFor(null) == null, "logo: no id, no triplet: no logo (the name is never used)");
        var both = new Channel { Id = 2654873089082394622UL, Onid = 0x217C, Tsid = 0x2, Sid = 0x41B };
        Check(idx.UrlFor(both) == cddb, "logo: the service id is tried before the triplet");

        var empty = new LogoIndex(new LogoRow[0], null);
        Check(!empty.Any && empty.UrlFor(byId) == null, "logo index: nothing in the TV's tables means nothing to look up");
        var badTriplet = new LogoIndex(new[] { Row("1", tms, "0x1,zz", "0x2,0x3", "0x4,0x5") }, null);
        Check(badTriplet.UrlFor(new Channel { Id = 9, Onid = 1, Tsid = 2, Sid = 4 }) == tms && badTriplet.UrlFor(new Channel { Id = 9, Onid = 0xFFFF, Tsid = 3, Sid = 5 }) == null, "logo index: an unreadable part leaves its triplet out and the others in");
        var uneven = new LogoIndex(new[] { Row("1", tms, "0x1,0x2", "0x3", "0x4,0x5") }, null);
        Check(uneven.UrlFor(new Channel { Id = 9, Onid = 1, Tsid = 3, Sid = 4 }) == tms && uneven.UrlFor(new Channel { Id = 9, Onid = 2, Tsid = 0, Sid = 5 }) == null, "logo index: lists of different lengths are used up to the shortest");

        // The guide: with logos the label is the logo, the number over the name; without, as it always was.
        GuideStore store; ChannelList list;
        GuideGrid g = SampleGrid(out store, out list);
        long now = 1794103440;
        List<Prim> plain = GuideScene.Build(g, now, TimeSpan.Zero, "");
        Check(!plain.Any(p => p.Kind == PrimKind.Logo), "guide: without a logo function no logo is drawn");
        var asked = new List<string>();
        List<Prim> with = GuideScene.Build(g, now, TimeSpan.Zero, "", c => { asked.Add(c.Name); return c.Major == 1 ? "/x/rai1.png" : null; });
        Prim[] logos = with.Where(p => p.Kind == PrimKind.Logo).ToArray();
        Check(logos.Length == 1 && logos[0].Text == "/x/rai1.png" && logos[0].W == GuideScene.LogoSize && logos[0].H == GuideScene.LogoSize, "guide: a row whose channel has a logo gets one square logo");
        Check(logos[0].X == GuideLayout.LabelX + 16 && logos[0].Y >= GuideLayout.RowsY && logos[0].Y + logos[0].H <= GuideLayout.RowsY + GuideLayout.RowH, "guide: the logo sits in the label column, inside its row");
        Check(asked.Count == Math.Min(GuideLayout.Rows, list.Count), "guide: the logo of each row on screen is asked once, no more");
        Prim name = with.First(p => p.Kind == PrimKind.Text && p.Text == "Channel 1" && p.Y >= GuideLayout.RowsY), plainName = plain.First(p => p.Kind == PrimKind.Text && p.Text == "Channel 1" && p.Y >= GuideLayout.RowsY);
        Check(name.X > logos[0].X + logos[0].W && name.X + name.MaxW <= GuideLayout.CellsX, "guide: with logos the name starts after the logo and stays inside the label column");
        Check(plainName.X == GuideLayout.LabelX + 16 && name.X == GuideLayout.LabelX + 86, "guide: without logos the name starts at the column's left (96), with logos after the logo (166)");
        Check(with.Count(p => p.Kind == PrimKind.Logo) <= GuideScene.MaxLogos && with.Count(p => p.Kind == PrimKind.Text) <= GuideScene.MaxTexts, "guide: the scene fits the pooled objects");
    }
}
