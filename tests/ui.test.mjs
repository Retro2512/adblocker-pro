import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const scope = { TextEncoder };
vm.createContext(scope);
vm.runInContext(readFileSync(new URL('../extension/ui/common.js', import.meta.url), 'utf8'), scope);
const { validateSettings, validHost, lines } = scope.QuietGateUI;
const valid = () => ({ enabled: true, strict: true, languages: ['hindi'], artistMatching: true, allowTracks: ['hello|adele'], blockTracks: [], phrases: [], allowedHosts: ['music.youtube.com'] });

test('settings imports accept the exact settings shape and deduplicate', () => {
  const settings = valid(); settings.languages.push('hindi');
  assert.equal(validateSettings(settings, ['hindi']).languages.length, 1);
});
test('settings imports reject arbitrary keys and malformed types', () => {
  assert.throws(() => validateSettings({ ...valid(), permission: 'all' }, ['hindi']));
  assert.throws(() => validateSettings({ ...valid(), enabled: 'true' }, ['hindi']));
  assert.throws(() => validateSettings({ ...valid(), phrases: ['\u0000'] }, ['hindi']));
  assert.throws(() => validateSettings({ ...valid(), languages: ['unknown'] }, ['hindi']));
  assert.throws(() => validateSettings({ ...valid(), allowedHosts: ['https://example.com/path'] }, ['hindi']));
  assert.throws(() => validateSettings({ ...valid(), blockTracks: ['hello|adele'] }, ['hindi']));
});
test('settings imports enforce count and byte limits', () => {
  assert.throws(() => validateSettings({ ...valid(), phrases: Array(501).fill('phrase') }, ['hindi']));
  assert.throws(() => validateSettings({ ...valid(), allowTracks: Array.from({ length: 500 }, (_, index) => `${index}${'a'.repeat(300)}`) }, ['hindi']));
});
test('domain validation does not admit paths or wildcard rules', () => {
  assert.equal(validHost('open.spotify.com'), true);
  for (const host of ['*.spotify.com', 'spotify.com/path', 'spotify.com:443', '-bad.com', 'https://spotify.com']) assert.equal(validHost(host), false);
});
test('line lists preserve phrases and remove blank lines and duplicates', () => {
  assert.deepEqual(Array.from(lines(' music \n\nnew song\r\nmusic')), ['music', 'new song']);
});
