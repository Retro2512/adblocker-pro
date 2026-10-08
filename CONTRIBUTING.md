# Contributing

Keep changes local, deterministic and covered by tests. Add a failing regression before changing playback intent, mute restoration or track transitions.

Catalog changes belong in `data/catalog.json` and the matching `extension/shared/catalog.js` wrapper. Preserve factual song language evidence and include sources in the pull request. Mixed language songs can have more than one language. Do not classify artists by nationality or assume every song by a multilingual performer has one language.

Adapter changes must select only the current player, not recommendations, playlists or page language. Add fixtures for stale metadata and nonmusic content. Test the real service separately with an account you control.

Run `npm test`, `npm run check`, browser tests and Windows self tests before a release. Do not commit generated profiles or listening metadata.
