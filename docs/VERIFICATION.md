# Verification

Tested on Windows on October 8, 2026 with Node 24.15.0, .NET 8 and Playwright Chromium 156. Tests used isolated browser profiles, not the owner's browser profile.

## Automated checks

| Check | Result |
| :--- | :--- |
| JavaScript unit tests | 80 passing |
| Actual Chromium extension playback fixtures | 16 passing |
| Actual extension UI and persistence tests | 15 passing |
| Published Windows executable self tests | 150 assertions passing |
| Manifest, asset and JavaScript syntax checks | Passing |
| Production npm dependency audit | No vulnerabilities reported |
| Windows media and CoreAudio discovery | Read only check passed |

Browser playback fixtures exercise pending play promises, known Hindi and Punjabi tracks, same element track changes, unknown tracks, missing metadata, explicit allow rules, mute restoration, explicit pause cancellation, Web Audio, cross origin iframes, video buffering overlay, domain exceptions, nonmusic YouTube videos and settings reloads.

UI tests exercise real worker messages, local persistence, import and export, invalid JSON shapes, size limits, exact rule removal, the minimal popup, real held playback counting, retry deduplication, toggle restoration, empty states, reset confirmation and mobile layout. Screenshots were visually inspected. Gate unit tests also cover old decision revisions, detached player cleanup, Web Audio aliases and cancellation.

Windows self tests use catalog fixtures and the production mute lease with fake audio callbacks. They verify initial mute preservation, repeated holds, volume slider changes, manual unmute, restoration, and disposal without modifying user audio. The published executable's catalog matches the source catalog.

## Public service observations

An isolated browser with the extension loaded visited the public [Brown Munde YouTube video](https://www.youtube.com/watch?v=VNs_cCtdbPc). Adblocker Pro identified Punjabi evidence from the current player metadata. The observed video stayed paused, muted and at time zero.

The public [Spotify track page](https://open.spotify.com/track/58f4twRnbZOOVUhMUpplJ4) exposed its title through structured metadata but no artist or playable media element in the logged out page. Strict mode held the unidentified track. This verifies metadata extraction, not authenticated Spotify streaming playback.

The Windows host had zero media sessions during the read only check. Live Spotify desktop pausing and mute restoration were not exercised. Other account restricted music services were tested with representative fixtures, not with live authenticated playback.

## Evidence files

Local development evidence is in `artifacts`: browser result JSON, UI result JSON, live page observations, UI screenshots, and Windows self test and API check output. These generated files are not included in the source archive.

## Before broad distribution

Test with your own accounts on every advertised service and supported browser. Include track changes, ads, podcasts, playlists, logged out pages, autoplay, preexisting mute, default audio device changes and quitting while held. Test detection precision in both strict and recognized matches modes. Store review and Windows code signing remain publisher actions.
