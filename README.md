# Adblocker Pro

Local music language filtering for Chromium browsers and Windows music apps. Despite its name, this project does not block advertisements.

The browser extension holds matching playback and shows a loading spinner over visible video. The Windows companion pauses matching tracks and mutes only the selected music app when an audio session is available.

## Start using it

[Download for Edge and Chrome](https://github.com/Retro2512/adblocker-pro/releases/latest/download/AdblockerPro-browser.zip)

[Download the Windows companion](https://github.com/Retro2512/adblocker-pro/releases/latest/download/AdblockerPro-windows-x64.zip)

[Download source](https://github.com/Retro2512/adblocker-pro/releases/latest/download/AdblockerPro-source.zip)

### Chrome, Edge, Brave and other Chromium browsers

1. Download the browser ZIP and extract it into a folder you will keep.
2. Open `edge://extensions` in Edge or `chrome://extensions` in Chrome.
3. Turn on Developer mode, then choose **Load unpacked**.
4. Select the extracted folder containing `manifest.json`. If using the source repository, select its `extension` folder instead.
5. Reload your music tabs and pin Adblocker Pro.

Keep the extracted folder after installation. GitHub downloads use this manual installation route; this release is not a browser store listing. See [Microsoft's installation guide](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/getting-started/extension-sideloading).

Use Chromium 119 or newer. No build, account, API key or server is needed. Each browser profile needs its own installation. Incognito requires enabling the extension there separately.

### Windows

Open `windows/publish-adblocker-pro/AdblockerPro.exe`, or extract the Windows archive in `dist` and open the executable. Keep `catalog.json` beside it. The portable release includes its .NET runtime and does not need administrator access.

Spotify is selected by default. The tray menu opens settings or quits the app. Closing the settings window leaves it in the tray. It does not install a service or add itself to startup. See [Windows guide](docs/WINDOWS.md).

## Defaults

Hindi, Punjabi, Urdu, Bhojpuri, Haryanvi, Rajasthani, Awadhi, Braj, Maithili, Magahi, Garhwali, Kumaoni, Dogri and Kashmiri are selected. The list is configurable; it is not a claim that geography has one definitive language boundary.

**Hold unidentified music is on by default.** Songs without usable language evidence stay held, including English or other languages. Use **Allow track**, or turn that setting off to block only recognized matches. YouTube videos without a usable category can also be held in this mode. Identified nonmusic videos continue normally.

**Match artists is on by default.** This broadens detection but can hold a multilingual artist's otherwise allowed songs. Explicit song language and exact track rules take precedence.

Settings also support selected languages, custom words, site exceptions, exact track rules, and JSON import and export. Browser and Windows settings are independent.

## Coverage

| Surface | Implementation |
| :--- | :--- |
| YouTube and YouTube Music | Player metadata, active track selectors, category checks, Media Session |
| Spotify web | Active player metadata and Media Session |
| Apple Music, Amazon Music, Deezer, Tidal | Active player selectors and Media Session |
| SoundCloud, Bandcamp | Active player and structured music metadata |
| JioSaavn, Gaana | Active player selectors and Media Session |
| Other websites | Structured MusicRecording metadata and recognized music context |
| Spotify desktop | Windows media metadata, pause requests and per app audio mute |
| MusicBee, foobar2000, VLC | Optional Windows targets when they publish compatible media sessions |

Adapters and playback transitions are tested with controlled browser fixtures. A listed adapter is not a guarantee against every current or future player implementation. Account restricted streaming services still need live acceptance testing with your accounts.

## What it does not do

Adblocker Pro does not listen to lyrics, run an acoustic language model, or identify every song ever released. The local catalog is a seed, not a complete music database. Missing, misleading or late metadata creates detection gaps; strict mode trades those gaps for more held tracks.

The loading indicator is an intentional visual hold, not a network failure. Browser playback is paused and play requests are deferred. Some sites display their own pause or error state. Desktop players are paused or muted, not made to buffer. A short snippet can occur when an app announces its next track late.

This is a user controlled filter, not an enforced Windows security policy. It does not cover every Windows audio source, browser internal pages, local files by default, remote casting, every DRM path or an uninstrumented player. The owner can disable or remove it. Page code can interfere with the browser bridge.

## Develop

```powershell
npm ci
npm test
npm run check
npx playwright install chromium
npm run test:browser
node tests/ui-browser.mjs
dotnet build windows/QuietGate.Windows.csproj -c Release
```

The extension has no production npm dependencies. Development uses Node 22 or newer and Playwright. The Windows source uses .NET 8 and Windows 10 version 2004 or newer. Publishing instructions and exact Windows build commands are in [Publishing](docs/PUBLISHING.md) and the Windows guide.

## Project map

| Path | Contents |
| :--- | :--- |
| `extension/content/gate.js` | Early media and Web Audio gate |
| `extension/content/controller.js` | Isolated policy controller and video spinner |
| `extension/content/adapters.js` | Current track extraction |
| `extension/shared` | Classifier, catalog and settings validation |
| `extension/background` | Settings messages and temporary tab status |
| `extension/ui` | Popup and options |
| `windows` | Portable Windows companion and source |
| `data/catalog.json` | Shared catalog source |
| `tests` | Unit and real extension fixture tests |

See [Detection](docs/DETECTION.md), [Architecture](docs/ARCHITECTURE.md), [Privacy](PRIVACY.md), and [Verification](docs/VERIFICATION.md).

MIT licensed. There are no analytics, remote model calls or runtime catalog requests.
