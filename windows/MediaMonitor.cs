using Windows.Media.Control;

namespace QuietGate;

internal sealed record PlaybackRow(string App, TrackMetadata Track, Decision Decision, string Action);

internal sealed class MediaMonitor(Classifier classifier, Settings settings) : IDisposable
{
    private readonly AppAudio audio = new();
    private readonly SemaphoreSlim gate = new(1);
    private readonly HashSet<GlobalSystemMediaTransportControlsSession> subscribed = [];
    private GlobalSystemMediaTransportControlsSessionManager? manager;
    private Settings settings = settings;
    private volatile bool disposed;
    internal event Action<IReadOnlyList<PlaybackRow>, string>? Changed;

    internal async Task StartAsync()
    {
        manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        manager.SessionsChanged += SessionsChanged;
        manager.CurrentSessionChanged += CurrentSessionChanged;
        Subscribe();
        // Timer callbacks run on MTA threads. Polling covers apps that omit metadata events.
        polling = new System.Threading.Timer(_ => Schedule(), null, 0, 750);
    }
    private System.Threading.Timer? polling;
    internal void Update(Settings value) { settings = value; Schedule(); }
    private void SessionsChanged(GlobalSystemMediaTransportControlsSessionManager sender, SessionsChangedEventArgs args) => Schedule();
    private void CurrentSessionChanged(GlobalSystemMediaTransportControlsSessionManager sender, CurrentSessionChangedEventArgs args) => Schedule();
    private void PropertiesChanged(GlobalSystemMediaTransportControlsSession sender, MediaPropertiesChangedEventArgs args) => Schedule();
    private void PlaybackChanged(GlobalSystemMediaTransportControlsSession sender, PlaybackInfoChangedEventArgs args) => Schedule();

    private void Subscribe()
    {
        if (manager == null) return;
        var current = manager.GetSessions().ToHashSet();
        foreach (var old in subscribed.Where(x => !current.Contains(x)).ToArray())
        {
            old.MediaPropertiesChanged -= PropertiesChanged;
            old.PlaybackInfoChanged -= PlaybackChanged;
            subscribed.Remove(old);
        }
        foreach (var session in current.Where(x => !subscribed.Contains(x)))
        {
            session.MediaPropertiesChanged += PropertiesChanged;
            session.PlaybackInfoChanged += PlaybackChanged;
            subscribed.Add(session);
        }
    }
    private void Schedule()
    {
        if (!disposed) _ = Task.Run(EvaluateAsync);
    }
    private async Task EvaluateAsync()
    {
        if (!await gate.WaitAsync(0)) return;
        try
        {
            if (disposed || manager == null) return;
            Subscribe();
            var snapshot = settings;
            var rows = new List<PlaybackRow>();
            var evaluations = new List<(string App, GlobalSystemMediaTransportControlsSession Session, TrackMetadata Track, Decision Decision)>();
            foreach (var session in subscribed.ToArray())
            {
                if (disposed) return;
                var app = MusicApps.Identify(session.SourceAppUserModelId);
                if (app == null || !snapshot.MonitoredApps.Contains(app, StringComparer.OrdinalIgnoreCase)) continue;
                try
                {
                    var properties = await session.TryGetMediaPropertiesAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2));
                    var track = new TrackMetadata(properties.Title ?? "", properties.Artist ?? "", properties.AlbumTitle ?? "", properties.Genres.ToArray());
                    evaluations.Add((app, session, track, classifier.Classify(track, snapshot)));
                }
                catch (Exception)
                {
                    evaluations.Add((app, session, new TrackMetadata("", ""), new Decision(snapshot.Enabled && snapshot.Strict, "Metadata unavailable")));
                }
            }
            // A changed setting must not allow a stale metadata request to reapply a hold.
            if (disposed || !ReferenceEquals(snapshot, settings)) return;
            var heldApps = evaluations.Where(x => x.Decision.Hold).Select(x => x.App).ToHashSet();
            foreach (var app in MusicApps.Known)
                if (!heldApps.Contains(app.Id)) audio.Restore(app.Id);
            foreach (var app in heldApps)
            {
                var muted = 0;
                try { muted = audio.Hold(app); } catch (Exception) { }
                foreach (var evaluation in evaluations.Where(x => x.App == app))
                {
                    var paused = false;
                    if (disposed) return;
                    try { paused = await evaluation.Session.TryPauseAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2)); } catch (Exception) { }
                    var action = paused ? "Paused" : muted > 0 ? "Muted" : "Pause unavailable";
                    rows.Add(new(app, evaluation.Track, evaluation.Decision, action));
                }
            }
            rows.AddRange(evaluations.Where(x => !heldApps.Contains(x.App)).Select(x => new PlaybackRow(x.App, x.Track, x.Decision, "Allowed")));
            Changed?.Invoke(rows, snapshot.Enabled ? rows.Count == 0 ? "Waiting for a music app" : "Listening" : "Off");
        }
        catch (Exception)
        {
            Changed?.Invoke([], "Media access unavailable");
        }
        finally { gate.Release(); }
    }

    public void Dispose()
    {
        disposed = true;
        polling?.Dispose();
        if (manager != null)
        {
            manager.SessionsChanged -= SessionsChanged;
            manager.CurrentSessionChanged -= CurrentSessionChanged;
        }
        // Audio cleanup is serialized with any in flight media request.
        gate.Wait();
        try
        {
            foreach (var session in subscribed)
            {
                session.MediaPropertiesChanged -= PropertiesChanged;
                session.PlaybackInfoChanged -= PlaybackChanged;
            }
            audio.Dispose();
        }
        finally { gate.Release(); }
    }
}
