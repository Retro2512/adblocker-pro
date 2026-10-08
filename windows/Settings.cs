using System.Text.Json;

namespace QuietGate;

internal sealed class Settings
{
    public bool Enabled { get; set; } = true;
    public bool Strict { get; set; } = true;
    public string[] Languages { get; set; } = LanguageDefaults.Select(x => x.Id).ToArray();
    public bool ArtistMatching { get; set; } = true;
    public string[] AllowTracks { get; set; } = [];
    public string[] BlockTracks { get; set; } = [];
    public string[] Phrases { get; set; } = [];
    public string[] AllowedHosts { get; set; } = [];
    public string[] MonitoredApps { get; set; } = ["spotify"];

    public static readonly (string Id, string Label)[] LanguageDefaults =
    [
        ("hindi", "Hindi"), ("punjabi", "Punjabi"), ("urdu", "Urdu"),
        ("bhojpuri", "Bhojpuri"), ("haryanvi", "Haryanvi"), ("rajasthani", "Rajasthani"),
        ("awadhi", "Awadhi"), ("braj", "Braj"), ("maithili", "Maithili"), ("magahi", "Magahi"),
        ("garhwali", "Garhwali"), ("kumaoni", "Kumaoni"), ("dogri", "Dogri"), ("kashmiri", "Kashmiri")
    ];
    internal static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };
    internal static string DirectoryPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "QuietGate");
    internal static string FilePath => Path.Combine(DirectoryPath, "settings.json");
    internal const int MaximumBytes = 100_000;

    public static Settings Load()
    {
        if (!File.Exists(FilePath)) return new();
        using var file = new FileStream(FilePath, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (file.Length > MaximumBytes) throw new InvalidDataException("Settings file is too large");
        var buffer = new byte[MaximumBytes + 1];
        var read = 0;
        while (read < buffer.Length)
        {
            var next = file.Read(buffer, read, buffer.Length - read);
            if (next == 0) break;
            read += next;
        }
        if (read > MaximumBytes) throw new InvalidDataException("Settings file is too large");
        return Parse(buffer.AsSpan(0, read));
    }

    internal static Settings Parse(ReadOnlySpan<byte> json)
    {
        if (json.Length > MaximumBytes) throw new InvalidDataException("Settings file is too large");
        var result = JsonSerializer.Deserialize<Settings>(json, JsonOptions)
            ?? throw new InvalidDataException("Settings are empty");
        result.Validate();
        return result;
    }

    private void Validate()
    {
        Check(Languages, 200, 100);
        Check(AllowTracks, 500, 4096);
        Check(BlockTracks, 500, 4096);
        Check(Phrases, 200, 4096);
        Check(AllowedHosts, 200, 4096);
        Check(MonitoredApps, 20, 100);
        if (MonitoredApps.Any(id => !MusicApps.Known.Any(app => app.Id == id))) throw new InvalidDataException("Unknown music app");
    }
    private static void Check(string[]? values, int maximumCount, int maximumLength)
    {
        if (values == null || values.Length > maximumCount || values.Any(value => value == null || value.Length > maximumLength))
            throw new InvalidDataException("Invalid settings list");
    }

    public void Save()
    {
        Validate();
        var json = JsonSerializer.SerializeToUtf8Bytes(this, JsonOptions);
        if (json.Length > MaximumBytes) throw new InvalidDataException("Settings file is too large");
        Directory.CreateDirectory(DirectoryPath);
        var temporary = FilePath + ".tmp";
        File.WriteAllBytes(temporary, json);
        File.Move(temporary, FilePath, true);
    }
}

internal static class MusicApps
{
    internal static readonly (string Id, string Label, string[] Processes, string[] SessionPrefixes)[] Known =
    [
        ("spotify", "Spotify", ["Spotify"], ["Spotify.exe", "SpotifyAB.SpotifyMusic_"]),
        ("musicbee", "MusicBee", ["MusicBee"], ["MusicBee.exe"]),
        ("foobar2000", "foobar2000", ["foobar2000"], ["foobar2000.exe"]),
        ("vlc", "VLC", ["vlc"], ["vlc.exe"])
    ];

    internal static string? Identify(string appId) => Known.Where(app => app.SessionPrefixes.Any(prefix =>
        prefix.EndsWith('_') ? appId.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) :
        appId.Equals(prefix, StringComparison.OrdinalIgnoreCase) || appId.Equals(Path.GetFileNameWithoutExtension(prefix), StringComparison.OrdinalIgnoreCase)))
        .Select(app => app.Id).FirstOrDefault();

    internal static string[] ProcessNames(string id) => Known.FirstOrDefault(x => x.Id == id).Processes ?? [];
}
