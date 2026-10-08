import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profileRoot = path.join(root, '.test-profiles');
const artifacts = path.join(root, 'artifacts');
await mkdir(profileRoot, {recursive:true}); await mkdir(artifacts, {recursive:true});
const profile = await mkdtemp(path.join(profileRoot, 'ui-browser-'));
const results = [], errors = [];
let context;
async function test(name, action) {
  try { await action(); results.push({name, passed:true}); console.log('PASS ' + name); }
  catch (error) { results.push({name, passed:false, error:error.message}); throw error; }
}
try {
  context = await chromium.launchPersistentContext(profile, {
    channel:'chromium', headless:true,
    args:[`--disable-extensions-except=${path.join(root,'extension')}`, `--load-extension=${path.join(root,'extension')}`, '--mute-audio'],
    viewport:{width:1000,height:900}, colorScheme:'light'
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/ui/options.html`);
  await options.waitForFunction(() => !document.getElementById('settings-fields').disabled);
  const send = message => options.evaluate(message => chrome.runtime.sendMessage(message), message);
  const current = async () => (await send({type:'GET_STATE'})).settings;
  const waitSettings = async predicate => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { if (predicate(await current())) return; await new Promise(resolve => setTimeout(resolve,25)); }
    throw new Error('Saved settings did not match within ten seconds');
  };
  await test('Actual options page reads defaults and saves switches', async () => {
    assert.equal(await options.locator('#enabled').isChecked(),true);
    assert.equal(await options.locator('#strict').isChecked(),true);
    await options.locator('#artistMatching').uncheck(); await waitSettings(settings => settings.artistMatching === false);
    await options.locator('#enabled').uncheck(); await waitSettings(settings => settings.enabled === false);
    await options.locator('#enabled').check(); await waitSettings(settings => settings.enabled === true);
  });
  await test('Language, phrase, and domain edits persist across a real reload', async () => {
    await options.locator('input[value="tamil"]').check();
    await options.locator('#phrases').fill('party remix\ncustom phrase'); await options.locator('#phrases').blur();
    await options.locator('#allowedHosts').fill('example.com\nmusic.example.org'); await options.locator('#allowedHosts').blur();
    await waitSettings(settings => settings.languages.includes('tamil') && settings.phrases.length === 2 && settings.allowedHosts.length === 2);
    await options.reload(); await options.waitForFunction(() => !document.getElementById('settings-fields').disabled);
    assert.equal(await options.locator('#artistMatching').isChecked(),false);
    assert.equal(await options.locator('input[value="tamil"]').isChecked(),true);
    assert.equal(await options.locator('#phrases').inputValue(),'party remix\ncustom phrase');
    assert.equal(await options.locator('#allowedHosts').inputValue(),'example.com\nmusic.example.org');
  });
  await test('Invalid domain edits stay unsaved and retain the entered text', async () => {
    await options.locator('#allowedHosts').fill('https://example.com/path'); await options.locator('#allowedHosts').blur();
    await options.waitForFunction(() => document.getElementById('allowedHosts').getAttribute('aria-invalid') === 'true');
    assert.deepEqual((await current()).allowedHosts,['example.com','music.example.org']);
    assert.equal(await options.locator('#allowedHosts').inputValue(),'https://example.com/path');
    await options.reload(); await options.waitForFunction(() => !document.getElementById('settings-fields').disabled);
  });
  let exported;
  await test('Export contains the real saved settings', async () => {
    const expected = await current();
    const downloadEvent = options.waitForEvent('download'); await options.locator('#export').click();
    const download = await downloadEvent;
    assert.equal(download.suggestedFilename(),'AdblockerPro.settings.json');
    exported = JSON.parse(await readFile(await download.path(),'utf8'));
    assert.deepEqual(exported,expected);
  });
  await test('Reset cancel and Escape preserve data and confirmation resets it', async () => {
    await options.locator('#reset').click(); await options.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.deepEqual(await current(),exported);
    await options.locator('#reset').click(); await options.keyboard.press('Escape'); assert.deepEqual(await current(),exported);
    await options.locator('#reset').click(); await options.locator('#confirm-reset').click();
    await waitSettings(settings => settings.artistMatching === true && settings.phrases.length === 0 && !settings.languages.includes('tamil'));
    await options.locator('#reset').click(); await options.keyboard.press('Escape');
    assert.equal((await current()).enabled,true);
  });
  await test('Import restores exported settings through the real worker', async () => {
    await options.locator('#import-file').setInputFiles({name:'settings.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
    await waitSettings(settings => settings.artistMatching === false && settings.phrases.length === 2);
    assert.deepEqual(await current(),exported);
    assert.equal(await options.locator('#phrases').inputValue(),'party remix\ncustom phrase');
  });
  await test('Imports reject arbitrary keys and files larger than 100 KB', async () => {
    await options.locator('#import-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...exported,unknown:true}))});
    await options.waitForFunction(() => document.getElementById('feedback').dataset.error === 'true');
    assert.deepEqual(await current(),exported);
    await options.locator('#import-file').setInputFiles({name:'big.json',mimeType:'application/json',buffer:Buffer.alloc(100*1024+1,32)});
    await options.waitForFunction(() => document.getElementById('feedback').textContent.includes('100 KB'));
    assert.deepEqual(await current(),exported);
  });
  const music = await context.newPage();
  await context.route('https://open.spotify.com/**', route => route.fulfill({contentType:'text/html',body:route.request().url().endsWith('/empty') ? '<!doctype html><html><head><title>Empty player</title></head><body></body></html>' : '<!doctype html><html><head><title>Music fixture</title></head><body><div data-testid="now-playing-widget"><a data-testid="nowplaying-track-link">Tum Hi Ho</a><a data-testid="context-item-info-artist">Arijit Singh</a></div><script>navigator.mediaSession.metadata=new MediaMetadata({title:"Tum Hi Ho",artist:"Arijit Singh"});</script></body></html>'}));
  await music.goto('https://open.spotify.com/track/fixture'); await music.bringToFront();
  const popupEvent = context.waitForEvent('page');
  await options.evaluate(() => chrome.tabs.create({url:chrome.runtime.getURL('ui/popup.html'),active:false}));
  const popup = await popupEvent;
  await popup.waitForFunction(() => document.getElementById('track-title').textContent === 'Tum Hi Ho');
  await test('Popup reads the active track and saves exact allow and block rules', async () => {
    assert.equal(await popup.locator('#track-artist').textContent(),'Arijit Singh');
    await popup.locator('#allow-track').click(); await waitSettings(settings => settings.allowTracks.includes('tum hi ho|arijit singh'));
    await popup.waitForFunction(() => document.getElementById('allow-track').getAttribute('aria-pressed') === 'true');
    await popup.locator('#block-track').click(); await waitSettings(settings => settings.blockTracks.includes('tum hi ho|arijit singh') && settings.allowTracks.length === 0);
    await popup.waitForFunction(() => document.getElementById('block-track').getAttribute('aria-pressed') === 'true');
    await popup.waitForFunction(() => document.getElementById('state').textContent === 'Blocked');
    await popup.setViewportSize({width:360,height:360}); await popup.waitForTimeout(200);
    await popup.screenshot({path:path.join(artifacts,'popup.png')});
  });
  await test('Options track removal clears the exact rule in storage', async () => {
    await options.reload(); await options.waitForFunction(() => !document.getElementById('settings-fields').disabled);
    assert.equal(await options.locator('#blockTracks li').count(),1);
    await options.locator('#blockTracks button').click(); await waitSettings(settings => settings.blockTracks.length === 0);
    assert.equal(await options.locator('#block-empty').isVisible(),true);
  });
  await test('Popup empty track disables exact rule actions', async () => {
    await music.goto('https://open.spotify.com/empty');
    await popup.waitForFunction(() => document.getElementById('track-title').textContent === 'No track detected');
    assert.equal(await popup.locator('#allow-track').isDisabled(),true);
    assert.equal(await popup.locator('#block-track').isDisabled(),true);
  });
  await test('An unsupported tab shows Ready without a pending update', async () => {
    const blank = await context.newPage(); await blank.goto('about:blank'); await blank.bringToFront();
    const newPopupEvent = context.waitForEvent('page');
    await options.evaluate(() => chrome.tabs.create({url:chrome.runtime.getURL('ui/popup.html'),active:false}));
    const emptyPopup = await newPopupEvent;
    await emptyPopup.waitForFunction(() => document.getElementById('state').textContent === 'Ready');
    assert.equal(await emptyPopup.locator('#allow-track').isDisabled(),true);
    assert.equal(await emptyPopup.locator('#block-track').isDisabled(),true);
    await emptyPopup.close(); await blank.close();
  });
  await test('Small settings layout has no overflow and no runtime errors', async () => {
    await options.setViewportSize({width:375,height:812}); await options.waitForTimeout(200);
    await options.evaluate(() => window.scrollTo(0,0));
    assert.equal(await options.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
    await options.screenshot({path:path.join(artifacts,'options-mobile.png'),fullPage:true});
    assert.deepEqual(errors,[]);
  });
} finally {
  await writeFile(path.join(artifacts,'ui-browser-results.json'),JSON.stringify({testedAt:new Date().toISOString(),results},null,2));
  await context?.close();
  if (path.dirname(profile) === profileRoot && path.basename(profile).startsWith('ui-browser-')) await rm(profile,{recursive:true,force:true});
}
