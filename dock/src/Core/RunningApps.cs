using System;
using System.Linq;

namespace Launcher.Core
{
    internal sealed class RunningComponent
    {
        public string AppId { get; set; }
        public string Name { get; set; }
        public int Pid { get; set; }
        public bool Service { get; set; }
        public bool CanStop { get; set; }
        public string Reason { get; set; }
        public bool Autorestart { get; set; }
        public string[] Matches { get; set; }
    }
    internal sealed class RunningSnapshot
    {
        public RunningComponent[] Components { get; set; } = Array.Empty<RunningComponent>();
        public RunningComponent[] For(string appId)
        {
            if (string.IsNullOrEmpty(appId)) return Array.Empty<RunningComponent>();
            return (Components ?? Array.Empty<RunningComponent>()).Where(c => c != null && c.Pid > 0 && Catalog.ValidAppId(c.AppId) &&
                (c.AppId == appId || (c.Matches != null && Array.IndexOf(c.Matches, appId) >= 0)))
                .GroupBy(c => c.AppId).Select(g => g.First()).OrderBy(c => c.Service).ThenBy(c => c.Name).ToArray();
        }
    }
    internal sealed class StopResult
    {
        public bool Ok { get; set; }
        public bool Verified { get; set; }
        public string Message { get; set; }
        public string Error { get; set; }
    }
}
