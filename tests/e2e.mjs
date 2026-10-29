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
async function joinMember(page, memberId) {
  await page.getByTestId('join-demo').click();
  await page.getByTestId(`member-${memberId}`).check();
  await page.getByTestId('confirm-join').click();
  await eventually(async () => (await local(page))?.memberId === memberId, `join ${memberId}`);
}

const SEED = 'reading-circle';
function target(room, id = SEED) {
  const action = room.actions.find(action => action.id === id);
  assert.ok(action, `action ${id} exists`);
  return action;
}
async function select(page, id, view = 'action') {
  await navigate(page, 'home');
  await page.getByTestId(`action-open-${id}`).click();
  await eventually(async () => (await local(page))?.selectedActionId === id, `selected action ${id}`);
  if (view !== 'action') await navigate(page, view);
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
  await page.screenshot({ path: `/tmp/zaction-v2-${state}-390x844.png`, fullPage: false });
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
const firstAction = {
  title: 'Make the library easier to use',
  description: 'Gather questions about access and prepare a free community reading circle.',
  proposalTitle: 'Hold a free library-access reading session',
  beneficiaries: 'Neighbors who use the library',
  whenWhere: 'Proposed Saturday afternoon; location not confirmed',
  sourceLabel: 'Member-provided discussion reference',
  sourceUrl: 'https://example.org/library-access',
};
const secondAction = {
  title: 'Plan a neighborhood access walk',
  description: 'Compare questions about the paths people use and agree on a free accessibility walk.',
  proposalTitle: 'Organize a free neighborhood access walk',
  beneficiaries: 'Neighbors using public paths',
  whenWhere: 'Proposed Sunday morning; route not confirmed',
  sourceLabel: 'Member-provided discussion reference',
  sourceUrl: 'https://example.org/access-walk',
};
const creationFields = {
  title: 'create-title', description: 'create-description', proposalTitle: 'create-proposal-title',
  beneficiaries: 'create-beneficiaries', whenWhere: 'create-when-where', sourceLabel: 'create-source-label', sourceUrl: 'create-source-url',
};
async function fillCreation(page, fields) {
  for (const [key, value] of Object.entries(fields)) await page.getByTestId(creationFields[key]).fill(value);
  await page.getByTestId('save-creation').click();
  await eventually(async () => (await local(page))?.creationDraft.title === fields.title, 'creation draft saved');
  return (await local(page)).creationDraft.id;
}

try {
  await eventually(async () => {
    if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
    return (await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) })).ok;
  }, 'production server health');
  const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath());
  browser = await chromium.launch({ executablePath, headless: true,
    env: { ...process.env, XDG_CACHE_HOME: join(temporary, 'cache'), XDG_CONFIG_HOME: join(temporary, 'config') } });
  const alexContext = await newContext({ viewport: { width: 1440, height: 1100 } });
  const riverContext = await newContext({ viewport: { width: 1280, height: 1000 } });
  const julesContext = await newContext({ viewport: { width: 1280, height: 1000 } });
  const alex = await openPage(alexContext);
  const initial = await snapshot();
  assert.equal(initial.schemaVersion, 2);
  assert.deepEqual(target(initial).ballots, []);
  assert.deepEqual(target(initial).contributions, []);
  const identity = (await local(alex)).identityFingerprint;
  assert.match(identity, /^[0-9a-f]{16}$/);
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
  pass('schema-v2 production app, manifest/icons, local identity and controlling service worker');

  const river = await openPage(riverContext);
  const jules = await openPage(julesContext);
  await joinMember(alex, 'alex');
  await joinMember(river, 'river');
  await joinMember(jules, 'jules');
  await navigate(alex, 'home');
  await alex.getByTestId('create-action').first().click();
  const actionA = await fillCreation(alex, firstAction);
  await alex.reload({ waitUntil: 'networkidle' });
  assert.equal(await alex.getByTestId('create-title').inputValue(), firstAction.title);
  assert.equal((await local(alex)).creationDraft.id, actionA);
  await alexContext.setOffline(true);
  await alex.getByTestId('publish-action').click();
  await eventually(async () => (await local(alex))?.pending.filter(item => item.type === 'create-action').length === 1, 'offline creation queued');
  assert.equal((await snapshot()).actions.length, 1);
  await alex.reload({ waitUntil: 'domcontentloaded' });
  assert.equal((await local(alex)).pending.filter(item => item.type === 'create-action').length, 1);
  assert.equal((await local(alex)).pending.find(item => item.type === 'create-action').action.title, firstAction.title);
  await alexContext.setOffline(false);
  await foreground(alex);
  await eventually(async () => (await snapshot()).actions.some(action => action.id === actionA) && !(await local(alex)).pending.length, 'created action accepted');
  await foreground(alex);
  await foreground(alex);
  assert.equal((await snapshot()).actions.filter(action => action.id === actionA).length, 1);
  assert.equal(target(await snapshot(), actionA).sourceKind, 'member-provided');
  pass('member-authored creation draft survives reload and offline replay creates one source-labeled action');

  await navigate(alex, 'create');
  await alex.getByTestId('start-another-action').click();
  const actionB = await fillCreation(alex, secondAction);
  assert.notEqual(actionA, actionB);
  await alex.getByTestId('publish-action').click();
  await eventually(async () => (await snapshot()).actions.length === 3 && !(await local(alex)).pending.length, 'second independent authored action accepted');
  await navigate(alex, 'home');
  await alex.getByTestId(`action-open-${actionA}`).waitFor();
  await alex.getByTestId(`action-open-${actionB}`).waitFor();
  await alex.screenshot({ path: '/tmp/zaction-v2-home-desktop.png', fullPage: false });
  assert.equal(target(await snapshot()).contributions.length, 0, 'the original reading circle is untouched');
  pass('two member-authored actions coexist with the preserved seed and can be selected independently');

  const discussionA = 'Library action: could we bring a plain-language handout?';
  const discussionB = 'Access walk: could we include step-free paths and rest stops?';
  await select(alex, actionA);
  await alex.getByTestId('contribution-input').fill(discussionA);
  await alex.getByTestId('save-draft').click();
  await eventually(async () => (await local(alex)).drafts[actionA]?.discussion === discussionA, 'first keyed discussion draft saved');
  await select(alex, actionB);
  await alex.getByTestId('contribution-input').fill(discussionB);
  await alex.getByTestId('save-draft').click();
  await eventually(async () => (await local(alex)).drafts[actionB]?.discussion === discussionB, 'second keyed discussion draft saved');
  await select(alex, actionA);
  assert.equal(await alex.getByTestId('contribution-input').inputValue(), discussionA);
  await alexContext.setOffline(true);
  const offlineNavigation = await alex.reload({ waitUntil: 'domcontentloaded' });
  assert.ok(offlineNavigation.fromServiceWorker());
  assert.equal(await alex.getByTestId('contribution-input').inputValue(), discussionA);
  assert.equal((await local(alex)).identityFingerprint, identity);
  await select(alex, actionB);
  assert.equal(await alex.getByTestId('contribution-input').inputValue(), discussionB);
  pass('per-action discussion drafts survive switching, actual offline worker reload, and identity restoration');

  await select(alex, actionA);
  await alex.getByTestId('publish-contribution').click();
  await select(alex, actionB);
  await alex.getByTestId('publish-contribution').click();
  await eventually(async () => (await local(alex)).pending.filter(item => item.type === 'contribute').length === 2, 'two target-specific contributions queued');
  await alexContext.setOffline(false);
  await foreground(alex);
  await foreground(river);
  await eventually(async () => target(await snapshot(), actionA).contributions.length === 1 && target(await snapshot(), actionB).contributions.length === 1, 'independent contributions accepted');
  await eventually(async () => (await local(river)).snapshot.actions.some(action => action.id === actionB), 'second browser sees authored actions');
  assert.equal(target(await snapshot(), actionA).contributions[0].text, discussionA);
  assert.equal(target(await snapshot(), actionB).contributions[0].text, discussionB);
  assert.equal(target(await snapshot()).contributions.length, 0);
  pass('offline publication and reconnect route each discussion to its original action exactly once');

  await select(alex, actionA, 'proposal');
  await alex.getByTestId('choice-approve').check();
  await capture(alex, 'open', alex.getByTestId('ballot-action-title'));
  await alexContext.setOffline(true);
  await alex.getByTestId('submit-vote').click();
  await alex.getByTestId('pending-status').waitFor();
  await capture(alex, 'pending', alex.getByTestId('ballot-action-title'));
  await select(alex, actionB, 'proposal');
  await alex.getByTestId('choice-approve').check();
  await alex.getByTestId('submit-vote').click();
  await eventually(async () => (await local(alex)).pending.filter(item => item.type === 'vote').length === 2, 'independent ballot intents queued');
  assert.equal(target(await snapshot(), actionA).ballots.length, 0);
  assert.equal(target(await snapshot(), actionB).ballots.length, 0);
  await alex.reload({ waitUntil: 'domcontentloaded' });
  await alex.getByTestId('pending-status').waitFor();
  assert.equal((await local(alex)).pending.filter(item => item.type === 'vote').length, 2);
  pass('two offline ballots retain explicit targets across reload without incrementing accepted totals');

  for (const id of [actionA, actionB]) {
    const progress = (await local(river)).progress[id] ?? { read: false, reviewed: false };
    assert.deepEqual(progress, { read: false, reviewed: false });
    await select(river, id, 'proposal');
    await river.getByTestId('choice-approve').check();
    await river.getByTestId('submit-vote').click();
    await eventually(async () => target(await snapshot(), id).ballots.length === 1, `same zero-progress member votes in ${id}`);
  }
  await select(river, actionA, 'proposal');
  await river.getByTestId('close-demo-vote').click();
  await river.getByTestId('confirm-close').click();
  await eventually(async () => target(await snapshot(), actionA).outcome === 'no-quorum', 'first action closes without quorum');
  assert.equal(target(await snapshot(), actionB).outcome, 'open');
  await alexContext.setOffline(false);
  await foreground(alex);
  await eventually(async () => {
    const state = await local(alex);
    return state.pending.length === 0 && state.receipts.some(item => item.type === 'vote' && item.actionId === actionA && !item.accepted);
  }, 'one offline target rejected while the other is accepted');
  assert.equal(target(await snapshot(), actionA).ballots.length, 1);
  assert.equal(target(await snapshot(), actionB).ballots.length, 2);
  await foreground(alex);
  await foreground(alex);
  assert.equal(target(await snapshot(), actionB).ballots.filter(item => item.memberId === 'alex').length, 1);
  pass('one action closes independently; reconnect rejects only its late ballot and accepts the other once at equal weight');

  await select(alex, actionA, 'proposal');
  await alex.reload({ waitUntil: 'networkidle' });
  const rejection = (await local(alex)).receipts.find(item => item.type === 'vote' && item.actionId === actionA && !item.accepted);
  assert.equal(rejection.operation.actionId, actionA);
  assert.equal(rejection.operation.choice, 'approve');
  const rejectedRow = alex.locator('[data-submission-status="rejected"]').filter({ hasText: /approve/i }).first();
  await rejectedRow.waitFor();
  assert.match(await rejectedRow.innerText(), /not accepted|rejected/i);
  await capture(alex, 'rejected', alex.getByTestId('submission-history'));
  await select(alex, actionB, 'proposal');
  assert.equal(await alex.locator('[data-submission-status="rejected"]').count(), 0);
  pass('rejected original choice and action survive reload and cannot leak into another action’s history');

  await foreground(jules);
  await eventually(async () => (await local(jules)).snapshot.actions.some(action => action.id === actionB), 'third browser has second action');
  await select(jules, actionB, 'proposal');
  await jules.getByTestId('choice-abstain').check();
  await jules.getByTestId('submit-vote').click();
  await eventually(async () => target(await snapshot(), actionB).ballots.length === 3, 'third equal ballot accepted');
  await select(river, actionB, 'proposal');
  await river.getByTestId('close-demo-vote').click();
  await river.getByTestId('confirm-close').click();
  await eventually(async () => target(await snapshot(), actionB).outcome === 'adopted', 'second action adopted');
  assert.equal(target(await snapshot(), actionA).outcome, 'no-quorum');
  assert.equal(target(await snapshot()).outcome, 'open');
  pass('distinct action outcomes coexist and the untouched seed remains open');

  const notesA = 'Library action: no quorum. Keep the source questions and prepare a revised proposal.';
  const notesB = 'Access walk: plan adopted. Confirm accessibility before making any outside commitment.';
  await foreground(alex);
  await select(alex, actionA, 'proposal');
  await alex.getByTestId('minutes-input').fill(notesA);
  await eventually(async () => (await local(alex)).drafts[actionA]?.minutes === notesA, 'first action minutes draft saved');
  await select(alex, actionB, 'proposal');
  await alex.getByTestId('minutes-input').fill(notesB);
  await eventually(async () => (await local(alex)).drafts[actionB]?.minutes === notesB, 'second action minutes draft saved');
  await alex.reload({ waitUntil: 'networkidle' });
  assert.equal(await alex.getByTestId('minutes-input').inputValue(), notesB);
  await select(alex, actionA, 'proposal');
  assert.equal(await alex.getByTestId('minutes-input').inputValue(), notesA);
  await alex.getByTestId('publish-minutes').click();
  await eventually(async () => target(await snapshot(), actionA).minutes.length === 1, 'first minutes published');
  assert.equal(target(await snapshot(), actionB).minutes.length, 0);
  await select(alex, actionB, 'proposal');
  assert.equal(await alex.getByTestId('minutes-input').inputValue(), notesB);
  await alex.getByTestId('publish-minutes').click();
  await eventually(async () => target(await snapshot(), actionB).minutes.length === 1, 'second minutes published');
  const corrected = notesB + ' Correction: no location has been booked.';
  await alex.getByTestId('minutes-input').fill(corrected);
  await alex.getByTestId('publish-minutes').click();
  await eventually(async () => target(await snapshot(), actionB).minutes.length === 2, 'second action correction appended');
  assert.equal(target(await snapshot(), actionA).minutes[0].text, notesA);
  assert.equal(target(await snapshot(), actionB).minutes[0].text, notesB);
  pass('separate minutes drafts survive switching/reload and publication/corrections stay action-local');

  const storageContext = await newContext({ viewport: { width: 390, height: 844 } });
  const storagePage = await openPage(storageContext);
  await joinMember(storagePage, 'alex');
  await select(storagePage, actionA);
  const unsaved = 'Keep this action-specific question visible when storage fails.';
  await storagePage.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    window.__restoreZactionPut = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = function () { throw new DOMException('Simulated quota exceeded', 'QuotaExceededError'); };
  });
  try {
    await storagePage.getByTestId('contribution-input').fill(unsaved);
    await storagePage.getByTestId('save-draft').click();
    await storagePage.getByText(/Could not save on this device/).first().waitFor();
    assert.equal(await storagePage.getByTestId('contribution-input').inputValue(), unsaved);
    assert.notEqual((await local(storagePage)).drafts[actionA]?.discussion, unsaved);
    await capture(storagePage, 'recovery', storagePage.locator('.composer-card'));
  } finally { await storagePage.evaluate(() => window.__restoreZactionPut()); }
  await storagePage.getByTestId('save-draft').click();
  await eventually(async () => (await local(storagePage)).drafts[actionA]?.discussion === unsaved, 'draft saved after recovery');
  await storagePage.locator('.composer-card .field-meta [role="status"]').filter({ hasText: 'Saved on this device' }).waitFor();
  await capture(storagePage, 'storage-recovered', storagePage.locator('.composer-card'));
  await storageContext.close();
  pass('failed local writes preserve input, show recovery, and save to the original action after retry');

  const sharedContext = await newContext();
  const firstTab = await openPage(sharedContext);
  await joinMember(firstTab, 'river');
  const secondTab = await openPage(sharedContext);
  await select(firstTab, actionA);
  await select(secondTab, actionB);
  await sharedContext.setOffline(true);
  await firstTab.getByTestId('contribution-input').fill('Tab one: keep the library question attached to its action.');
  await secondTab.getByTestId('contribution-input').fill('Tab two: keep the access-walk question attached to its action.');
  assert.equal(await firstTab.getByTestId('active-action-title').innerText(), firstAction.title, 'another tab cannot retarget the first editor');
  assert.equal(await secondTab.getByTestId('active-action-title').innerText(), secondAction.title, 'each tab keeps its own active action');
  await Promise.all([firstTab.getByTestId('publish-contribution').click(), secondTab.getByTestId('publish-contribution').click()]);
  await eventually(async () => (await local(firstTab)).pending.filter(item => item.type === 'contribute').length === 2, 'two tabs retain both action targets');
  await sharedContext.setOffline(false);
  await foreground(firstTab);
  await foreground(secondTab);
  await eventually(async () => target(await snapshot(), actionA).contributions.length === 2 && target(await snapshot(), actionB).contributions.length === 2 && (await local(firstTab)).pending.length === 0, 'two tabs reconcile each target exactly once');
  await sharedContext.close();
  pass('simultaneous tabs cannot clobber another action’s durable submission queue');

  const migrationContext = await newContext();
  const migrationPage = await openPage(migrationContext);
  const beforeMigration = await local(migrationPage);
  const currentRoom = await snapshot();
  const originalSeed = target(currentRoom);
  const legacyRoomId = 'a-previously-used-demo-room';
  const legacySnapshot = { schemaVersion: 1, roomId: legacyRoomId,
    proposalRevision: 1, rulesVersion: originalSeed.rulesVersion, membershipVersion: originalSeed.membershipVersion,
    closesAt: originalSeed.closesAt, contributions: originalSeed.contributions, ballots: originalSeed.ballots,
    outcome: originalSeed.outcome, closedAt: originalSeed.closedAt, minutes: originalSeed.minutes, completedTasks: originalSeed.completedTasks };
  const pendingLegacy = { id: randomUUID(), memberId: 'jules', type: 'vote', choice: 'abstain',
    roomId: legacyRoomId, proposalRevision: 1, rulesVersion: originalSeed.rulesVersion, membershipVersion: originalSeed.membershipVersion };
  const legacyContribution = { ...pendingLegacy, id: randomUUID(), type: 'contribute', text: 'Restore this submitted legacy question to its original reading-circle draft.' };
  const legacyReceiptOperation = { ...pendingLegacy, id: randomUUID(), type: 'contribute', text: 'A preserved legacy question.' };
  const legacy = { memberId: 'jules', snapshot: legacySnapshot, draft: 'Preserve this previous discussion draft.',
    progress: { read: true, reviewed: false }, pending: [pendingLegacy, legacyContribution],
    receipts: [{ id: legacyReceiptOperation.id, accepted: true, reason: 'Accepted by the demo room.',
      receivedAt: new Date().toISOString(), type: 'contribute', operation: legacyReceiptOperation }],
    lastSync: new Date().toISOString(), identityFingerprint: beforeMigration.identityFingerprint };
  await migrationContext.setOffline(true);
  await saveBrowserRecord(migrationPage, legacy);
  await migrationPage.reload({ waitUntil: 'domcontentloaded' });
  await eventually(async () => (await local(migrationPage))?.schemaVersion === 2, 'browser v1 migration completed');
  const migrated = await local(migrationPage);
  assert.equal(migrated.selectedActionId, SEED);
  assert.equal(migrated.snapshot.roomId, legacySnapshot.roomId);
  assert.equal(migrated.drafts[SEED].discussion, legacy.draft);
  assert.deepEqual(migrated.progress[SEED], legacy.progress);
  assert.equal(migrated.pending[0].actionId, SEED);
  assert.equal(migrated.pending[0].id, pendingLegacy.id);
  assert.equal(migrated.receipts[0].actionId, SEED);
  assert.equal(migrated.receipts[0].operation.actionId, SEED);
  assert.equal(migrated.identityFingerprint, beforeMigration.identityFingerprint);
  assert.deepEqual(await local(migrationPage, 'state-v1-backup'), legacy);
  await migrationPage.reload({ waitUntil: 'domcontentloaded' });
  assert.deepEqual(await local(migrationPage, 'state-v1-backup'), legacy);
  pass('existing browser v1 data migrates with its identity, draft, progress, target-tagged queue/history and exact backup intact');

  await migrationContext.setOffline(false);
  await foreground(migrationPage);
  await eventually(async () => (await local(migrationPage)).pending.length === 0 && (await local(migrationPage)).receipts.some(item => item.id === legacyContribution.id && !item.accepted), 'old-room submissions rejected with original target');
  await select(migrationPage, actionA);
  const unrelated = 'This separate library-action draft must not be replaced by recovery.';
  await migrationPage.getByTestId('contribution-input').fill(unrelated);
  await migrationPage.getByTestId('save-draft').click();
  await eventually(async () => (await local(migrationPage)).drafts[actionA]?.discussion === unrelated, 'unrelated action draft safely saved');
  await select(migrationPage, SEED, 'proposal');
  const recoverRow = migrationPage.locator('[data-submission-status="rejected"]').filter({ hasText: legacyContribution.text });
  await recoverRow.getByTestId('recover-submission').click();
  await eventually(async () => (await local(migrationPage)).selectedActionId === SEED && (await local(migrationPage)).drafts[SEED]?.discussion === legacyContribution.text, 'rejected contribution restored to original action');
  assert.equal(await migrationPage.getByTestId('contribution-input').inputValue(), legacyContribution.text);
  assert.equal((await local(migrationPage)).drafts[actionA].discussion, unrelated);
  assert.ok((await local(migrationPage)).receipts.some(item => item.id === legacyContribution.id && !item.accepted));
  await capture(migrationPage, 'restored', migrationPage.locator('.composer-card'));
  await migrationContext.close();
  pass('rejected text can be explicitly recovered into its original action without changing another action’s draft or receipt');

  const corruptContext = await newContext();
  const corruptPage = await openPage(corruptContext);
  const corruptRecord = { malformed: true, draft: 42, pending: 'corrupt-sentinel' };
  await saveBrowserRecord(corruptPage, corruptRecord);
  await corruptPage.reload({ waitUntil: 'networkidle' });
  await corruptPage.getByText(/Browser storage could not be opened|Saved data needs review/).first().waitFor();
  await navigate(corruptPage, 'action');
  assert.equal(await corruptPage.getByTestId('contribution-input').count(), 0, 'unsafe local data does not expose a misleading composer');
  await corruptPage.getByRole('button', { name: 'Retry group updates', exact: true }).click();
  await pause(200);
  assert.deepEqual(await local(corruptPage), corruptRecord);
  assert.equal(await corruptPage.getByText(/^Draft saved on this device/).count(), 0);
  await corruptContext.close();
  pass('corrupt browser records remain unchanged and unsafe editing stays unavailable through recovery retries');

  const mobileContext = await newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobile = await openPage(mobileContext);
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await mobile.screenshot({ path: '/tmp/zaction-v2-home-390x844.png', fullPage: false });
  await select(mobile, actionB, 'proposal');
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await mobileContext.close();
  assert.deepEqual(pageErrors, [], 'no uncaught JavaScript errors in any scenario');
  pass('multi-action desktop/mobile UI remains responsive without uncaught JavaScript errors');
  console.log(`Completed ${passed} schema-v2 production browser checks. No real-phone, GPU, encrypted messaging, or official election-vote validation is claimed.`);
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
