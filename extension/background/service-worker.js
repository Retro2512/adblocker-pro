'use strict';
importScripts('../shared/catalog.js', '../shared/classifier.js', '../shared/settings.js', '../shared/counter.js');
const Settings = globalThis.QuietGateSettings;
let writeQueue = Promise.resolve();
let statusQueue = Promise.resolve();
async function readSettings() {
  const {settings} = await chrome.storage.local.get('settings');
  try { return Settings.sanitize(settings || {}); } catch { return Settings.defaults(); }
}
function writeSettings(update) {
  const operation = writeQueue.then(async () => {
    const settings = await update(await readSettings());
    await chrome.storage.local.set({settings});
    return {settings};
  });
  writeQueue = operation.catch(() => {});
  return operation;
}
chrome.runtime.onInstalled.addListener(async () => {
  const settings = await readSettings();
  await chrome.storage.local.set({settings});
});
chrome.tabs.onRemoved.addListener(async tabId => {
  const entries = await chrome.storage.session.get(null);
  const keys = Object.keys(entries).filter(key => key === 'tab:' + tabId || key.startsWith('count:' + tabId + ':'));
  await chrome.storage.session.remove(keys);
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const handle = async () => {
    if (!message || typeof message.type !== 'string') throw new Error('Invalid request');
    const fromUI = sender.id === chrome.runtime.id &&
      sender.url?.startsWith(chrome.runtime.getURL('ui/'));
    if (message.type === 'STATUS' && sender.tab) {
      const data = message.status || {};
      const status = {};
      for (const key of ['title', 'artist', 'site', 'decision', 'reason', 'key', 'language']) {
        status[key] = typeof data[key] === 'string' ? data[key].slice(0, 1000) : '';
      }
      status.music = data.music === true;
      status.playbackRequested = data.playbackRequested === true;
      status.frameId = sender.frameId;
      status.updatedAt = Date.now();
      const operation = statusQueue.then(async () => {
        const storageKey = 'tab:' + sender.tab.id;
        const existing = (await chrome.storage.session.get(storageKey))[storageKey];
        // The top frame or an advertising frame must not hide an embedded player.
        if (!existing || status.music || existing.frameId === sender.frameId || (!existing.music && sender.frameId === 0)) {
          await chrome.storage.session.set({[storageKey]: status});
        }
        if (status.decision === 'block' && status.playbackRequested && status.title.trim() && status.key.includes('|')) {
          const frameKey = 'count:' + sender.tab.id + ':' + sender.frameId;
          const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(status.site + '|' + status.key));
          const digest = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
          const previous = (await chrome.storage.session.get(frameKey))[frameKey];
          const update = QuietGateCounter.record(previous, sender.documentId || '', digest);
          if (update.added) {
            const {stats} = await chrome.storage.local.get('stats');
            const blockedCount = Math.min(Number.MAX_SAFE_INTEGER, QuietGateCounter.total(stats?.blockedCount) + 1);
            await chrome.storage.local.set({stats: {blockedCount}});
            await chrome.storage.session.set({[frameKey]: update.state});
          }
        }
      });
      statusQueue = operation.catch(() => {});
      await operation;
      return {ok: true};
    }
    if (message.type === 'GET_SETTINGS') return {settings: await readSettings()};
    if (!fromUI) throw new Error('Open Adblocker Pro to change settings');
    if (message.type === 'GET_SUMMARY') {
      await statusQueue;
      const [{stats}, settings] = await Promise.all([chrome.storage.local.get('stats'), readSettings()]);
      return {enabled: settings.enabled, blockedCount: QuietGateCounter.total(stats?.blockedCount)};
    }
    if (message.type === 'GET_STATE') {
      const key = Number.isInteger(message.tabId) ? 'tab:' + message.tabId : '';
      const cached = key ? (await chrome.storage.session.get(key))[key] : null;
      let status = null;
      if (key) {
        // Ask the live document, so navigations and removed iframes cannot leave
        // an old song in the popup. Subframe loads must not clear parent status.
        for (const frameId of new Set([cached?.frameId ?? 0, 0])) {
          try {
            const current = await chrome.tabs.sendMessage(message.tabId, {type: 'GET_CURRENT_STATUS'}, {frameId});
            if (current?.status) { status = {...current.status, frameId}; break; }
          } catch { /* Browser internal pages and removed frames have no receiver. */ }
        }
      }
      return {settings: await readSettings(), status};
    }
    if (message.type === 'UPDATE_SETTINGS') return writeSettings(current => Settings.sanitize(message.patch, current));
    if (message.type === 'RESET_SETTINGS') return writeSettings(() => Settings.defaults());
    if (message.type === 'TRACK_RULE') {
      const key = message.key;
      if (typeof key !== 'string' || key.length > 500 || !key.includes('|') || !key.replace(/\|/g, '').trim()) throw new Error('No track selected');
      if (!['allow', 'block', 'clear'].includes(message.rule)) throw new Error('Invalid rule');
      return writeSettings(current => {
        const patch = {
          allowTracks: current.allowTracks.filter(x => x !== key),
          blockTracks: current.blockTracks.filter(x => x !== key)
        };
        if (message.rule === 'allow') patch.allowTracks.push(key);
        if (message.rule === 'block') patch.blockTracks.push(key);
        return Settings.sanitize(patch, current);
      });
    }
    throw new Error('Unknown request');
  };
  handle().then(respond, error => respond({error: error.message || 'Unable to save'}));
  return true;
});
