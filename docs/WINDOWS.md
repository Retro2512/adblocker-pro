# Windows companion

## Run

Open `AdblockerPro.exe`. Keep `catalog.json` beside it. The app includes its runtime and supports Windows 10 version 2004 or later and Windows 11.

Spotify is selected by default. Choose the languages and apps to hold, then select Save. Allow track saves an exact title and artist override. Blocked overrides take precedence. Closing the window keeps Adblocker Pro in the tray. Use Quit to stop it.

There is no installation, administrator prompt, service or automatic startup registration. Settings are stored in `%LocalAppData%\QuietGate\settings.json`. Track overrides use `Title | Artist`, one per line. Phrases match whole normalized words. Rules, catalog and classification stay local; no listening metadata or audio is transmitted or recorded.

## Build

From the source repository root with the .NET 8 SDK:

```powershell
dotnet build windows/QuietGate.Windows.csproj -c Release
dotnet publish windows/QuietGate.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -o windows/publish-adblocker-pro
```

The build copies `data/catalog.json` beside the executable. SDK and Windows targeting packages may be downloaded during restore. The companion has no third party runtime dependencies.

## Safe checks

From the folder containing the published app:

```powershell
Start-Process -FilePath .\AdblockerPro.exe -ArgumentList '--self-test','--output','self-test.txt' -Wait -WindowStyle Hidden
Get-Content .\self-test.txt
Start-Process -FilePath .\AdblockerPro.exe -ArgumentList '--check','--output','check.txt' -Wait -WindowStyle Hidden
Get-Content .\check.txt
```

Self tests use synthetic metadata and fake audio controls. Check reads the available media and audio sessions. Neither command pauses playback or changes audio. To run the same checks from source:

```powershell
dotnet run --project windows/QuietGate.Windows.csproj -c Release -- --self-test
dotnet run --project windows/QuietGate.Windows.csproj -c Release -- --check
```

## Implementation

Adblocker Pro watches Windows Global System Media Transport Controls metadata and playback events. A 750 millisecond fallback poll catches providers that omit events. When a monitored app has a held track, it mutes only matching per process CoreAudio sessions on active render devices, then requests pause from that app's media session.

Spotify desktop and its Microsoft Store identity are recognized. Other selectable app identities are MusicBee, foobar2000 and VLC. Support depends on those apps exposing Windows media sessions. The app does not inspect browser sessions, capture audio, install a driver, intercept network traffic or change the system output volume.

## Actual behavior

This is a metadata gate, not a universal preplayback buffer. Metadata can arrive after audio starts, so an initial snippet is possible. Providers may omit artist, title or language tags, refuse pause, use an unrecognized identity or delay updates. CoreAudio mute can fail for unavailable endpoints or incompatible audio paths. Unknown metadata is held only when Hold unknown tracks is enabled. A track is not automatically resumed when allowed.

Strict mode also holds unknown English tracks. Known other language metadata and known catalog tracks can be allowed automatically. Most players, including Spotify, do not provide reliable language tags. Artist heuristics can therefore hold a multilingual artist's other songs. Exact allowed overrides bypass those inferences.

If an app exposes several media sessions, any held session holds that app's audio and all of its recognized media sessions. This prevents an allowed session from unmuting a simultaneous blocked session, but can also hold an allowed stream in the same app. Separate unrelated apps are untouched.

## Mute ownership

The companion does not change volume levels. It records ownership only after changing an initially unmuted audio session to muted. A preexisting mute is never undone. Session notifications use a dedicated event context. A volume slider change that leaves the owned mute in place retains ownership, so that mute can still be restored. An external unmute relinquishes ownership and is respected for that hold while pause requests continue.

Owned mutes are restored when an app no longer has held sessions, monitoring is disabled, an app is deselected or Adblocker Pro exits normally. Use the tray Quit action for shutdown. Forced termination, a process crash or power loss can leave an app session muted. If this happens, unmute that app in the Windows volume mixer. There is no persistent service to recover mute changes after termination.

## Verification

The safe self test covers explicit override precedence, disabled mode, language tags, title labels, catalog aliases and artist boundaries, phrase boundaries, unknown strict decisions, script evidence, application identity filtering and mute ownership restoration. A fake audio backend exercises the same mute lease used by real audio sessions through hold, repeated events, slider changes, allow, external unmute and remute, and cleanup. The callback COM interface is exported without attaching it to any real audio session. Every shipped catalog track is also checked. The read only check exercises Windows media session discovery and CoreAudio enumeration without playback commands or mute writes.

The development host had no music or media sessions during this check. Live Spotify pause behavior and real user audio restoration were not tested during development.

## API references

[Windows media pause requests](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssession.trypauseasync)

[Audio session controls](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nn-audioclient-isimpleaudiovolume)

[Mute event context](https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nf-audiopolicy-iaudiosessionevents-onsimplevolumechanged)
