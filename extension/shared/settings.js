(() => {
  'use strict';
  const listKeys = ['allowTracks', 'blockTracks', 'phrases', 'allowedHosts'];
  function defaults() {
    return {
      enabled: true, strict: true, artistMatching: true,
      languages: [...(globalThis.QuietGateClassifier?.DEFAULT_SETTINGS.languages || [])],
      allowTracks: [], blockTracks: [], phrases: [], allowedHosts: []
    };
  }
  function cleanList(value, limit = 500, length = 500) {
    if (!Array.isArray(value)) throw new TypeError('Expected a list');
    if (value.length > limit) throw new TypeError('Too many rules');
    return [...new Set(value.map(x => {
      if (typeof x !== 'string' || x.length > length) throw new TypeError('Invalid rule');
      return x.normalize('NFKC').trim();
    }).filter(Boolean))];
  }
  function sanitize(patch, base = defaults()) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('Invalid settings');
    const result = {...defaults(), ...base};
    for (const key of Object.keys(patch)) {
      if (!Object.hasOwn(defaults(), key)) throw new TypeError('Unknown setting: ' + key);
      if (['enabled', 'strict', 'artistMatching'].includes(key)) {
        if (typeof patch[key] !== 'boolean') throw new TypeError('Invalid switch');
        result[key] = patch[key];
      } else if (key === 'languages') {
        const supported = new Set((globalThis.QuietGateCatalog?.languages || []).map(x => x.id));
        result.languages = cleanList(patch.languages, 64, 30);
        if (result.languages.some(id => !supported.has(id))) throw new TypeError('Unknown language');
      } else if (listKeys.includes(key)) {
        result[key] = cleanList(patch[key]);
        if (key === 'allowTracks' || key === 'blockTracks') {
          result[key] = [...new Set(result[key].map(value => {
            const at = value.indexOf('|');
            if (at < 0) throw new TypeError('Track rules need a title and artist separated by |');
            const normalized = globalThis.QuietGateClassifier.trackKey({title: value.slice(0, at), artist: value.slice(at + 1)});
            if (normalized === '|') throw new TypeError('Empty track rule');
            return normalized;
          }))];
        }
        if (key === 'allowedHosts') {
          result[key] = result[key].map(x => x.toLowerCase().replace(/^\*\./, ''));
          if (result[key].some(x => !/^(?:localhost|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]+)$/.test(x))) {
            throw new TypeError('Enter domains without paths');
          }
        }
      }
    }
    if (result.allowTracks.some(key => result.blockTracks.includes(key))) throw new TypeError('A track cannot be both allowed and blocked');
    return result;
  }
  function hostAllowed(hostname, settings) {
    const host = String(hostname).toLowerCase();
    return settings.allowedHosts.some(x => host === x || host.endsWith('.' + x));
  }
  globalThis.QuietGateSettings = {defaults, sanitize, hostAllowed};
})();
