# Adblocker Pro for Windows

Open `publish-adblocker-pro/AdblockerPro.exe`. Keep `catalog.json` beside it. Windows 10 version 2004 or later and Windows 11 are supported. The published app includes its runtime.

Spotify is selected by default. MusicBee, foobar2000 and VLC can be selected when they expose Windows media controls. Browsers are excluded. Use the extension for browser playback.

Choose the languages to hold, then select Save. Hold unknown tracks is on by default, so unfamiliar English tracks also pause until allowed. Allow track saves an exact title and artist override. It does not automatically resume playback. Blocked overrides take precedence over allowed overrides.

Closing the window leaves the tray app running. Use Quit to stop it and restore any app mute that Adblocker Pro still owns. No installer, service, startup registration or administrator access is used.

## Build

From the repository root with the .NET 8 SDK installed:

```powershell
dotnet build windows/QuietGate.Windows.csproj -c Release
dotnet publish windows/QuietGate.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -o windows/publish-adblocker-pro
```

The build links `data/catalog.json` into the output. No third party runtime packages are used. SDK and Windows targeting packages may be downloaded during restore.

## Test without changing playback

```powershell
dotnet run --project windows/QuietGate.Windows.csproj -c Release -- --self-test --output windows/self-test.txt
dotnet run --project windows/QuietGate.Windows.csproj -c Release -- --check --output windows/check.txt
```

Self tests use synthetic metadata and mute ownership states. They load and test the shipped catalog but never request media sessions or audio controls. Check reads media and audio session availability without pausing or muting anything.

To test the published executable without opening its listening UI:

```powershell
Start-Process -FilePath .\windows\publish-adblocker-pro\AdblockerPro.exe -ArgumentList '--self-test','--output','windows/self-test-published.txt' -Wait -WindowStyle Hidden
Get-Content .\windows\self-test-published.txt
```

## Settings

Settings are stored in `%LocalAppData%\QuietGate\settings.json`. Catalog and rules are local. No metadata, listening history or audio is transmitted or recorded.

Track overrides use `Title | Artist`, one per line. Phrases match complete normalized words in titles, artists or albums. Artist matching is a catalog heuristic, not language recognition from audio. Turn it off when an artist's other languages should not be inferred. Explicit known language tags and exact catalog tracks take precedence over artist heuristics.

Further implementation and limitations are in [Windows notes](../docs/WINDOWS.md).
