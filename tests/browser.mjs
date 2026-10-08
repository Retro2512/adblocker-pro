import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp, rm, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profileRoot = path.join(root, '.test-profiles');
await mkdir(profileRoot, {recursive: true});
await mkdir(path.join(root, 'artifacts'), {recursive: true});
const profile = await mkdtemp(path.join(profileRoot, 'browser-'));
const results = [];
let context;
// A silent PCM recording makes playback assertions without producing sound.
const data = Buffer.alloc(44 + 16000 * 2 * 20);
data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32);
data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(data.length - 44, 40);
const wav = 'data:audio/wav;base64,' + data.toString('base64');
function fixture({title = 'Tum Hi Ho', artist = 'Arijit Singh', category = 'Music', youtube = false, youtubeMusic = false} = {}) {
  const playerMetadata = youtubeMusic
    ? `<ytmusic-player-bar><span class="title">${title}</span><span class="byline"><a>${artist}</a></span></ytmusic-player-bar>`
    : `<div data-testid="now-playing-widget"><a data-testid="nowplaying-track-link">${title}</a><a data-testid="context-item-info-artist">${artist}</a></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Player fixture</title></head><body>
  ${playerMetadata}
  <script>
    window.ytInitialPlayerResponse = ${JSON.stringify(youtube ? {videoDetails: {title, author: artist, videoId: 'fixture'}, microformat: {playerMicroformatRenderer: {category}}} : null)};
    window.changeTrack = (title, artist) => {
      document.querySelector(${JSON.stringify(youtubeMusic ? 'ytmusic-player-bar .title' : '[data-testid="nowplaying-track-link"]')}).textContent = title;
      document.querySelector(${JSON.stringify(youtubeMusic ? 'ytmusic-player-bar .byline a' : '[data-testid="context-item-info-artist"]')}).textContent = artist;
      navigator.mediaSession.metadata = new MediaMetadata({title, artist});
    };
    changeTrack(${JSON.stringify(title)}, ${JSON.stringify(artist)});
    window.player = new Audio(${JSON.stringify(wav)});
    document.body.append(player);
    window.playResult = 'pending';
    player.play().then(() => window.playResult = 'resolved', e => window.playResult = e.name);
  </script></body></html>`;
}
async function test(name, fn) {
  try { await fn(); results.push({name, passed: true}); console.log('PASS ' + name); }
  catch (error) { results.push({name, passed: false, error: error.message}); throw error; }
}
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${path.join(root, 'extension')}`, `--load-extension=${path.join(root, 'extension')}`, '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
    viewport: {width: 1280, height: 850}
  });
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${id}/ui/options.html`);
  await ui.locator('#settings-fields').waitFor({state: 'visible'});
  try { await ui.waitForFunction(() => !document.getElementById('settings-fields').disabled); }
  catch (error) {
    console.error('Startup diagnostics', {errors, feedback: await ui.locator('#feedback').textContent(), messages: await ui.evaluate(() => chrome.runtime.sendMessage({type:'GET_STATE'}))});
    throw error;
  }
  const send = message => ui.evaluate(message => chrome.runtime.sendMessage(message), message);
  const patch = async value => { const response = await send({type: 'UPDATE_SETTINGS', patch: value}); assert.equal(response.error, undefined); return response; };
  let page = await context.newPage();
  await context.route('https://open.spotify.com/**', route => route.fulfill({contentType: 'text/html', body: fixture()}));
  await page.goto('https://open.spotify.com/track/fixture');
  await test('Manifest loads and north language defaults exclude Tamil and English', async () => {
    const {settings} = await send({type: 'GET_STATE'});
    assert(settings.languages.includes('hindi')); assert(settings.languages.includes('punjabi'));
    assert(!settings.languages.includes('tamil')); assert(!settings.languages.includes('english'));
    assert.equal(settings.strict, true);
  });
  await test('Hindi playback stays paused with a pending play promise', async () => {
    await page.waitForTimeout(1200);
    const state = await page.evaluate(() => ({paused: player.paused, muted: player.muted, time: player.currentTime, result: playResult}));
    assert.equal(state.paused, true); assert.equal(state.muted, true); assert.equal(state.time, 0); assert.equal(state.result, 'pending');
  });
  await test('Allowing the exact track resumes held playback and restores mute', async () => {
    await send({type: 'TRACK_RULE', key: 'tum hi ho|arijit singh', rule: 'allow'});
    await page.waitForFunction(() => !player.paused && player.currentTime > .1);
    assert.equal(await page.evaluate(() => player.muted), false);
    assert.equal(await page.evaluate(() => playResult), 'resolved');
  });
  await test('Same element Punjabi track transition is held synchronously', async () => {
    const paused = await page.evaluate(() => { changeTrack('Lover', 'Diljit Dosanjh'); return player.paused; });
    assert.equal(paused, true);
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => player.paused), true);
  });
  await test('Strict mode holds unknown music and balanced mode permits it', async () => {
    await page.evaluate(() => { changeTrack('Uncatalogued Recording', 'Unknown Performer'); player.play().catch(() => {}); });
    await page.waitForTimeout(350); assert.equal(await page.evaluate(() => player.paused), true);
    await patch({strict: false});
    await page.waitForFunction(() => !player.paused);
  });
  await test('Explicit pause cancels held play and does not unexpectedly resume', async () => {
    await page.evaluate(() => { changeTrack('Tum Hi Ho', 'Arijit Singh'); });
    await send({type: 'TRACK_RULE', key: 'tum hi ho|arijit singh', rule: 'clear'});
    await page.waitForTimeout(300);
    await page.evaluate(() => { player.play().catch(() => {}); player.pause(); });
    await patch({enabled: false});
    await page.waitForTimeout(400); assert.equal(await page.evaluate(() => player.paused), true);
    assert.equal(await page.evaluate(() => player.muted), false);
  });
  await test('A user muted player remains muted after a hold is released', async () => {
    await page.evaluate(() => { player.muted = true; player.play().catch(() => {}); });
    await patch({enabled: true}); await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => player.paused), true);
    await patch({enabled: false}); await page.waitForFunction(() => !player.paused);
    assert.equal(await page.evaluate(() => player.muted), true);
  });
  await test('Domain exception releases playback', async () => {
    await patch({enabled: true, strict: true, allowedHosts: ['spotify.com']});
    await page.waitForFunction(() => !player.paused);
    await patch({allowedHosts: []}); await page.waitForFunction(() => player.paused);
  });
  await test('Page messages cannot mutate extension settings', async () => {
    await page.evaluate(() => window.postMessage({type: 'UPDATE_SETTINGS', patch: {enabled: false}}, '*'));
    assert.equal((await send({type: 'GET_STATE'})).settings.enabled, true);
    const invalid = await send({type: 'UPDATE_SETTINGS', patch: {notASetting: true}});
    assert(invalid.error);
  });
  await test('Hindi tutorial with an explicit nonmusic category plays', async () => {
    await context.route('https://www.youtube.com/**', route => route.fulfill({contentType: 'text/html', body: fixture({title: 'Hindi coding tutorial', artist: 'Teaching Channel', category: 'Education', youtube: true})}));
    await page.close(); page = await context.newPage();
    await page.goto('https://www.youtube.com/watch?v=fixture');
    await page.waitForFunction(() => !player.paused && player.currentTime > .1);
  });
  await test('YouTube Music song with Entertainment category stays held and settings control playback', async () => {
    await patch({enabled: true, strict: true, allowedHosts: []});
    await context.route('https://music.youtube.com/**', route => route.fulfill({contentType: 'text/html', body: fixture({title: 'Jugnu', artist: 'Badshah', category: 'Entertainment', youtube: true, youtubeMusic: true})}));
    await page.goto('https://music.youtube.com/watch?v=fixture');
    await page.waitForTimeout(2300);
    const state = await page.evaluate(() => ({paused: player.paused, muted: player.muted, time: player.currentTime, result: playResult}));
    assert.equal(state.paused, true); assert.equal(state.muted, true); assert.equal(state.time, 0); assert.equal(state.result, 'pending');
    await patch({enabled: false});
    await page.waitForFunction(() => !player.paused && player.currentTime > .1 && playResult === 'resolved');
    assert.equal(await page.evaluate(() => player.muted), false);
    await patch({enabled: true});
    await page.waitForFunction(() => player.paused && player.muted);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => player.paused), true);
  });
  await test('Strict mode holds a music service before title metadata arrives', async () => {
    await context.unroute('https://open.spotify.com/**');
    await context.route('https://open.spotify.com/**', route => route.fulfill({contentType: 'text/html', body: fixture({title: '', artist: ''})}));
    await page.goto('https://open.spotify.com/track/unidentified');
    await page.waitForTimeout(2100);
    assert.equal(await page.evaluate(() => player.paused), true);
    assert.equal(await page.evaluate(() => player.currentTime), 0);
  });
  await test('Strict mode holds a YouTube player whose category is unavailable', async () => {
    await context.unroute('https://www.youtube.com/**');
    await context.route('https://www.youtube.com/**', route => route.fulfill({contentType: 'text/html', body: fixture({title: 'Unlabelled video', artist: 'Unknown channel', category: '', youtube: true})}));
    await page.goto('https://www.youtube.com/watch?v=fixture');
    await page.waitForTimeout(2100);
    assert.equal(await page.evaluate(() => player.paused), true);
    assert.equal(await page.evaluate(() => player.currentTime), 0);
    await send({type: 'TRACK_RULE', key: 'unlabelled video|unknown channel', rule: 'allow'});
    await page.waitForFunction(() => !player.paused);
  });
  await test('Web Audio resumes only after its track is allowed', async () => {
    await context.unroute('https://open.spotify.com/**');
    await context.route('https://open.spotify.com/**', route => route.fulfill({contentType: 'text/html', body: fixture()}));
    await page.goto('https://open.spotify.com/track/audio-context');
    await page.evaluate(() => {
      window.audioContext = new AudioContext(); window.resumeResult = 'pending';
      audioContext.resume().then(() => resumeResult = 'resolved', error => resumeResult = error.name);
    });
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => audioContext.state), 'suspended');
    assert.equal(await page.evaluate(() => resumeResult), 'pending');
    await send({type: 'TRACK_RULE', key: 'tum hi ho|arijit singh', rule: 'allow'});
    await page.waitForFunction(() => audioContext.state === 'running' && resumeResult === 'resolved');
    await page.evaluate(() => audioContext.close());
    await send({type: 'TRACK_RULE', key: 'tum hi ho|arijit singh', rule: 'clear'});
  });
  await test('A music player in a cross origin iframe is also held', async () => {
    await context.route('https://frame.fixture.test/**', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Embedded player</title><iframe src="https://open.spotify.com/embed/track/fixture"></iframe>'}));
    await page.goto('https://frame.fixture.test/player');
    const frame = page.frames().find(frame => frame.url().includes('open.spotify.com'));
    assert(frame);
    await frame.waitForFunction(() => window.player);
    await page.waitForTimeout(800);
    assert.equal(await frame.evaluate(() => player.paused), true);
    assert.equal(await frame.evaluate(() => player.currentTime), 0);
  });
  await test('Blocked video displays the loading overlay', async () => {
    await page.goto('https://open.spotify.com/track/video');
    await page.evaluate(() => {
      const video = document.createElement('video'); video.width = 640; video.height = 360;
      video.style.background = '#182721'; document.body.append(video);
    });
    await page.waitForSelector('quietgate-buffer', {state: 'visible'});
    assert.equal(await page.locator('quietgate-buffer').getAttribute('aria-hidden'), 'true');
    await page.screenshot({path: path.join(root, 'artifacts', 'buffering.png')});
  });
  await test('Enabled state and rule changes persist on reload', async () => {
    await ui.reload(); await ui.waitForFunction(() => !document.getElementById('settings-fields').disabled);
    assert.equal(await ui.locator('#enabled').isChecked(), true);
    assert.equal(await ui.locator('#strict').isChecked(), true);
    assert.equal(await ui.locator('input[value="hindi"]').isChecked(), true);
    await ui.screenshot({path: path.join(root, 'artifacts', 'settings.png'), fullPage: true});
    assert.deepEqual(errors, []);
  });
} finally {
  await writeFile(path.join(root, 'artifacts', 'browser-results.json'), JSON.stringify({testedAt: new Date().toISOString(), results}, null, 2));
  await context?.close();
  // The generated profile must be a direct child of this project's test directory.
  if (path.dirname(profile) === profileRoot && path.basename(profile).startsWith('browser-')) await rm(profile, {recursive: true, force: true});
}
