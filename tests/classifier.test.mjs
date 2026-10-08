import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../extension/shared/catalog.js';
import '../extension/shared/classifier.js';
const { normalize, trackKey, classify, DEFAULT_SETTINGS } = globalThis.QuietGateClassifier;
const balanced = { ...DEFAULT_SETTINGS, strict: false, artistMatching: false };

test('normalization retains Indic vowel signs and strips Latin accents', () => {
  assert.equal(normalize('  BÉYONCÉ — Déjà Vu! '), 'beyonce deja vu');
  assert.equal(normalize('हिंदी! ਪੰਜਾਬੀ'), 'हिंदी ਪੰਜਾਬੀ');
  assert.equal(normalize('ＭＵＳＩＣ'), 'music');
  assert.equal(normalize(42), '');
  assert.equal(normalize('a'.repeat(5000)).length, 4096);
});
test('stable key uses title and performer', () => assert.equal(trackKey({ title: 'Tum Hi Ho!', artist: 'ARIJIT Singh' }), 'tum hi ho|arijit singh'));
test('manual block wins conflicting allow', () => {
  const track = { title: 'New Song', artist: 'Artist' };
  assert.equal(classify(track, { allowTracks: [trackKey(track)], blockTracks: [trackKey(track)] }).reason, 'track_blocklist');
});
test('manual allow wins selected language and artist evidence', () => {
  const track = { title: 'Kesariya', artist: 'Arijit Singh', language: 'Hindi' };
  assert.equal(classify(track, { allowTracks: [track] }).decision, 'allow');
});
test('blank manual key cannot block missing metadata', () => assert.equal(classify({}, { blockTracks: ['|'] }).decision, 'unknown'));
test('known Hindi and Punjabi tracks resolve without artist heuristics', () => {
  assert.equal(classify({ title: 'Kesariya', artist: 'Arijit Singh' }, balanced).language, 'hindi');
  assert.equal(classify({ title: 'Brown Munde', artist: 'AP Dhillon, Gurinder Gill' }, balanced).reason, 'catalog_track');
  assert.equal(classify({ title: '५२', artist: 'Nobody' }, balanced).decision, 'unknown');
});
test('regional catalog songs resolve', () => {
  for (const [title, artist, language] of [
    ['52 Gaj Ka Daman', 'Renuka Panwar', 'haryanvi'],
    ['Lollypop Lageli', 'Pawan Singh', 'bhojpuri'],
    ['Aaj Jane Ki Zid Na Karo', 'Farida Khanum', 'urdu']
  ]) assert.equal(classify({ title, artist }, balanced).language, language);
});
test('source confirmed regional performer spellings resolve without heuristics', () => {
  assert.equal(classify({ title: 'Teri Aakhya Ka Yo Kajal', artist: 'D.C. Madana' }, balanced).reason, 'catalog_track');
  assert.equal(classify({ title: 'Hello Koun', artist: 'Sneh Updhayaya' }, balanced).language, 'bhojpuri');
});
test('curated common title cannot match unrelated artist', () => {
  assert.equal(classify({ title: 'Lover', artist: 'Taylor Swift' }, balanced).decision, 'unknown');
  assert.equal(classify({ title: 'Lemonade', artist: 'Beyoncé' }, balanced).decision, 'unknown');
  assert.equal(classify({ title: 'No Love', artist: 'Eminem' }, balanced).decision, 'unknown');
});
test('curated titles accept known release decorations and performer aliases', () => {
  assert.equal(classify({ title: 'Tum Hi Ho (From "Aashiqui 2")', artist: 'Arijit Singh' }, balanced).reason, 'catalog_track');
  assert.equal(classify({ title: 'Brown Munde [Official Audio]', artist: 'A P Dhillon' }, balanced).reason, 'catalog_track');
  assert.equal(classify({ title: 'Lover (English Version)', artist: 'Taylor Swift' }, balanced).decision, 'unknown');
});
test('explicit selected language blocks aliases and IDs', () => {
  for (const language of ['Hindi', 'hi', 'हिन्दी', 'pa', 'ਪੰਜਾਬੀ', 'bho']) assert.equal(classify({ title: 'Untitled', language }, balanced).decision, 'block');
});
test('explicit BCP 47 tags resolve registered base languages', () => {
  for (const language of ['hi-IN', 'pa-Guru-IN', 'ur-PK', 'bho-IN']) assert.equal(classify({ title: 'Untitled', language }, balanced).decision, 'block');
  for (const language of ['en-US', 'ta-IN', 'bn-BD', 'pt-BR']) assert.equal(classify({ title: 'Untitled', language }, balanced).decision, 'allow');
  for (const language of ['hi something', 'xx-IN', 'unknown-english', 'English Captions']) assert.equal(classify({ title: 'Untitled', language }, balanced).decision, 'unknown');
});
test('other explicit languages override multilingual artist heuristics', () => {
  for (const language of ['English', 'Tamil', 'বাংলা', 'मराठी', 'नेपाली', 'zxx']) assert.equal(classify({ title: 'A recording', artist: 'Shreya Ghoshal', language }).decision, 'allow');
});
test('duplicate recognized language tags are valid', () => assert.equal(classify({ language: 'en', languages: ['English'] }).decision, 'allow'));
test('mixed selected and other languages block', () => assert.equal(classify({ languages: ['English', 'Punjabi'] }).language, 'punjabi'));
test('unknown language does not authorize allow', () => assert.equal(classify({ language: 'xx' }, balanced).decision, 'unknown'));
test('UI language never supplies song language', () => assert.equal(classify({ title: 'Hello', artist: 'Adele', htmlLang: 'hi', pageLanguage: 'Hindi' }, balanced).decision, 'unknown'));
test('Gurmukhi title is Punjabi evidence', () => assert.equal(classify({ title: 'ਪੰਜਾਬੀ ਗੀਤ', artist: 'Unknown' }, balanced).language, 'punjabi'));
test('Devanagari alone is not definitive Hindi', () => assert.equal(classify({ title: 'मन उधाण वाऱ्याचे', artist: 'Unknown' }, balanced).decision, 'unknown'));
test('Arabic script alone cannot distinguish Urdu from Arabic', () => assert.equal(classify({ title: 'مرحبا', artist: 'Unknown' }, balanced).decision, 'unknown'));
test('phrase rules have Unicode and token boundaries', () => {
  assert.equal(classify({ title: 'Punctuation example' }, { ...balanced, languages: [], phrases: ['pun'] }).decision, 'unknown');
  assert.equal(classify({ title: 'A हिंदी गीत' }, { ...balanced, languages: [], phrases: ['हिंदी गीत'] }).reason, 'phrase_rule');
  assert.equal(classify({ title: 'TITLE' }, { ...balanced, phrases: ['  '] }).decision, 'unknown');
});
test('song labels work in title and album without matching language fragments', () => {
  assert.equal(classify({ title: 'New Hindi Song 2026', artist: 'Unknown' }, balanced).reason, 'song_language_label');
  assert.equal(classify({ title: 'Example | Punjabi | Official Audio' }, balanced).language, 'punjabi');
  assert.equal(classify({ title: 'Example', album: 'Bhojpuri Songs' }, balanced).language, 'bhojpuri');
  assert.equal(classify({ title: 'The Hindigo Song', artist: 'Unknown' }, balanced).decision, 'unknown');
  assert.equal(classify({ title: 'Punjabi MC interview' }, balanced).decision, 'unknown');
});
test('nonselected song labels precede performer heuristics but not curated tracks', () => {
  assert.equal(classify({ title: 'A new Tamil Song', artist: 'Shreya Ghoshal' }).decision, 'allow');
  assert.equal(classify({ title: 'Example (English)', artist: 'Arijit Singh' }).language, 'english');
  assert.equal(classify({ title: 'Example', album: 'Bengali Songs', artist: 'Arijit Singh' }).decision, 'allow');
  assert.equal(classify({ title: 'Tum Hi Ho', album: 'English Songs', artist: 'Arijit Singh' }).reason, 'catalog_track');
  assert.equal(classify({ title: 'Example English lyrics', artist: 'Arijit Singh' }).reason, 'artist_heuristic');
  assert.equal(classify({ title: 'Example (Hindi) | English Song', artist: 'Unknown' }).decision, 'block');
});
test('mixed catalog language blocks any selected component', () => {
  for (const [title, artist, selected] of [['Pasoori', 'Ali Sethi', 'urdu'], ['Pasoori', 'Shae Gill', 'punjabi'], ['Kala Chashma', 'Amar Arshi', 'punjabi'], ['Kala Chashma', 'Neha Kakkar', 'hindi']]) {
    assert.equal(classify({ title, artist }, { ...balanced, languages: [selected] }).language, selected);
  }
  assert.equal(classify({ title: 'Pasoori', artist: 'Ali Sethi' }, { ...balanced, languages: ['hindi'] }).decision, 'allow');
});
test('artist heuristic is identified and optional', () => {
  const track = { title: 'An uncatalogued song', artist: 'Diljit Dosanjh' };
  const answer = classify(track);
  assert.equal(answer.reason, 'artist_heuristic');
  assert.ok(answer.confidence < .8);
  assert.ok(answer.evidence.includes('Artist catalog heuristic'));
  assert.equal(classify(track, balanced).decision, 'unknown');
});
test('artist name token boundaries prevent substrings', () => assert.equal(classify({ title: 'Hello', artist: 'Shubham Smith' }).decision, 'unknown'));
test('unselected catalog language is allowed', () => assert.equal(classify({ title: 'Brown Munde', artist: 'AP Dhillon' }, { languages: ['hindi'], artistMatching: false }).decision, 'allow'));
test('strict is a caller policy, not automatic classifier denial', () => assert.equal(classify({ title: 'Unknown', artist: 'Unknown' }, { strict: true }).decision, 'unknown'));
test('disabled classifier always allows', () => assert.equal(classify({ title: 'Kesariya', artist: 'Arijit Singh' }, { enabled: false }).decision, 'allow'));
test('missing or malformed inputs are safe', () => {
  for (const metadata of [null, undefined, '', { title: 4, artist: {}, language: [] }]) assert.equal(classify(metadata).decision, 'unknown');
});
test('packaged Windows catalog mirrors extension data exactly', () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(new URL('../data/catalog.json', import.meta.url))), globalThis.QuietGateCatalog);
});
