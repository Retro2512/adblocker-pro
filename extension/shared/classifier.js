(function (root) {
  'use strict';
  const LIMIT = 4096;
  const DEFAULT_SETTINGS = Object.freeze({ enabled: true, strict: true,
    languages: Object.freeze(['hindi', 'punjabi', 'urdu', 'bhojpuri', 'haryanvi', 'rajasthani', 'awadhi', 'braj', 'maithili', 'magahi', 'garhwali', 'kumaoni', 'dogri', 'kashmiri']),
    artistMatching: true, allowTracks: Object.freeze([]), blockTracks: Object.freeze([]), phrases: Object.freeze([]), allowedHosts: Object.freeze([]) });
  function bounded(value) { return typeof value === 'string' ? value.slice(0, LIMIT) : ''; }
  function normalize(value) {
    return bounded(value).normalize('NFKC').toLowerCase()
      .replace(/[\u00c0-\u024f]/g, char => char.normalize('NFD').replace(/\p{M}/gu, ''))
      .replace(/([a-z])[\u0300-\u036f]+/g, '$1')
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  }
  function trackKey(metadata) { return normalize(metadata?.title) + '|' + normalize(metadata?.artist); }
  function list(value, limit = 500) { return Array.isArray(value) ? value.slice(0, limit) : []; }
  function phrasesIn(text, phrase) { return phrase && (' ' + text + ' ').includes(' ' + phrase + ' '); }
  function titleCandidates(value) {
    const raw = bounded(value);
    const cleaned = raw.replace(/\s*\((?:from\b[^)]*|official\s+(?:music\s+)?(?:audio|video)|lyrics?|lyrical\s+video)\)\s*$/iu, '')
      .replace(/\s*\[(?:official\s+(?:music\s+)?(?:audio|video)|lyrics?|lyrical\s+video)\]\s*$/iu, '');
    return [...new Set([normalize(raw), normalize(cleaned)])];
  }
  function canonicalKey(value) {
    if (value && typeof value === 'object') return trackKey(value);
    if (typeof value !== 'string') return '';
    const at = value.indexOf('|');
    return at < 0 ? normalize(value) + '|' : normalize(value.slice(0, at)) + '|' + normalize(value.slice(at + 1));
  }
  function result(decision, reason, language = null, confidence = 0, evidence = []) {
    return { decision, reason, language, confidence, evidence };
  }
  function languageId(value, aliases) {
    const exact = aliases.get(normalize(value));
    if (exact) return exact;
    const tag = bounded(value).trim().toLowerCase();
    return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})+$/u.test(tag) ? aliases.get(tag.split('-')[0]) : undefined;
  }
  function classify(metadata = {}, supplied = {}) {
    if (!metadata || typeof metadata !== 'object') metadata = {};
    const settings = { ...DEFAULT_SETTINGS, ...supplied };
    if (!settings.enabled) return result('allow', 'disabled', null, 1);
    const key = trackKey(metadata);
    if (key !== '|') {
      if (list(settings.blockTracks).some(item => canonicalKey(item) === key)) return result('block', 'track_blocklist', null, 1, [key]);
      if (list(settings.allowTracks).some(item => canonicalKey(item) === key)) return result('allow', 'track_allowlist', null, 1, [key]);
    }
    const catalog = root.QuietGateCatalog || { languages: [], tracks: [], artists: [] };
    const aliases = new Map();
    for (const language of list(catalog.languages, 200)) {
      for (const alias of [language.id, language.label, ...list(language.aliases, 100)]) aliases.set(normalize(alias), language.id);
    }
    const selected = new Set(list(settings.languages, 200).map(value => languageId(value, aliases) || normalize(value)));
    const explicit = [...list(metadata.languages, 30), bounded(metadata.language)].filter(Boolean);
    const known = [...new Set(explicit.map(value => languageId(value, aliases)).filter(Boolean))];
    const selectedExplicit = known.find(id => selected.has(id));
    if (selectedExplicit) return result('block', 'language_metadata', selectedExplicit, 1, explicit.map(bounded));
    // A known nonselected language takes precedence over inferred catalog evidence.
    // An unrecognized tag does not establish that a song is allowed.
    if (known.length && explicit.every(value => languageId(value, aliases))) return result('allow', 'language_metadata', known[0], 1, explicit.map(bounded));
    const title = normalize(metadata.title), artist = normalize(metadata.artist), album = normalize(metadata.album);
    for (const phrase of list(settings.phrases, 200).map(normalize).filter(Boolean)) {
      if ([title, artist, album].some(text => phrasesIn(text, phrase))) return result('block', 'phrase_rule', null, 1, [phrase]);
    }
    const inferredLanguages = [];
    for (const language of list(catalog.languages, 200)) {
      // Metadata labels are evidence about a song. A page's HTML lang is never read.
      const labels = [language.label, ...list(language.aliases, 100)].map(normalize).filter(label => label.length > 3);
      for (const label of labels) {
        const tagged = [title, album].some(text =>
          ['song', 'songs', 'music', 'track', 'tracks', 'geet', 'gaana', 'gaane', 'गाना', 'गीत'].some(word => phrasesIn(text, label + ' ' + word) || phrasesIn(text, word + ' ' + label)));
        const bareLabel = [metadata.title, metadata.album].some(value => normalize(value) === label ||
          bounded(value).split(/[|()\[\]{}]/u).some(segment => normalize(segment) === label));
        if (tagged || bareLabel) { inferredLanguages.push(language); break; }
      }
    }
    const selectedLabel = inferredLanguages.find(language => selected.has(language.id));
    if (selectedLabel) return result('block', 'song_language_label', selectedLabel.id, .9, [bounded(selectedLabel.label)]);
    const candidateTitles = titleCandidates(metadata.title);
    for (const track of list(catalog.tracks, 10000)) {
      const titles = [track.title, ...list(track.aliases, 50)].map(normalize);
      if (!title || !candidateTitles.some(candidate => titles.includes(candidate))) continue;
      const artists = list(track.artists, 50).flatMap(name => {
        const canonical = normalize(name);
        const entry = list(catalog.artists, 5000).find(item => [item.name, ...list(item.aliases, 50)].some(alias => normalize(alias) === canonical));
        return [canonical, ...(entry ? [entry.name, ...list(entry.aliases, 50)].map(normalize) : [])];
      }).filter(Boolean);
      if (artists.length && !artists.some(name => phrasesIn(artist, name))) continue;
      const trackLanguages = [...new Set([track.language, ...list(track.languages, 30)].filter(Boolean))];
      const selectedTrackLanguage = trackLanguages.find(id => selected.has(id));
      if (selectedTrackLanguage) return result('block', 'catalog_track', selectedTrackLanguage, .99, [bounded(track.title), bounded(metadata.artist)]);
      return result('allow', 'catalog_track', track.language, .99, [bounded(track.title), bounded(metadata.artist)]);
    }
    if (/[\u0a05-\u0a39\u0a59-\u0a5e]/u.test(bounded(metadata.title))) {
      return result(selected.has('punjabi') ? 'block' : 'allow', 'gurmukhi_script', 'punjabi', .96, ['Gurmukhi title']);
    }
    if (inferredLanguages.length) return result('allow', 'song_language_label', inferredLanguages[0].id, .9, [bounded(inferredLanguages[0].label)]);
    if (settings.artistMatching && artist) {
      for (const entry of list(catalog.artists, 5000)) {
        const name = [entry.name, ...list(entry.aliases, 50)].map(normalize).find(value => phrasesIn(artist, value));
        if (!name) continue;
        const language = list(entry.languages, 30).find(id => selected.has(id));
        if (language) return result('block', 'artist_heuristic', language, .72, ['Artist catalog heuristic', bounded(entry.name)]);
      }
    }
    return result('unknown', title || artist ? 'insufficient_language_evidence' : 'missing_metadata');
  }
  root.QuietGateClassifier = Object.freeze({ normalize, trackKey, classify, DEFAULT_SETTINGS });
})(globalThis);
