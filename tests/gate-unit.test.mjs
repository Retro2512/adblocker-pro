import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../extension/content/gate.js', import.meta.url), 'utf8');
function harness({alias = false, contextRunning = false} = {}) {
  class Media extends EventTarget {
    constructor() { super(); this.paused = true; this.isConnected = true; this._muted = false; this.playCalls = 0; }
    get muted() { return this._muted; }
    set muted(value) { this._muted = Boolean(value); }
    play() { this.playCalls++; this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  class Element { attachShadow() { return { addEventListener() {}, querySelectorAll: () => [], host: this }; } }
  class Context extends EventTarget {
    constructor() { super(); this.state = contextRunning ? 'running' : 'suspended'; this.resumeCalls = 0; }
    resume() { if (this.state === 'closed') return Promise.reject(new DOMException('Closed', 'InvalidStateError')); this.resumeCalls++; this.state = 'running'; this.dispatchEvent(new Event('statechange')); return Promise.resolve(); }
    suspend() { this.state = 'suspended'; this.dispatchEvent(new Event('statechange')); return Promise.resolve(); }
    close() { this.state = 'closed'; this.dispatchEvent(new Event('statechange')); return Promise.resolve(); }
  }
  const messages = [], listeners = new Map(), documentListeners = new Map(), intervals = [];
  const window = {
    AudioContext: Context,
    addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); },
    postMessage(data) { messages.push(data); for (const listener of listeners.get('message') || []) listener({ source: window, data }); }
  };
  if (alias) window.webkitAudioContext = Context;
  const document = {
    addEventListener(type, fn) { const list = documentListeners.get(type) || []; list.push(fn); documentListeners.set(type, list); },
    querySelectorAll: () => [], getElementById: () => null
  };
  const scope = { window, document, HTMLMediaElement: Media, Element, Event, DOMException, navigator: {}, location: {href:'https://music.example.test/',hostname:'music.example.test'}, MutationObserver: class { observe() {} }, setInterval(fn) { intervals.push(fn); }, queueMicrotask };
  vm.createContext(scope); vm.runInContext(source, scope);
  function decision(hold, enabled = true) { const revision = messages.findLast(message => message.from === 'gate').revision; window.postMessage({ channel: 'quietgate:1', from: 'controller', type: 'DECISION', revision, hold, enabled }); }
  return { Media, window, decision, documentListeners, messages, scan: intervals[0] };
}
const settle = promise => Promise.race([promise.then(() => 'resolved', error => error.name), new Promise(resolve => setTimeout(() => resolve('pending'), 20))]);

test('gate holds a play promise then restores mute and playback on allow', async () => {
  const { Media, decision } = harness(); const media = new Media();
  const playing = media.play(); assert.equal(media.paused, true); assert.equal(media.muted, true); assert.equal(media.playCalls, 0);
  decision(false); await playing;
  assert.equal(media.paused, false); assert.equal(media.muted, false); assert.equal(media.playCalls, 1);
});
test('gate preserves a mute change made while held', async () => {
  const { Media, decision } = harness(); const media = new Media(); const playing = media.play();
  media.muted = true; decision(false); await playing; assert.equal(media.muted, true);
});
test('explicit pause cancels a held play promise without later resuming', async () => {
  const { Media, decision } = harness(); const media = new Media(); const outcome = settle(media.play());
  media.pause(); assert.equal(await outcome, 'AbortError'); decision(false); assert.equal(media.playCalls, 0);
});
test('source changes hold playback and ignore an old allow decision', async () => {
  const { Media, window, decision, documentListeners, messages } = harness(); const media = new Media();
  const playing = media.play(); decision(false); await playing;
  const oldRevision = messages.at(-1).revision;
  for (const listener of documentListeners.get('loadstart')) listener({ type: 'loadstart', target: media });
  assert.equal(media.paused, true); assert.equal(media.muted, true);
  window.postMessage({ channel: 'quietgate:1', from: 'controller', type: 'DECISION', revision: oldRevision, hold: false, enabled: true });
  assert.equal(media.paused, true);
  decision(false); await Promise.resolve(); assert.equal(media.paused, false); assert.equal(media.muted, false);
});
test('disabled filtering does not rehold a changed source', async () => {
  const { Media, decision, documentListeners } = harness(); const media = new Media();
  const playing = media.play(); decision(false, false); await playing;
  for (const listener of documentListeners.get('loadstart')) listener({ type: 'loadstart', target: media });
  assert.equal(media.paused, false); assert.equal(media.muted, false);
});
test('closed AudioContext resume rejects even while playback is held', async () => {
  const { window } = harness(); const context = new window.AudioContext(); await context.close();
  assert.equal(await settle(context.resume()), 'InvalidStateError');
});
test('AudioContext suspend settles a queued resume rather than losing its promise', async () => {
  const { window, decision } = harness(); const context = new window.AudioContext(); const outcome = settle(context.resume());
  await context.suspend(); decision(false);
  assert.notEqual(await outcome, 'pending');
});
test('AudioContext held resume resolves only after allow and invokes native resume once', async () => {
  const {window,decision} = harness(); const context = new window.AudioContext();
  const resumed = context.resume(); assert.equal(context.resumeCalls,0); assert.equal(context.state,'suspended');
  assert.equal(await settle(resumed),'pending'); decision(false); await resumed;
  assert.equal(context.resumeCalls,1); assert.equal(context.state,'running');
});
test('both AudioContext constructor aliases wrap and suspend initially running audio', async () => {
  const {window,decision} = harness({alias:true,contextRunning:true});
  assert.equal(window.AudioContext,window.webkitAudioContext);
  const first = new window.AudioContext(), second = new window.webkitAudioContext();
  assert.equal(first.state,'suspended'); assert.equal(second.state,'suspended');
  decision(false); await Promise.resolve();
  assert.equal(first.state,'running'); assert.equal(second.state,'running');
  assert.equal(first.resumeCalls,1); assert.equal(second.resumeCalls,1);
});
test('AudioContext explicit suspend cancels every queued resume and does not restart on allow', async () => {
  const {window,decision} = harness(); const context = new window.AudioContext();
  const first = settle(context.resume()), second = settle(context.resume()); await context.suspend();
  assert.equal(await first,'AbortError'); assert.equal(await second,'AbortError');
  decision(false); await Promise.resolve(); assert.equal(context.state,'suspended'); assert.equal(context.resumeCalls,0);
});
test('AudioContext close rejects a queued resume and does not restart on allow', async () => {
  const {window,decision} = harness(); const context = new window.AudioContext(); const outcome = settle(context.resume());
  await context.close(); assert.equal(await outcome,'InvalidStateError'); decision(false);
  assert.equal(context.state,'closed'); assert.equal(context.resumeCalls,0);
});
test('removing a paused held media element restores its original mute before cleanup', async () => {
  const {Media,decision,scan} = harness(); const media = new Media(); const outcome = settle(media.play());
  media.pause(); assert.equal(await outcome,'AbortError'); media.isConnected = false; scan(); decision(false);
  assert.equal(media.muted,false); assert.equal(media.playCalls,0);
});
