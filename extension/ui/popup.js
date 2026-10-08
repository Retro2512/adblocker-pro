(function () {
  'use strict';
  const {request} = QuietGateUI;
  const enabled = document.getElementById('enabled');
  const count = document.getElementById('blocked-count');
  const feedback = document.getElementById('feedback');
  let state = null, busy = false, generation = 0;
  function showError(message = '') {
    feedback.textContent = message;
    feedback.hidden = !message;
    feedback.dataset.error = String(Boolean(message));
  }
  function render() {
    enabled.disabled = busy || !state;
    if (!state) return;
    enabled.checked = state.enabled;
    const total = Number.isSafeInteger(state.blockedCount) && state.blockedCount >= 0 ? state.blockedCount : 0;
    count.textContent = new Intl.NumberFormat(undefined, total >= 1000000 ? {notation: 'compact', maximumFractionDigits: 1} : {}).format(total);
    count.setAttribute('aria-label', 'Blocked: ' + new Intl.NumberFormat().format(total));
  }
  async function refresh() {
    if (busy) return;
    const current = generation;
    try {
      const summary = await request({type: 'GET_SUMMARY'});
      if (current !== generation || busy) return;
      state = summary;
      render();
      showError();
    } catch {
      if (current === generation) showError('Could not connect. Reopen the extension.');
    }
  }
  enabled.addEventListener('change', async () => {
    if (!state || busy) return;
    const previous = state.enabled;
    state.enabled = enabled.checked;
    generation++;
    busy = true;
    render();
    showError();
    try {
      const result = await request({type: 'UPDATE_SETTINGS', patch: {enabled: state.enabled}});
      state.enabled = result.settings.enabled;
    } catch {
      state.enabled = previous;
      showError('Could not save. Try again.');
    } finally { busy = false; render(); }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.stats || changes.settings)) refresh();
  });
  refresh();
  setInterval(refresh, 1500);
})();
