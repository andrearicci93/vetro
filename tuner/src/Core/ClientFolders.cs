using System;
using System.Collections.Generic;

namespace Tuner.Core
{
    /// <summary>
    /// Samsung's managed TV client lives in a folder named after its version (1.1.12 on the Q80A). Other firmware has another number,
    /// so the tuner looks at every version folder, newest first, instead of one fixed name.
    /// </summary>
    internal static class ClientFolders
    {
        /// <summary>The folder names that read as a version number, newest first. Anything else (a stray file, "latest") is ignored.</summary>
        public static List<string> NewestFirst(IEnumerable<string> names)
        {
            var found = new List<KeyValuePair<Version, string>>();
            foreach (string name in names)
            {
                Version v;
                if (!string.IsNullOrEmpty(name) && name.IndexOf('/') < 0 && Version.TryParse(name, out v)) found.Add(new KeyValuePair<Version, string>(v, name));
            }
            found.Sort((a, b) => b.Key.CompareTo(a.Key));
            var result = new List<string>(found.Count);
            foreach (var f in found) result.Add(f.Value);
            return result;
        }
    }
}
