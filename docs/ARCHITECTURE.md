# Architecture

## Browser

Manifest V3 loads two scripts at document start in every matching frame. The MAIN world gate patches HTMLMediaElement play and pause, observes source changes, suspends Web Audio contexts, and observes Media Session metadata. It starts held until the isolated controller returns a decision. Each play request gets a fresh check. Revision numbers stop an older allow decision from reopening a newer track.

The isolated controller extracts current track metadata, applies local settings and sends only a playback decision to the page gate. It does not expose stored settings through that bridge. Known music services with pending playback remain held in strict mode even before a title arrives. Unclassified YouTube playback remains held in strict mode until usable evidence or a manual exception arrives.

Blocked HTML media keeps its play promise pending, remains paused, and is muted as a second guard. An allow decision restores the previous mute value and resumes only playback that was requested. An explicit pause cancels that intent. A visible video receives a spinner in a closed shadow root. Reduced motion disables its rotation. The extension never redirects requests or alters DRM.

An MV3 worker serializes settings writes, validates patches and retains current tab status in session storage. Only this extension's UI pages may modify settings. Content scripts may report current status and read settings. The extension requests storage permission; its content script match patterns account for website access.

The popup requests only enable state and the cumulative blocked count. It receives no current title, artist, site or classification reason. The count increments when playback was requested and a titled item was held. A rolling set of 256 item hashes per frame document suppresses repeat counts across retries, toggle changes and worker restarts. Only the aggregate count persists across browser sessions. This is a playback hold metric, not an ad metric.

## Detection boundary

Classification is metadata based. Language evidence has explicit priority, manual rules are deterministic, and optional artist evidence is marked as heuristic. The browser's UI language is never a song language. Devanagari alone cannot distinguish Hindi from Marathi or Nepali. Arabic script alone cannot establish Urdu.

The page bridge is not an adversarial security boundary. A hostile site can spoof page messages, replace patched APIs or use a player outside these hooks. The extension has no administrative enforcement role. All browsing profiles, incognito settings and separate browsers are independent.

## Windows

The companion uses GlobalSystemMediaTransportControlsSessionManager to observe configured music apps. It evaluates media properties on change and on a bounded polling interval. A hold requests pause and uses ISimpleAudioVolume for matched app processes when available. It never uses the system endpoint volume interface. Owned mute states are restored when the hold ends or the companion quits normally.

Windows media metadata is not guaranteed to arrive before audio. Unsupported sessions and apps without media controls cannot be reliably classified by this mechanism. See the Windows guide for recovery and supported targets.

## Sources

[Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) documents injection timing, frames and execution worlds.

[Windows media session manager](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmanager) documents the media control API used by the companion.

[Windows app audio volume](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nn-audioclient-isimpleaudiovolume) documents per session volume control.
