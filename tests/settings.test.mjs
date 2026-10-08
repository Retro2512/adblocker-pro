import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../extension/shared/catalog.js';
import '../extension/shared/classifier.js';
import '../extension/shared/settings.js';
const settings = globalThis.QuietGateSettings;
test('north defaults never accidentally select every catalog language', () => {
  assert(settings.defaults().languages.includes('hindi'));
  assert(!settings.defaults().languages.includes('english'));
  assert(!settings.defaults().languages.includes('tamil'));
});
test('settings reject invalid types, oversized inputs and unknown keys', () => {
  for (const patch of [{enabled: 'yes'}, {strict: 1}, {allowTracks: 'a'}, {languages: ['invented']}, {extra: true}, {phrases: Array(501).fill('x')}]) assert.throws(() => settings.sanitize(patch));
  assert.throws(() => settings.sanitize({allowedHosts: ['https://youtube.com/path']}));
  assert.deepEqual(settings.sanitize({languages: ['tamil']}).languages, ['tamil']);
});
test('host exceptions cover subdomains but not deceptive suffixes', () => {
  const value = settings.sanitize({allowedHosts: ['Spotify.com']});
  assert.equal(settings.hostAllowed('open.spotify.com', value), true);
  assert.equal(settings.hostAllowed('notspotify.com', value), false);
  assert.equal(settings.hostAllowed('spotify.com.evil.test', value), false);
});
test('sanitization copies and deduplicates rule lists', () => {
  const input = ['word', ' word ', ''];
  assert.deepEqual(settings.sanitize({phrases: input}).phrases, ['word']);
  assert.equal(input.length, 3);
});
test('inherited object names are not recognized settings', () => {
  assert.throws(() => settings.sanitize({constructor: true}));
  assert.throws(() => settings.sanitize(JSON.parse('{"__proto__":{}}')));
});
test('track imports canonicalize keys and reject normalized conflicts', () => {
  assert.deepEqual(settings.sanitize({allowTracks: ['TUM HI HO|Arijit Singh']}).allowTracks, ['tum hi ho|arijit singh']);
  assert.throws(() => settings.sanitize({allowTracks: ['TUM HI HO|Arijit Singh'], blockTracks: ['tum hi ho|arijit singh']}));
  assert.throws(() => settings.sanitize({blockTracks: ['|']}));
});
