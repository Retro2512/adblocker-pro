(function () {
  'use strict';
  const MAX_IMPORT_BYTES = 100 * 1024;
  const settingKeys = ['enabled', 'strict', 'languages', 'artistMatching', 'allowTracks', 'blockTracks', 'phrases', 'allowedHosts'];
  async function request(message) {
    if (!globalThis.chrome?.runtime?.sendMessage) throw new Error('Adblocker Pro is unavailable. Reopen this page.');
    const response = await chrome.runtime.sendMessage(message);
    if (!response || response.error) throw new Error(response?.error || 'Could not save. Try again.');
    return response;
  }
  function feedback(message, error = false) {
    const node = document.getElementById('feedback');
    node.textContent = message;
    node.dataset.error = String(error);
  }
  function lines(value) { return [...new Set(value.split(/\r?\n/).map(line => line.trim()).filter(Boolean))]; }
  function validateSettings(value, languageIds) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose a Adblocker Pro settings file.');
    if (Object.keys(value).some(key => !settingKeys.includes(key)) || settingKeys.some(key => !Object.hasOwn(value, key))) throw new Error('This file has invalid settings.');
    for (const key of ['enabled', 'strict', 'artistMatching']) if (typeof value[key] !== 'boolean') throw new Error('This file has invalid settings.');
    for (const key of ['languages', 'allowTracks', 'blockTracks', 'phrases', 'allowedHosts']) {
      const limit = key === 'languages' ? 100 : 500;
      const maxLength = key === 'allowedHosts' ? 253 : 500;
      if (!Array.isArray(value[key]) || value[key].length > limit || value[key].some(item => typeof item !== 'string' || !item.trim() || item.length > maxLength || /[\u0000-\u001f\u007f]/u.test(item))) throw new Error('This file has invalid settings.');
    }
    if (value.languages.some(id => !languageIds.includes(id))) throw new Error('This file has an unknown language.');
    if (value.allowedHosts.some(host => !validHost(host))) throw new Error('Enter domains only, without paths.');
    if (value.allowTracks.some(key => value.blockTracks.includes(key))) throw new Error('A track cannot be both allowed and blocked.');
    const clean = Object.fromEntries(settingKeys.map(key => [key, Array.isArray(value[key]) ? [...new Set(value[key].map(item => item.trim()))] : value[key]]));
    if (new TextEncoder().encode(JSON.stringify(clean)).length > MAX_IMPORT_BYTES) throw new Error('Choose a file smaller than 100 KB.');
    return clean;
  }
  function validHost(host) {
    return host.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(host);
  }
  globalThis.QuietGateUI = { request, feedback, lines, validateSettings, validHost, MAX_IMPORT_BYTES };
})();
