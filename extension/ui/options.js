(function () {
  'use strict';
  const { request, feedback, lines, validateSettings, validHost, MAX_IMPORT_BYTES } = QuietGateUI;
  const catalog = QuietGateCatalog.languages;
  const languageIds = catalog.map(language => language.id);
  const form = document.getElementById('settings-form');
  const fields = document.getElementById('settings-fields');
  const fileInput = document.getElementById('import-file');
  let settings, pending = Promise.resolve(), saving = 0;

  for (const language of catalog) {
    const label = document.createElement('label');
    label.className = 'language-choice';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.name = 'languages'; checkbox.value = language.id;
    const name = document.createElement('span'); name.textContent = language.label;
    label.append(checkbox, name); document.getElementById('languages').append(label);
  }
  function render(replaceText = false) {
    for (const key of ['enabled', 'strict', 'artistMatching']) document.getElementById(key).checked = settings[key];
    for (const node of form.elements.languages) node.checked = settings.languages.includes(node.value);
    if (replaceText) for (const key of ['phrases', 'allowedHosts']) { document.getElementById(key).value = settings[key].join('\n'); document.getElementById(key).removeAttribute('aria-invalid'); }
    for (const [key, empty] of [['allowTracks', 'allow-empty'], ['blockTracks', 'block-empty']]) {
      const list = document.getElementById(key); list.replaceChildren();
      document.getElementById(empty).hidden = settings[key].length > 0;
      for (const trackKey of settings[key]) {
        const item = document.createElement('li');
        const name = document.createElement('span'); name.className = 'rule-name'; name.textContent = trackKey.replace(/\s*(?:\|\||::|\|)\s*/gu, ' · ');
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'rule-remove'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', `Remove ${name.textContent}`);
        remove.addEventListener('click', () => save({ type: 'TRACK_RULE', key: trackKey, rule: 'clear' }).catch(() => {}));
        item.append(name, remove); list.append(item);
      }
    }
  }
  function save(message, replaceText = false) {
    saving += 1; feedback('Saving');
    const operation = pending.then(async () => {
      const response = await request(message);
      settings = response.settings; render(replaceText);
    });
    pending = operation.catch(error => { render(); feedback(error.message, true); }).finally(() => { saving -= 1; if (!saving && document.getElementById('feedback').dataset.error !== 'true') feedback('Saved'); });
    return operation;
  }
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('change', event => {
    const target = event.target;
    if (['enabled', 'strict', 'artistMatching'].includes(target.name)) save({ type: 'UPDATE_SETTINGS', patch: { [target.name]: target.checked } }).catch(() => {});
    else if (target.name === 'languages') save({ type: 'UPDATE_SETTINGS', patch: { languages: [...form.querySelectorAll('[name="languages"]:checked')].map(node => node.value) } }).catch(() => {});
    else if (target.name === 'phrases' || target.name === 'allowedHosts') {
      let entries = lines(target.value);
      if (target.name === 'allowedHosts') entries = entries.map(host => host.toLowerCase());
      const invalid = entries.length > 500 || entries.some(entry => entry.length > (target.name === 'phrases' ? 500 : 253) || /[\u0000-\u001f\u007f]/u.test(entry)) || (target.name === 'allowedHosts' && entries.some(host => !validHost(host)));
      target.setAttribute('aria-invalid', String(invalid));
      if (invalid) { feedback(target.name === 'allowedHosts' ? 'Enter domains only, without paths.' : 'Use up to 500 phrases, each up to 500 characters.', true); return; }
      save({ type: 'UPDATE_SETTINGS', patch: { [target.name]: entries } }).catch(() => {});
    }
  });
  document.getElementById('export').addEventListener('click', async () => {
    await pending;
    const blob = new Blob([JSON.stringify(settings, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'AdblockerPro.settings.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); feedback('Exported');
  });
  document.getElementById('import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0]; fileInput.value = '';
    if (!file) return;
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error('Choose a file smaller than 100 KB.');
      let parsed;
      try { parsed = JSON.parse(await file.text()); } catch (_) { throw new Error('Choose a valid JSON settings file.'); }
      const patch = validateSettings(parsed, languageIds);
      await save({ type: 'UPDATE_SETTINGS', patch }, true);
      feedback('Imported');
    } catch (error) { feedback(error.message, true); }
  });
  const dialog = document.getElementById('reset-dialog');
  document.getElementById('reset').addEventListener('click', () => { dialog.returnValue = ''; dialog.showModal(); });
  dialog.addEventListener('close', async () => {
    if (dialog.returnValue !== 'reset') return;
    try { await save({ type: 'RESET_SETTINGS' }, true); feedback('Reset'); } catch (_) { /* Save already reports the error. */ }
  });
  (async () => {
    try { const response = await request({ type: 'GET_STATE' }); settings = response.settings; render(true); fields.disabled = false; feedback(''); }
    catch (error) { feedback(error.message, true); }
  })();
})();
