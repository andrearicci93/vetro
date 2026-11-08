namespace Tuner.Core
{
    /// <summary>Audio languages as the broadcast gives them (ISO 639-2, three letters) turned into words for the screen.</summary>
    internal static class Languages
    {
        public static string Name(string code)
        {
            switch ((code ?? "").ToUpperInvariant())
            {
                case "ITA": return "Italian";
                case "ENG": return "English";
                case "DEU": case "GER": return "German";
                case "FRA": case "FRE": return "French";
                case "SPA": return "Spanish";
                case "POR": return "Portuguese";
                case "RUS": return "Russian";
                case "POL": return "Polish";
                case "ROM": case "RON": return "Romanian";
                case "TUR": return "Turkish";
                case "ARA": return "Arabic";
                case "ALB": case "SQI": return "Albanian";
                case "SLV": return "Slovenian";
                case "SCR": case "HRV": return "Croatian";
                case "SRP": return "Serbian";
                case "DUT": case "NLD": return "Dutch";
                case "GRE": case "ELL": return "Greek";
                case "UND": case "UNKNOWN": case "": return "Original";
                default: return code.ToUpperInvariant();
            }
        }
    }
}
