(function () {
  'use strict';
  const { request, feedback } = QuietGateUI;
  const enabled = document.getElementById('enabled');
  const allow = document.getElementById('allow-track');
  const block = document.getElementById('block-track');
  let state, tabId, busy = false, pendingDecision = null;
  const siteNames = { youtube: 'YouTube', youtubeMusic: 'YouTube Music', spotify: 'Spotify', appleMusic: 'Apple Music', amazonMusic: 'Amazon Music', soundcloud: 'SoundCloud', deezer: 'Deezer', tidal: 'Tidal', jiosaavn: 'JioSaavn', gaana: 'Gaana', bandcamp: 'Bandcamp', generic: '' };
  function render() {
    enabled.checked = state.settings.enabled;
    enabled.disabled = busy;
    const status = state.status || {};
    const active = state.settings.enabled;
    const labels = { allow: 'Allowed', block: 'Blocked', hold: 'Held for review', held: 'Held for review' };
    const marker = document.getElementById('state');
    const pending = status.reason === 'Unidentified music' || status.reason === 'Checking track';
    const updating = Boolean(pendingDecision && pendingDecision.key === status.key);
    marker.textContent = !active ? 'Off' : updating ? 'Updating' : pending ? (status.reason === 'Checking track' ? 'Checking track' : 'Held for review') : labels[status.decision] || (status.title ? 'Watching' : 'Ready');
    marker.dataset.tone = active && !pending && !updating ? status.decision || 'neutral' : 'neutral';
    document.getElementById('track-title').textContent = status.title || 'No track detected';
    document.getElementById('track-artist').textContent = status.artist || '';
    document.getElementById('track-site').textContent = siteNames[status.site] ?? status.site ?? '';
    for (const [button, list] of [[allow, state.settings.allowTracks], [block, state.settings.blockTracks]]) {
      button.disabled = busy || typeof status.key !== 'string' || !status.key.replace(/\|/gu, '').trim() || status.key.length > 500;
      button.setAttribute('aria-pressed', String(Boolean(status.key && list.includes(status.key))));
    }
  }
  async function refresh() {
    if (busy) return;
    try {
      state = await request({ type: 'GET_STATE', tabId });
      if (pendingDecision && (state.status?.key !== pendingDecision.key || state.status?.decision === pendingDecision.decision || Date.now() > pendingDecision.until)) pendingDecision = null;
      render();
    } catch (error) { document.getElementById('state').textContent = 'Unavailable'; document.getElementById('state').dataset.tone = 'neutral'; feedback(error.message, true); }
  }
  async function change(message, success) {
    busy = true; render();
    try {
      const response = await request(message);
      state.settings = response.settings;
      if (message.type === 'TRACK_RULE') pendingDecision = { key: message.key, decision: message.rule === 'allow' ? 'allow' : 'block', until: Date.now() + 3000 };
      feedback(success);
    } catch (error) { feedback(error.message, true); }
    finally { busy = false; render(); await refresh(); }
  }
  enabled.addEventListener('change', () => change({ type: 'UPDATE_SETTINGS', patch: { enabled: enabled.checked } }, enabled.checked ? 'Enabled' : 'Turned off'));
  allow.addEventListener('click', () => change({ type: 'TRACK_RULE', key: state.status.key, rule: 'allow' }, 'Track allowed'));
  block.addEventListener('click', () => change({ type: 'TRACK_RULE', key: state.status.key, rule: 'block' }, 'Track blocked'));
  for (const id of ['brand-link', 'settings-link']) document.getElementById(id).addEventListener('click', event => { event.preventDefault(); chrome.runtime.openOptionsPage(); });
  (async () => {
    try { const tabs = await chrome.tabs.query({ active: true, currentWindow: true }); tabId = tabs[0]?.id; } catch (_) { /* State is still available without an active tab. */ }
    await refresh();
    setInterval(refresh, 1500);
  })();
})();
