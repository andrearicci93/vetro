namespace Launcher.Core
{
    // How a tile that a Vetro plugin has taken over is started. The dock never talks to the plugin: it asks the Vetro service on
    // this TV (a POST to the launcher plugin's "open" route, which answers at once), and the service decides who starts the app
    // and falls back to the plain launch itself. Only when the service cannot be reached is the app started here, so a plugin that
    // needs a minute to get ready is never started twice. The slug and the app id are checked, so nothing from the list reaches the
    // shell but letters, digits and ". _ -".
    internal static class ShardLaunch
    {
        public const int ServicePort = 8099;

        public static string Command(AppEntry e, int port)
        {
            if (e == null || !e.ViaShard || !Catalog.ValidSlug(e.Slug) || !Catalog.ValidAppId(e.AppId)) return null;
            string url = "http://127.0.0.1:" + port + "/plugins/launcher/api/open?slug=" + e.Slug;
            return "( /usr/bin/curl -sf -m 5 -X POST '" + url + "' >/dev/null 2>&1 || /usr/bin/app_launcher -s " + e.AppId + " >/dev/null 2>&1 ) &";
        }
    }
}
