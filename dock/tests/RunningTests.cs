using System;
using System.Collections.Generic;
using Launcher.Core;
namespace Launcher.Tests
{
    internal static class RunningTests
    {
        public static void Run()
        {
            T.Run("raw centre releases complete a tap without compositor events", () => {
                var input = new EvdevReader(16);
                var events = new List<int>();
                byte[] records = new byte[48];
                for (int i = 0; i < 3; i++) {
                    records[i * 16 + 8] = 1; records[i * 16 + 10] = 28;
                    records[i * 16 + 12] = (byte)(i == 0 ? 1 : i == 1 ? 2 : 0);
                }
                input.FeedTransitions(records, 19, events);
                var tail = new byte[29]; Array.Copy(records, 19, tail, 0, 29);
                input.FeedTransitions(tail, tail.Length, events);
                T.Eq(string.Join(",", events), "28,-28", "release order and split records retained, repeat ignored");
                var press = new CenterPress(); bool held;
                press.Down(2, 0);
                T.Eq(press.Up(.2, out held), 2, "raw release launches the selected app");
                T.Eq(press.Up(.3, out held), -1, "later compositor release cannot launch twice");
            });
            T.Run("centre press: tap, hold, repeat and cancellation", () => {
                var press = new CenterPress(); bool held;
                T.True(press.Down(3, 0), "first down");
                T.Eq(press.Up(0.2, out held), 3, "tap selects original target"); T.True(!held, "tap is not hold");
                press.Down(4, 1); T.True(!press.Down(4, 1.5), "repeat does not restart hold");
                T.Eq(press.Hold(1.74), -1, "not early"); T.Eq(press.Hold(1.75), 4, "one long press");
                T.Eq(press.Hold(2), -1, "not repeated"); T.Eq(press.Up(2.1, out held), -1, "release after hold is consumed");
                press.Down(2, 3); T.Eq(press.Up(4, out held), 2, "late timer still recognizes hold"); T.True(held, "never launch after delayed hold timer");
                press.Down(1, 5); press.Cancel(); T.Eq(press.Up(5.2, out held), -1, "navigation/hide cancels press");
                T.True(CenterPress.IsCenter("Return") && CenterPress.IsCenter("KP_Enter") && CenterPress.IsCenter("Select"), "remote select aliases");
                T.True(!CenterPress.IsCenter("Right"), "arrows unaffected");
            });
            T.Run("running apps: exact app and package service matches", () => {
                var state = new RunningSnapshot { Components = new[] {
                    new RunningComponent { AppId = "video.ui", Pid = 10, Name = "Video", Matches = new[] { "video.ui", "video.svc" } },
                    new RunningComponent { AppId = "video.svc", Pid = 11, Name = "Playback", Service = true, Matches = new[] { "video.ui", "video.svc" } },
                    new RunningComponent { AppId = "other.ui", Pid = 12, Name = "Other", Matches = new[] { "other.ui" } }
                } };
                T.Eq(state.For("video.ui").Length, 2, "app's background service included");
                T.Eq(state.For("video.ui")[0].AppId, "video.ui", "app before services");
                T.Eq(state.For("video").Length, 0, "no prefix matches"); T.Eq(state.For(null).Length, 0, "system action has no badge");
                state.Components = new[] { new RunningComponent { AppId = "bad;id", Pid = 3, Matches = new[] { "video.ui" } } };
                T.Eq(state.For("video.ui").Length, 0, "unusable target ignored");
            });
        }
    }
}
