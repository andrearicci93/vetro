using System;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Launcher.Core;

namespace Launcher.Native
{
    internal sealed class RuntimeClient
    {
        private readonly HttpClient _http;
        private readonly JsonSerializerOptions _json = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        public RuntimeClient(string origin)
        {
            if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri) || !uri.IsLoopback || uri.Scheme != "http" ||
                uri.UserInfo.Length != 0 || uri.AbsolutePath != "/" || uri.Query.Length != 0 || uri.Fragment.Length != 0)
                throw new ArgumentException("Launcher API must be a loopback HTTP origin.");
            _http = new HttpClient(new HttpClientHandler { UseProxy = false, AllowAutoRedirect = false })
                { BaseAddress = uri, Timeout = TimeSpan.FromSeconds(20) };
        }
        public async Task<RunningSnapshot> Read()
        {
            using var response = await _http.GetAsync("/dock/runtime");
            if (!response.IsSuccessStatusCode) throw new Exception("Running apps unavailable");
            return JsonSerializer.Deserialize<RunningSnapshot>(await response.Content.ReadAsStringAsync(), _json)
                ?? throw new Exception("Running apps unavailable");
        }
        public async Task<StopResult> Stop(RunningComponent component)
        {
            using var body = new StringContent(JsonSerializer.Serialize(new { appId = component.AppId, pid = component.Pid }), Encoding.UTF8, "application/json");
            // Never retry: a failed response can follow a successful stop.
            using var response = await _http.PostAsync("/dock/stop", body);
            var result = JsonSerializer.Deserialize<StopResult>(await response.Content.ReadAsStringAsync(), _json);
            if (result == null) throw new Exception("Could not confirm stop");
            return result;
        }
    }
}
