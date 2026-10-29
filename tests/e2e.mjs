import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
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
  await maya.reload({ waitUntil: 'domcontentloaded' });
  await eventually(async () => (await local(maya)).pending.filter(op => op.type === 'vote').length === 2, 'two distinct ballot intents retained');
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
    await eventually(async () => !/Checking the forecast/.test(await observedPage.getByTestId('weather-status').innerText()), 'observed weather rendered');
    await capture(observedPage, 'weather-observed', observedPage.getByTestId('weather-panel'));
    console.log(`OBSERVED: unmocked weather route returned ${observed.status}; screenshot /tmp/zaction-social-weather-observed-390x844.png. This observation is separate from fixture PASS counts.`);
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
  if (output) console.error('Test server output:', output.trim());
  throw error;
} finally {
  if (browser) await browser.close();
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), pause(2000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  await rm(temporary, { recursive: true, force: true });
}
