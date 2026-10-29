import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
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
const child = spawn(process.execPath, ['--use-env-proxy', 'server.mjs'], {
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
async function local(page, key = 'state') {
  return page.evaluate(key => new Promise((resolve, reject) => {
    const request = indexedDB.open('zaction-local-v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('records')) { db.close(); resolve(null); return; }
      const read = db.transaction('records').objectStore('records').get(key);
      read.onsuccess = () => { db.close(); resolve(read.result ?? null); };
      read.onerror = () => reject(read.error);
    };
  }), key);
}
async function navigate(page, view) {
  await page.evaluate(view => { location.hash = view; }, view);
}
async function foreground(page) {
  await page.bringToFront();
  await page.evaluate(() => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); });
}

const pageErrors = [];
const newContext = (options = {}) => browser.newContext({ timezoneId: 'America/New_York', ...options });
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

const SEED = 'reading-circle';
const planDate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
function target(room, id = SEED) {
  const action = room.actions.find(action => action.id === id);
  assert.ok(action, `action ${id} exists`);
  return action;
}
async function select(page, id, view = 'action') {
  await page.evaluate(({ id, view }) => { location.hash = `${view}/${encodeURIComponent(id)}`; }, { id, view });
  await eventually(async () => (await local(page))?.selectedActionId === id, `selected action ${id}`);
  await page.evaluate(() => window.scrollTo({ top: 0 }));
}
async function closeVote(page) {
  const close = page.getByTestId('close-demo-vote');
  if (!await close.isVisible()) {
    const tools = page.getByTestId('preview-vote-tools');
    if (await tools.evaluate(element => element.tagName === 'DETAILS')) await tools.locator('summary').click();
    else await tools.click();
  }
  await close.click();
  await page.getByTestId('confirm-close').click();
}
async function capture(page, state, locator) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (locator) {
    await locator.evaluate(element => element.scrollIntoView({ block: 'start', inline: 'nearest' }));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const box = await locator.boundingBox();
    assert.ok(box && box.y > -2 && box.y < 844, `${state} evidence anchor is visible in the original viewport`);
  }
  await page.screenshot({ path: `/tmp/zaction-social-${state}-390x844.png`, fullPage: false });
  await page.setViewportSize({ width: 1440, height: 1100 });
}
async function saveBrowserRecord(page, value, key = 'state') {
  await page.evaluate(({ value, key }) => new Promise((resolve, reject) => {
    const request = indexedDB.open('zaction-local-v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('records', 'readwrite');
      transaction.objectStore('records').put(value, key);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  }), { value, key });
}
async function assertOnboardingFocus(page) {
  assert.equal(await page.getByTestId('nav-home').count(), 0, 'feed navigation is not rendered behind onboarding');
  assert.equal(await page.getByTestId('mobile-nav-home').count(), 0, 'mobile navigation is not rendered behind onboarding');
  const welcome = page.locator('section[aria-label="Welcome to Zaction"]');
  const count = await welcome.locator('button, input, select, textarea, a[href], [tabindex]').count();
  await page.getByTestId('onboarding-name').focus();
  for (let index = 0; index < count + 2; index++) {
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => document.activeElement === document.body || Boolean(document.activeElement?.closest('section[aria-label="Welcome to Zaction"]'))), 'Tab cannot reach a hidden feed control while onboarding is active');
  }
}
async function onboard(page, name, interests = ['bbq', 'help'], cityId = 'new-york') {
  await page.getByTestId('onboarding-name').waitFor();
  await page.getByTestId('onboarding-name').fill(name);
  await page.getByTestId('onboarding-continue').click();
  await page.getByTestId('onboarding-city').waitFor();
  await page.getByTestId('onboarding-city').selectOption(cityId);
  await page.getByTestId('onboarding-continue').click();
  await page.getByTestId('onboarding-interest-bbq').waitFor();
  for (const interest of ['bbq', 'potluck', 'games', 'walk', 'help', 'idea']) {
    const option = page.getByTestId(`onboarding-interest-${interest}`);
    if ((await option.getAttribute('aria-pressed') === 'true') !== interests.includes(interest)) await option.click();
  }
  await page.getByTestId('onboarding-finish').click();
  await eventually(async () => {
    const state = await local(page);
    return Boolean(state?.community?.onboarded && state?.memberId?.startsWith('member-') &&
      state.community.name === name && state.community.cityId === cityId &&
      JSON.stringify([...state.community.interests].sort()) === JSON.stringify([...interests].sort()) &&
      !await page.getByTestId('onboarding-finish').isVisible());
  }, 'personal public profile saved without an unfinished onboarding dialog');
}
const weather = { mode: 'clear' };
async function mockWeather(context) {
  await context.route('**/api/weather?*', async route => {
    const url = new URL(route.request().url());
    const common = { cityId: url.searchParams.get('cityId') ?? 'new-york', date: url.searchParams.get('date') ?? planDate, sourceUrl: 'https://open-meteo.com/' };
    const body = weather.mode === 'unavailable'
      ? { ...common, status: 'unavailable', reason: 'Controlled test failure: weather provider is unavailable. Try again later.' }
      : { ...common, status: 'available', checkedAt: new Date().toISOString(), temperatureMaxF: 78, temperatureMinF: 64,
        rainChance: weather.mode === 'rain' ? 85 : 20, windMph: weather.mode === 'rain' ? 18 : 7,
        description: weather.mode === 'rain' ? 'Rain (test forecast)' : 'Mainly clear (test forecast)', stale: false };
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(body) });
  });
}
async function fillPlan(page, kind, title, budget = '80', bring = ['A dish to share', 'Water', 'A picnic blanket']) {
  await navigate(page, 'home');
  await page.getByTestId(`template-${kind}`).first().click();
  await page.getByTestId('create-title').fill(title);
  await page.getByTestId('create-description').fill('Bring neighbors together, share a useful conversation, and agree on accessible next steps.');
  for (const [id, value] of [
    ['plan-date', planDate], ['plan-location', 'Community park; exact meeting point still to be agreed'],
    ['plan-budget', budget], ['plan-people', '8'], ['plan-rainplan', 'Use a free covered space after confirming access, or choose another day.'],
    ['plan-accessibility', 'Step-free route and a quiet seating option'], ['plan-bringlist', bring.join('\n')],
  ]) await page.getByTestId(id).fill(value);
  await page.getByTestId('plan-city').selectOption('new-york');
  if (await page.getByTestId('create-beneficiaries').isVisible()) await page.getByTestId('create-beneficiaries').fill('Neighbors who want to meet and share ideas');
  await page.getByTestId('save-creation').click();
  await eventually(async () => (await local(page)).creationDraft.title === title, 'gathering draft saved');
  return (await local(page)).creationDraft.id;
}

async function captureBring(page, state, locator = page.getByTestId('bring-items')) {
  await page.setViewportSize({ width: 390, height: 844 });
  await locator.evaluate(element => element.scrollIntoView({ block: 'start', inline: 'nearest' }));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const box = await locator.boundingBox();
  assert.ok(box && box.y > -2 && box.y < 844, `${state} bring-item state is visible in the original viewport`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'bring items fit the narrow viewport');
  await page.screenshot({ path: `/tmp/zaction-bring-${state}-390x844.png`, fullPage: false });
  await page.setViewportSize({ width: 1440, height: 1100 });
}

async function verifyBringItems(maya, mayaContext, mayaId, noah, noahContext, noahId) {
  const longItem = 'Reusable plates and a clearly marked allergy-friendly serving kit for everyone';
  const items = ['Water', 'Water', longItem, 'Cups'];
  const actionC = await fillPlan(maya, 'bbq', 'Park cookout · bring & share', '80', items);
  await maya.getByTestId('publish-action').click();
  await eventually(async () => (await snapshot()).actions.some(action => action.id === actionC) && !(await local(maya)).pending.length, 'first bring-items plan accepted');
  const actionD = await fillPlan(maya, 'potluck', 'Covered supper · bring & share', '40', items);
  await maya.getByTestId('publish-action').click();
  await eventually(async () => (await snapshot()).actions.some(action => action.id === actionD) && !(await local(maya)).pending.length, 'second bring-items plan accepted');
  await foreground(noah);
  await eventually(async () => (await local(noah)).snapshot.actions.some(action => action.id === actionD), 'second profile sees both bring lists');
  await select(maya, actionC);
  await select(noah, actionC);
  const status = (page, id, index) => page.getByTestId(`bring-status-${id}-${index}`);
  const row = (page, id, index) => page.getByTestId(`bring-row-${id}-${index}`);
  const claim = (page, id, index) => page.getByTestId(`bring-claim-${id}-${index}`);
  const release = (page, id, index) => page.getByTestId(`bring-release-${id}-${index}`);
  const claims = async (id = actionC) => target(await snapshot(), id).bringClaims ?? [];
  const sideEffects = room => room.actions.map(action => ({
    id: action.id, reactions: action.reactions, rsvps: action.rsvps, ballots: action.ballots,
    contributions: action.contributions, minutes: action.minutes, completedTasks: action.completedTasks, outcome: action.outcome,
  }));
  const unrelatedBefore = sideEffects(await snapshot());
  const progressBefore = { maya: (await local(maya)).progress, noah: (await local(noah)).progress };
  assert.equal((await claims()).length, 0);
  assert.equal(await row(maya, actionC, 0).getByText('Water', { exact: true }).count(), 1);
  assert.equal(await row(maya, actionC, 1).getByText('Water', { exact: true }).count(), 1);
  const firstName = await claim(maya, actionC, 0).getAttribute('aria-label');
  const duplicateName = await claim(maya, actionC, 1).getAttribute('aria-label');
  assert.match(firstName, /Water/);
  assert.match(duplicateName, /Water/);
  assert.notEqual(firstName, duplicateName, 'duplicate labels have different accessible slot names');
  await captureBring(maya, 'open');

  const originalButton = await claim(maya, actionC, 0).elementHandle();
  await claim(maya, actionC, 0).focus();
  await maya.keyboard.press('Enter');
  await eventually(async () => (await claims()).some(item => item.itemIndex === 0 && item.memberId === mayaId) && !(await local(maya)).pending.length, 'Enter offers the first duplicate slot');
  assert.ok(await originalButton.evaluate(element => element.isConnected && element === document.activeElement), 'the same native button keeps focus after its command becomes release');
  assert.equal(await originalButton.getAttribute('data-testid'), `bring-release-${actionC}-0`);
  await foreground(noah);
  await eventually(async () => /Maya plans to bring/.test(await status(noah, actionC, 0).innerText()), 'other profile sees the actual accepted owner');
  assert.equal(await release(noah, actionC, 0).count(), 0, 'another member is not offered a release control');
  await claim(noah, actionC, 1).focus();
  await noah.keyboard.press('Space');
  await eventually(async () => (await claims()).some(item => item.itemIndex === 1 && item.memberId === noahId), 'Space offers the second duplicate slot');
  await select(maya, actionD);
  await claim(maya, actionD, 0).focus();
  await maya.keyboard.press('Enter');
  await eventually(async () => (await claims(actionD)).some(item => item.itemIndex === 0 && item.memberId === mayaId), 'same label in another plan is independent');
  assert.deepEqual((await claims()).map(item => [item.itemIndex, item.memberId]).sort(), [[0, mayaId], [1, noahId]]);
  assert.equal((await claims(actionD)).length, 1);
  await select(maya, actionC);
  await maya.getByTestId('bring-refresh').focus();
  await maya.keyboard.press('Enter');
  await eventually(async () => /Noah plans to bring/.test(await status(maya, actionC, 1).innerText()), 'manual availability refresh reconciles the duplicate slot');
  assert.ok(await maya.getByTestId('bring-refresh').evaluate(element => element === document.activeElement), 'availability refresh does not steal keyboard focus');
  await captureBring(maya, 'claimed');
  await maya.getByTestId('bring-items').evaluate(element => element.scrollIntoView({ block: 'start' }));
  await maya.screenshot({ path: '/tmp/zaction-bring-claimed-desktop.png', fullPage: false });
  pass('bring-item native Enter/Space controls preserve focus, distinguish duplicate slots and isolate two plans and real profile owners');

  await mayaContext.setOffline(true);
  await claim(maya, actionC, 2).click();
  await eventually(async () => (await local(maya)).pending.filter(op => op.type === 'bring-item' && op.actionId === actionC && op.itemIndex === 2).length === 1, 'offline offer is durably queued once');
  const pendingClaim = (await local(maya)).pending.find(op => op.type === 'bring-item' && op.itemIndex === 2);
  assert.equal(pendingClaim.intent, 'claim');
  assert.equal(pendingClaim.memberId, mayaId);
  assert.match(await status(maya, actionC, 2).innerText(), /Available/);
  assert.match(await status(maya, actionC, 2).innerText(), /Offer saved on this device.*waiting to be accepted/s);
  assert.equal((await claims()).some(item => item.itemIndex === 2), false, 'queued offers do not reserve on the server');
  const offlineClaimReload = await maya.reload({ waitUntil: 'domcontentloaded' });
  assert.ok(offlineClaimReload.fromServiceWorker());
  await eventually(async () => (await local(maya)).pending.some(op => op.id === pendingClaim.id), 'offline offer keeps its original operation ID after worker reload');
  await captureBring(maya, 'pending-claim', row(maya, actionC, 2));
  await mayaContext.setOffline(false);
  await foreground(maya);
  await eventually(async () => (await claims()).some(item => item.id === pendingClaim.id) && !(await local(maya)).pending.length, 'reconnect accepts the original offer exactly once');
  assert.equal((await claims()).filter(item => item.itemIndex === 2).length, 1);

  await mayaContext.setOffline(true);
  await release(maya, actionC, 2).focus();
  await maya.keyboard.press('Space');
  await eventually(async () => (await local(maya)).pending.some(op => op.type === 'bring-item' && op.intent === 'release' && op.itemIndex === 2), 'offline release queued');
  const pendingRelease = (await local(maya)).pending.find(op => op.type === 'bring-item' && op.intent === 'release');
  assert.equal(pendingRelease.claimId, pendingClaim.id, 'release targets the exact accepted claim');
  assert.match(await status(maya, actionC, 2).innerText(), /You plan to bring this/);
  assert.match(await status(maya, actionC, 2).innerText(), /Release saved on this device.*waiting to be accepted/s);
  assert.equal((await claims()).find(item => item.itemIndex === 2).id, pendingClaim.id, 'queued release does not free accepted ownership');
  const offlineReleaseReload = await maya.reload({ waitUntil: 'domcontentloaded' });
  assert.ok(offlineReleaseReload.fromServiceWorker());
  await eventually(async () => (await local(maya)).pending.some(op => op.id === pendingRelease.id), 'offline release keeps its exact claim and operation IDs');
  assert.match(await status(maya, actionC, 2).innerText(), /You plan to bring this/);
  await captureBring(maya, 'pending-release', row(maya, actionC, 2));
  await mayaContext.setOffline(false);
  await foreground(maya);
  await eventually(async () => !(await claims()).some(item => item.itemIndex === 2) && !(await local(maya)).pending.length, 'accepted release frees only the original slot');
  pass('offline offer and exact-claim release survive real worker reloads without presenting pending intent as accepted availability');

  await foreground(noah);
  await eventually(async () => !target((await local(noah)).snapshot, actionC).bringClaims.some(item => item.itemIndex === 2), 'both profiles observe the open slot before their competing offers');
  await Promise.all([mayaContext.setOffline(true), noahContext.setOffline(true)]);
  await Promise.all([claim(maya, actionC, 2).click(), claim(noah, actionC, 2).click()]);
  await eventually(async () => [await local(maya), await local(noah)].every(state => state.pending.some(op => op.type === 'bring-item' && op.actionId === actionC && op.itemIndex === 2)), 'both real profiles have competing durable offers');
  const raceOperations = [await local(maya), await local(noah)].map(state => state.pending.find(op => op.type === 'bring-item' && op.itemIndex === 2));
  await Promise.all([mayaContext.setOffline(false), noahContext.setOffline(false)]);
  await Promise.all([foreground(maya), foreground(noah)]);
  await eventually(async () => !(await local(maya)).pending.length && !(await local(noah)).pending.length, 'both competing offers receive terminal receipts');
  const raceClaim = (await claims()).filter(item => item.itemIndex === 2);
  assert.equal(raceClaim.length, 1, 'only one competing offer owns the slot');
  const winner = raceClaim[0].memberId === mayaId ? maya : noah;
  const loser = winner === maya ? noah : maya;
  const loserId = winner === maya ? noahId : mayaId;
  const rejectedOperation = raceOperations.find(op => op.memberId === loserId);
  const rejection = (await local(loser)).receipts.find(receipt => receipt.id === rejectedOperation.id);
  assert.equal(rejection.accepted, false);
  assert.equal(rejection.operation.itemIndex, 2);
  assert.equal(rejection.operation.actionId, actionC);
  assert.match(await status(loser, actionC, 2).innerText(), /Offer not accepted:.*already has an accepted offer/s);
  await loser.reload({ waitUntil: 'networkidle' });
  assert.equal((await local(loser)).receipts.find(receipt => receipt.id === rejection.id).accepted, false);
  assert.match(await status(loser, actionC, 2).innerText(), /Offer not accepted/);
  await captureBring(loser, 'conflict', row(loser, actionC, 2));
  await release(winner, actionC, 2).click();
  await eventually(async () => !(await claims()).some(item => item.itemIndex === 2), 'winner deliberately releases the contested slot');
  await foreground(loser);
  await eventually(async () => /Available/.test(await status(loser, actionC, 2).innerText()), 'rejected member reviews refreshed open availability');
  await claim(loser, actionC, 2).focus();
  await loser.keyboard.press('Enter');
  await eventually(async () => (await claims()).some(item => item.itemIndex === 2 && item.memberId === loserId) && !(await local(loser)).pending.length, 'explicit new offer accepted after release');
  const recovered = (await claims()).find(item => item.itemIndex === 2);
  assert.notEqual(recovered.id, rejection.id, 'recovery is a deliberate new operation, not a changed replay');
  assert.equal((await local(loser)).receipts.find(receipt => receipt.id === rejection.id).accepted, false, 'terminal conflict remains in original history');
  await captureBring(loser, 'recovered', row(loser, actionC, 2));
  pass('competing offline offers yield one owner, retain the losing intent across reload and require an explicit fresh retry after release');

  const replayIds = [];
  let dropResponse = true;
  await mayaContext.route('**/api/operations', async route => {
    const operation = route.request().postDataJSON();
    if (operation.type !== 'bring-item' || operation.actionId !== actionC || operation.itemIndex !== 3) return route.continue();
    replayIds.push(operation.id);
    if (!dropResponse) return route.continue();
    await route.fetch(); // The real server commits; only this response is lost.
    await route.abort('failed');
  });
  try {
    await claim(maya, actionC, 3).click();
    await eventually(async () => replayIds.length > 0 && (await claims()).some(item => item.itemIndex === 3) && (await local(maya)).pending.some(op => op.id === replayIds[0]), 'real acceptance with lost response leaves the original intent pending');
    const replayId = replayIds[0];
    assert.equal((await claims()).find(item => item.itemIndex === 3).id, replayId);
    await mayaContext.setOffline(true);
    const lostResponseReload = await maya.reload({ waitUntil: 'domcontentloaded' });
    assert.ok(lostResponseReload.fromServiceWorker());
    assert.ok((await local(maya)).pending.some(op => op.id === replayId));
    dropResponse = false;
    await mayaContext.setOffline(false);
    await foreground(maya);
    await eventually(async () => (await local(maya)).receipts.some(receipt => receipt.id === replayId && receipt.accepted) && !(await local(maya)).pending.length, 'lost-response replay retrieves the stable accepted receipt');
    assert.ok(replayIds.length >= 2, 'the browser retried the operation');
    assert.equal(new Set(replayIds).size, 1, 'all transport retries preserve the original operation ID');
    assert.equal((await claims()).filter(item => item.itemIndex === 3).length, 1);
  } finally { await mayaContext.unroute('**/api/operations'); }
  pass('a committed bring offer with a lost HTTP response replays the same persisted operation after offline reload and creates exactly one claim');

  const safetyDraft = 'Keep this question and every accepted bring-item owner if a response is corrupt.';
  await maya.getByTestId('contribution-input').fill(safetyDraft);
  await maya.getByTestId('save-draft').click();
  await eventually(async () => (await local(maya)).drafts[actionC]?.discussion === safetyDraft, 'draft persisted before malformed snapshot response');
  const prior = await local(maya);
  const malformed = structuredClone(prior.snapshot);
  malformed.sequence += 1000;
  target(malformed, actionC).bringClaims.push({ id: 'bad-remote-claim', itemIndex: 999, memberId: 'unregistered-member', createdAt: new Date().toISOString() });
  await mayaContext.route('**/api/state', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(malformed) }));
  try {
    await maya.getByTestId('bring-refresh').click();
    await maya.getByText('Community updates are unavailable.', { exact: false }).first().waitFor();
    const kept = await local(maya);
    assert.deepEqual(kept.snapshot, prior.snapshot, 'invalid remote claim data cannot replace the valid saved room');
    assert.equal(kept.drafts[actionC].discussion, safetyDraft);
    assert.equal(kept.identityFingerprint, prior.identityFingerprint);
  } finally { await mayaContext.unroute('**/api/state'); }
  await foreground(maya);
  await eventually(async () => (await local(maya)).snapshot.sequence === (await snapshot()).sequence, 'valid availability reconnects after malformed snapshot rejection');
  assert.deepEqual(sideEffects(await snapshot()), unrelatedBefore, 'bring offers never set reactions, RSVPs, ballots, comments, minutes, tasks or outcomes');
  assert.deepEqual({ maya: (await local(maya)).progress, noah: (await local(noah)).progress }, progressBefore, 'bring offers do not award private progress or voting weight');
  assert.deepEqual(target(await snapshot(), actionD).bringClaims.map(item => [item.itemIndex, item.memberId]), [[0, mayaId]], 'later conflict, retry and release never touch the other plan');
  pass('malformed bring-claim responses preserve saved work and accepted ownership; logistics leave social signals, votes, progress and other plans unchanged');
}

async function captureLifecycle(page, state, locator) {
  await page.setViewportSize({ width: 390, height: 844 });
  await locator.evaluate(element => element.scrollIntoView({ block: 'start', inline: 'nearest' }));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const box = await locator.boundingBox();
  assert.ok(box && box.y > -2 && box.y < 844, `${state} lifecycle evidence is visible in the original viewport`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'lifecycle terms and reasons wrap within the narrow viewport');
  await page.screenshot({ path: `/tmp/zaction-lifecycle-${state}-390x844.png`, fullPage: false });
  await page.setViewportSize({ width: 1440, height: 1100 });
}

async function verifyPlanLifecycle(maya, mayaContext, mayaId, noah, noahContext, noahId) {
  const items = ['Water', 'Cups'];
  const first = await fillPlan(maya, 'bbq', 'Courtyard BBQ · original plan', '80', items);
  await maya.getByTestId('publish-action').click();
  await eventually(async () => (await snapshot()).actions.some(action => action.id === first) && !(await local(maya)).pending.length, 'first lifecycle plan published');
  const second = await fillPlan(maya, 'potluck', 'Community supper · original plan', '40', items);
  await maya.getByTestId('publish-action').click();
  await eventually(async () => (await snapshot()).actions.some(action => action.id === second) && !(await local(maya)).pending.length, 'independent lifecycle plan published');
  await foreground(noah);
  await eventually(async () => (await local(noah)).snapshot.actions.some(action => action.id === second), 'other member sees the lifecycle plans');
  const offer = (page, id, index) => page.getByTestId(`bring-claim-${id}-${index}`);
  const release = (page, id, index) => page.getByTestId(`bring-release-${id}-${index}`);
  const lifecycle = action => action.lifecycle ?? { status: 'active', changeId: null };
  const participation = action => ({ contributions: action.contributions, ballots: action.ballots, minutes: action.minutes,
    reactions: action.reactions ?? [], rsvps: action.rsvps ?? [], bringClaims: action.bringClaims ?? [], completedTasks: action.completedTasks,
    outcome: action.outcome, closedAt: action.closedAt });
  const assertFresh = action => {
    for (const field of ['contributions', 'ballots', 'minutes', 'reactions', 'rsvps', 'bringClaims', 'completedTasks']) assert.deepEqual(action[field] ?? [], [], `${field} start empty on the fresh proposal`);
    assert.equal(action.outcome, 'open');
    assert.equal(action.closedAt, null);
    assert.equal(lifecycle(action).status, 'active');
  };
  async function edit(page, id, title, reason, date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)) {
    await select(page, id);
    await page.getByTestId(`plan-update-${id}`).click();
    await page.getByTestId('create-title').fill(title);
    await page.getByTestId('plan-date').fill(date);
    await page.getByTestId('plan-budget').fill('120');
    await page.getByTestId('plan-location').fill('Public library courtyard; access still to be confirmed');
    await page.getByTestId('plan-rainplan').fill('Use the accessible community room after confirming access, or postpone together.');
    await page.getByTestId('change-reason').fill(reason);
    await page.getByTestId('save-plan-change').click();
    await eventually(async () => (await local(page)).planChangeDrafts?.[id]?.title === title && (await local(page)).planChangeDrafts[id].change.reason === reason, 'separate author change draft saved');
    return (await local(page)).planChangeDrafts[id];
  }
  async function openCancel(page, id) {
    await select(page, id);
    await page.getByTestId(`plan-cancel-${id}`).click();
    await page.getByTestId('keep-plan').waitFor();
    await eventually(async () => page.getByTestId('keep-plan').evaluate(element => element === document.activeElement), 'cancellation initially focuses the least destructive choice');
    return page.getByRole('dialog');
  }

  await select(maya, first);
  await maya.getByTestId('contribution-input').fill('Keep shade, step-free access and affordable food in the agreed plan.');
  await maya.getByTestId('publish-contribution').click();
  await offer(maya, first, 0).click();
  await eventually(async () => target(await snapshot(), first).bringClaims.length === 1 && target(await snapshot(), first).contributions.length === 1, 'original plan has real accepted participation');
  await select(noah, first);
  await noah.getByTestId(`rsvp-going-${first}`).click();
  await eventually(async () => target(await snapshot(), first).rsvps.length === 1, 'original RSVP accepted');
  assert.equal(await noah.getByTestId(`plan-update-${first}`).count(), 0, 'non-author has no author change control');
  assert.equal(await noah.getByTestId(`plan-cancel-${first}`).count(), 0, 'non-author has no cancellation control');
  for (const page of [maya, noah]) {
    await select(page, first, 'proposal');
    await page.getByTestId('choice-approve').check();
    await page.getByTestId('submit-vote').click();
    await eventually(async () => target(await snapshot(), first).ballots.some(ballot => ballot.memberId === (page === maya ? mayaId : noahId)), 'original group consent accepted');
  }
  await closeVote(maya);
  await eventually(async () => target(await snapshot(), first).outcome === 'adopted', 'original proposal adopted before terms change');
  await maya.getByTestId('minutes-input').fill('The original courtyard terms were adopted. Later replacement terms need fresh consent.');
  await maya.getByTestId('publish-minutes').click();
  await eventually(async () => target(await snapshot(), first).minutes.length === 1 && !(await local(maya)).pending.length, 'original minutes published');
  await select(maya, first);
  await maya.getByTestId(`save-${first}`).click();
  await eventually(async () => (await local(maya)).savedActionIds.includes(first), 'original plan privately saved');
  await navigate(maya, 'profile');
  await maya.locator('button.progress-row').filter({ hasText: 'Read the plan' }).click();
  await eventually(async () => (await local(maya)).progress[first]?.read === true, 'original private progress recorded before replacement');
  await select(noah, second);
  await offer(noah, second, 0).click();
  await eventually(async () => target(await snapshot(), second).bringClaims.some(claim => claim.memberId === noahId), 'independent original claim accepted');
  const secondBefore = structuredClone(target(await snapshot(), second));
  const unrelatedId = await fillPlan(maya, 'games', 'Private unfinished game-night draft', '24', ['Cards']);
  const unrelatedDraft = structuredClone((await local(maya)).creationDraft);
  const unrelatedDiscussionDrafts = structuredClone((await local(maya)).drafts);
  const reason = 'Move to a covered, accessible courtyard on the following day and review the higher shared estimate before anyone commits.';
  const changedDraft = await edit(maya, first, 'Courtyard BBQ · revised proposal', reason);
  assert.equal(changedDraft.change.actionId, first);
  assert.equal(changedDraft.change.expectedChangeId, null);
  assert.notEqual(changedDraft.id, first);
  assert.equal(changedDraft.planning.budgetCents, 12000);
  assert.deepEqual((await local(maya)).creationDraft, unrelatedDraft, 'editing a published plan preserves unrelated creation work');
  const authorRoom = await snapshot();
  const authorTarget = target(authorRoom, first);
  const noahSession = (await local(noah, 'community-sessions'))[authorRoom.roomId];
  const unauthorized = await fetch(`${origin}/api/operations`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${noahSession.token}` },
    body: JSON.stringify({ id: randomUUID(), type: 'cancel-plan', memberId: noahId, actionId: first,
      roomId: authorRoom.roomId, proposalRevision: authorTarget.proposalRevision, rulesVersion: authorTarget.rulesVersion,
      membershipVersion: authorTarget.membershipVersion, expectedChangeId: null, changeReason: 'A non-author cannot withdraw this listing.' }),
    signal: AbortSignal.timeout(5000),
  });
  const unauthorizedResult = await unauthorized.json();
  assert.equal(unauthorizedResult.receipt.accepted, false);
  assert.match(unauthorizedResult.receipt.reason, /author/i);
  assert.equal(lifecycle(target(await snapshot(), first)).status, 'active');
  await foreground(maya);
  await eventually(async () => (await local(maya)).snapshot.sequence >= unauthorizedResult.snapshot.sequence, 'author sees an unrelated sequence change');
  assert.equal(await maya.getByTestId('publish-plan-change').isDisabled(), false, 'another receipt does not invalidate the exact unchanged lifecycle token');
  const comparison = await maya.getByTestId('change-comparison').innerText();
  assert.match(comparison, /80/);
  assert.match(comparison, /120/);
  assert.match(comparison, /Community park/);
  assert.match(comparison, /Public library courtyard/);
  await captureLifecycle(maya, 'change', maya.getByTestId('change-comparison'));
  await maya.getByTestId('change-comparison').evaluate(element => element.scrollIntoView({ block: 'start' }));
  await maya.screenshot({ path: '/tmp/zaction-lifecycle-change-desktop.png', fullPage: false });
  pass('author-only changes compare old and new terms in a separate durable draft while preserving unrelated work and existing group consent');

  const originalBefore = structuredClone(target(await snapshot(), first));
  await mayaContext.setOffline(true);
  await maya.getByTestId('publish-plan-change').click();
  await eventually(async () => (await local(maya)).pending.some(op => op.type === 'change-plan' && op.actionId === first), 'offline replacement queued against original');
  const replacementOperation = (await local(maya)).pending.find(op => op.type === 'change-plan' && op.actionId === first);
  assert.equal(replacementOperation.replacementActionId, changedDraft.id);
  assert.equal(replacementOperation.expectedChangeId, null);
  assert.equal(replacementOperation.changeReason, reason);
  assert.deepEqual(target(await snapshot(), first), originalBefore, 'queued change has no public effect');
  const pendingReload = await maya.reload({ waitUntil: 'domcontentloaded' });
  assert.ok(pendingReload.fromServiceWorker());
  await eventually(async () => (await local(maya)).pending.some(op => op.id === replacementOperation.id), 'pending author transition survives worker reload');
  assert.equal((await local(maya)).planChangeDrafts[first].planning.rainPlan, changedDraft.planning.rainPlan);
  await captureLifecycle(maya, 'pending-change', maya.getByTestId('change-pending'));
  await mayaContext.setOffline(false);
  await foreground(maya);
  await eventually(async () => lifecycle(target(await snapshot(), first)).status === 'superseded' && !(await local(maya)).pending.length, 'replacement accepted atomically');
  const afterChange = await snapshot();
  const replacement = target(afterChange, changedDraft.id);
  assert.equal(lifecycle(target(afterChange, first)).replacementActionId, replacement.id);
  assert.equal(lifecycle(target(afterChange, first)).changeId, replacementOperation.id);
  assert.deepEqual(participation(target(afterChange, first)), participation(originalBefore), 'adopted terms and their participation remain historical');
  assert.deepEqual(target(afterChange, second), secondBefore, 'another plan remains unchanged');
  assertFresh(replacement);
  assert.deepEqual(replacement.origin, { actionId: first, reason, kind: 'change' });
  assert.equal(replacement.planning.date, changedDraft.planning.date);
  assert.equal(replacement.planning.budgetCents, 12000);
  assert.equal(replacement.planning.rainPlan, changedDraft.planning.rainPlan);
  assert.equal(((await local(maya)).savedActionIds ?? []).includes(replacement.id), false, 'private saves are not retargeted');
  assert.deepEqual((await local(maya)).progress[replacement.id] ?? { read: false, reviewed: false }, { read: false, reviewed: false });
  assert.deepEqual((await local(maya)).creationDraft, unrelatedDraft);
  assert.deepEqual((await local(maya)).drafts, unrelatedDiscussionDrafts, 'replacement leaves existing discussion and minutes drafts on their original targets');
  await select(maya, first);
  await maya.reload({ waitUntil: 'networkidle' });
  assert.equal((await local(maya)).selectedActionId, first, 'reopening a historical URL does not silently redirect');
  await captureLifecycle(maya, 'superseded', maya.getByTestId(`lifecycle-banner-${first}`));
  await maya.getByTestId(`lifecycle-successor-${first}`).click();
  await eventually(async () => (await local(maya)).selectedActionId === replacement.id, 'successor navigation requires an explicit choice');
  pass('offline changes reopen and atomically link a fresh proposal without copying votes, RSVPs, claims, progress or silently redirecting historical links');

  await select(noah, second);
  await noahContext.setOffline(true);
  await offer(noah, second, 1).click();
  await noah.getByTestId(`rsvp-going-${second}`).click();
  await select(noah, second, 'proposal');
  await noah.getByTestId('choice-approve').check();
  await noah.getByTestId('submit-vote').click();
  await eventually(async () => (await local(noah)).pending.filter(op => op.actionId === second).length === 3, 'stale participant saves three original-plan intents');
  const lateIntents = (await local(noah)).pending.filter(op => op.actionId === second);
  const dialog = await openCancel(maya, second);
  const focusables = await dialog.locator('button, input, textarea, select, a[href], [tabindex]').count();
  for (const direction of ['Tab', 'Shift+Tab']) {
    for (let index = 0; index < focusables + 2; index++) {
      await maya.keyboard.press(direction);
      assert.ok(await maya.evaluate(() => Boolean(document.activeElement?.closest('dialog[open]'))), 'Tab and Shift+Tab stay inside cancellation confirmation');
    }
  }
  await maya.keyboard.press('Escape');
  await eventually(async () => maya.getByTestId(`plan-cancel-${second}`).evaluate(element => element === document.activeElement), 'Escape restores cancellation trigger focus');
  assert.equal(lifecycle(target(await snapshot(), second)).status, 'active');
  await openCancel(maya, second);
  const cancellationReason = 'The accessible space is unavailable. Keep the original record while we find a workable day together.';
  await maya.getByTestId('cancel-reason').fill(cancellationReason);
  await maya.getByTestId('keep-plan').click();
  await eventually(async () => maya.getByTestId(`plan-cancel-${second}`).evaluate(element => element === document.activeElement), 'Keep plan restores its trigger without withdrawing anything');
  assert.equal(lifecycle(target(await snapshot(), second)).status, 'active');
  await openCancel(maya, second);
  assert.equal(await maya.getByTestId('cancel-reason').inputValue(), cancellationReason, 'a dismissed reason remains a private draft');
  await mayaContext.setOffline(true);
  await maya.evaluate(() => {
    // The browser still commits a real IndexedDB transaction. Delay only its
    // completion notification to exercise a genuinely unfinished local save.
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
    if (!descriptor?.set) throw new Error('This browser cannot expose the delayed storage-completion fixture.');
    let armed = true;
    const finish = [];
    window.__releaseLifecycleSave = () => {
      armed = false;
      Object.defineProperty(IDBTransaction.prototype, 'oncomplete', descriptor);
      for (const callback of finish.splice(0)) callback();
      delete window.__lifecycleSaveHeld;
    };
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {
      ...descriptor,
      set(listener) {
        const transaction = this;
        descriptor.set.call(transaction, event => {
          const notify = () => { if (typeof listener === 'function') listener.call(transaction, event); };
          if (armed && transaction.mode === 'readwrite') {
            armed = false;
            finish.push(notify);
            window.__lifecycleSaveHeld = true;
          } else notify();
        });
      },
    });
  });
  try {
    await maya.getByTestId('confirm-cancel').click();
    await eventually(async () => maya.evaluate(() => Boolean(window.__lifecycleSaveHeld)), 'cancellation waits for real local-save completion');
    assert.equal(await maya.getByTestId('keep-plan').isDisabled(), true, 'Keep plan cannot imply undo while confirmation is already saving');
    assert.equal(await maya.getByRole('button', { name: 'Close dialog', exact: true }).isDisabled(), true);
    assert.equal(await maya.getByTestId('cancel-reason').getAttribute('readonly'), '');
    await maya.keyboard.press('Escape');
    assert.equal(await maya.getByRole('dialog').isVisible(), true, 'Escape cannot dismiss an in-flight confirmation');
    await maya.mouse.click(5, 5);
    assert.equal(await maya.getByRole('dialog').isVisible(), true, 'the backdrop cannot dismiss an in-flight confirmation');
    assert.equal(lifecycle(target(await snapshot(), second)).status, 'active');
  } finally {
    await maya.evaluate(() => window.__releaseLifecycleSave?.());
  }
  await eventually(async () => (await local(maya)).pending.some(op => op.type === 'cancel-plan' && op.actionId === second), 'offline withdrawal queued');
  await eventually(async () => maya.locator(`#plan-management-heading-${second}`).evaluate(element => element === document.activeElement), 'durable confirmation focuses stable plan-management context');
  const cancelOperation = (await local(maya)).pending.find(op => op.type === 'cancel-plan' && op.actionId === second);
  assert.equal(cancelOperation.expectedChangeId, null);
  assert.equal(cancelOperation.changeReason, cancellationReason);
  assert.equal(lifecycle(target(await snapshot(), second)).status, 'active', 'pending withdrawal leaves the public listing active');
  const cancelReload = await maya.reload({ waitUntil: 'domcontentloaded' });
  assert.ok(cancelReload.fromServiceWorker());
  await eventually(async () => (await local(maya)).pending.some(op => op.id === cancelOperation.id), 'offline cancellation reopens with its exact original target and token');
  await captureLifecycle(maya, 'pending-cancel', maya.getByTestId('cancel-pending').locator('..'));
  await mayaContext.setOffline(false);
  await foreground(maya);
  await eventually(async () => lifecycle(target(await snapshot(), second)).status === 'cancelled' && !(await local(maya)).pending.length, 'author withdrawal accepted after reconnect');
  const cancelled = structuredClone(target(await snapshot(), second));
  assert.equal(lifecycle(cancelled).reason, cancellationReason);
  assert.equal(lifecycle(cancelled).changeId, cancelOperation.id);
  assert.deepEqual(participation(cancelled), participation(secondBefore), 'withdrawal preserves original accepted commitments and open outcome');
  await captureLifecycle(maya, 'cancelled', maya.getByTestId(`lifecycle-banner-${second}`));
  pass('cancellation contains keyboard focus, keeps the safe choice first, restores focus on dismissal and persists an honest offline withdrawal');

  await noahContext.setOffline(false);
  await foreground(noah);
  await eventually(async () => {
    const state = await local(noah);
    return !state.pending.length && lateIntents.every(intent => state.receipts.some(receipt => receipt.id === intent.id && !receipt.accepted));
  }, 'late original-plan intents receive terminal rejections');
  for (const intent of lateIntents) {
    const receipt = (await local(noah)).receipts.find(receipt => receipt.id === intent.id);
    assert.equal(receipt.operation.actionId, second);
    assert.equal(receipt.operation.type, intent.type);
    assert.match(receipt.reason, /cancel|inactive|no longer active/i);
  }
  await noah.reload({ waitUntil: 'networkidle' });
  for (const intent of lateIntents) assert.equal((await local(noah)).receipts.find(receipt => receipt.id === intent.id).accepted, false);
  assert.deepEqual(participation(target(await snapshot(), second)), participation(cancelled));
  await captureLifecycle(noah, 'rejected', noah.getByTestId('submission-history'));
  await select(noah, replacement.id);
  await offer(noah, replacement.id, 0).click();
  await eventually(async () => target(await snapshot(), replacement.id).bringClaims.some(claim => claim.memberId === noahId), 'same item accepted independently on the new proposal');
  const replacementClaim = target(await snapshot(), replacement.id).bringClaims[0];
  await select(noah, second);
  await release(noah, second, 0).click();
  await eventually(async () => target(await snapshot(), second).bringClaims.length === 0 && !(await local(noah)).pending.length, 'exact owner release remains possible on the withdrawn original');
  assert.equal(target(await snapshot(), replacement.id).bringClaims[0].id, replacementClaim.id, 'old-plan release cannot remove the new-plan claim');
  assert.equal(target(await snapshot(), second).ballots.length, 0);
  assert.equal(target(await snapshot(), second).rsvps.length, 0);
  pass('late ballot, RSVP and bring offers stay rejected on their original plan while exact historical releases cannot touch a successor claim');

  await select(maya, second);
  await maya.getByTestId(`plan-again-${second}`).click();
  const restartReason = 'Try a new supper proposal after the space check, with fresh consent from everyone.';
  await maya.getByTestId('create-title').fill('Community supper · new attempt');
  await maya.getByTestId('change-reason').fill(restartReason);
  await maya.getByTestId('save-plan-change').click();
  await eventually(async () => (await local(maya)).planChangeDrafts[second].change.reason === restartReason, 'restart terms saved separately');
  const restartDraft = (await local(maya)).planChangeDrafts[second];
  assert.equal(restartDraft.change.expectedChangeId, cancelOperation.id);
  await maya.getByTestId('publish-plan-change').click();
  await eventually(async () => (await snapshot()).actions.some(action => action.id === restartDraft.id) && !(await local(maya)).pending.length, 'cancelled plan restarts as a fresh proposal');
  assert.equal(lifecycle(target(await snapshot(), second)).status, 'cancelled', 'Plan again never reactivates the old ID');
  assert.equal(lifecycle(target(await snapshot(), second)).reason, cancellationReason);
  assert.equal(lifecycle(target(await snapshot(), second)).replacementActionId, restartDraft.id);
  assert.deepEqual(target(await snapshot(), restartDraft.id).origin, { actionId: second, reason: restartReason, kind: 'restart' });
  assertFresh(target(await snapshot(), restartDraft.id));
  assert.deepEqual((await local(maya)).creationDraft, unrelatedDraft);
  assert.equal((await local(maya)).creationDraft.id, unrelatedId);
  await select(maya, second);
  await maya.reload({ waitUntil: 'networkidle' });
  assert.equal((await local(maya)).selectedActionId, second);
  await captureLifecycle(maya, 'restart', maya.getByTestId(`lifecycle-banner-${second}`));
  pass('Plan again keeps the cancelled URL and reason intact and creates one linked proposal with fresh consent and no unrelated draft loss');

  const staleTab = await openPage(mayaContext);
  const staleReason = 'A private alternate arrangement, saved before the author withdrew this listing.';
  const staleDraft = await edit(staleTab, restartDraft.id, 'Community supper · carefully reviewed retry', staleReason);
  await foreground(noah);
  await eventually(async () => (await local(noah)).snapshot.actions.some(action => action.id === restartDraft.id), 'other profile sees restarted proposal');
  for (const page of [maya, noah]) {
    await select(page, restartDraft.id, 'proposal');
    await page.getByTestId('choice-approve').check();
    await page.getByTestId('submit-vote').click();
    await eventually(async () => target(await snapshot(), restartDraft.id).ballots.some(ballot => ballot.memberId === (page === maya ? mayaId : noahId)), 'new proposal receives its own equal ballots');
  }
  await closeVote(maya);
  await eventually(async () => target(await snapshot(), restartDraft.id).outcome === 'adopted', 'restarted proposal independently adopted');
  await openCancel(maya, restartDraft.id);
  await maya.getByTestId('cancel-reason').fill('The host can no longer organize this date; the adopted group result remains part of the record.');
  await maya.getByTestId('confirm-cancel').click();
  await eventually(async () => lifecycle(target(await snapshot(), restartDraft.id)).status === 'cancelled' && !(await local(maya)).pending.length, 'adopted proposal withdrawn without changing its group result');
  await eventually(async () => maya.locator(`#plan-management-heading-${restartDraft.id}`).evaluate(element => element === document.activeElement), 'accepted withdrawal retains useful focus after the cancellation trigger disappears');
  const cancelledRestart = target(await snapshot(), restartDraft.id);
  assert.equal(cancelledRestart.outcome, 'adopted');
  assert.equal(cancelledRestart.ballots.length, 2);
  await foreground(staleTab);
  await staleTab.getByTestId('review-plan-change').waitFor();
  assert.equal((await local(staleTab)).planChangeDrafts[restartDraft.id].change.expectedChangeId, staleDraft.change.expectedChangeId, 'background synchronization does not silently rebase saved author intent');
  assert.equal(await staleTab.getByTestId('create-title').inputValue(), staleDraft.title);
  assert.ok(await staleTab.getByTestId('publish-plan-change').isDisabled(), 'stale terms require review before a new attempt');
  await captureLifecycle(staleTab, 'stale', staleTab.locator('.creation-form'));
  await staleTab.getByTestId('review-plan-change').click();
  await eventually(async () => (await local(staleTab)).planChangeDrafts[restartDraft.id].change.expectedChangeId === lifecycle(cancelledRestart).changeId, 'explicit review adopts the current cancellation token');
  assert.equal(await staleTab.getByTestId('create-title').inputValue(), staleDraft.title);
  assert.equal(await staleTab.getByTestId('change-reason').inputValue(), staleReason);
  const reviewed = (await local(staleTab)).planChangeDrafts[restartDraft.id];
  await staleTab.getByTestId('publish-plan-change').click();
  await eventually(async () => (await snapshot()).actions.some(action => action.id === reviewed.id) && !(await local(staleTab)).pending.length, 'explicitly reviewed restart accepted');
  assertFresh(target(await snapshot(), reviewed.id));
  assert.equal(target(await snapshot(), reviewed.id).origin.kind, 'restart');
  assert.equal(target(await snapshot(), restartDraft.id).outcome, 'adopted');
  assert.deepEqual((await local(staleTab)).creationDraft, unrelatedDraft);
  await select(staleTab, reviewed.id);
  await captureLifecycle(staleTab, 'recovery', staleTab.getByTestId(`lifecycle-origin-${reviewed.id}`));
  await staleTab.close();
  pass('stale author drafts remain private until explicit review, and withdrawing an adopted listing preserves the decision before a fresh restart');

  const finalDraft = await edit(maya, reviewed.id, 'Community supper · final reviewed proposal', 'Use the newly confirmed accessible room; everyone can reconsider this fresh proposal.');
  const attempts = [];
  let loseResponse = true;
  await mayaContext.route('**/api/operations', async route => {
    const operation = route.request().postDataJSON();
    if (operation.type !== 'change-plan' || operation.actionId !== reviewed.id) return route.continue();
    attempts.push(operation.id);
    if (!loseResponse) return route.continue();
    await route.fetch();
    await route.abort('failed');
  });
  try {
    await maya.getByTestId('publish-plan-change').click();
    await eventually(async () => attempts.length > 0 && (await snapshot()).actions.some(action => action.id === finalDraft.id) && (await local(maya)).pending.some(op => op.id === attempts[0]), 'actual replacement committed while its response is lost');
    const stableId = attempts[0];
    await mayaContext.setOffline(true);
    const lostReload = await maya.reload({ waitUntil: 'domcontentloaded' });
    assert.ok(lostReload.fromServiceWorker());
    assert.ok((await local(maya)).pending.some(op => op.id === stableId && op.actionId === reviewed.id && op.replacementActionId === finalDraft.id));
    loseResponse = false;
    await mayaContext.setOffline(false);
    await foreground(maya);
    await eventually(async () => !(await local(maya)).pending.length && (await local(maya)).receipts.some(receipt => receipt.id === stableId && receipt.accepted), 'lost response recovers the stable lifecycle receipt');
    assert.ok(attempts.length >= 2);
    assert.equal(new Set(attempts).size, 1);
    assert.equal((await snapshot()).actions.filter(action => action.origin?.actionId === reviewed.id).length, 1, 'replay creates exactly one successor');
    assert.equal(lifecycle(target(await snapshot(), reviewed.id)).replacementActionId, finalDraft.id);
    assertFresh(target(await snapshot(), finalDraft.id));
    assert.deepEqual((await local(maya)).creationDraft, unrelatedDraft);
  } finally { await mayaContext.unroute('**/api/operations'); }
  pass('a committed replacement with a lost response replays its original target and ID after worker reload and creates exactly one successor');
}

async function captureScheduleWeather(page, state, locator) {
  const previousViewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await locator.evaluate(element => element.scrollIntoView({ block: 'start', inline: 'nearest' }));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const box = await locator.boundingBox();
  assert.ok(box && box.y > -2 && box.y < 844, `${state} schedule/weather evidence is visible in the original viewport`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'schedule and forecast context fit the narrow viewport');
  await page.screenshot({ path: `/tmp/zaction-schedule-weather-${state}-390x844.png`, fullPage: false });
  if (previousViewport) await page.setViewportSize(previousViewport);
}

async function verifyScheduleWeather(otherViewer) {
  const context = await newContext({ timezoneId: 'Pacific/Kiritimati', locale: 'en-US', viewport: { width: 390, height: 844 } });
  const checkedAt = new Date(Date.now() - 3600000).toISOString();
  const nextDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const latestDate = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
  const requests = [];
  const available = (query, overrides = {}) => ({ ...query, sourceUrl: 'https://open-meteo.com/', status: 'available', checkedAt,
    temperatureMaxF: 71, temperatureMinF: 55, rainChance: 12, windMph: 8,
    description: 'City-day outlook (test forecast)', stale: false, ...overrides });
  let responseFor = query => available(query);
  await context.route('**/api/weather?*', async route => {
    const url = new URL(route.request().url());
    const query = { cityId: url.searchParams.get('cityId'), date: url.searchParams.get('date') };
    const entry = { ...query, fulfilled: false };
    requests.push(entry);
    const body = await responseFor(query);
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(body) });
    entry.fulfilled = true;
  });
  try {
    const page = await openPage(context);
    await onboard(page, 'Schedule QA', []);
    const id = await fillPlan(page, 'walk', 'Community walk · schedule and outlook', '0', ['Water']);
    await page.getByTestId('plan-time').fill('   ');
    await page.getByTestId('save-creation').click();
    await eventually(async () => (await local(page)).creationDraft.planning.timeHint === '   ', 'whitespace time note saved without inventing a clock time');
    await page.getByTestId('publish-action').click();
    await eventually(async () => (await snapshot()).actions.some(action => action.id === id) && !(await local(page)).pending.length, 'schedule example published');
    await select(page, id);
    const expectedDate = new Date(`${planDate}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
    const schedule = page.getByTestId('detail-schedule');
    assert.equal(await schedule.locator('.schedule-date').innerText(), expectedDate);
    assert.match(await schedule.innerText(), /Time to be agreed/);
    assert.match(await schedule.innerText(), /City reference zone: America\/New_York/);
    await select(otherViewer, id);
    assert.equal(await otherViewer.getByTestId('detail-schedule').innerText(), await schedule.innerText(), 'UTC+14 and New York viewers see identical civil date/year and scheduling meaning');
    await navigate(page, 'home');
    assert.match(await page.getByTestId(`plan-schedule-${id}`).innerText(), /Time to be agreed/);
    await select(page, id);
    await captureScheduleWeather(page, 'schedule-fallback', schedule.locator('..'));
    await page.getByTestId(`plan-update-${id}`).click();
    const rawNote = '7 pm Pacific (host note; please confirm)';
    await page.getByTestId('plan-time').fill(rawNote);
    await page.getByTestId('plan-date').fill(nextDate);
    await page.getByTestId('plan-city').selectOption('austin');
    await page.getByTestId('change-reason').fill('Consider another city and day; the host time note stays unparsed until people confirm arrangements.');
    await page.getByTestId('save-plan-change').click();
    await eventually(async () => (await local(page)).planChangeDrafts[id]?.planning.timeHint === rawNote && (await local(page)).planChangeDrafts[id]?.planning.cityId === 'austin', 'raw time note and revised city saved on their own draft');
    const oldSchedule = page.getByTestId('comparison-schedule-original');
    const proposedSchedule = page.getByTestId('comparison-schedule-proposed');
    assert.match(await oldSchedule.innerText(), /Time to be agreed/);
    assert.equal(await oldSchedule.locator('.schedule-date').innerText(), expectedDate);
    assert.equal(await proposedSchedule.locator('.schedule-time').innerText(), rawNote);
    assert.match(await proposedSchedule.innerText(), /City reference zone: America\/Chicago/);
    assert.match(await proposedSchedule.innerText(), new RegExp(nextDate.slice(0, 4)));
    await captureScheduleWeather(page, 'known-raw-note', page.getByTestId('change-comparison'));
    pass('civil schedules retain year and unset/raw time notes across viewer zones while keeping the city IANA reference separate from arbitrary host text');

    responseFor = query => available(query, { description: 'Austin baseline (test forecast)' });
    await page.getByTestId('weather-retry').click();
    await eventually(async () => /Austin baseline/.test(await page.getByTestId('weather-status').innerText()), 'baseline query fixture displayed');
    await page.evaluate(() => {
      window.__weatherQueryViolations = [];
      const panel = document.querySelector('[data-testid="weather-panel"]');
      const inspect = () => {
        const text = panel?.textContent ?? '';
        if (text.includes('Seattle') && text.includes('Austin baseline (test forecast)')) window.__weatherQueryViolations.push('old Austin forecast rendered under Seattle query');
      };
      window.__weatherQueryObserver = new MutationObserver(inspect);
      window.__weatherQueryObserver.observe(panel, { subtree: true, childList: true, characterData: true });
    });
    const releaseOldResponses = [];
    responseFor = query => query.cityId === 'seattle' && query.date === nextDate
      ? new Promise(resolve => { releaseOldResponses.push(() => resolve(available(query, { description: 'Late older query (test forecast)', temperatureMaxF: 88 }))); })
      : available(query, { description: 'Seattle current date (test forecast)', temperatureMaxF: 64, rainChance: 32 });
    await page.getByTestId('plan-city').selectOption('seattle');
    await eventually(async () => releaseOldResponses.length > 0 && /Seattle/.test(await page.getByTestId('weather-query').innerText()), 'new city query is requested and visible');
    assert.match(await page.getByTestId('weather-query').innerText(), /America\/Los_Angeles/);
    assert.match(await page.getByTestId('weather-status').innerText(), /Checking the daily forecast/);
    assert.equal(await page.locator('.weather-temp').count(), 0, 'changed query immediately hides prior measurements');
    assert.equal(await page.getByTestId('weather-checked-at').count(), 0);
    await captureScheduleWeather(page, 'query-loading', page.getByTestId('weather-panel'));
    await page.getByTestId('plan-date').fill(latestDate);
    await eventually(async () => /Seattle current date/.test(await page.getByTestId('weather-status').innerText()), 'newer city/date response wins');
    for (const releaseOldResponse of releaseOldResponses) releaseOldResponse();
    await eventually(async () => requests.filter(request => request.cityId === 'seattle' && request.date === nextDate).every(request => request.fulfilled), 'older deferred responses have actually arrived');
    assert.match(await page.getByTestId('weather-status').innerText(), /Seattle current date/);
    assert.doesNotMatch(await page.getByTestId('weather-status').innerText(), /Late older query|88°/);
    assert.deepEqual(await page.evaluate(() => { window.__weatherQueryObserver.disconnect(); return window.__weatherQueryViolations; }), [], 'no transient old forecast was displayed beneath the changed city');
    const beforeEmptyDate = requests.length;
    await page.getByTestId('plan-date').fill('');
    await eventually(async () => /Pick a date and a city/.test(await page.getByTestId('weather-status').innerText()), 'clearing date shows an explicit unset query');
    assert.equal(await page.locator('.weather-temp').count(), 0);
    assert.equal(await page.getByTestId('weather-retry').isDisabled(), true);
    assert.equal(requests.length, beforeEmptyDate, 'empty dates do not issue a weather request');
    pass('city/date changes show loading without old metrics, ignore late prior responses, and clearing the date issues no forecast request');

    const invalidResponses = [
      query => available(query, { cityId: 'new-york', description: 'Wrong-city available payload (test fixture)' }),
      query => available(query, { date: nextDate, description: 'Wrong-date available payload (test fixture)' }),
      query => ({ ...query, cityId: 'new-york', sourceUrl: 'https://open-meteo.com/', status: 'unavailable', reason: 'Wrong-city unavailable reason (test fixture)' }),
      query => ({ ...query, date: nextDate, sourceUrl: 'https://open-meteo.com/', status: 'unavailable', reason: 'Wrong-date unavailable reason (test fixture)' }),
      query => available(query, { checkedAt: 'not-a-retrieval-timestamp' }),
      query => available(query, { stale: 'yes' }),
    ];
    for (let index = 0; index < invalidResponses.length; index++) {
      responseFor = invalidResponses[index];
      const before = requests.length;
      if (index === 0) await page.getByTestId('plan-date').fill(latestDate);
      else await page.getByTestId('weather-retry').click();
      await eventually(async () => requests.length > before && /could not be verified for this city and date/.test(await page.getByTestId('weather-status').innerText()), `invalid query/metadata fixture ${index + 1} rejected`);
      assert.match(await page.getByTestId('weather-query').innerText(), /Seattle/);
      assert.doesNotMatch(await page.getByTestId('weather-status').innerText(), /Wrong-city|Wrong-date/);
      assert.equal(await page.locator('.weather-temp').count(), 0);
      assert.equal(await page.getByTestId('weather-checked-at').count(), 0, 'invalid retrieval metadata is never displayed');
    }
    await captureScheduleWeather(page, 'unavailable', page.getByTestId('weather-panel'));
    responseFor = query => available(query, { stale: true, reason: 'Controlled test refresh failure; this is only the same-query cached outlook.', description: 'Cached same-query outlook (test forecast)', temperatureMaxF: 64, rainChance: 32 });
    await page.getByTestId('weather-retry').click();
    await eventually(async () => /Cached forecast.*May be stale/s.test(await page.getByTestId('weather-status').innerText()), 'matching stale response explicitly warns about cache age');
    assert.equal(await page.getByTestId('weather-checked-at').getAttribute('datetime'), checkedAt);
    assert.match(await page.getByTestId('weather-advice').innerText(), /cached daily outlook may be stale/i);
    assert.doesNotMatch(await page.getByTestId('weather-advice').innerText(), /Looks worth considering/);
    assert.match(await page.getByTestId('weather-precipitation').innerText(), /Daily max precipitation chance/);
    await captureScheduleWeather(page, 'stale', page.getByTestId('weather-panel'));
    await page.getByTestId('weather-retry').click();
    await eventually(async () => /Cached same-query outlook/.test(await page.getByTestId('weather-status').innerText()) && !await page.getByTestId('weather-retry').isDisabled(), 'retry settles with the original matching cache timestamp');
    assert.deepEqual({ cityId: requests.at(-1).cityId, date: requests.at(-1).date }, { cityId: 'seattle', date: latestDate });
    assert.equal(await page.getByTestId('weather-checked-at').getAttribute('datetime'), checkedAt);
    pass('available and unavailable response identities and displayed metadata are validated; matching stale retries retain their original timestamp and uncertainty');

    responseFor = query => available(query, { description: 'Current query before offline (test forecast)', temperatureMaxF: 64 });
    await page.getByTestId('weather-retry').click();
    await eventually(async () => /Current query before offline/.test(await page.getByTestId('weather-status').innerText()), 'matching outlook loaded before going offline');
    await context.setOffline(true);
    await eventually(async () => /Cached forecast.*Offline/s.test(await page.getByTestId('weather-status').innerText()), 'in-place offline outlook is honestly cached');
    assert.equal(await page.getByTestId('weather-checked-at').getAttribute('datetime'), checkedAt);
    assert.match(await page.getByTestId('weather-advice').innerText(), /offline.*cached daily outlook may have changed/is);
    assert.doesNotMatch(await page.getByTestId('weather-advice').innerText(), /Looks worth considering/);
    await captureScheduleWeather(page, 'offline', page.getByTestId('weather-panel'));
    const beforeOfflineQuery = requests.length;
    await page.getByTestId('plan-city').selectOption('austin');
    await eventually(async () => /Austin/.test(await page.getByTestId('weather-query').innerText()) && /No forecast for this city and date/.test(await page.getByTestId('weather-status').innerText()), 'offline changed query has no matching forecast');
    assert.equal(await page.locator('.weather-temp').count(), 0);
    assert.equal(await page.getByTestId('weather-checked-at').count(), 0);
    assert.equal(requests.length, beforeOfflineQuery, 'offline query changes do not request or reuse another city outlook');
    await page.getByTestId('save-plan-change').click();
    await eventually(async () => (await local(page)).planChangeDrafts[id]?.planning.cityId === 'austin' && (await local(page)).planChangeDrafts[id]?.planning.date === latestDate, 'current query terms durably saved before offline reload');
    const offlineReload = await page.reload({ waitUntil: 'domcontentloaded' });
    assert.ok(offlineReload.fromServiceWorker());
    await eventually(async () => /No forecast for this city and date/.test(await page.getByTestId('weather-status').innerText()), 'offline worker reload has no persistent forecast');
    assert.equal(await page.getByTestId('weather-checked-at').count(), 0);
    assert.equal(await page.locator('.weather-temp').count(), 0);
    assert.equal(JSON.stringify(await local(page)).includes('Current query before offline (test forecast)'), false, 'weather results are absent from durable browser state');
    responseFor = query => available(query, { description: 'Reconnected Austin outlook (test forecast)', temperatureMaxF: 68 });
    await context.setOffline(false);
    await foreground(page);
    await eventually(async () => /Reconnected Austin outlook/.test(await page.getByTestId('weather-status').innerText()), 'reconnect checks the current saved city/date');
    assert.deepEqual({ cityId: requests.at(-1).cityId, date: requests.at(-1).date }, { cityId: 'austin', date: latestDate });
    pass('offline in-place weather keeps only matching cached context and original retrieval time; reload invents no persistent outlook and reconnect checks current terms');

    await page.getByTestId('save-plan-change').click();
    await eventually(async () => (await local(page)).planChangeDrafts[id]?.planning.cityId === 'austin' && (await local(page)).planChangeDrafts[id]?.planning.date === latestDate, 'replacement terms saved for the changed query');
    const successorId = (await local(page)).planChangeDrafts[id].id;
    await page.getByTestId('publish-plan-change').click();
    await eventually(async () => (await snapshot()).actions.some(action => action.id === successorId) && !(await local(page)).pending.length, 'different-query linked replacement accepted');
    await page.getByTestId('open-created-action').click();
    await eventually(async () => (await local(page)).selectedActionId === successorId && /Reconnected Austin outlook/.test(await page.getByTestId('weather-status').innerText()), 'successor shows only its own city/date outlook');
    const successorSchedule = page.getByTestId('detail-schedule');
    assert.equal(await successorSchedule.locator('.schedule-time').innerText(), rawNote, 'the copied arbitrary time note is not converted when city/date change');
    assert.match(await successorSchedule.innerText(), /City reference zone: America\/Chicago/);
    assert.match(await page.getByTestId('weather-query').innerText(), /Austin/);
    assert.match(await page.getByTestId('weather-query').innerText(), /America\/Chicago/);
    assert.equal(await page.getByTestId('weather-checked-at').getAttribute('datetime'), checkedAt);
    assert.doesNotMatch(await page.getByTestId('weather-status').innerText(), /Seattle current date|Austin baseline/);
    await captureScheduleWeather(page, 'replacement', page.getByTestId('weather-panel'));
    await page.setViewportSize({ width: 1440, height: 1100 });
    await eventually(async () => /Reconnected Austin outlook/.test(await page.getByTestId('weather-status').innerText()), 'desktop weather panel settles for the same query');
    await page.getByTestId('weather-panel').evaluate(element => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: '/tmp/zaction-schedule-weather-replacement-desktop.png', fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId(`plan-update-${successorId}`).click();
    await page.getByTestId('create-title').fill('Community walk · same-day accessibility notes');
    await page.getByTestId('change-reason').fill('Clarify the welcome notes without changing this city or civil date; the daily outlook remains only planning context.');
    await page.getByTestId('save-plan-change').click();
    await eventually(async () => (await local(page)).planChangeDrafts[successorId]?.title === 'Community walk · same-day accessibility notes', 'same-query successor draft saved');
    const sameQueryId = (await local(page)).planChangeDrafts[successorId].id;
    await page.getByTestId('publish-plan-change').click();
    await eventually(async () => (await snapshot()).actions.some(action => action.id === sameQueryId) && !(await local(page)).pending.length, 'same-query linked replacement accepted');
    await page.getByTestId('open-created-action').click();
    await eventually(async () => (await local(page)).selectedActionId === sameQueryId && /Reconnected Austin outlook/.test(await page.getByTestId('weather-status').innerText()), 'same city/day controlled response remains valid on a linked plan');
    assert.equal(await page.getByTestId('weather-checked-at').getAttribute('datetime'), checkedAt, 'same-query reuse does not invent a new retrieval timestamp or event readiness');
    assert.equal(target(await snapshot(), successorId).origin.actionId, id);
    assert.equal(target(await snapshot(), sameQueryId).origin.actionId, successorId);
    assert.equal(await page.getByTestId('detail-schedule').locator('.schedule-time').innerText(), rawNote);
    pass('linked replacements use their own schedule/query while honest same-city/day responses retain the original retrieval stamp and raw host note');
  } finally { await context.close(); }
}

try {
  await eventually(async () => {
    if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
    return (await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) })).ok;
  }, 'production server health');
  const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath());
  browser = await chromium.launch({ executablePath, headless: true,
    env: { ...process.env, XDG_CACHE_HOME: join(temporary, 'cache'), XDG_CONFIG_HOME: join(temporary, 'config') } });
  const mayaContext = await newContext({ viewport: { width: 390, height: 844 } });
  const noahContext = await newContext({ viewport: { width: 1440, height: 1100 } });
  await mockWeather(mayaContext);
  await mockWeather(noahContext);
  const maya = await openPage(mayaContext);
  const font = await maya.evaluate(async () => {
    await document.fonts.ready;
    return {
      applied: getComputedStyle(document.body).fontFamily.includes('Bricolage'),
      loaded: [...document.fonts].some(face => face.family.includes('Bricolage') && face.status === 'loaded'),
      resources: performance.getEntriesByType('resource').map(entry => entry.name).filter(url => url.includes('.woff2')),
    };
  });
  assert.ok(font.applied && font.loaded, 'the self-hosted Bricolage face is applied and loaded, rather than only declared');
  assert.ok(font.resources.length > 0, 'the browser requested the actual local font resource');
  const fontURL = font.resources[0];
  const initial = await snapshot();
  assert.deepEqual(target(initial).ballots, []);
  assert.deepEqual(target(initial).contributions, []);
  assert.equal(initial.profiles.filter(profile => !profile.synthetic).length, 0);
  const manifestURL = await maya.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await fetch(new URL(manifestURL, origin))).json();
  assert.equal(manifest.display, 'standalone');
  for (const size of ['192x192', '512x512']) {
    const icon = manifest.icons.find(icon => icon.sizes === size);
    assert.ok(icon, `install icon ${size}`);
    assert.ok((await fetch(new URL(icon.src, origin))).ok);
  }
  assert.equal(await maya.getByTestId('member-alex').count(), 0, 'new members are not asked to impersonate a fixture profile');
  await assertOnboardingFocus(maya);
  await capture(maya, 'onboarding');
  await onboard(maya, 'Maya');
  const firstLocal = await local(maya);
  const mayaId = firstLocal.memberId;
  const identity = firstLocal.identityFingerprint;
  assert.equal(firstLocal.community.name, 'Maya');
  assert.equal(firstLocal.community.cityId, 'new-york');
  assert.ok(firstLocal.community.interests.includes('bbq'));
  assert.ok(firstLocal.community.interests.includes('help'));
  const sessions = await local(maya, 'community-sessions');
  assert.equal(sessions[initial.roomId].memberId, mayaId);
  assert.equal(typeof sessions[initial.roomId].token, 'string');
  assert.equal(JSON.stringify(firstLocal).includes(sessions[initial.roomId].token), false);
  await maya.reload({ waitUntil: 'networkidle' });
  assert.equal((await local(maya)).memberId, mayaId);
  assert.deepEqual((await local(maya)).community, firstLocal.community);
  assert.equal((await local(maya)).identityFingerprint, identity);
  pass('first-run setup isolates keyboard focus, loads the self-hosted typeface, and persists private preferences with a stable local identity');

  const noah = await openPage(noahContext);
  await onboard(noah, 'Noah', ['bbq', 'walk']);
  const noahId = (await local(noah)).memberId;
  assert.notEqual(mayaId, noahId);
  const publicState = await snapshot();
  assert.equal(publicState.profiles.filter(profile => !profile.synthetic).length, 2);
  assert.equal(Object.hasOwn(publicState, 'sessions'), false);
  assert.equal(Object.hasOwn(publicState.profiles.find(profile => profile.id === mayaId), 'interests'), false);
  const browseContext = await newContext();
  const browse = await openPage(browseContext);
  await browse.getByTestId('onboarding-browse').click();
  await eventually(async () => Boolean((await local(browse))?.community?.browsing), 'browse without joining');
  assert.equal((await local(browse)).memberId, null);
  assert.equal((await snapshot()).profiles.filter(profile => !profile.synthetic).length, 2);
  await browseContext.close();
  pass('two members have their own public profiles while browsing creates no invented member or social activity');

  const actionA = await fillPlan(maya, 'bbq', 'Sunday neighborhood BBQ');
  const draft = (await local(maya)).creationDraft;
  assert.equal(draft.planning.budgetCents, 8000);
  assert.equal(draft.planning.expectedPeople, 8);
  assert.equal(draft.planning.kind, 'bbq');
  assert.match(await maya.getByTestId('budget-per-person').innerText(), /\$10(?:\.00)?/);
  await eventually(async () => /20\s*%/.test(await maya.getByTestId('weather-panel').innerText()), 'clear weather fixture shown');
  await capture(maya, 'plan', maya.getByTestId('budget-per-person'));
  await capture(maya, 'weather-available', maya.getByTestId('weather-panel'));
  weather.mode = 'rain';
  await maya.getByTestId('weather-retry').click();
  await eventually(async () => /85\s*%/.test(await maya.getByTestId('weather-panel').innerText()), 'rain forecast fixture shown');
  assert.match((await local(maya)).creationDraft.planning.rainPlan, /covered/);
  weather.mode = 'unavailable';
  await maya.getByTestId('weather-retry').click();
  await eventually(async () => /unavailable/i.test(await maya.getByTestId('weather-panel').innerText()), 'unavailable weather fixture shown');
  assert.doesNotMatch(await maya.getByTestId('weather-panel').innerText(), /78\s*°|20\s*%/);
  await capture(maya, 'weather-unavailable', maya.getByTestId('weather-panel'));
  weather.mode = 'clear';
  pass('BBQ planning computes an $80/8 = $10 estimate, retains a rain backup, and distinguishes controlled clear/rain/unavailable weather fixtures');

  await mayaContext.setOffline(true);
  await maya.getByTestId('publish-action').click();
  await eventually(async () => (await local(maya)).pending.filter(op => op.type === 'create-action').length === 1, 'offline gathering queued');
  assert.equal((await snapshot()).actions.length, 1);
  const offlineResponse = await maya.reload({ waitUntil: 'domcontentloaded' });
  assert.ok(offlineResponse.fromServiceWorker());
  const fontResponse = maya.waitForResponse(response => response.url() === fontURL);
  const offlineFont = await maya.evaluate(async url => {
    await document.fonts.ready;
    const response = await fetch(url, { cache: 'reload' });
    return { ok: response.ok, bytes: (await response.arrayBuffer()).byteLength, type: response.headers.get('content-type'),
      loaded: [...document.fonts].some(face => face.family.includes('Bricolage') && face.status === 'loaded') };
  }, fontURL);
  assert.ok(offlineFont.ok && offlineFont.bytes > 0 && offlineFont.loaded);
  assert.match(offlineFont.type, /font\/woff2/);
  assert.ok((await fontResponse).fromServiceWorker(), 'the production worker serves the actual font while offline');
  assert.equal((await local(maya)).creationDraft.planning.budgetCents, 8000);
  assert.equal((await local(maya)).pending.find(op => op.type === 'create-action').actionId, actionA);
  await mayaContext.setOffline(false);
  await foreground(maya);
  await eventually(async () => (await snapshot()).actions.some(action => action.id === actionA) && !(await local(maya)).pending.length, 'authenticated gathering accepted');
  await foreground(maya);
  await foreground(maya);
  assert.equal((await snapshot()).actions.filter(action => action.id === actionA).length, 1);
  assert.equal(target(await snapshot(), actionA).createdBy, mayaId);
  assert.equal(target(await snapshot(), actionA).membershipVersion, 'COMMUNITY-PREVIEW-v1');
  assert.equal(target(await snapshot(), actionA).planning.budgetCents, 8000);
  pass('offline gathering creation survives the real production worker reload and reconnects exactly once as its actual author');

  const actionB = await fillPlan(maya, 'potluck', 'Bring-and-share neighborhood supper', '40');
  await maya.getByTestId('publish-action').click();
  await eventually(async () => (await snapshot()).actions.length === 3 && !(await local(maya)).pending.length, 'second authored gathering accepted');
  await navigate(maya, 'home');
  await foreground(noah);
  await eventually(async () => (await local(noah)).snapshot.actions.some(action => action.id === actionB), 'second member sees gathering');
  await maya.getByTestId('feed-category-bbq').click();
  assert.equal(await maya.getByTestId(`action-card-${actionA}`).count(), 1);
  assert.equal(await maya.getByTestId(`action-card-${actionB}`).count(), 0);
  await maya.getByTestId('feed-category-all').click();
  await maya.getByTestId('feed-search').fill('neighborhood BBQ');
  assert.equal(await maya.getByTestId(`action-card-${actionA}`).count(), 1);
  assert.equal(await maya.getByTestId(`action-card-${actionB}`).count(), 0);
  await maya.getByTestId('feed-search').fill('');
  await maya.getByTestId('feed-city').selectOption('austin');
  assert.equal(await maya.getByTestId(`action-card-${actionA}`).count(), 0);
  await maya.getByTestId('feed-city').selectOption('new-york');
  await maya.getByTestId(`save-${actionA}`).click();
  await eventually(async () => (await local(maya)).savedActionIds.includes(actionA), 'plan saved privately');
  await navigate(maya, 'saved');
  await maya.reload({ waitUntil: 'networkidle' });
  await maya.getByTestId(`action-card-${actionA}`).waitFor();
  assert.equal(((await local(noah)).savedActionIds ?? []).includes(actionA), false);
  assert.equal(Object.hasOwn(await snapshot(), 'savedActionIds'), false);
  await navigate(maya, 'home');
  await maya.setViewportSize({ width: 1440, height: 1100 });
  await maya.screenshot({ path: '/tmp/zaction-social-feed-desktop.png', fullPage: false });
  await capture(maya, 'feed', maya.getByTestId(`action-card-${actionA}`));
  pass('community feed filters actual posts by activity/search/city and privately saved plans persist without sharing another member’s saves');

  await maya.getByTestId(`reaction-${actionA}`).click();
  await eventually(async () => target(await snapshot(), actionA).reactions.length === 1, 'first member interested');
  await noah.getByTestId(`reaction-${actionA}`).click();
  await eventually(async () => target(await snapshot(), actionA).reactions.length === 2, 'second member interested');
  await foreground(maya);
  await eventually(async () => target((await local(maya)).snapshot, actionA).reactions.length === 2, 'reaction state reconciled');
  await maya.getByTestId(`reaction-${actionA}`).click();
  await eventually(async () => target(await snapshot(), actionA).reactions.length === 1, 'interest toggled off');
  await maya.getByTestId(`reaction-${actionA}`).click();
  await eventually(async () => target(await snapshot(), actionA).reactions.length === 2, 'interest toggled back on');
  await maya.getByTestId(`rsvp-going-${actionA}`).click();
  await noah.getByTestId(`rsvp-maybe-${actionA}`).click();
  await eventually(async () => target(await snapshot(), actionA).rsvps.length === 2, 'independent RSVP records');
  assert.equal(target(await snapshot(), actionA).ballots.length, 0);
  assert.equal(target(await snapshot(), actionB).reactions.length, 0);
  assert.equal(target(await snapshot(), actionB).rsvps.length, 0);
  pass('interest toggles and individual RSVPs synchronize across real profiles without adding ballots or changing another plan');

  await select(maya, actionA);
  const question = 'I can bring vegetarian dishes. Is there a covered space nearby?';
  await maya.getByTestId('contribution-input').fill(question);
  await maya.getByTestId('publish-contribution').click();
  await eventually(async () => target(await snapshot(), actionA).contributions.length === 1, 'first public comment accepted');
  const parent = target(await snapshot(), actionA).contributions[0];
  assert.equal(parent.memberId, mayaId);
  await foreground(noah);
  await select(noah, actionA);
  const reply = 'I can check the covered seating and step-free access.';
  await noah.getByTestId(`reply-open-${parent.id}`).click();
  await noah.getByTestId(`reply-input-${parent.id}`).fill(reply);
  await noahContext.setOffline(true);
  await noah.getByTestId(`reply-submit-${parent.id}`).click();
  await eventually(async () => (await local(noah)).pending.some(op => op.type === 'contribute' && op.parentId === parent.id), 'reply queued against its parent');
  await noah.reload({ waitUntil: 'domcontentloaded' });
  assert.ok((await local(noah)).pending.some(op => op.parentId === parent.id && op.actionId === actionA));
  await noahContext.setOffline(false);
  await foreground(noah);
  await eventually(async () => target(await snapshot(), actionA).contributions.length === 2, 'offline reply accepted');
  const storedReply = target(await snapshot(), actionA).contributions.find(comment => comment.parentId === parent.id);
  assert.equal(storedReply.text, reply);
  assert.equal(storedReply.memberId, noahId);
  assert.equal(target(await snapshot(), actionB).contributions.length, 0);
  pass('threaded replies retain their original parent, action and author through offline queue/reload/reconnect');

  await select(maya, actionB);
  const secondDraft = 'The supper should also have a quiet participation option.';
  await maya.getByTestId('contribution-input').fill(secondDraft);
  await maya.getByTestId('save-draft').click();
  await eventually(async () => (await local(maya)).drafts[actionB]?.discussion === secondDraft, 'second discussion draft saved');
  await select(maya, actionA, 'proposal');
  await maya.getByTestId('choice-approve').check();
  await mayaContext.setOffline(true);
  await maya.getByTestId('submit-vote').click();
  await maya.getByTestId('pending-status').waitFor();
  await capture(maya, 'pending', maya.getByTestId('ballot-action-title'));
  await select(maya, actionB, 'proposal');
  await maya.getByTestId('choice-approve').check();
  await maya.getByTestId('submit-vote').click();
  await eventually(async () => (await local(maya)).pending.some(op => op.type === 'vote' && op.actionId === actionB && op.memberId === mayaId && op.choice === 'approve'), 'second ballot durably saved before intentional reload');
  await maya.getByTestId('pending-status').waitFor();
  const savedBallotIntents = (await local(maya)).pending.filter(op => op.type === 'vote');
  assert.deepEqual(savedBallotIntents.map(op => op.actionId).sort(), [actionA, actionB].sort());
  await maya.reload({ waitUntil: 'domcontentloaded' });
  await eventually(async () => (await local(maya)).pending.filter(op => op.type === 'vote').length === 2, 'two distinct ballot intents retained');
  const reopenedBallotIntents = (await local(maya)).pending.filter(op => op.type === 'vote');
  assert.deepEqual(reopenedBallotIntents.map(op => [op.id, op.actionId, op.memberId, op.choice]).sort(), savedBallotIntents.map(op => [op.id, op.actionId, op.memberId, op.choice]).sort(), 'offline reload preserves both original operation IDs, proposal targets, voters and choices');
  assert.equal(target(await snapshot(), actionA).ballots.length, 0);
  assert.equal(target(await snapshot(), actionB).ballots.length, 0);
  for (const id of [actionA, actionB]) {
    assert.deepEqual((await local(noah)).progress[id] ?? { read: false, reviewed: false }, { read: false, reviewed: false });
    await select(noah, id, 'proposal');
    await noah.getByTestId('choice-approve').check();
    await noah.getByTestId('submit-vote').click();
    await eventually(async () => target(await snapshot(), id).ballots.length === 1, 'one equal community ballot accepted');
  }
  await select(noah, actionA, 'proposal');
  await closeVote(noah);
  await eventually(async () => target(await snapshot(), actionA).outcome === 'no-quorum', 'one gathering vote closes independently');
  assert.equal(target(await snapshot(), actionB).outcome, 'open');
  await mayaContext.setOffline(false);
  await foreground(maya);
  await eventually(async () => (await local(maya)).pending.length === 0, 'pending ballots reconciled');
  assert.equal(target(await snapshot(), actionA).ballots.length, 1);
  assert.equal(target(await snapshot(), actionB).ballots.length, 2);
  assert.equal(target(await snapshot(), actionA).reactions.length, 2);
  assert.equal(target(await snapshot(), actionA).rsvps.length, 2);

  const profileCount = (await snapshot()).profiles.length;
  const sessionBeforeEdit = (await local(maya, 'community-sessions'))[initial.roomId];
  await navigate(maya, 'profile');
  await maya.getByRole('button', { name: 'Your preferences', exact: true }).click();
  await assertOnboardingFocus(maya);
  await onboard(maya, 'Maya', ['walk', 'potluck'], 'austin');
  assert.equal((await local(maya)).memberId, mayaId);
  assert.equal((await snapshot()).profiles.length, profileCount, 'editing preferences does not mint another member');
  assert.equal((await snapshot()).profiles.find(profile => profile.id === mayaId).cityId, 'austin');
  const sessionAfterEdit = (await local(maya, 'community-sessions'))[initial.roomId];
  assert.equal(sessionAfterEdit.memberId, sessionBeforeEdit.memberId);
  assert.ok(sessionAfterEdit.token === sessionBeforeEdit.token, 'the existing private capability retains its owner');
  assert.equal(Object.hasOwn((await snapshot()).profiles.find(profile => profile.id === mayaId), 'interests'), false);
  const currentRoom = await snapshot();
  const currentBallotTarget = target(currentRoom, actionB);
  const duplicateResponse = await fetch(`${origin}/api/operations`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${sessionAfterEdit.token}` },
    body: JSON.stringify({ id: randomUUID(), memberId: mayaId, type: 'vote', actionId: actionB, choice: 'oppose',
      roomId: currentRoom.roomId, proposalRevision: currentBallotTarget.proposalRevision,
      rulesVersion: currentBallotTarget.rulesVersion, membershipVersion: currentBallotTarget.membershipVersion }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal((await duplicateResponse.json()).receipt.accepted, false, 'editing city/interests cannot grant a second ballot');
  assert.equal(target(await snapshot(), actionB).ballots.filter(ballot => ballot.memberId === mayaId).length, 1);
  await maya.getByRole('button', { name: 'Your preferences', exact: true }).click();
  await onboard(maya, 'Maya', ['bbq', 'help'], 'new-york');
  assert.equal((await local(maya)).memberId, mayaId);
  assert.equal((await snapshot()).profiles.length, profileCount);

  await select(maya, actionA, 'proposal');
  await maya.reload({ waitUntil: 'networkidle' });
  const rejected = (await local(maya)).receipts.find(receipt => receipt.type === 'vote' && receipt.actionId === actionA && !receipt.accepted);
  assert.equal(rejected.operation.choice, 'approve');
  assert.equal(rejected.operation.actionId, actionA);
  await capture(maya, 'rejected', maya.getByTestId('submission-history'));
  await select(noah, actionB, 'proposal');
  await closeVote(noah);
  await eventually(async () => target(await snapshot(), actionB).outcome === 'adopted', 'second plan adopted with equal ballots');
  pass('community decisions remain separate from social signals and preference edits: members keep one equal ballot, one late intent is rejected and another plan adopts');

  await select(maya, actionA, 'proposal');
  const notesA = 'The BBQ proposal did not reach quorum. Its social interest and RSVPs did not approve it.';
  await maya.getByTestId('minutes-input').fill(notesA);
  await maya.getByTestId('save-minutes-draft').click();
  await select(maya, actionB, 'proposal');
  const notesB = 'The supper plan was adopted. Confirm access and the estimated budget before making commitments.';
  await maya.getByTestId('minutes-input').fill(notesB);
  await maya.getByTestId('save-minutes-draft').click();
  await eventually(async () => (await local(maya)).drafts[actionB]?.minutes === notesB, 'second plan minutes durably saved before intentional reload');
  await maya.reload({ waitUntil: 'networkidle' });
  assert.equal(await maya.getByTestId('minutes-input').inputValue(), notesB);
  await maya.getByTestId('publish-minutes').click();
  await eventually(async () => target(await snapshot(), actionB).minutes.length === 1, 'member publishes decision notes');
  await select(maya, actionA, 'proposal');
  assert.equal(await maya.getByTestId('minutes-input').inputValue(), notesA);
  assert.equal(target(await snapshot(), actionA).minutes.length, 0);
  await maya.getByTestId('publish-minutes').click();
  await eventually(async () => target(await snapshot(), actionA).minutes.length === 1, 'other plan minutes published separately');
  pass('action-specific discussion and minutes drafts persist and human publication never changes another plan’s records');

  await select(maya, actionA);
  const authText = 'Retain this comment while the test transport rejects its authorization.';
  let interceptedId;
  await mayaContext.route('**/api/operations', async route => {
    const op = route.request().postDataJSON();
    if (op.type !== 'contribute' || op.text !== authText) return route.continue();
    interceptedId = op.id;
    await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({
      receipt: { id: op.id, actionId: op.actionId, type: op.type, accepted: false, reason: 'Your private community session needs recovery.', receivedAt: new Date().toISOString() }, snapshot: await snapshot(),
    }) });
  });
  await maya.getByTestId('contribution-input').fill(authText);
  await maya.getByTestId('publish-contribution').click();
  await eventually(async () => Boolean(interceptedId && (await local(maya)).receipts.some(receipt => receipt.id === interceptedId && !receipt.accepted)), 'authorization rejection retains the original operation in history');
  const authRejection = (await local(maya)).receipts.find(receipt => receipt.id === interceptedId);
  assert.equal(authRejection.operation.text, authText);
  assert.equal(authRejection.operation.actionId, actionA);
  await mayaContext.unroute('**/api/operations');
  await maya.reload({ waitUntil: 'networkidle' });
  await select(maya, actionA, 'proposal');
  await maya.locator('[data-submission-status="rejected"]').filter({ hasText: authText }).getByTestId('recover-submission').click();
  assert.equal(await maya.getByTestId('contribution-input').inputValue(), authText);
  await maya.getByTestId('publish-contribution').click();
  await eventually(async () => target(await snapshot(), actionA).contributions.some(comment => comment.text === authText), 'recovered authenticated submission accepted');
  assert.equal(target(await snapshot(), actionA).contributions.filter(comment => comment.text === authText).length, 1);
  assert.equal((await local(maya)).receipts.find(receipt => receipt.id === interceptedId).accepted, false);
  pass('a controlled authorization rejection preserves the original submission across reload and explicit recovery publishes one copy to its original plan');

  const unsaved = 'Keep this question visible if the local browser cannot save it.';
  await maya.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    window.__restoreZactionPut = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = function () { throw new DOMException('Simulated quota exceeded', 'QuotaExceededError'); };
  });
  try {
    await maya.getByTestId('contribution-input').fill(unsaved);
    await maya.getByTestId('save-draft').click();
    await maya.getByText(/Could not save on this device/).first().waitFor();
    assert.equal(await maya.getByTestId('contribution-input').inputValue(), unsaved);
    assert.notEqual((await local(maya)).drafts[actionA]?.discussion, unsaved);
    await capture(maya, 'recovery', maya.locator('.comment-composer'));
  } finally { await maya.evaluate(() => window.__restoreZactionPut()); }
  await maya.getByTestId('save-draft').click();
  await eventually(async () => (await local(maya)).drafts[actionA]?.discussion === unsaved, 'storage recovered without losing input');
  pass('quota failures preserve unsaved input and recover into the original plan without claiming a successful save');

  const secondTab = await openPage(mayaContext);
  await select(maya, actionA);
  await select(secondTab, actionB);
  const beforeA = target(await snapshot(), actionA).contributions.length;
  const beforeB = target(await snapshot(), actionB).contributions.length;
  await mayaContext.setOffline(true);
  await maya.getByTestId('contribution-input').fill('First tab: preserve the BBQ target.');
  await secondTab.getByTestId('contribution-input').fill('Second tab: preserve the supper target.');
  assert.match(await maya.getByTestId('active-action-title').innerText(), /Sunday neighborhood BBQ/);
  assert.match(await secondTab.getByTestId('active-action-title').innerText(), /Bring-and-share neighborhood supper/);
  await Promise.all([maya.getByTestId('publish-contribution').click(), secondTab.getByTestId('publish-contribution').click()]);
  await eventually(async () => (await local(maya)).pending.filter(op => op.type === 'contribute').length === 2, 'two authenticated tabs retain both targets');
  await mayaContext.setOffline(false);
  await foreground(maya);
  await foreground(secondTab);
  await eventually(async () => target(await snapshot(), actionA).contributions.length === beforeA + 1 && target(await snapshot(), actionB).contributions.length === beforeB + 1 && !(await local(maya)).pending.length, 'two tabs synchronize exact targets');
  await secondTab.close();
  pass('authenticated simultaneous tabs preserve independent draft targets and durable queues without duplicates');

  const legacyContext = await newContext();
  const legacyPage = await openPage(legacyContext);
  const oldState = await local(legacyPage);
  const room = await snapshot();
  const seed = target(room);
  const legacySnapshot = { schemaVersion: 1, roomId: room.roomId, proposalRevision: 1, rulesVersion: seed.rulesVersion,
    membershipVersion: seed.membershipVersion, closesAt: seed.closesAt, contributions: seed.contributions, ballots: seed.ballots,
    outcome: seed.outcome, closedAt: seed.closedAt, minutes: seed.minutes, completedTasks: seed.completedTasks };
  const legacy = { memberId: 'jules', snapshot: legacySnapshot, draft: 'Preserve this old discussion draft.', progress: { read: true, reviewed: false },
    pending: [], receipts: [], lastSync: null, identityFingerprint: oldState.identityFingerprint };
  await legacyContext.setOffline(true);
  await saveBrowserRecord(legacyPage, legacy);
  await legacyPage.reload({ waitUntil: 'domcontentloaded' });
  await eventually(async () => (await local(legacyPage)).schemaVersion === 2, 'legacy browser record migrated');
  assert.equal((await local(legacyPage)).drafts[SEED].discussion, legacy.draft);
  assert.deepEqual((await local(legacyPage)).progress[SEED], legacy.progress);
  assert.equal((await local(legacyPage)).identityFingerprint, oldState.identityFingerprint);
  assert.deepEqual(await local(legacyPage, 'state-v1-backup'), legacy);
  await legacyContext.close();
  pass('legacy browser identity, discussion, progress and exact migration backup survive the community upgrade');

  await verifyBringItems(maya, mayaContext, mayaId, noah, noahContext, noahId);
  await verifyPlanLifecycle(maya, mayaContext, mayaId, noah, noahContext, noahId);
  await verifyScheduleWeather(maya);

  if (process.env.ZACTION_CAPTURE_LIVE_WEATHER === '1') {
    // This context has no weather routes. Its observed provider result is kept
    // separate from deterministic fixture checks and never increments PASS.
    const observedContext = await newContext();
    const observedPage = await openPage(observedContext);
    await onboard(observedPage, 'Weather QA', []);
    let observed;
    observedPage.on('response', async response => {
      if (new URL(response.url()).pathname === '/api/weather') {
        try { observed = await response.json(); } catch { /* UI surfaces the request failure. */ }
      }
    });
    await fillPlan(observedPage, 'bbq', 'Weather observation draft', '0');
    await eventually(async () => ['available', 'unavailable'].includes(observed?.status), 'unmocked weather route observation', 20000);
    await eventually(async () => /Forecast available|Cached forecast|Forecast unavailable/.test(await observedPage.getByTestId('weather-status').innerText()), 'observed weather rendered');
    await capture(observedPage, 'weather-observed', observedPage.getByTestId('weather-panel'));
    await writeFile('/tmp/zaction-weather-observed.json', `${JSON.stringify({ observedAt: new Date().toISOString(), response: observed }, null, 2)}\n`);
    console.log(`OBSERVED: unmocked weather route returned ${observed.status} for ${observed.cityId}/${observed.date}${observed.checkedAt ? `; original checkedAt ${observed.checkedAt}` : '; no forecast retrieval timestamp returned'}; public response /tmp/zaction-weather-observed.json; screenshot /tmp/zaction-social-weather-observed-390x844.png. This observation is separate from fixture PASS counts.`);
    await observedContext.close();
  }

  await navigate(maya, 'home');
  await maya.setViewportSize({ width: 390, height: 844 });
  assert.ok(await maya.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await maya.screenshot({ path: '/tmp/zaction-social-feed-final-390x844.png', fullPage: false });
  await select(maya, actionB, 'proposal');
  assert.ok(await maya.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  assert.deepEqual(pageErrors, [], 'community flows completed without uncaught page errors');
  pass('community feed and decision screens fit the original mobile viewport without uncaught JavaScript errors');
  console.log(`Completed ${passed} community-preview production browser checks. Forecast display used controlled TEST fixtures; no live-provider, phone, GPU, encryption, or official-election validation is claimed.`);
} catch (error) {
  if (process.env.GITHUB_ACTIONS === 'true') {
    // Public annotations expose the failing check/frame without dumping saved
    // browser state or private test sessions from authenticated page contexts.
    const firstLine = String(error?.message ?? 'Unknown browser error').split('\n')[0].slice(0, 400);
    const frames = [...String(error?.stack ?? '').matchAll(/e2e\.mjs:(\d+):(\d+)/g)].slice(0, 3).map(match => `${match[1]}:${match[2]}`).join(', ');
    const detail = `${error?.name ?? 'Error'} after ${passed} completed checks: ${firstLine}. Test frames: ${frames || 'unavailable'}`;
    const escaped = detail.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
    console.error(`::error title=Production browser failure::${escaped}`);
  }
  if (output) console.error('Test server output:', output.trim());
  throw error;
} finally {
  if (browser) await browser.close();
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), pause(2000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  await rm(temporary, { recursive: true, force: true });
}
