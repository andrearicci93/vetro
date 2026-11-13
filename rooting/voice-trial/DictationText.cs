using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Text;

static class DictationText
{
    static readonly string Characters = " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
    static readonly string[] Symbols = ("space exclam quotedbl numbersign dollar percent ampersand apostrophe " +
        "parenleft parenright asterisk plus comma minus period slash colon semicolon less equal greater question at " +
        "bracketleft backslash bracketright asciicircum underscore grave braceleft bar braceright asciitilde").Split(' ');

    public static string Normalize(string text)
    {
        text = Regex.Replace(text ?? "", @"\s+", " ").Trim();
        return text.EndsWith(".") ? text.Substring(0, text.Length - 1) : text;
    }

    public static List<(string key, string direction)> Keys(string text)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Length > 160) throw new Exception("Use 1–160 characters.");
        var keys = new List<(string, string)>();
        bool shifted = false;
        foreach (char ch in text)
        {
            bool upper = ch >= 'A' && ch <= 'Z';
            string key;
            if (upper || ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9') key = char.ToLowerInvariant(ch).ToString();
            else
            {
                int index = Characters.IndexOf(ch);
                if (index < 0) throw new Exception("This TV typing method supports printable ASCII only.");
                key = Symbols[index];
            }
            if (upper != shifted) keys.Add(("Shift_L", upper ? "down" : "up"));
            shifted = upper;
            keys.Add((key, null));
        }
        if (shifted) keys.Add(("Shift_L", "up"));
        return keys;
    }

    public static string Shell(string text)
    {
        var keys = Keys(text); // Validate everything before sending any keys.
        var script = new StringBuilder("shifted=0; release_shift() { if [ \"$shifted\" = 1 ]; then /usr/bin/input_keyevent Shift_L up; fi; }; " +
            "trap release_shift EXIT; trap \"exit 1\" HUP INT TERM; ");
        foreach (var step in keys)
        {
            script.Append("[ ! -f /tmp/vetro-voice-service.cancel ] || exit 1; ");
            if (step.key == "Shift_L" && step.direction == "down") script.Append("shifted=1; ");
            // Keys are fixed alphanumeric/underscore symbols, never transcript text.
            script.Append("/usr/bin/input_keyevent ").Append(step.key);
            if (step.direction != null) script.Append(' ').Append(step.direction);
            script.Append(" || exit; ");
            if (step.key == "Shift_L" && step.direction == "up") script.Append("shifted=0; ");
            if (step.direction == null) script.Append("sleep 0.08; ");
        }
        return script.ToString();
    }
}
