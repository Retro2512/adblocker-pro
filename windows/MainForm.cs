namespace QuietGate;

internal sealed class MainForm : Form
{
    private readonly MediaMonitor monitor;
    private readonly NotifyIcon tray;
    private Settings settings;
    private readonly CheckBox enabled = new() { Text = "Adblocker Pro on", AutoSize = true };
    private readonly CheckBox strict = new() { Text = "Hold unknown tracks", AutoSize = true };
    private readonly CheckBox artists = new() { Text = "Match known artists", AutoSize = true };
    private readonly CheckedListBox languages = new() { Dock = DockStyle.Fill, CheckOnClick = true, BorderStyle = BorderStyle.None };
    private readonly CheckedListBox apps = new() { Dock = DockStyle.Fill, CheckOnClick = true, BorderStyle = BorderStyle.None };
    private readonly TextBox allow = RulesBox();
    private readonly TextBox block = RulesBox();
    private readonly TextBox phrases = RulesBox();
    private readonly Label status = new() { Text = "Starting", AutoSize = true, Dock = DockStyle.Top, Padding = new Padding(0, 8, 0, 8) };
    private readonly ListBox playback = new() { Dock = DockStyle.Fill, BorderStyle = BorderStyle.None, IntegralHeight = false };
    private IReadOnlyList<PlaybackRow> current = [];
    private bool quitting;

    internal MainForm(Classifier classifier, Settings initial, bool preview = false)
    {
        settings = initial;
        monitor = new MediaMonitor(classifier, settings);
        Text = "Adblocker Pro";
        using (var iconStream = typeof(MainForm).Assembly.GetManifestResourceStream("QuietGate.QuietGate.ico"))
            Icon = iconStream == null ? SystemIcons.Application : new Icon(iconStream);
        ClientSize = new Size(580, 620);
        MinimumSize = new Size(520, 580);
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 10);
        BackColor = Color.White;
        Padding = new Padding(22);

        var root = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 5 };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 40));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 125));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 32));
        Controls.Add(root);
        var heading = new Label { Text = "Adblocker Pro", Font = new Font("Segoe UI", 22, FontStyle.Bold), AutoSize = true };
        root.Controls.Add(heading, 0, 0);
        var now = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 3 };
        now.RowStyles.Add(new RowStyle(SizeType.Absolute, 32));
        now.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        now.RowStyles.Add(new RowStyle(SizeType.Absolute, 35));
        now.Controls.Add(status, 0, 0);
        now.Controls.Add(playback, 0, 1);
        var trackActions = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false };
        trackActions.Controls.Add(Button("Allow track", () => OverrideCurrent(true)));
        trackActions.Controls.Add(Button("Block track", () => OverrideCurrent(false)));
        now.Controls.Add(trackActions, 0, 2);
        root.Controls.Add(now, 0, 1);

        var tabs = new TabControl { Dock = DockStyle.Fill };
        var controlsPage = Page("Listening");
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 4, ColumnCount = 2, Padding = new Padding(12) };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 60));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 40));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.Controls.Add(enabled, 0, 0);
        layout.Controls.Add(strict, 0, 1);
        layout.Controls.Add(artists, 0, 2);
        var languagePanel = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2 };
        languagePanel.RowStyles.Add(new RowStyle(SizeType.Absolute, 26));
        languagePanel.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        languagePanel.Controls.Add(new Label { Text = "Languages to hold", AutoSize = true }, 0, 0);
        languagePanel.Controls.Add(languages, 0, 1);
        layout.Controls.Add(languagePanel, 0, 3);
        var appPanel = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2 };
        appPanel.RowStyles.Add(new RowStyle(SizeType.Absolute, 26));
        appPanel.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        appPanel.Controls.Add(new Label { Text = "Music apps", AutoSize = true }, 0, 0);
        appPanel.Controls.Add(apps, 0, 1);
        layout.Controls.Add(appPanel, 1, 3);
        controlsPage.Controls.Add(layout);
        tabs.TabPages.Add(controlsPage);
        tabs.TabPages.Add(RulesPage("Allowed tracks", allow, "Title | Artist"));
        tabs.TabPages.Add(RulesPage("Blocked tracks", block, "Title | Artist"));
        tabs.TabPages.Add(RulesPage("Phrases", phrases, "One phrase per line"));
        root.Controls.Add(tabs, 0, 2);
        var actions = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(0, 10, 0, 0) };
        actions.Controls.Add(Button("Save", Save));
        actions.Controls.Add(Button("Quit", Quit));
        root.Controls.Add(actions, 0, 3);
        root.Controls.Add(new Label { Text = "Close to keep listening", AutoSize = true, ForeColor = Color.DimGray }, 0, 4);

        enabled.Checked = settings.Enabled;
        strict.Checked = settings.Strict;
        artists.Checked = settings.ArtistMatching;
        foreach (var language in Settings.LanguageDefaults) languages.Items.Add(language.Label, settings.Languages.Contains(language.Id));
        foreach (var app in MusicApps.Known) apps.Items.Add(app.Label, settings.MonitoredApps.Contains(app.Id));
        allow.Lines = settings.AllowTracks;
        block.Lines = settings.BlockTracks;
        phrases.Lines = settings.Phrases;
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open", null, (_, _) => Open());
        menu.Items.Add("Turn off", null, (_, _) => { enabled.Checked = false; Save(); });
        menu.Items.Add("Quit", null, (_, _) => Quit());
        tray = new NotifyIcon { Icon = Icon, Text = "Adblocker Pro", Visible = !preview, ContextMenuStrip = menu };
        tray.DoubleClick += (_, _) => Open();
        monitor.Changed += OnChanged;
        Shown += async (_, _) =>
        {
            if (preview) return;
            try { await monitor.StartAsync(); }
            catch (Exception) { status.Text = "Media access unavailable"; }
        };
        FormClosing += (_, args) =>
        {
            if (!quitting && args.CloseReason == CloseReason.UserClosing) { args.Cancel = true; Hide(); }
        };
    }

    private static TextBox RulesBox() => new() { Multiline = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill, AcceptsReturn = true, BorderStyle = BorderStyle.FixedSingle };
    private static TabPage Page(string text) => new(text) { BackColor = Color.White };
    private static TabPage RulesPage(string text, TextBox box, string label)
    {
        var page = Page(text);
        page.Padding = new Padding(12);
        var table = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2 };
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));
        table.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        table.Controls.Add(new Label { Text = label, AutoSize = true }, 0, 0);
        table.Controls.Add(box, 0, 1);
        page.Controls.Add(table);
        return page;
    }
    private static Button Button(string text, Action action)
    {
        var button = new Button { Text = text, AutoSize = true, FlatStyle = FlatStyle.System };
        button.Click += (_, _) => action();
        return button;
    }
    private void Save()
    {
        var updated = new Settings
        {
            Enabled = enabled.Checked,
            Strict = strict.Checked,
            ArtistMatching = artists.Checked,
            Languages = languages.CheckedIndices.Cast<int>().Select(i => Settings.LanguageDefaults[i].Id).ToArray(),
            MonitoredApps = apps.CheckedIndices.Cast<int>().Select(i => MusicApps.Known[i].Id).ToArray(),
            AllowTracks = Lines(allow), BlockTracks = Lines(block), Phrases = Lines(phrases)
        };
        if (updated.AllowTracks.Concat(updated.BlockTracks).Any(x => !x.Contains('|')))
        { MessageBox.Show(this, "Use Title | Artist for each track", "Adblocker Pro", MessageBoxButtons.OK, MessageBoxIcon.Information); return; }
        try { updated.Save(); }
        catch (Exception) { MessageBox.Show(this, "Could not save settings", "Adblocker Pro", MessageBoxButtons.OK, MessageBoxIcon.Error); return; }
        settings = updated;
        monitor.Update(settings);
        status.Text = updated.Enabled ? "Saved" : "Off";
    }
    private static string[] Lines(TextBox box) => box.Lines.Select(x => x.Trim()).Where(x => x.Length != 0).Distinct().ToArray();
    private void OverrideCurrent(bool allowed)
    {
        var index = playback.SelectedIndex;
        if (index < 0 || index >= current.Count || string.IsNullOrWhiteSpace(current[index].Track.Title)) return;
        var track = current[index].Track;
        var key = track.Key;
        var target = allowed ? allow : block;
        var other = allowed ? block : allow;
        target.Lines = Lines(target).Where(x => Classifier.NormalizeKey(x) != key).Append(key).ToArray();
        other.Lines = Lines(other).Where(x => Classifier.NormalizeKey(x) != key).ToArray();
        Save();
    }
    private void OnChanged(IReadOnlyList<PlaybackRow> rows, string message)
    {
        if (IsDisposed || quitting) return;
        if (InvokeRequired) { BeginInvoke(() => OnChanged(rows, message)); return; }
        var selectedKey = playback.SelectedIndex >= 0 && playback.SelectedIndex < current.Count ? current[playback.SelectedIndex].Track.Key : null;
        current = rows;
        status.Text = message;
        playback.BeginUpdate();
        playback.Items.Clear();
        foreach (var row in rows)
            playback.Items.Add((row.Track.Title.Length == 0 ? "No track details" : row.Track.Title + " · " + row.Track.Artist) + "  •  " + row.Action + " · " + row.Decision.Reason);
        var selected = rows.Select((row, index) => (row, index)).FirstOrDefault(x => x.row.Track.Key == selectedKey);
        if (rows.Count != 0) playback.SelectedIndex = selectedKey != null && selected.row != null ? selected.index : 0;
        playback.EndUpdate();
    }
    internal void Open() { Show(); WindowState = FormWindowState.Normal; Activate(); }
    private void Quit() { quitting = true; Close(); }
    protected override void Dispose(bool disposing)
    {
        if (disposing) { monitor.Dispose(); tray.Visible = false; tray.Dispose(); }
        base.Dispose(disposing);
    }
}
