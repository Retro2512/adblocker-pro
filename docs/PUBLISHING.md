# Publishing

## Release files

Run the checks and Windows publish command before creating the archives.

```powershell
npm ci
npm test
npm run check
npm run test:browser
node tests/ui-browser.mjs
dotnet publish windows/QuietGate.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -o windows/publish-adblocker-pro
npm run package
```

`dist` contains AdblockerPro-browser.zip, AdblockerPro-windows-x64.zip, AdblockerPro-source.zip and SHA256 checksums. The browser archive puts manifest.json and INSTALL.txt at its root and is usable by extracting it and choosing Load unpacked. The source archive excludes dependencies, build intermediates, generated screenshots and browser profiles.

## Browser stores

Upload the Chromium archive through your own Chrome Web Store or Edge Addons developer account. Supply a public privacy policy URL pointing to the contents of PRIVACY.md, support contact details, screenshots from the packaged version and your own publisher identity. Store acceptance requires review and is not implied by a successful local build.

Suggested listing title: **Adblocker Pro**

Suggested summary: **Hold selected music languages before playback with local track rules.**

Suggested description:

> Choose which music languages to hold on supported music sites. Adblocker Pro checks the current title, artist and available language metadata locally. Matching video stays paused with a loading indicator. Allow individual tracks, add custom words, or allow a site. Strict mode also holds unidentified tracks, including songs in other languages. Artist matching is optional. No audio recording, account or remote service is used.

Single purpose: local language based filtering of music playback.

Permission rationale: storage retains chosen settings and track exceptions. Website access is required to inspect current player metadata and hold media in pages and embedded frames. No remote code is loaded. Do not describe the extension as detecting every song or guaranteeing complete coverage.

## Windows distribution

The portable executable is unsigned. Public distribution should use your own code signing certificate and a reproducible release workflow. Do not disable SmartScreen or antivirus checks. The app needs no administrator permissions, service registration or startup task. Include the catalog, MIT license and Windows guide with the executable.

## Source release

The public repository is [Retro2512/adblocker-pro](https://github.com/Retro2512/adblocker-pro). Release assets are distributed through GitHub Releases. Browser store publication is separate. Do not include local browser profiles, `node_modules`, personal settings, signing keys or account credentials in future releases.
