using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace QuietGate;

internal sealed record TrackMetadata(string Title, string Artist, string Album = "", string[]? LanguageTags = null)
{
    public string Key => Classifier.Normalize(Title) + "|" + Classifier.Normalize(Artist);
}
internal sealed record Decision(bool Hold, string Reason);
internal sealed class Catalog
{
    public int Version { get; set; }
    public CatalogLanguage[] Languages { get; set; } = [];
    public CatalogTrack[] Tracks { get; set; } = [];
    public CatalogArtist[] Artists { get; set; } = [];
}
internal sealed class CatalogLanguage
{
    public string Id { get; set; } = "";
    public string Label { get; set; } = "";
    public string[] Aliases { get; set; } = [];
}
internal sealed class CatalogTrack
{
    public string Title { get; set; } = "";
    public string[] Artists { get; set; } = [];
    public string Language { get; set; } = "";
    public string[] Languages { get; set; } = [];
    public string[] Aliases { get; set; } = [];
}
internal sealed class CatalogArtist
{
    public string Name { get; set; } = "";
    public string[] Aliases { get; set; } = [];
    public string[] Languages { get; set; } = [];
}

internal sealed class Classifier(Catalog catalog)
{
    internal static Catalog LoadCatalog(string path)
    {
        var result = JsonSerializer.Deserialize<Catalog>(File.ReadAllText(path), Settings.JsonOptions)
            ?? throw new InvalidDataException("Catalog is empty");
        if (result.Version != 1 || result.Languages.Length == 0) throw new InvalidDataException("Catalog version is unsupported");
        return result;
    }

    internal Decision Classify(TrackMetadata track, Settings settings)
    {
        if (!settings.Enabled) return new(false, "Off");
        var key = track.Key;
        if (key != "|" && settings.BlockTracks.Any(x => NormalizeKey(x) == key)) return new(true, "Blocked track");
        if (key != "|" && settings.AllowTracks.Any(x => NormalizeKey(x) == key)) return new(false, "Allowed track");
        var selected = settings.Languages.Select(value => catalog.Languages.FirstOrDefault(language =>
            new[] { language.Id, language.Label }.Concat(language.Aliases).Any(alias => Normalize(alias) == Normalize(value)))?.Id ?? Normalize(value)).ToHashSet();
        var tags = (track.LanguageTags ?? []).Where(x => !string.IsNullOrWhiteSpace(x)).Take(30).Select(ResolveLanguage).ToArray();
        var explicitLanguages = tags.Where(x => x != null).Select(x => x!).ToArray();
        if (explicitLanguages.Any(x => selected.Contains(x.Id))) return new(true, "Blocked language");
        if (explicitLanguages.Length != 0 && tags.All(tag => tag != null))
            return new(false, "Allowed language");
        var title = Normalize(track.Title);
        var artist = Normalize(track.Artist);
        var fields = new[] { title, artist, Normalize(track.Album) };
        if (settings.Phrases.Select(Normalize).Any(x => fields.Any(field => ArtistMatches(field, x))))
            return new(true, "Blocked phrase");
        var labeledLanguages = new List<string>();
        foreach (var language in catalog.Languages)
        {
            foreach (var label in new[] { language.Label }.Concat(language.Aliases).Select(Normalize).Where(x => x.Length > 3))
            {
                var words = new[] { "song", "songs", "music", "track", "tracks", "geet", "gaana", "gaane", "गाना", "गीत" };
                var tagged = new[] { title, fields[2] }.Any(field => words.Any(word => ArtistMatches(field, label + " " + word) || ArtistMatches(field, word + " " + label)));
                var bare = new[] { track.Title, track.Album }.Any(field => Normalize(field) == label || field.Split(['|', '(', ')', '[', ']', '{', '}']).Any(segment => Normalize(segment) == label));
                if (tagged || bare) { labeledLanguages.Add(language.Id); break; }
            }
        }
        if (labeledLanguages.Any(selected.Contains)) return new(true, "Language label");
        var candidateTitles = TitleCandidates(track.Title);
        var match = catalog.Tracks.FirstOrDefault(x => title.Length != 0 && new[] { x.Title }.Concat(x.Aliases).Any(a => candidateTitles.Contains(Normalize(a)))
            && (x.Artists.Length == 0 || x.Artists.SelectMany(ArtistAliases).Any(a => ArtistMatches(artist, Normalize(a)))));
        if (match != null)
        {
            var held = new[] { match.Language }.Concat(match.Languages).Any(selected.Contains);
            return new(held, held ? "Catalog language" : "Allowed language");
        }
        if (track.Title.Any(c => c is >= '\u0a05' and <= '\u0a39' or >= '\u0a59' and <= '\u0a5e'))
            return new(selected.Contains("punjabi"), selected.Contains("punjabi") ? "Punjabi script" : "Allowed language");
        if (labeledLanguages.Count != 0) return new(false, "Language label");
        if (settings.ArtistMatching && catalog.Artists.Any(x => x.Languages.Any(selected.Contains)
            && new[] { x.Name }.Concat(x.Aliases).Any(a => ArtistMatches(artist, Normalize(a)))))
            return new(true, "Artist match");
        return new(settings.Strict, settings.Strict ? "Unknown track" : "No match");
    }

    private static bool ArtistMatches(string artist, string candidate) => candidate.Length != 0 && (" " + artist + " ").Contains(" " + candidate + " ", StringComparison.Ordinal);
    private CatalogLanguage? ResolveLanguage(string value)
    {
        var normalized = Normalize(value);
        var direct = catalog.Languages.FirstOrDefault(x => new[] { x.Id, x.Label }.Concat(x.Aliases).Any(a => Normalize(a) == normalized));
        if (direct != null) return direct;
        if (!Regex.IsMatch(value, @"^[a-z]{2,3}(?:-[a-z0-9]{2,8})+$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100))) return null;
        var baseTag = value.Split('-')[0];
        return catalog.Languages.FirstOrDefault(x => new[] { x.Id, x.Label }.Concat(x.Aliases).Any(a => Normalize(a) == Normalize(baseTag)));
    }
    private IEnumerable<string> ArtistAliases(string name)
    {
        var normalized = Normalize(name);
        var entry = catalog.Artists.FirstOrDefault(x => new[] { x.Name }.Concat(x.Aliases).Any(alias => Normalize(alias) == normalized));
        return entry == null ? [name] : new[] { name, entry.Name }.Concat(entry.Aliases);
    }
    private static HashSet<string> TitleCandidates(string title)
    {
        var raw = title[..Math.Min(title.Length, 4096)];
        var cleaned = Regex.Replace(raw, @"\s*\((?:from\b[^)]*|official\s+(?:music\s+)?(?:audio|video)|lyrics?|lyrical\s+video)\)\s*$", "", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100));
        cleaned = Regex.Replace(cleaned, @"\s*\[(?:official\s+(?:music\s+)?(?:audio|video)|lyrics?|lyrical\s+video)\]\s*$", "", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100));
        return new[] { Normalize(raw), Normalize(cleaned) }.ToHashSet();
    }
    internal static string NormalizeKey(string value)
    {
        var parts = value.Split('|', 2);
        return parts.Length == 2 ? Normalize(parts[0]) + "|" + Normalize(parts[1]) : Normalize(value) + "|";
    }
    internal static string Normalize(string value)
    {
        value ??= "";
        value = value[..Math.Min(value.Length, 4096)];
        var sanitized = new StringBuilder();
        foreach (var rune in value.EnumerateRunes()) sanitized.Append(rune.ToString());
        value = sanitized.ToString().Normalize(NormalizationForm.FormKC).ToLowerInvariant();
        var result = new StringBuilder();
        bool latin = false;
        foreach (var rune in value.Normalize(NormalizationForm.FormD).EnumerateRunes())
        {
            var category = Rune.GetUnicodeCategory(rune);
            if (category is UnicodeCategory.NonSpacingMark or UnicodeCategory.SpacingCombiningMark or UnicodeCategory.EnclosingMark)
            {
                if (!latin) result.Append(rune.ToString());
                continue;
            }
            if (Rune.IsLetter(rune) || category is UnicodeCategory.DecimalDigitNumber or UnicodeCategory.LetterNumber or UnicodeCategory.OtherNumber)
            {
                latin = rune.Value <= 0x024f;
                result.Append(Rune.ToLowerInvariant(rune).ToString());
            }
            else
            {
                latin = false;
                if (result.Length > 0 && result[^1] != ' ') result.Append(' ');
            }
        }
        return result.ToString().Trim().Normalize(NormalizationForm.FormC);
    }
}
