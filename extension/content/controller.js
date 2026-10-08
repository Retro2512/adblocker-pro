(() => {
  'use strict';
  const CHANNEL = 'quietgate:1';
  const Settings = globalThis.QuietGateSettings;
  const Classifier = globalThis.QuietGateClassifier;
  const Adapters = globalThis.QuietGateAdapters;
  let settings = Settings.defaults();
  let ready = false;
  let metadata = {};
  let revision = 0;
  let scheduled = null;
  let lastStatus = '';
  let started = Date.now();
  let lastURL = location.href;
  let blocked = false;
  let playbackRequested = false;
  let overlay;
  let lastBounds = '';
  function post(type, value = {}) {
    window.postMessage({channel: CHANNEL, from: 'controller', type, revision, ...value}, '*');
  }
  function sendStatus(status) {
    const json = JSON.stringify(status);
    if (json === lastStatus) return;
    lastStatus = json;
    chrome.runtime.sendMessage({type: 'STATUS', status}).catch(() => {});
  }
  function makeOverlay() {
    const host = document.createElement('quietgate-buffer');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'all:initial!important;position:fixed!important;z-index:2147483647!important;pointer-events:none!important;display:none!important;';
    const shadow = host.attachShadow({mode: 'closed'});
    const style = document.createElement('style');
    style.textContent = ':host{contain:strict}.surface{height:100%;width:100%;display:grid;place-items:center;background:rgba(0,0,0,.12)}.spinner{width:38px;height:38px;border:3px solid rgba(255,255,255,.24);border-top-color:#fff;border-radius:50%;animation:spin 1s linear infinite;filter:drop-shadow(0 1px 3px #0008)}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinner{animation:none;border-style:dotted}}';
    const surface = document.createElement('div');
    surface.className = 'surface';
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    surface.append(spinner);
    shadow.append(style, surface);
    (document.fullscreenElement || document.documentElement)?.append(host);
    return host;
  }
  function drawOverlay() {
    if (!blocked || !document.documentElement) {
      if (overlay && overlay.style.display !== 'none') overlay.style.setProperty('display', 'none', 'important');
      return;
    }
    let rect, area = 0;
    for (const video of document.querySelectorAll('video')) {
      const bounds = video.getBoundingClientRect();
      const size = bounds.width * bounds.height;
      if (size > area && bounds.width >= 120 && bounds.height >= 60 && bounds.bottom > 0 && bounds.top < innerHeight) {
        area = size; rect = bounds;
      }
    }
    if (!rect) {
      if (overlay && overlay.style.display !== 'none') overlay.style.setProperty('display', 'none', 'important');
      return;
    }
    if (!overlay?.isConnected) { overlay = makeOverlay(); lastBounds = ''; }
    const bounds = [rect.x, rect.y, rect.width, rect.height].map(Math.round).join(',');
    if (bounds !== lastBounds || overlay.style.display === 'none') {
      lastBounds = bounds;
      for (const [name, value] of Object.entries({left: rect.x, top: rect.y, width: rect.width, height: rect.height})) overlay.style.setProperty(name, value + 'px', 'important');
      overlay.style.setProperty('display', 'block', 'important');
    }
  }
  function evaluate() {
    scheduled = null;
    if (!ready) return;
    if (location.href !== lastURL) { started = Date.now(); lastURL = location.href; }
    let track;
    try { track = Adapters.extract(document, location, metadata); }
    catch { track = {...metadata, site: location.hostname, music: false}; }
    track.title = String(track.title || '').slice(0, 1000);
    track.artist = String(track.artist || '').slice(0, 1000);
    const key = Classifier.trackKey(track);
    let musicContext = track.music === true;
    const bypass = !settings.enabled || Settings.hostAllowed(location.hostname, settings);
    let result = {decision: 'allow', reason: settings.enabled ? 'Site allowed' : 'Off', language: null};
    let hold = false;
    if (!bypass) {
      result = Classifier.classify(track, settings);
      // Song rules do not block a tutorial merely because its title says Hindi.
      const explicitTrackBlock = settings.blockTracks.includes(key);
      const dedicatedMusicSite = Adapters.supportedSites.find(site => site.id === track.site)?.music === true;
      const music = track.music === true || (dedicatedMusicSite && !track.title && playbackRequested);
      musicContext = music;
      hold = explicitTrackBlock || (music && (result.decision === 'block' || (settings.strict && result.decision === 'unknown')));
      const youtubeUnsettled = /(^|\.)youtube(?:-nocookie)?\.com$/.test(location.hostname) &&
        !metadata.category && (Date.now() - started < 1800 || (settings.strict && playbackRequested && result.decision !== 'allow'));
      if (youtubeUnsettled) hold = true;
      if (hold && result.decision === 'unknown') result = {...result, reason: 'Unidentified music'};
      if (!music && !explicitTrackBlock) result = {...result, decision: 'allow', reason: youtubeUnsettled ? 'Checking track' : 'Not identified as music'};
    }
    blocked = hold;
    post('DECISION', {hold, enabled: !bypass});
    sendStatus({
      title: track.title, artist: track.artist, site: track.site || location.hostname,
      key, music: musicContext, decision: hold ? 'block' : 'allow',
      reason: result.reason, language: result.language || ''
    });
    drawOverlay();
  }
  function schedule(delay = 60) {
    if (scheduled !== null) return;
    scheduled = setTimeout(evaluate, delay);
  }
  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== window || message?.channel !== CHANNEL || message.from !== 'gate') return;
    if (!Number.isSafeInteger(message.revision) || message.revision < revision) return;
    if (message.type === 'METADATA' || message.type === 'PROBE') {
      revision = message.revision;
      playbackRequested = message.playbackRequested === true;
      if (message.metadata && typeof message.metadata === 'object') metadata = message.metadata;
      schedule(0);
    }
  });
  chrome.storage.local.get('settings').then(value => {
    try { settings = Settings.sanitize(value.settings || {}); } catch {}
    ready = true;
    post('HELLO');
    schedule(0);
  }).catch(() => { ready = true; post('HELLO'); schedule(0); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    try { settings = Settings.sanitize(changes.settings.newValue || {}); } catch { return; }
    schedule(0);
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'GET_CURRENT_STATUS' || sender.id !== chrome.runtime.id) return;
    evaluate();
    respond({status: lastStatus ? JSON.parse(lastStatus) : null});
  });
  new MutationObserver(() => schedule()).observe(document, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'content', 'aria-label', 'src']});
  document.addEventListener('yt-navigate-finish', () => { started = Date.now(); post('REFRESH'); schedule(0); });
  document.addEventListener('fullscreenchange', () => { overlay?.remove(); schedule(0); });
  window.addEventListener('scroll', drawOverlay, {passive: true});
  window.addEventListener('resize', drawOverlay, {passive: true});
  window.addEventListener('pageshow', () => { post('HELLO'); schedule(0); });
  setInterval(() => schedule(0), 1500);
  post('HELLO');
})();
