import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

// Point this at an extracted release to exercise the shipped app with the same checks.
const root = process.env.ZACTION_E2E_ROOT ? resolve(process.env.ZACTION_E2E_ROOT) : resolve(import.meta.dirname, '..');
if (!existsSync(join(root, 'dist/index.html'))) throw new Error('Run npm run build before the production browser tests.');
const temporary = await mkdtemp(join(tmpdir(), 'zaction-browser-'));
const socket = createServer();
await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
let output = '';
let browser;
let passed = 0;
const child = spawn(process.execPath, ['server.mjs'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ZACTION_DATA_FILE: join(temporary, 'demo-room.json') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });

const pause = duration => new Promise(resolve => setTimeout(resolve, duration));
async function eventually(check, label, timeout = 15000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try { if (await check()) return; }
    catch (error) { last = error; }
    await pause(100);
  }
  throw new Error(`Timed out: ${label}${last ? ` (${last.message})` : ''}`);
}
function pass(label) { passed++; console.log(`PASS ${passed}: ${label}`); }
async function snapshot() {
  const response = await fetch(`${origin}/api/state`, { signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200);
  return response.json();
}
async function local(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('zaction-local-v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('records')) { db.close(); resolve(null); return; }
      const read = db.transaction('records').objectStore('records').get('state');
      read.onsuccess = () => { db.close(); resolve(read.result ?? null); };
      read.onerror = () => reject(read.error);
    };
  }));
}
async function navigate(page, view) {
  await page.evaluate(view => { location.hash = view; }, view);
}
async function foreground(page) {
  await page.bringToFront();
  await page.evaluate(() => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); });
}

const pageErrors = [];
async function openPage(context) {
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(origin, { waitUntil: 'networkidle' });
  await eventually(async () => Boolean((await local(page))?.snapshot), 'initial room persisted');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload({ waitUntil: 'networkidle' });
  assert.ok(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)));
  return page;
}
async function joinMember(page, memberId) {
  await page.getByTestId('join-demo').click();
  await page.getByTestId(`member-${memberId}`).check();
  await page.getByTestId('confirm-join').click();
  await eventually(async () => (await local(page))?.memberId === memberId, `join ${memberId}`);
}

try {
  await eventually(async () => {
    if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
    return (await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) })).ok;
  }, 'production server health');
  const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath());
  browser = await chromium.launch({
    executablePath, headless: true,
    env: { ...process.env, XDG_CACHE_HOME: join(temporary, 'cache'), XDG_CONFIG_HOME: join(temporary, 'config') },
  });
  const alexContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const riverContext = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const julesContext = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const alex = await openPage(alexContext);
  const initial = await snapshot();
  assert.deepEqual(initial.ballots, []);
  assert.deepEqual(initial.contributions, []);
  assert.match((await local(alex)).identityFingerprint, /^[0-9a-f]{16}$/);
  const identity = (await local(alex)).identityFingerprint;
  const manifestURL = await alex.locator('link[rel="manifest"]').getAttribute('href');
  const manifestResponse = await fetch(new URL(manifestURL, origin));
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));
  for (const icon of manifest.icons) {
    const response = await fetch(new URL(icon.src, origin));
    assert.equal(response.status, 200, `manifest icon ${icon.src}`);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  await alex.screenshot({ path: '/tmp/zaction-home-desktop.png', fullPage: true });
  pass('production app, install manifest/icons, secure local identity and controlling service worker');

  const river = await openPage(riverContext);
  const jules = await openPage(julesContext);
  await joinMember(alex, 'alex');
  await joinMember(river, 'river');
  await joinMember(jules, 'jules');
  await navigate(alex, 'action');
  const question = 'Could the reading circle include a step-free route and plain-language handout?';
  await alexContext.setOffline(true);
  await alex.getByTestId('contribution-input').fill(question);
  await alex.getByTestId('save-draft').click();
  await eventually(async () => (await local(alex))?.draft === question, 'offline draft persisted');
  const offlineNavigation = await alex.reload({ waitUntil: 'domcontentloaded' });
  assert.ok(offlineNavigation.fromServiceWorker(), 'offline app shell came from the actual production worker');
  await alex.getByTestId('contribution-input').waitFor();
  assert.equal(await alex.getByTestId('contribution-input').inputValue(), question);
  assert.equal((await local(alex)).identityFingerprint, identity);
  pass('offline cached app reload retains the exact draft and device identity');

  await alexContext.setOffline(false);
  await foreground(alex);
  await alex.getByTestId('publish-contribution').click();
  await eventually(async () => (await snapshot()).contributions.length === 1, 'published contribution');
  await foreground(river);
  await eventually(async () => (await local(river))?.snapshot.contributions.some(item => item.text === question), 'second browser receives contribution');
  pass('explicit contribution publication reaches a second browser once');

  await navigate(alex, 'proposal');
  await alexContext.setOffline(true);
  await alex.getByTestId('choice-approve').check();
  await alex.getByTestId('submit-vote').click();
  await alex.getByTestId('pending-status').waitFor();
  await eventually(async () => (await local(alex))?.pending.some(item => item.type === 'vote'), 'ballot intent persisted');
  assert.equal((await snapshot()).ballots.length, 0);
  assert.match(await alex.getByTestId('accepted-ballot-count').innerText(), /^0\s*\/\s*3/);
  await alex.reload({ waitUntil: 'domcontentloaded' });
  await alex.getByTestId('pending-status').waitFor();
  assert.equal((await local(alex)).pending.filter(item => item.type === 'vote').length, 1);
  pass('offline ballot remains pending across reload and never increments accepted totals');

  assert.deepEqual((await local(river)).progress, { read: false, reviewed: false });
  await navigate(river, 'proposal');
  await river.getByTestId('choice-approve').check();
  await river.getByTestId('submit-vote').click();
  await eventually(async () => (await snapshot()).ballots.length === 1, 'member without progress votes');
  await alexContext.setOffline(false);
  await foreground(alex);
  await eventually(async () => (await snapshot()).ballots.length === 2 && !(await local(alex)).pending.some(item => item.type === 'vote'), 'queued ballot accepted');
  await foreground(alex);
  await foreground(alex);
  await pause(500);
  const accepted = await snapshot();
  assert.equal(accepted.ballots.length, 2);
  assert.equal(accepted.ballots.filter(item => item.memberId === 'alex').length, 1);
  assert.equal(accepted.outcome, 'open');
  pass('foreground reconnect accepts one queued ballot; no progress gate or duplicate voting weight');

  await foreground(jules);
  await eventually(async () => (await local(jules))?.snapshot.ballots.length === 2, 'third context current open proposal');
  await navigate(jules, 'proposal');
  await julesContext.setOffline(true);
  await jules.getByTestId('choice-abstain').check();
  await jules.getByTestId('submit-vote').click();
  await jules.getByTestId('pending-status').waitFor();
  await river.getByTestId('close-demo-vote').click();
  await river.getByTestId('confirm-close').click();
  await eventually(async () => (await snapshot()).outcome === 'adopted', 'explicit demo close');
  await river.getByTestId('vote-outcome').waitFor();
  await julesContext.setOffline(false);
  await foreground(jules);
  await eventually(async () => (await local(jules))?.receipts.some(item => item.type === 'vote' && !item.accepted), 'late ballot rejected');
  assert.equal((await snapshot()).ballots.length, 2);
  await jules.reload({ waitUntil: 'networkidle' });
  const rejection = (await local(jules)).receipts.find(item => item.type === 'vote' && !item.accepted);
  assert.equal(rejection.operation.choice, 'abstain');
  assert.match(rejection.reason, /closed|deadline/i);
  const retainedSubmission = jules.getByTestId('submission-history').locator('[data-submission-status="rejected"]');
  await retainedSubmission.waitFor();
  assert.match(await retainedSubmission.innerText(), /abstain/i);
  assert.match(await retainedSubmission.innerText(), /closed|deadline/i);
  pass('explicit closure produces adoption; late offline ballot is rejected with its intent retained after reload');

  const notes = 'The demo adopted the free reading-circle plan with two approvals. Venue access is still unconfirmed.';
  await river.getByTestId('minutes-input').fill(notes);
  await river.getByTestId('publish-minutes').click();
  await eventually(async () => (await snapshot()).minutes.length === 1, 'human publishes minutes');
  const correction = notes + ' Correction: the next task is to check step-free access, not to book a room.';
  await river.getByTestId('minutes-input').fill(correction);
  await river.getByTestId('publish-minutes').click();
  await eventually(async () => (await snapshot()).minutes.length === 2, 'minutes correction appended');
  assert.equal((await snapshot()).minutes[0].text, notes);
  pass('human-reviewed minutes and corrections preserve both published versions');

  const storageContext = await browser.newContext();
  const storagePage = await openPage(storageContext);
  await joinMember(storagePage, 'alex');
  await navigate(storagePage, 'action');
  const unsaved = 'Keep this question visible when a storage write fails.';
  await storagePage.getByTestId('contribution-input').fill(unsaved);
  await storagePage.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    window.__restoreZactionPut = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = function () { throw new DOMException('Simulated quota exceeded', 'QuotaExceededError'); };
  });
  try {
    await storagePage.getByTestId('save-draft').click();
    await storagePage.getByText(/Could not save on this device/).first().waitFor();
    assert.equal(await storagePage.getByTestId('contribution-input').inputValue(), unsaved);
    assert.notEqual((await local(storagePage)).draft, unsaved);
  } finally {
    await storagePage.evaluate(() => window.__restoreZactionPut());
  }
  await storageContext.close();
  pass('failed browser-storage writes keep input visible and never claim durable saving');

  const sharedContext = await browser.newContext();
  const firstTab = await openPage(sharedContext);
  await joinMember(firstTab, 'river');
  const secondTab = await openPage(sharedContext);
  await navigate(firstTab, 'action');
  await navigate(secondTab, 'action');
  await sharedContext.setOffline(true);
  await firstTab.getByTestId('contribution-input').fill('First tab: could we provide a large-print agenda?');
  await secondTab.getByTestId('contribution-input').fill('Second tab: could we offer a quiet participation option?');
  await Promise.all([
    firstTab.getByTestId('publish-contribution').click(),
    secondTab.getByTestId('publish-contribution').click(),
  ]);
  await eventually(async () => (await local(firstTab))?.pending.filter(item => item.type === 'contribute').length === 2, 'both tabs retain queued operations');
  await sharedContext.setOffline(false);
  await foreground(firstTab);
  await foreground(secondTab);
  await eventually(async () => (await snapshot()).contributions.length === 3 && (await local(firstTab)).pending.length === 0, 'both tab operations accepted exactly once');
  await sharedContext.close();
  pass('simultaneous tabs preserve both offline queue entries and reconcile them without duplicates');

  const corruptContext = await browser.newContext();
  const corruptPage = await openPage(corruptContext);
  const corruptRecord = { malformed: true, draft: 42, pending: 'corrupt-sentinel' };
  await corruptPage.evaluate(value => new Promise((resolve, reject) => {
    const request = indexedDB.open('zaction-local-v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('records', 'readwrite');
      transaction.objectStore('records').put(value, 'state');
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  }), corruptRecord);
  await corruptPage.reload({ waitUntil: 'networkidle' });
  await corruptPage.getByText(/Browser storage could not be opened|Saved data needs review/).first().waitFor();
  await navigate(corruptPage, 'action');
  await corruptPage.getByTestId('contribution-input').fill('Do not overwrite the saved record while recovery is required.');
  await corruptPage.getByTestId('save-draft').click();
  await pause(200);
  assert.deepEqual(await local(corruptPage), corruptRecord);
  assert.equal(await corruptPage.getByText(/^Draft saved on this device/).count(), 0);
  await corruptContext.close();
  pass('corrupt browser records remain intact for recovery and cannot be overwritten by polling or saves');

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobile = await openPage(mobileContext);
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'home has no mobile horizontal overflow');
  await mobile.screenshot({ path: '/tmp/zaction-home-mobile.png', fullPage: true });
  await navigate(mobile, 'proposal');
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'proposal has no mobile horizontal overflow');
  await mobile.screenshot({ path: '/tmp/zaction-proposal-mobile.png', fullPage: true });
  await mobileContext.close();
  assert.deepEqual(pageErrors, [], 'all tested pages completed without uncaught JavaScript errors');
  pass('responsive desktop/mobile screens have no horizontal overflow or uncaught JavaScript errors');
  console.log(`Completed ${passed} production browser checks. No real-phone, GPU, encrypted messaging, or official election-vote validation is claimed.`);
} catch (error) {
  if (output) console.error('Test server output:', output.trim());
  throw error;
} finally {
  if (browser) await browser.close();
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), pause(2000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  await rm(temporary, { recursive: true, force: true });
}
