import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import '../extension/shared/catalog.js';
import '../extension/shared/classifier.js';
import '../extension/content/adapters.js';
const { extract, supportedSites } = globalThis.QuietGateAdapters;
function read(html, url, bridge = {}) {
  const dom = new JSDOM(html, { url });
  return extract(dom.window.document, dom.window.location, bridge);
}
test('YouTube extracts active watch title, not recommendations', () => {
  const track = read('<div id="title"><h1 class="ytd-watch-metadata">Hello</h1></div><div id="owner"><div id="channel-name"><a>Adele</a></div></div><aside>Hindi Song Arijit Singh</aside>', 'https://www.youtube.com/watch?v=one', { category: 'Music', videoId: 'one' });
  assert.equal(track.title, 'Hello'); assert.equal(track.artist, 'Adele'); assert.equal(track.music, true); assert.equal(track.id, 'one');
});
test('explicit nonmusic YouTube category wins song title cues', () => {
  assert.equal(read('<div id="title"><h1 class="ytd-watch-metadata">New Hindi Song tutorial</h1></div>', 'https://www.youtube.com/watch?v=a', { category: 'Education' }).music, false);
});
test('YouTube topic channel is music context', () => assert.equal(read('<div id="title"><h1 class="ytd-watch-metadata">Kesariya</h1></div><div id="owner"><div id="channel-name"><a>Arijit Singh - Topic</a></div></div>', 'https://www.youtube.com/watch?v=a').music, true));
test('YouTube artist plus catalog song title or official music cue establishes music', () => {
  for (const title of ['Arijit Singh - Tum Hi Ho', 'Example (Official Audio)', 'New Punjabi Song', 'Example lyrics']) {
    assert.equal(read(`<div id="title"><h1 class="ytd-watch-metadata">${title}</h1></div>`, 'https://www.youtube.com/watch?v=a').music, true);
  }
});
test('interview or tutorial without category is not inferred music', () => {
  for (const title of ['Arijit Singh interview', 'How to add lyrics to video', 'Brown Munde AP Dhillon reaction']) {
    assert.equal(read(`<div id="title"><h1 class="ytd-watch-metadata">${title}</h1></div>`, 'https://www.youtube.com/watch?v=a').music, false);
  }
});
test('known YouTube artist prefix can separate song title', () => {
  const track = read('<div id="title"><h1 class="ytd-watch-metadata">Arijit Singh - Tum Hi Ho</h1></div>', 'https://www.youtube.com/watch?v=a');
  assert.equal(track.title, 'Tum Hi Ho'); assert.equal(track.artist, 'Arijit Singh');
});
test('YouTube Music adapter wins broader YouTube host', () => {
  const track = read('<ytmusic-player-bar><span class="title">Brown Munde</span><span class="byline"><a>AP Dhillon</a></span></ytmusic-player-bar>', 'https://music.youtube.com/watch?v=a');
  assert.equal(track.site, 'youtubeMusic'); assert.equal(track.music, true); assert.equal(track.artist, 'AP Dhillon');
});
test('YouTube Music treats music uploads as music regardless of broad video category', () => {
  const html = '<ytmusic-player-bar><span class="title">Jugnu</span><span class="byline"><a>Badshah</a><a>Jugnu</a></span></ytmusic-player-bar>';
  for (const category of ['Entertainment', 'People & Blogs', 'संगीत']) {
    const track = read(html, 'https://music.youtube.com/watch?v=current', { title: 'Jugnu', artist: 'Badshah', category, videoId: 'current' });
    assert.equal(track.site, 'youtubeMusic');
    assert.equal(track.music, true, category);
    assert.equal(globalThis.QuietGateClassifier.classify(track).decision, 'block', category);
  }
});
test('YouTube Music preserves explicit podcast and spoken word context', () => {
  const html = '<ytmusic-player-bar><span class="title">Episode 1</span><span class="byline"><a>Badshah</a></span></ytmusic-player-bar>';
  for (const category of ['Podcast', 'Spoken Word']) {
    assert.equal(read(html, 'https://music.youtube.com/watch?v=current', { category, videoId: 'current' }).music, false, category);
  }
});
test('fresh identified YouTube Music bridge wins stale player bar metadata', () => {
  const html = '<ytmusic-player-bar><span class="title">English Song</span><span class="byline"><a>Old Performer</a></span><span class="subtitle"><a>Old Performer</a><a>Old Album</a></span></ytmusic-player-bar>';
  const track = read(html, 'https://music.youtube.com/watch?v=current', { videoId: 'current', title: 'Tum Hi Ho', artist: 'Arijit Singh', album: 'Aashiqui 2', category: 'Music' });
  assert.equal(track.title, 'Tum Hi Ho'); assert.equal(track.artist, 'Arijit Singh'); assert.equal(track.album, 'Aashiqui 2');
  assert.equal(track.id, 'current'); assert.equal(globalThis.QuietGateClassifier.classify(track).decision, 'block');
});
test('fresh identified bridge cannot inherit stale artist or album when fields are empty', () => {
  const html = '<ytmusic-player-bar><span class="title">English Song</span><span class="byline"><a>Old Performer</a></span><span class="subtitle"><a>Old Performer</a><a>English Songs</a></span></ytmusic-player-bar>';
  const track = read(html, 'https://music.youtube.com/watch?v=current', { videoId: 'current', title: 'New Uncatalogued Recording', artist: '', album: '', category: 'Music' });
  assert.equal(track.title, 'New Uncatalogued Recording'); assert.equal(track.artist, ''); assert.equal(track.album, '');
  assert.equal(track.music, true); assert.equal(globalThis.QuietGateClassifier.classify(track).decision, 'unknown');
});
test('unidentified YouTube Music bridge retains current DOM preference', () => {
  const html = '<ytmusic-player-bar><span class="title">Hello</span><span class="byline"><a>Adele</a></span><span class="subtitle"><a>Adele</a><a>25</a></span></ytmusic-player-bar>';
  const track = read(html, 'https://music.youtube.com/watch?v=current', { title: 'Tum Hi Ho', artist: 'Arijit Singh', album: 'Aashiqui 2', category: 'Music' });
  assert.equal(track.title, 'Hello'); assert.equal(track.artist, 'Adele'); assert.equal(track.album, '25'); assert.equal(track.id, undefined);
});
test('Spotify active metadata is independent of recommendation text', () => {
  const track = read('<a data-testid="nowplaying-track-link">Hello</a><a data-testid="context-item-info-artist">Adele</a><main><h1>Kesariya</h1><p>Arijit Singh</p></main>', 'https://open.spotify.com/');
  assert.equal(track.title, 'Hello'); assert.equal(track.artist, 'Adele'); assert.equal(track.music, true);
});
test('current DOM metadata wins stale media session', () => {
  const track = read('<a data-testid="nowplaying-track-link">Hello</a><a data-testid="context-item-info-artist">Adele</a>', 'https://open.spotify.com/', { title: 'Kesariya', artist: 'Arijit Singh', language: 'hi', album: 'Old album' });
  assert.equal(track.title, 'Hello'); assert.equal(track.artist, 'Adele'); assert.equal(track.language, ''); assert.equal(track.album, '');
});
test('stale YouTube video identifier invalidates bridge metadata', () => {
  const track = read('<div id="title"><h1 class="ytd-watch-metadata">Programming tutorial</h1></div>', 'https://www.youtube.com/watch?v=current', { title: 'Kesariya', artist: 'Arijit Singh', category: 'Music', videoId: 'old' });
  assert.equal(track.music, false); assert.equal(track.artist, ''); assert.equal(track.id, undefined);
});
test('music services can use media session metadata', () => {
  for (const url of ['https://music.apple.com/', 'https://music.amazon.ca/', 'https://www.deezer.com/', 'https://listen.tidal.com/', 'https://www.jiosaavn.com/', 'https://gaana.com/']) {
    const track = read('', url, { title: 'Kesariya', artist: 'Arijit Singh' });
    assert.equal(track.title, 'Kesariya'); assert.equal(track.music, true);
  }
});
test('active player adapters cover other music sites', () => {
  const fixtures = [
    ['https://music.apple.com/', '<div class="lcd-meta__primary">Hello</div><div class="lcd-meta__secondary">Adele</div>', 'appleMusic'],
    ['https://music.amazon.com/', '<div data-testid="mini-player-title">Hello</div><div data-testid="mini-player-subtitle">Adele</div>', 'amazonMusic'],
    ['https://www.deezer.com/', '<div class="player-track-title">Hello</div><div class="player-track-artist">Adele</div>', 'deezer'],
    ['https://listen.tidal.com/', '<div data-test="footer-track-title">Hello</div><div data-test="footer-track-artist">Adele</div>', 'tidal'],
    ['https://www.jiosaavn.com/', '<div class="c-player__song-name">Hello</div><div class="c-player__artist">Adele</div>', 'jiosaavn'],
    ['https://gaana.com/', '<div class="player"><div class="song-name">Hello</div><div class="artist-name">Adele</div></div>', 'gaana'],
    ['https://soundcloud.com/', '<div class="playbackSoundBadge__titleLink">Hello</div><div class="playbackSoundBadge__lightLink">Adele</div>', 'soundcloud'],
    ['https://artist.bandcamp.com/', '<div class="inline_player"><span class="title">Hello</span></div><div id="name-section"><span class="artist">Adele</span></div>', 'bandcamp']
  ];
  for (const [url, html, site] of fixtures) { const track = read(html, url); assert.equal(track.title, 'Hello'); assert.equal(track.artist, 'Adele'); assert.equal(track.site, site); assert.equal(track.music, true); }
});
test('explicit podcast or speech category disables audio music inference', () => {
  assert.equal(read('<a class="playbackSoundBadge__titleLink">Episode 1</a>', 'https://soundcloud.com/', { category: 'Podcast' }).music, false);
  assert.equal(read('', 'https://open.spotify.com/', { title: 'Episode 1', category: 'Speech' }).music, false);
});
test('dedicated service with no current track is not music context', () => assert.equal(read('<h1>Hindi Songs</h1>', 'https://open.spotify.com/').music, false));
test('generic structured music recording excludes webpage UI language', () => {
  const track = read('<html lang="hi"><script type="application/ld+json">{"@type":"MusicRecording","name":"Hello","byArtist":{"name":"Adele"},"inLanguage":"en"}</script></html>', 'https://example.org/');
  assert.equal(track.site, 'generic'); assert.equal(track.music, true); assert.equal(track.language, 'en'); assert.equal(track.artist, 'Adele');
});
test('structured language arrays preserve every selected language component', () => {
  const track = read('<script type="application/ld+json">{"@type":"MusicRecording","name":"Example","byArtist":{"name":"Artist"},"inLanguage":["en-US",{"@type":"Language","name":"Hindi"}]}</script>', 'https://example.org/');
  assert.deepEqual(track.languages, ['en-US', 'Hindi']);
  assert.equal(track.language, 'en-US');
  assert.equal(globalThis.QuietGateClassifier.classify(track).language, 'hindi');
});
test('structured Language objects can supply a language code', () => {
  const track = read('<script type="application/ld+json">{"@type":"MusicRecording","name":"Example","inLanguage":{"@type":"Language","alternateName":"ta-IN"}}</script>', 'https://example.org/');
  assert.equal(track.language, 'ta-IN');
  assert.equal(globalThis.QuietGateClassifier.classify(track).decision, 'allow');
});
test('ambiguous or malformed structured recommendations are ignored', () => {
  const html = '<script type="application/ld+json">bad json</script><script type="application/ld+json">[{"@type":"MusicRecording","name":"Kesariya"},{"@type":"MusicRecording","name":"Brown Munde"}]</script><h1>Hindi music</h1>';
  const track = read(html, 'https://example.org/'); assert.equal(track.title, ''); assert.equal(track.music, false);
});
test('structured recordings cannot replace active item with recommendation', () => {
  const track = read('<script type="application/ld+json">{"@type":"MusicRecording","name":"Kesariya","byArtist":{"name":"Arijit Singh"},"inLanguage":"hi"}</script>', 'https://example.org/', { title: 'Hello', artist: 'Adele', music: true });
  assert.equal(track.title, 'Hello'); assert.equal(track.artist, 'Adele'); assert.equal(track.language, '');
});
test('lookalike domain is not a supported site', () => assert.equal(read('', 'https://open.spotify.com.evil.example/', { title: 'Hello' }).site, 'generic'));
test('metadata lengths and lists are bounded', () => {
  const track = read('', 'https://open.spotify.com/', { title: 'x'.repeat(5000), languages: Array(100).fill('en') });
  assert.equal(track.title.length, 4096); assert.equal(track.languages.length, 30);
});
test('all required music services are registered', () => assert.equal(supportedSites.length, 11));
