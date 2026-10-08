# Detection

Adblocker Pro classifies current song metadata. It does not classify listeners, performers' ethnicity, citizenship, birthplace, or appearance. No audio is uploaded or transcribed. HTML page language and recommendation text are not used as song language evidence.

## Shared API

Load `extension/shared/catalog.js`, then `extension/shared/classifier.js`. They set `globalThis.QuietGateCatalog` and `globalThis.QuietGateClassifier`. The same scripts run in Chromium and in Node through side effect imports.

`normalize(value)` applies Unicode NFKC, lowercase, Latin accent normalization, punctuation replacement, and whitespace collapse. Indic vowel signs remain intact. String inputs are limited to 4096 characters. `trackKey(metadata)` returns normalized title, a pipe, and normalized artist.

`classify(metadata, settings)` returns `decision`, `reason`, `language`, `confidence`, and `evidence`. Decision is `block`, `allow`, or `unknown`. Confidence describes a rule's strength, not a calibrated probability. `DEFAULT_SETTINGS` provides the shared settings contract.

Rules run in this order:

1. Disabled filtering permits playback.
2. Explicit track block wins a conflicting track allow.
3. Explicit track allow overrides inferred evidence.
4. Supplied language tags block selected languages. Recognized tags for only other languages allow playback. BCP 47 tags such as `hi-IN`, `pa-Guru-IN`, and `en-US` fall back to a registered base language.
5. User phrase rules match whole normalized phrases in title, artist, or album.
6. Selected language labels in song title or album match a song or music cue, or an isolated label between delimiters. A selected label wins if the title has several language labels.
7. Curated song titles require a listed performer. Known performer aliases and narrow release decorations such as `(From "Album")` are accepted.
8. Gurmukhi letters in a song title supply Punjabi script evidence.
9. Recognized labels for only other song languages allow playback before performer heuristics. An English captions or lyrics label alone does not supply an English song language.
10. Optional artist catalog associations provide heuristic evidence.
11. Missing or inconclusive metadata returns `unknown`.

Strict handling belongs to the playback controller. The classifier never turns unknown metadata into a block by itself. Devanagari alone cannot distinguish Hindi, Marathi, Nepali, or other languages. Arabic script alone cannot distinguish Urdu from Arabic or Persian.

## Catalog

`data/catalog.json` mirrors the extension catalog for the Windows companion:

```json
{
  "version": 1,
  "languages": [{ "id": "hindi", "label": "Hindi", "aliases": ["hi", "hin"] }],
  "tracks": [{ "title": "Pasoori", "artists": ["Ali Sethi", "Shae Gill"], "language": "punjabi", "languages": ["punjabi", "urdu"], "aliases": [] }],
  "artists": [{ "name": "Arijit Singh", "aliases": [], "languages": ["hindi"] }]
}
```

The initial catalog contains 84 song entries and 68 performer associations. Song coverage concentrates on Hindi and Punjabi, with Bhojpuri, Haryanvi, and Urdu examples. Other selected languages rely on supplied labels, optional artist associations where available, and strict handling. Geography is not itself a language rule. Mixed recordings can supply an optional `languages` array, while `language` remains their first ID for compatibility. Any selected component blocks a mixed track.

Performer associations are intentionally separate from track records. Many listed singers perform in multiple languages. Artist matching can therefore block an untagged Tamil, Bengali, English, or instrumental recording by the same performer. Recognized song language metadata takes precedence. Disable artist matching for a more precise mode; explicit track allows handle individual exceptions.

Sample catalog references include the [official Brown Munde release](https://www.youtube.com/watch?v=VNs_cCtdbPc), the [distributed Brown Munde recording](https://www.youtube.com/watch?v=FM2ykrYbzqg), the [IPRS rights record](https://iprs.org/wp-content/uploads/2024/01/List_of_Authors_Other_Owners_for_Disclosure_Report_31st_Mar_2024.pdf), and [Coke Studio's description of Pasoori's Punjabi and Urdu lyrics](https://www.coca-cola.com/pk/en/media-center/pasoori-makes-history-1-billion-youtube-views). Kala Chashma conservatively includes Hindi and Punjabi because the Hindi film release retains Punjabi language material. Catalog entries are a local seed, not an exhaustive language database or a continuously updated service.

## Site adapters

`extension/content/adapters.js` sets `globalThis.QuietGateAdapters`, exposing `extract(document, location, bridgeMetadata)` and `supportedSites`. Extraction returns current title, artist, album, supplied language tags, music context, site ID, and a stable key. YouTube video IDs are preserved when available.

Adapters cover YouTube, YouTube Music, Spotify, Apple Music, Amazon Music, SoundCloud, Deezer, Tidal, JioSaavn, Gaana, and Bandcamp. Dedicated player selectors exclude unrelated recommendation sections. Generic extraction accepts Media Session bridge metadata and a single matching JSON LD `MusicRecording`; ambiguous structured lists are ignored.

Explicit JSON LD `inLanguage` strings, arrays, and schema `Language` objects are retained. Every supplied language component is evaluated; English plus Hindi is not mistaken for English only.

On YouTube, explicit nonmusic category metadata wins. Without a category, topic channels, official audio or video labels, song or lyric labels, and a catalog performer paired with a known title establish music context. Interview, tutorial, reaction, review, and similar cues suppress title based inference. These rules can still miss an unusually titled song or mistake a video with unusual labels; they are not audio content recognition.

On YouTube Music, broad upload categories such as Entertainment do not disable music filtering. A current track establishes music context unless its supplied category explicitly identifies a podcast, speech, spoken word or audiobook.

SoundCloud and Bandcamp active track players establish music context unless supplied category metadata identifies podcasts or speech. Untagged spoken audio on these sites can therefore be held in strict mode. Spotify and other music services may also host podcasts whose Media Session metadata omits content type.

Current DOM player title wins differing bridge metadata unless a YouTube player response identifies the video ID in the current URL. That verified response takes precedence while the player bar still shows the previous item; stale DOM artist and album fields are discarded. Without that verified identity, a title disagreement discards bridge artist, album, category and language tags. A YouTube bridge video ID that differs from the current URL invalidates the bridge record. Site markup can change; Media Session fallback remains useful when an active selector is unavailable. Tests validate synthetic player fixtures, not signed in playback against every current service.

## Verification

Run `node --test tests/classifier.test.mjs tests/adapters.test.mjs`. Fixtures cover multilingual metadata, Unicode boundaries, title collisions, explicit exceptions, uncertain scripts, performer heuristics, all registered site adapters, recommendations, spoken audio, structured metadata, stale navigation, and catalog parity.

### Source verification sample

Public responses checked on October 8, 2026 returned successful pages for the [official Brown Munde YouTube release](https://www.youtube.com/watch?v=VNs_cCtdbPc) and [Spotify recording](https://open.spotify.com/track/58f4twRnbZOOVUhMUpplJ4). The YouTube response contained Music genre metadata and initial player data. Spotify supplied a JSON LD MusicRecording without performer or language fields. Active player selectors were absent from both initial HTML responses, so these HTTP checks do not verify hydrated player DOM or actual playback.

Further primary or distribution references checked include [Sonotek's Teri Aakhya Ka Yo Kajal recording](https://www.youtube.com/watch?v=mh5J7pV1hJE), [the Apple Music D.C. Madana credit](https://music.apple.com/us/song/1666848436), [the Shazam Hello Koun credit](https://www.shazam.com/song/1491469401/hello-koun), [Raaga's Haryanvi Solid Body record](https://www.raaga.com/haryanvi/songs/solid-body-535958), [Maina's Desi Desi Na Bolya Kar release](https://www.youtube.com/watch?v=Ax4b79RUrrA), [Zee's licensed language catalog](https://www.novex.in/wp-content/uploads/2024/04/ZMC-Catalogue.pdf), and [All India Radio Jammu's Dogri artist roster](https://prasarbharati.gov.in/wp-content/uploads/music_artists/airjammu.pdf). This is a verification sample, not an individual audit of every catalog entry.
