(() => {
  'use strict';
  const CHANNEL = 'quietgate:1';
  const mediaPrototype = HTMLMediaElement.prototype;
  const nativePlay = mediaPrototype.play;
  const nativePause = mediaPrototype.pause;
  const muted = Object.getOwnPropertyDescriptor(mediaPrototype, 'muted');
  const media = new Map();
  const roots = new Set([document]);
  const contexts = new Map();
  const contextWaiters = new Map();
  let held = true;
  let revision = 0;
  let enabled = true;
  let fingerprint = '';
  let lastURL = location.href;
  let lastSnapshot = {};
  let scheduled = false;

  function send(type, value = {}) {
    const playbackRequested = [...media.entries()].some(([element, state]) => state.desired || !element.paused) ||
      [...contexts.entries()].some(([context, state]) => state.desired || context.state === 'running');
    window.postMessage({channel: CHANNEL, from: 'gate', type, revision, playbackRequested, ...value}, '*');
  }
  function remember(element) {
    if (!media.has(element)) media.set(element, {
      desired: !element.paused, muted: muted?.get.call(element) || false,
      changedMute: false, pending: null, authorized: false
    });
    return media.get(element);
  }
  function pauseElement(element, state) {
    if (!element.paused) state.desired = true;
    if (muted && !state.changedMute) {
      state.muted = muted.get.call(element);
      state.changedMute = true;
    }
    if (muted) muted.set.call(element, true);
    nativePause.call(element);
  }
  function suspendContext(context, state) {
    if (context.state === 'running') {
      state.desired = true;
      state.suspend.call(context).catch(() => {});
    }
  }
  function hold() {
    held = true;
    for (const [element, state] of media) pauseElement(element, state);
    for (const [context, state] of contexts) suspendContext(context, state);
  }
  function release() {
    held = false;
    for (const [element, state] of media) {
      if (state.changedMute && muted) muted.set.call(element, state.muted);
      state.changedMute = false;
      if (state.desired) {
        state.desired = false;
        const pending = state.pending;
        state.pending = null;
        try {
          state.authorized = true;
          const result = nativePlay.call(element);
          if (pending) Promise.resolve(result).then(pending.resolve, error => { state.authorized = false; pending.reject(error); });
          else result?.catch(() => { state.authorized = false; });
        } catch (error) { pending?.reject(error); }
      }
    }
    for (const [context, state] of contexts) {
      const waiters = contextWaiters.get(context) || [];
      contextWaiters.delete(context);
      if (state.desired && context.state !== 'closed') {
        state.desired = false;
        state.resume.call(context).then(
          () => waiters.forEach(x => x.resolve()),
          error => waiters.forEach(x => x.reject(error))
        );
      } else waiters.forEach(x => x.reject(new DOMException('Audio playback was cancelled', 'AbortError')));
    }
  }
  function snapshot() {
    let title = '', artist = '', album = '', category = '', videoId = '', isLive = false;
    try {
      const metadata = navigator.mediaSession?.metadata;
      title = metadata?.title || '';
      artist = metadata?.artist || '';
      album = metadata?.album || '';
    } catch {}
    if (/(^|\.)youtube(?:-nocookie)?\.com$/.test(location.hostname)) {
      try {
        const requested = new URL(location.href).searchParams.get('v') || location.pathname.match(/\/(?:embed|shorts)\/([^/?]+)/)?.[1];
        const player = document.getElementById('movie_player');
        const response = player?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
        const details = response?.videoDetails;
        if (details && (!requested || requested === details.videoId)) {
          title = details.title || title;
          artist = details.author || artist;
          category = response.microformat?.playerMicroformatRenderer?.category || '';
          videoId = details.videoId || '';
          isLive = details.isLiveContent === true;
        }
      } catch {}
    }
    const clip = value => typeof value === 'string' ? value.slice(0, 1000) : '';
    return {title: clip(title), artist: clip(artist), album: clip(album), category: clip(category), videoId: clip(videoId), isLive};
  }
  function report(force = false) {
    const metadata = snapshot();
    const next = JSON.stringify(metadata);
    if (next !== fingerprint || location.href !== lastURL) {
      fingerprint = next;
      lastURL = location.href;
      lastSnapshot = metadata;
      revision++;
      if (enabled) hold();
      force = true;
    }
    if (force) send('METADATA', {metadata: lastSnapshot, url: location.href});
  }
  function probe() {
    if (!enabled) return;
    revision++;
    hold();
    report(true);
  }
  mediaPrototype.play = function play() {
    const state = remember(this);
    if (enabled) probe(); else report();
    if (!held) return nativePlay.call(this);
    state.desired = true;
    pauseElement(this, state);
    if (!state.pending) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      state.pending = {promise, resolve, reject};
    }
    send('PROBE', {metadata: lastSnapshot});
    return state.pending.promise;
  };
  mediaPrototype.pause = function pause() {
    const state = remember(this);
    state.desired = false;
    state.authorized = false;
    if (state.pending) {
      state.pending.reject(new DOMException('Playback was paused', 'AbortError'));
      state.pending = null;
    }
    return nativePause.call(this);
  };
  if (muted?.configurable) {
    Object.defineProperty(mediaPrototype, 'muted', {
      ...muted,
      set(value) {
        const state = remember(this);
        if (held) {
          state.muted = Boolean(value);
          state.changedMute = true;
          muted.set.call(this, true);
        } else muted.set.call(this, value);
      }
    });
  }
  function mediaEvent(event) {
    const element = event.target;
    if (!(element instanceof HTMLMediaElement)) return;
    const state = remember(element);
    if (event.type === 'emptied' || event.type === 'loadstart') probe();
    if (event.type === 'play' || event.type === 'playing') {
      if (event.type === 'play') {
        if (state.authorized) state.authorized = false;
        else if (enabled) probe();
      }
      report();
      if (held) {
        state.desired = true;
        pauseElement(element, state);
        element.dispatchEvent(new Event('waiting'));
        send('PROBE', {metadata: lastSnapshot});
      }
    }
  }
  function watchRoot(root) {
    roots.add(root);
    for (const event of ['play', 'playing', 'loadstart', 'emptied']) root.addEventListener(event, mediaEvent, true);
  }
  watchRoot(document);
  const attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (options) {
    const root = attachShadow.call(this, options);
    watchRoot(root);
    return root;
  };

  // Media Session updates normally arrive before the next audio frame.
  try {
    const prototype = Object.getPrototypeOf(navigator.mediaSession);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'metadata');
    if (descriptor?.set && descriptor.configurable) Object.defineProperty(prototype, 'metadata', {
      ...descriptor,
      set(value) {
        descriptor.set.call(this, value);
        report(true);
      }
    });
  } catch {}

  const wrappedContexts = new WeakMap();
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const Native = window[name];
    if (!Native) continue;
    if (wrappedContexts.has(Native)) { window[name] = wrappedContexts.get(Native); continue; }
    const resume = Native.prototype.resume;
    const suspend = Native.prototype.suspend;
    const close = Native.prototype.close;
    function track(context) {
      if (!contexts.has(context)) {
        contexts.set(context, {resume, suspend, desired: context.state === 'running'});
        context.addEventListener('statechange', () => {
          if (context.state === 'closed') contexts.delete(context);
          else if (held) suspendContext(context, contexts.get(context));
        });
      }
      if (held) suspendContext(context, contexts.get(context));
      return contexts.get(context);
    }
    Native.prototype.resume = function () {
      if (this.state === 'closed') return resume.call(this);
      const state = track(this);
      report();
      if (!held) return resume.call(this);
      state.desired = true;
      send('PROBE', {metadata: lastSnapshot});
      return new Promise((resolve, reject) => {
        const waiters = contextWaiters.get(this) || [];
        waiters.push({resolve, reject});
        contextWaiters.set(this, waiters);
      });
    };
    Native.prototype.suspend = function () {
      if (this.state === 'closed') return suspend.call(this);
      track(this).desired = false;
      for (const waiter of contextWaiters.get(this) || []) waiter.reject(new DOMException('Audio playback was suspended', 'AbortError'));
      contextWaiters.delete(this);
      return suspend.call(this);
    };
    Native.prototype.close = function () {
      for (const waiter of contextWaiters.get(this) || []) waiter.reject(new DOMException('Audio context closed', 'InvalidStateError'));
      contextWaiters.delete(this);
      contexts.delete(this);
      return close.call(this);
    };
    const Wrapped = new Proxy(Native, {
      construct(target, args, newTarget) {
        const context = Reflect.construct(target, args, newTarget);
        track(context);
        return context;
      }
    });
    wrappedContexts.set(Native, Wrapped);
    window[name] = Wrapped;
  }

  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== window || message?.channel !== CHANNEL || message.from !== 'controller') return;
    if (message.type === 'HELLO') report(true);
    if (message.type === 'DECISION' && message.revision === revision) {
      enabled = message.enabled !== false;
      if (message.hold && enabled) hold(); else release();
    }
    if (message.type === 'REFRESH') probe();
  });
  function scan() {
    for (const root of roots) {
      if (root !== document && !root.host.isConnected) { roots.delete(root); continue; }
      for (const element of root.querySelectorAll('audio,video')) {
        const state = remember(element);
        if (held) pauseElement(element, state);
      }
    }
    for (const [element, state] of media) {
      if (!element.isConnected && element.paused && !state.pending && !state.desired) {
        if (state.changedMute && muted) muted.set.call(element, state.muted);
        media.delete(element);
      }
    }
    report();
  }
  new MutationObserver(() => {
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(() => { scheduled = false; scan(); });
    }
  }).observe(document, {childList: true, subtree: true});
  setInterval(scan, 500);
  document.addEventListener('yt-navigate-start', probe, true);
  document.addEventListener('yt-navigate-finish', () => report(true), true);
  window.addEventListener('popstate', probe);
  window.addEventListener('pageshow', () => report(true));
  report(true);
})();
