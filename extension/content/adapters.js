(function (root) {
  'use strict';
  const supportedSites = Object.freeze([
    { id: 'youtube', hosts: ['youtube.com', 'youtube-nocookie.com'], music: false },
    { id: 'youtubeMusic', hosts: ['music.youtube.com'], music: true },
    { id: 'spotify', hosts: ['open.spotify.com'], music: true },
    { id: 'appleMusic', hosts: ['music.apple.com'], music: true },
    { id: 'amazonMusic', hosts: ['music.amazon.com', 'music.amazon.ca', 'music.amazon.co.uk', 'music.amazon.in', 'music.amazon.de', 'music.amazon.fr', 'music.amazon.co.jp'], music: true },
    { id: 'soundcloud', hosts: ['soundcloud.com'], music: false },
    { id: 'deezer', hosts: ['deezer.com'], music: true },
    { id: 'tidal', hosts: ['listen.tidal.com'], music: true },
    { id: 'jiosaavn', hosts: ['jiosaavn.com'], music: true },
    { id: 'gaana', hosts: ['gaana.com'], music: true },
    { id: 'bandcamp', hosts: ['bandcamp.com'], music: false }
  ]);
  const selectors = {
    youtube: { title: ['#title h1.ytd-watch-metadata', 'h1.ytd-watch-metadata', 'h1.title.ytd-video-primary-info-renderer', '#info-contents h1'], artist: ['#owner #channel-name a', '#upload-info #channel-name a'] },
    youtubeMusic: { title: ['ytmusic-player-bar .title', 'ytmusic-player-bar [class~="title"]'], artist: ['ytmusic-player-bar .byline a', 'ytmusic-player-bar .subtitle a'], album: ['ytmusic-player-bar .subtitle a:nth-of-type(2)'] },
    spotify: { title: ['[data-testid="nowplaying-track-link"]', '[data-testid="context-item-info-title"]'], artist: ['[data-testid="context-item-info-artist"]', '[data-testid="now-playing-widget"] [data-testid="context-item-info-subtitles"]'], container: ['[data-testid="now-playing-widget"]'] },
    appleMusic: { title: ['.lcd-meta__primary', '[data-testid="player-track-title"]'], artist: ['.lcd-meta__secondary', '[data-testid="player-track-artist"]'], container: ['.web-chrome-playback-lcd', '.lcd-meta'] },
    amazonMusic: { title: ['music-horizontal-item[slot="primary"]', '[data-testid="mini-player-title"]', '#transport .track-title'], artist: ['[data-testid="mini-player-subtitle"]', '#transport .track-artist'], container: ['#transport', '[data-testid="mini-player"]'] },
    soundcloud: { title: ['.playbackSoundBadge__titleLink'], artist: ['.playbackSoundBadge__lightLink'], container: ['.playbackSoundBadge'] },
    deezer: { title: ['[data-testid="track_title"]', '.player-track-title'], artist: ['[data-testid="artist_name"]', '.player-track-artist'], container: ['[data-testid="player"]', '.player-bottom'] },
    tidal: { title: ['[data-test="footer-track-title"]', '[data-test="player-track-title"]'], artist: ['[data-test="footer-track-artist"]', '[data-test="player-track-artist"]'], container: ['[data-test="footer-player"]', '[data-test="player"]'] },
    jiosaavn: { title: ['.c-player__meta .c-player__title', '.c-player__song-name', '[data-testid="player-title"]'], artist: ['.c-player__meta .c-player__subtitle', '.c-player__artist', '[data-testid="player-artist"]'], container: ['.c-player'] },
    gaana: { title: ['.player .song-name', '#player .song_name', '[data-testid="player-title"]'], artist: ['.player .artist-name', '#player .artist_name', '[data-testid="player-artist"]'], container: ['.player', '#player'] },
    bandcamp: { title: ['.inline_player .title', '.play_cell.playing + .title-col .track-title', '.track_row_view.playing .track-title'], artist: ['#name-section h3 span a', '#name-section .artist'], album: ['#name-section .trackTitle'], container: ['.inline_player'] }
  };
  function string(value) { return typeof value === 'string' ? value.slice(0, 4096).trim() : ''; }
  function nodes(document, selector) { try { return Array.from(document.querySelectorAll(selector)); } catch { return []; } }
  function first(document, options = []) {
    for (const selector of options) {
      const node = nodes(document, selector)[0];
      const value = string(node?.textContent || node?.getAttribute?.('title') || node?.getAttribute?.('content'));
      if (value) return value;
    }
    return '';
  }
  function hostMatches(host, domain) { return host === domain || host.endsWith('.' + domain); }
  function siteFor(host) {
    // The dedicated music subdomain must be tested before the broad YouTube domain.
    return supportedSites.find(site => site.id === 'youtubeMusic' && site.hosts.some(domain => hostMatches(host, domain))) ||
      supportedSites.find(site => site.hosts.some(domain => hostMatches(host, domain))) || { id: 'generic', music: false };
  }
  function structured(document, title) {
    const norm = root.QuietGateClassifier?.normalize || (value => string(value).toLowerCase());
    const recordings = [];
    function visit(value, depth = 0) {
      if (!value || depth > 4) return;
      if (Array.isArray(value)) { value.slice(0, 20).forEach(item => visit(item, depth + 1)); return; }
      if (typeof value !== 'object') return;
      const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
      if (types.includes('MusicRecording')) recordings.push(value);
      if (value['@graph']) visit(value['@graph'], depth + 1);
    }
    for (const node of nodes(document, 'script[type="application/ld+json"]').slice(0, 10)) {
      if ((node.textContent?.length || 0) > 100000) continue;
      try { visit(JSON.parse(node.textContent)); } catch { /* Ignore malformed third party metadata. */ }
    }
    // No selecting the first recommended recording when the current item is unknown.
    const candidates = title ? recordings.filter(item => norm(item.name) === norm(title)) : recordings;
    if (candidates.length !== 1) return {};
    const item = candidates[0];
    const authors = Array.isArray(item.byArtist) ? item.byArtist : [item.byArtist];
    const languageValues = Array.isArray(item.inLanguage) ? item.inLanguage.slice(0, 30) : [item.inLanguage];
    const languages = languageValues.map(value => string(typeof value === 'string' ? value : value?.name || value?.alternateName)).filter(Boolean);
    return { title: string(item.name), artist: authors.map(artist => string(typeof artist === 'string' ? artist : artist?.name)).filter(Boolean).join(', '),
      album: string(typeof item.inAlbum === 'string' ? item.inAlbum : item.inAlbum?.name), language: languages[0] || '', languages, music: true };
  }
  function extract(document, location, bridgeMetadata = {}) {
    let host = string(location?.hostname).toLowerCase();
    if (!host && typeof location === 'string') { try { host = new URL(location).hostname.toLowerCase(); } catch { /* Invalid locations use generic extraction. */ } }
    const site = siteFor(host), options = selectors[site.id] || {};
    const videoSite = site.id === 'youtube' || site.id === 'youtubeMusic';
    let bridge = bridgeMetadata && typeof bridgeMetadata === 'object' ? bridgeMetadata : {};
    const domTitle = first(document, options.title);
    const norm = root.QuietGateClassifier?.normalize || (value => string(value).toLowerCase());
    let currentVideoId = '';
    try {
      const url = new URL(typeof location === 'string' ? location : location?.href || ('https://' + host + (location?.pathname || '') + (location?.search || '')));
      currentVideoId = url.searchParams.get('v') || (/^\/(?:shorts|live)\/([^/]+)/u.exec(url.pathname)?.[1] || '');
    } catch { /* Metadata extraction does not require a valid full URL. */ }
    if (bridge.videoId && currentVideoId && bridge.videoId !== currentVideoId) bridge = {};
    const mismatchedTitle = domTitle && bridge.title && norm(domTitle) !== norm(bridge.title);
    // Player response IDs establish freshness during SPA transitions. The bar
    // can still show the previously allowed item when the next item starts.
    const currentBridge = Boolean(videoSite && currentVideoId && bridge.videoId === currentVideoId && string(bridge.title));
    const bridgeDetails = currentBridge || !mismatchedTitle;
    const domDetails = !currentBridge || !mismatchedTitle;
    const activeTitle = (currentBridge ? string(bridge.title) : domTitle) || string(bridge.title);
    const ld = structured(document, activeTitle);
    const metadata = { title: activeTitle || ld.title || '', artist: (currentBridge ? string(bridge.artist) : '') || (domDetails ? first(document, options.artist) : '') || (bridgeDetails ? string(bridge.artist) : '') || ld.artist || '',
      album: (currentBridge ? string(bridge.album) : '') || (domDetails ? first(document, options.album) : '') || (bridgeDetails ? string(bridge.album) : '') || ld.album || '',
      language: (bridgeDetails ? string(bridge.language) : '') || ld.language || '',
      languages: bridgeDetails && Array.isArray(bridge.languages) ? bridge.languages.slice(0, 30).map(string).filter(Boolean) : ld.languages || [],
      music: false, site: site.id };
    const currentItem = Boolean(metadata.title);
    const category = bridgeDetails ? string(String(bridge.category ?? '')) : '';
    const musicCategory = category.toLowerCase() === 'music' || category === '10';
    const spokenCategory = /^(?:podcast|podcasts|speech|spoken word|audiobook|audiobooks)$/iu.test(category);
    // YouTube upload categories describe videos, not song content. On the
    // dedicated music service, Entertainment and localized categories must
    // not bypass filtering. Explicit spoken content remains outside scope.
    if (videoSite && (spokenCategory || (site.id === 'youtube' && category && !musicCategory))) metadata.music = false;
    else if (site.id === 'youtube') {
      const channel = first(document, ['#owner #channel-name a', '#upload-info #channel-name a']);
      const categoryNode = first(document, ['meta[itemprop="genre"]']);
      const spokenCue = /\b(?:how to|tutorial|interview|documentary|lesson|news|explained|analysis|reaction|review)\b/iu.test(metadata.title);
      const musicCue = !spokenCue && /\b(?:official\s+(?:music\s+)?(?:video|audio)|lyrics?|lyrical|songs?|music\s+video)\b/iu.test(metadata.title);
      const titleTokens = ' ' + norm(metadata.title) + ' ';
      const artistSongCue = !spokenCue && (root.QuietGateCatalog?.tracks || []).some(item =>
        [item.title, ...(item.aliases || [])].some(name => titleTokens.includes(' ' + norm(name) + ' ')) &&
        (item.artists || []).some(name => titleTokens.includes(' ' + norm(name) + ' ')));
      metadata.music = currentItem && (musicCategory || categoryNode.toLowerCase() === 'music' || /\s(?:\u2014|-)\sTopic$/u.test(channel) || musicCue || artistSongCue);
    } else metadata.music = currentItem && !spokenCategory && (site.music || ld.music === true || bridge.music === true || bridge.isMusic === true ||
      ['soundcloud', 'bandcamp'].includes(site.id) && Boolean(first(document, options.title)));
    // YouTube uses the uploader as artist. Known artist prefixes provide better song metadata.
    if (videoSite && metadata.music && metadata.title) {
      const norm = root.QuietGateClassifier?.normalize;
      const parts = metadata.title.split(/\s+[\u2013\u2014-]\s+/u);
      if (norm && parts.length === 2) {
        const knownArtist = (root.QuietGateCatalog?.artists || []).find(item => [item.name, ...(item.aliases || [])].some(name => norm(name) === norm(parts[0])));
        if (knownArtist) { metadata.artist = parts[0]; metadata.title = parts[1]; }
      }
    }
    if (string(bridge.videoId)) metadata.id = string(bridge.videoId);
    if (root.QuietGateClassifier) metadata.key = root.QuietGateClassifier.trackKey(metadata);
    return metadata;
  }
  root.QuietGateAdapters = Object.freeze({ extract, supportedSites });
})(globalThis);
