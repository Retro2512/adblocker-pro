using System.Diagnostics;
using System.Runtime.InteropServices;

namespace QuietGate;

// Only per application session volume is used. There is no endpoint volume interface here.
internal sealed class AppAudio : IDisposable
{
    internal static readonly Guid EventContext = new("047739ED-F912-433C-9D19-6090B3F6F0A2");
    private readonly Dictionary<string, AudioEntry> entries = [];

    internal int Hold(string app)
    {
        var names = MusicApps.ProcessNames(app);
        var found = 0;
        Enumerate((endpoint, control) =>
        {
            IAudioSessionControl2? session = null;
            try
            {
                session = (IAudioSessionControl2)control;
                session.GetProcessId(out var pid);
                if (pid == 0) return false;
                using var process = Process.GetProcessById((int)pid);
                if (!names.Contains(process.ProcessName, StringComparer.OrdinalIgnoreCase)) return false;
                session.GetSessionInstanceIdentifier(out var instance);
                var key = endpoint + "|" + instance;
                var retained = !entries.TryGetValue(key, out var entry);
                if (retained)
                {
                    entry = new AudioEntry(app, session, (ISimpleAudioVolume)control);
                    entries.Add(key, entry);
                }
                try { if (entry!.Hold()) found++; }
                catch (COMException) { }
                return retained;
            }
            catch (Exception ex) when (ex is COMException or InvalidCastException or ArgumentException or InvalidOperationException)
            { return false; }
        });
        return found;
    }

    internal void Restore(string app)
    {
        foreach (var pair in entries.Where(x => x.Value.App == app).ToArray())
        {
            pair.Value.Dispose();
            entries.Remove(pair.Key);
        }
    }

    public void Dispose()
    {
        foreach (var entry in entries.Values) entry.Dispose();
        entries.Clear();
    }

    internal static int CheckMusicSessions()
    {
        var count = 0;
        Enumerate((endpoint, control) =>
        {
            try
            {
                ((IAudioSessionControl2)control).GetProcessId(out var pid);
                if (pid == 0) return false;
                using var process = Process.GetProcessById((int)pid);
                if (MusicApps.Known.Any(app => app.Processes.Contains(process.ProcessName, StringComparer.OrdinalIgnoreCase))) count++;
                // Read the mute state to verify the COM interface without modifying it.
                ((ISimpleAudioVolume)control).GetMute(out _);
            }
            catch (Exception ex) when (ex is COMException or ArgumentException or InvalidOperationException) { }
            return false;
        });
        return count;
    }

    internal static bool CheckCallbackInterop()
    {
        var ownership = new MuteOwnership();
        var callback = new VolumeEvents(ownership);
        var pointer = Marshal.GetComInterfaceForObject(callback, typeof(IAudioSessionEvents));
        try { return pointer != IntPtr.Zero; }
        finally { Marshal.Release(pointer); }
    }

    private static void Enumerate(Func<string, IAudioSessionControl, bool> visit)
    {
        IMMDeviceEnumerator? enumerator = null;
        IMMDeviceCollection? devices = null;
        try
        {
            enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            enumerator.EnumAudioEndpoints(0, 1, out devices); // Render endpoints, active only.
            devices.GetCount(out var count);
            for (uint i = 0; i < count; i++)
            {
                IMMDevice? device = null;
                IAudioSessionManager2? manager = null;
                IAudioSessionEnumerator? sessions = null;
                try
                {
                    devices.Item(i, out device);
                    device.GetId(out var endpoint);
                    var iid = typeof(IAudioSessionManager2).GUID;
                    device.Activate(ref iid, 23, IntPtr.Zero, out var activated);
                    manager = (IAudioSessionManager2)activated;
                    manager.GetSessionEnumerator(out sessions);
                    sessions.GetCount(out var sessionCount);
                    for (var j = 0; j < sessionCount; j++)
                    {
                        sessions.GetSession(j, out var control);
                        if (!visit(endpoint, control)) Release(control);
                    }
                }
                catch (COMException) { }
                finally { Release(sessions); Release(manager); Release(device); }
            }
        }
        finally { Release(devices); Release(enumerator); }
    }
    internal static void Release(object? value)
    {
        if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value);
    }

    private sealed class AudioEntry : IDisposable
    {
        internal string App { get; }
        private readonly IAudioSessionControl2 control;
        private readonly ISimpleAudioVolume volume;
        private readonly VolumeEvents events;
        private readonly MuteLease lease;
        internal AudioEntry(string app, IAudioSessionControl2 control, ISimpleAudioVolume volume)
        {
            App = app;
            this.control = control;
            this.volume = volume;
            lease = new MuteLease(() => { volume.GetMute(out var muted); return muted; }, muted =>
            {
                var context = EventContext;
                volume.SetMute(muted, ref context);
            });
            events = new VolumeEvents(lease.Ownership);
            control.RegisterAudioSessionNotification(events);
        }
        internal bool Hold()
        {
            return lease.Hold();
        }
        public void Dispose()
        {
            try
            {
                lease.Restore();
                control.UnregisterAudioSessionNotification(events);
            }
            catch (COMException) { }
            finally { lease.Ownership.ExternalChange(); Release(control); }
        }
    }

    [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
    private sealed class VolumeEvents(MuteOwnership ownership) : IAudioSessionEvents
    {
        public int OnDisplayNameChanged(string name, ref Guid context) => 0;
        public int OnIconPathChanged(string path, ref Guid context) => 0;
        public int OnSimpleVolumeChanged(float volume, bool muted, ref Guid context)
        {
            if (context != EventContext) ownership.ExternalMuteChange(muted);
            return 0;
        }
        public int OnChannelVolumeChanged(uint count, IntPtr volumes, uint index, ref Guid context) => 0;
        public int OnGroupingParamChanged(ref Guid grouping, ref Guid context) => 0;
        public int OnStateChanged(int state) => 0;
        public int OnSessionDisconnected(int reason) { ownership.ExternalChange(); return 0; }
    }
}

// Kept independent of COM so ownership transitions can be tested without touching audio.
internal sealed class MuteOwnership
{
    private volatile bool owned;
    private volatile bool externallyChanged;
    internal bool ShouldMute(bool muted) => !muted && !externallyChanged;
    internal void MarkOwned() => owned = true;
    internal void ExternalMuteChange(bool muted)
    {
        // A volume slider notification repeats the mute bit. It does not revoke our mute.
        if (!muted || !owned) ExternalChange();
    }
    internal void ExternalChange() { owned = false; externallyChanged = true; }
    internal bool ShouldRestore(bool muted) => owned && muted;
}

internal sealed class MuteLease(Func<bool> getMute, Action<bool> setMute)
{
    internal MuteOwnership Ownership { get; } = new();
    internal bool Hold()
    {
        var muted = getMute();
        if (!Ownership.ShouldMute(muted)) return muted;
        Ownership.MarkOwned();
        try { setMute(true); }
        catch { Ownership.ExternalChange(); throw; }
        return true;
    }
    internal void Restore()
    {
        if (Ownership.ShouldRestore(getMute())) setMute(false);
        Ownership.ExternalChange();
    }
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] internal class MMDeviceEnumerator { }
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceEnumerator
{
    void EnumAudioEndpoints(int dataFlow, uint stateMask, out IMMDeviceCollection devices);
    void GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    void GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
    void RegisterEndpointNotificationCallback(IntPtr callback);
    void UnregisterEndpointNotificationCallback(IntPtr callback);
}
[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceCollection
{
    void GetCount(out uint count);
    void Item(uint index, out IMMDevice device);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDevice
{
    void Activate(ref Guid iid, uint context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object result);
    void OpenPropertyStore(uint access, out IntPtr properties);
    void GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    void GetState(out uint state);
}
[ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioSessionManager2
{
    void GetAudioSessionControl(ref Guid sessionId, uint flags, out IAudioSessionControl control);
    void GetSimpleAudioVolume(ref Guid sessionId, uint flags, out ISimpleAudioVolume volume);
    void GetSessionEnumerator(out IAudioSessionEnumerator sessions);
}
[ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioSessionEnumerator
{
    void GetCount(out int count);
    void GetSession(int index, out IAudioSessionControl control);
}
[ComImport, Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioSessionControl
{
    void GetState(out int state);
    void GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    void SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid context);
    void GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
    void SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid context);
    void GetGroupingParam(out Guid grouping);
    void SetGroupingParam(ref Guid grouping, ref Guid context);
    void RegisterAudioSessionNotification(IAudioSessionEvents events);
    void UnregisterAudioSessionNotification(IAudioSessionEvents events);
}
[ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioSessionControl2
{
    void GetState(out int state);
    void GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    void SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid context);
    void GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
    void SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid context);
    void GetGroupingParam(out Guid grouping);
    void SetGroupingParam(ref Guid grouping, ref Guid context);
    void RegisterAudioSessionNotification(IAudioSessionEvents events);
    void UnregisterAudioSessionNotification(IAudioSessionEvents events);
    void GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string identifier);
    void GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string identifier);
    void GetProcessId(out uint processId);
    [PreserveSig] int IsSystemSoundsSession();
    void SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
}
[ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface ISimpleAudioVolume
{
    void SetMasterVolume(float level, ref Guid context);
    void GetMasterVolume(out float level);
    void SetMute([MarshalAs(UnmanagedType.Bool)] bool muted, ref Guid context);
    void GetMute([MarshalAs(UnmanagedType.Bool)] out bool muted);
}
[ComVisible(true), Guid("24918ACC-64B3-37C1-8CA9-74A66E9957A8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionEvents
{
    [PreserveSig] int OnDisplayNameChanged([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid context);
    [PreserveSig] int OnIconPathChanged([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid context);
    [PreserveSig] int OnSimpleVolumeChanged(float volume, [MarshalAs(UnmanagedType.Bool)] bool muted, ref Guid context);
    [PreserveSig] int OnChannelVolumeChanged(uint count, IntPtr volumes, uint index, ref Guid context);
    [PreserveSig] int OnGroupingParamChanged(ref Guid grouping, ref Guid context);
    [PreserveSig] int OnStateChanged(int state);
    [PreserveSig] int OnSessionDisconnected(int reason);
}
