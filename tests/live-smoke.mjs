// Optional public page smoke check. No account login, user profile or audible audio.
// This is observational, not proof of authenticated streaming playback support.
import {chromium} from 'playwright';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profileRoot = path.join(root, '.test-profiles');
await mkdir(profileRoot, {recursive: true});
const profile = await mkdtemp(path.join(profileRoot, 'live-'));
let context;
const observations = [];
try {
  context = await chromium.launchPersistentContext(profile, {channel: 'chromium', headless: true,
    args: [`--load-extension=${path.join(root, 'extension')}`, `--disable-extensions-except=${path.join(root, 'extension')}`, '--mute-audio'],
    viewport: {width: 1280, height: 850}});
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${id}/ui/options.html`);
  for (const url of ['https://www.youtube.com/watch?v=VNs_cCtdbPc', 'https://open.spotify.com/track/58f4twRnbZOOVUhMUpplJ4']) {
    const page = await context.newPage();
    try {
      const response = await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 35000});
      await page.waitForTimeout(6000);
      await page.bringToFront();
      const status = await ui.evaluate(async () => {
        const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
        return (await chrome.runtime.sendMessage({type: 'GET_STATE', tabId: tab.id})).status;
      });
      const details = await page.evaluate(() => ({
        title: document.title,
        genre: document.querySelector('meta[itemprop="genre"]')?.content || '',
        media: [...document.querySelectorAll('audio,video')].map(element => ({paused: element.paused, currentTime: element.currentTime, muted: element.muted})),
        hasMusicRecording: [...document.querySelectorAll('script[type="application/ld+json"]')].some(element => element.textContent.includes('MusicRecording'))
      }));
      const observation = {url, httpStatus: response?.status(), status, details};
      observations.push(observation); console.log(JSON.stringify(observation, null, 2));
    } catch (error) { observations.push({url, error: error.message}); console.log('OBSERVATION ' + error.message); }
    finally { await page.close(); }
  }
} finally {
  await mkdir(path.join(root, 'artifacts'), {recursive: true});
  await writeFile(path.join(root, 'artifacts', 'live-smoke.json'), JSON.stringify({testedAt: new Date().toISOString(), observations}, null, 2));
  await context?.close();
  if (path.dirname(profile) === profileRoot && path.basename(profile).startsWith('live-')) await rm(profile, {recursive: true, force: true});
}
