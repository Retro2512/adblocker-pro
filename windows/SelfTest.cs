namespace QuietGate;

internal static class SelfTest
{
    internal static int Run(Catalog shipped, string[] args)
    {
        var assertions = 0;
        void Assert(bool result, string name)
        {
            assertions++;
            if (!result) throw new InvalidOperationException("Self test failed: " + name);
        }
        var catalog = new Catalog
        {
            Version = 1,
            Languages = [new() { Id = "hindi", Label = "Hindi", Aliases = ["hi"] }, new() { Id = "punjabi", Label = "Punjabi", Aliases = ["pa"] }, new() { Id = "english", Label = "English", Aliases = ["en"] }],
            Tracks = [new() { Title = "Test Song", Artists = ["Test Artist"], Language = "hindi", Aliases = ["Song Alias"] }, new() { Title = "English Song", Artists = ["Test Artist"], Language = "english" }],
            Artists = [new() { Name = "Test Artist", Languages = ["hindi"], Aliases = ["Artist Alias"] }]
        };
        var classifier = new Classifier(catalog);
        var settings = new Settings();
        var track = new TrackMetadata("Test Song", "Test Artist");
        Assert(classifier.Classify(track, settings).Hold, "catalog selected language");
        settings.AllowTracks = ["TEST SONG | Tést Artist"];
        Assert(!classifier.Classify(track, settings).Hold, "normalized explicit allow");
        settings.BlockTracks = [track.Key];
        Assert(classifier.Classify(track, settings).Hold, "explicit block wins allow");
        settings.Enabled = false;
        Assert(!classifier.Classify(track, settings).Hold, "disabled wins rules");
        settings = new Settings { Strict = false, ArtistMatching = false };
        Assert(classifier.Classify(new("Song Alias", "Test Artist"), settings).Hold, "track alias");
        Assert(classifier.Classify(new("Test Song", "Artist Alias"), settings).Hold, "track artist alias without heuristic");
        Assert(classifier.Classify(new("Test Song (From Movie)", "Test Artist"), settings).Hold, "source title suffix");
        Assert(classifier.Classify(new("Test Song [Official Music Video]", "Test Artist"), settings).Hold, "official title suffix");
        Assert(!classifier.Classify(new("Test Song", "Unrelated Artist"), settings).Hold, "same title unrelated artist");
        Assert(!classifier.Classify(new("Unknown", "Test Artist"), settings).Hold, "artist option disabled");
        settings.ArtistMatching = true;
        Assert(classifier.Classify(new("Unknown", "Artist Alias"), settings).Hold, "artist alias");
        Assert(!classifier.Classify(new("Unknown", "Test Artists"), settings).Hold, "artist token boundary");
        Assert(!classifier.Classify(new("English Song", "Test Artist"), settings).Hold, "curated track overrides artist heuristic");
        Assert(!classifier.Classify(new("Test Song", "Test Artist", LanguageTags: ["en"]), settings).Hold, "explicit other language overrides artist");
        Assert(!classifier.Classify(new("Test Song", "Test Artist", LanguageTags: ["en-US"]), settings).Hold, "explicit BCP47 other language");
        Assert(classifier.Classify(new("Unknown", "Other", LanguageTags: ["hi-IN"]), settings).Hold, "explicit BCP47 selected language");
        Assert(classifier.Classify(new("Test Song", "Test Artist", LanguageTags: ["en", "unrecognized"]), settings).Hold, "mixed unknown language stays conservative");
        Assert(classifier.Classify(new("English Song", "Other", LanguageTags: ["pa"]), settings).Hold, "explicit Punjabi");
        Assert(classifier.Classify(new("ਗੀਤ", "Other"), settings).Hold, "Gurmukhi script");
        Assert(!classifier.Classify(new("गीत", "Other"), settings).Hold, "Devanagari not assumed Hindi");
        Assert(classifier.Classify(new("Fresh Hindi Song", "Other"), settings).Hold, "language label in title");
        Assert(!classifier.Classify(new("Fresh English Song", "Test Artist"), settings).Hold, "nonselected language label overrides artist");
        Assert(classifier.Classify(new("English Song", "Other", "Hindi Songs"), settings).Hold, "selected language label wins mixed labels");
        catalog.Tracks[0].Languages = ["hindi", "punjabi"];
        var bilingual = new Settings { Languages = ["punjabi"], ArtistMatching = false };
        Assert(classifier.Classify(track, bilingual).Hold, "bilingual track selected second language");
        settings.Languages = ["hindi"];
        settings.Strict = true;
        Assert(!classifier.Classify(new("ਗੀਤ", "Other"), settings).Hold, "known Punjabi allowed when unselected");
        settings = new Settings { Strict = false, ArtistMatching = false };
        settings.Phrases = ["special phrase"];
        Assert(classifier.Classify(new("A special phrase here", "Other"), settings).Hold, "phrase rule");
        Assert(!classifier.Classify(new("A special phraseology", "Other"), settings).Hold, "phrase boundary");
        settings.Strict = true;
        Assert(classifier.Classify(new("Unknown English", "Other"), settings).Hold, "strict holds unknown English");
        Assert(classifier.Classify(new("", ""), settings).Hold, "strict missing metadata");
        Assert(Classifier.Normalize("  Café... TEST! ") == "cafe test", "normalization accents punctuation");
        Assert(Classifier.Normalize("ਪੰਜਾਬੀ") == "ਪੰਜਾਬੀ", "Indian combining marks preserved");
        Assert(Classifier.Normalize(new string('a', 5000)).Length == 4096, "input bounded");
        Assert(Classifier.Normalize("\ud800") == "", "invalid unicode safe");
        Assert(Classifier.Normalize("İ") == "i", "Latin dotted uppercase I normalization");
        Assert(MusicApps.Identify("Spotify.exe") == "spotify", "desktop Spotify identity");
        Assert(MusicApps.Identify("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify") == "spotify", "packaged Spotify identity");
        Assert(MusicApps.Identify("chrome.exe") == null, "browser excluded");
        Assert(MusicApps.Identify("FakeSpotify.exe") == null, "substring app excluded");
        var state = new MuteOwnership();
        Assert(state.ShouldMute(false), "initial unmuted may hold");
        Assert(!state.ShouldMute(true), "existing mute untouched");
        Assert(!state.ShouldRestore(true), "existing mute not restored");
        state.MarkOwned();
        Assert(state.ShouldRestore(true), "own mute restored");
        state.ExternalMuteChange(true);
        Assert(state.ShouldRestore(true), "volume only notification retains mute restoration");
        Assert(!state.ShouldRestore(false), "already unmuted untouched");
        state.ExternalMuteChange(false);
        Assert(!state.ShouldRestore(true), "external mute change relinquishes ownership");
        Assert(!state.ShouldMute(false), "user override not remuted in same hold");
        var fakeMute = false;
        var writes = new List<bool>();
        var lease = new MuteLease(() => fakeMute, muted => { fakeMute = muted; writes.Add(muted); });
        Assert(lease.Hold() && fakeMute && writes.SequenceEqual([true]), "fake audio blocked event mutes once");
        lease.Hold();
        Assert(writes.Count == 1, "repeated blocked event no duplicate write");
        lease.Ownership.ExternalMuteChange(true);
        lease.Restore();
        Assert(!fakeMute && writes.SequenceEqual([true, false]), "fake audio allow event restores after slider change");
        fakeMute = true;
        writes.Clear();
        lease = new MuteLease(() => fakeMute, muted => { fakeMute = muted; writes.Add(muted); });
        lease.Hold();
        lease.Restore();
        Assert(fakeMute && writes.Count == 0, "fake audio initial mute remains on exit");
        fakeMute = false;
        lease = new MuteLease(() => fakeMute, muted => { fakeMute = muted; writes.Add(muted); });
        lease.Hold();
        fakeMute = false;
        lease.Ownership.ExternalMuteChange(false);
        fakeMute = true;
        lease.Ownership.ExternalMuteChange(true);
        lease.Restore();
        Assert(fakeMute && writes.SequenceEqual([true]), "fake audio user unmute then remute preserved on exit");
        fakeMute = false;
        writes.Clear();
        lease = new MuteLease(() => fakeMute, muted => { fakeMute = muted; writes.Add(muted); });
        lease.Hold();
        lease.Restore();
        Assert(writes.SequenceEqual([true, false]), "fake audio disable and quit cleanup restore own mute");
        Assert(AppAudio.CheckCallbackInterop(), "audio callback COM interface export without a real audio session");
        var real = new Classifier(shipped);
        Assert(shipped.Version == 1 && shipped.Languages.Length >= 14, "packaged catalog loaded");
        foreach (var entry in shipped.Tracks)
        {
            if (entry.Artists.Length == 0) continue;
            Assert(real.Classify(new(entry.Title, entry.Artists[0]), new Settings { Languages = [entry.Language] }).Hold, "shipped track " + entry.Title);
            foreach (var language in entry.Languages)
                Assert(real.Classify(new(entry.Title, entry.Artists[0]), new Settings { Languages = [language], ArtistMatching = false }).Hold, "shipped mixed track " + entry.Title + " " + language);
        }
        var serialized = System.Text.Json.JsonSerializer.Serialize(settings, Settings.JsonOptions);
        Assert(serialized.Contains("\"artistMatching\"") && serialized.Contains("\"monitoredApps\""), "settings schema");
        Assert(Settings.Parse(System.Text.Encoding.UTF8.GetBytes(serialized)).Strict, "settings parse round trip");
        void Reject(string json, string name)
        {
            var rejected = false;
            try { Settings.Parse(System.Text.Encoding.UTF8.GetBytes(json)); }
            catch (Exception ex) when (ex is System.Text.Json.JsonException or InvalidDataException) { rejected = true; }
            Assert(rejected, name);
        }
        Reject("{\"allowTracks\":[null]}", "null rule rejected");
        Reject("{\"languages\":null}", "null language list rejected");
        Reject("{\"enabled\":\"yes\"}", "wrong settings type rejected");
        Reject("{\"monitoredApps\":[\"chrome\"]}", "unapproved app rejected");
        Reject("{\"phrases\":[\"" + new string('a', 4097) + "\"]}", "oversize rule rejected");
        Reject(new string(' ', Settings.MaximumBytes + 1), "oversize settings rejected");
        Program.WriteResult($"Self test passed\nAssertions: {assertions}\nClassifier and mute ownership transitions verified\nNo media or audio APIs called", args);
        return 0;
    }
}
