using System.Runtime.InteropServices;
using Windows.Media.Control;

namespace QuietGate;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        try
        {
            var catalogPath = Path.Combine(AppContext.BaseDirectory, "catalog.json");
            var catalog = Classifier.LoadCatalog(catalogPath);
            if (args.Contains("--self-test")) return SelfTest.Run(catalog, args);
            if (args.Contains("--check")) return CheckAsync(args).GetAwaiter().GetResult();
            if (args.Contains("--render-ui"))
            {
                var position = Array.IndexOf(args, "--render-ui");
                if (position + 1 >= args.Length) throw new ArgumentException("Specify an image path");
                using var preview = new MainForm(new Classifier(catalog), new Settings(), true);
                preview.StartPosition = FormStartPosition.Manual;
                preview.Location = new Point(-32000, -32000);
                preview.ShowInTaskbar = false;
                preview.Show();
                Application.DoEvents();
                using var bitmap = new Bitmap(preview.Width, preview.Height);
                preview.DrawToBitmap(bitmap, new Rectangle(0, 0, preview.Width, preview.Height));
                bitmap.Save(args[position + 1]);
                return 0;
            }
            using var instance = new Mutex(true, "Local\\QuietGate.Windows", out var first);
            if (!first)
            {
                MessageBox.Show("Adblocker Pro is already running. Open it from the tray", "Adblocker Pro", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 0;
            }
            Settings settings;
            try { settings = Settings.Load(); }
            catch (Exception)
            {
                MessageBox.Show("Could not read settings. Check the settings file before opening Adblocker Pro", "Adblocker Pro", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
            using var form = new MainForm(new Classifier(catalog), settings);
            Application.Run(form);
            return 0;
        }
        catch (Exception ex)
        {
            if (args.Length > 0) { WriteResult("Failed: " + ex.Message, args); return 1; }
            MessageBox.Show("Adblocker Pro could not start. Check that catalog.json is beside the app", "Adblocker Pro", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static async Task<int> CheckAsync(string[] args)
    {
        var manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        var count = manager.GetSessions().Count;
        var audioCount = await Task.Run(AppAudio.CheckMusicSessions);
        WriteResult($"Read only check passed\nMedia sessions: {count}\nKnown music audio sessions: {audioCount}\nNo audio or playback changes", args);
        return 0;
    }
    internal static void WriteResult(string result, string[] args)
    {
        if (!Console.IsOutputRedirected) AttachConsole(unchecked((uint)-1));
        Console.WriteLine(result);
        var output = Array.IndexOf(args, "--output");
        if (output >= 0 && output + 1 < args.Length) File.WriteAllText(args[output + 1], result + Environment.NewLine);
    }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AttachConsole(uint processId);
}
