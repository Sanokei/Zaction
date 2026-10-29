import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoData, applyOperation, createDemoStore, migrateDemoData } from '../server.mjs';

const NOW = Date.parse('2026-10-29T16:00:00Z');
const SEED = 'reading-circle';
const target = (value, id = SEED) => {
  const snapshot = value.snapshot ?? value;
  const action = snapshot.actions.find(action => action.id === id);
  assert.ok(action, `action ${id} exists`);
  return action;
};
const operation = (data, fields = {}) => {
  const actionId = fields.actionId ?? SEED;
  const action = data.snapshot.actions.find(action => action.id === actionId);
  return {
    id: randomUUID(), memberId: 'alex', type: 'vote', choice: 'approve', actionId: SEED,
    proposalRevision: action?.proposalRevision ?? 1,
    rulesVersion: action?.rulesVersion ?? 'DEMO-RULES-v1',
    membershipVersion: action?.membershipVersion ?? 'DEMO-MEMBERS-v1',
    roomId: data.snapshot.roomId,
    ...fields,
  };
};
const authored = (fields = {}) => ({
  title: 'Make the library easier to use',
  description: 'Read the public access plan and gather questions for a free discussion.',
  proposalTitle: 'Hold a free library-access reading session',
  beneficiaries: 'Neighbors who use the local library',
  whenWhere: 'Proposed Saturday afternoon; location not yet confirmed',
  sourceLabel: 'Member-provided reading reference',
  sourceUrl: 'https://example.org/library-access',
  ...fields,
});
function createAction(data, actionId = 'library-access', fields = {}, now = NOW) {
  return applyOperation(data, operation(data, { type: 'create-action', actionId, action: authored(fields) }), now);
}

test('a fresh public demo has no fabricated contributions, ballots, or outcomes', () => {
  const { snapshot } = createDemoData(NOW);
  assert.equal(target(snapshot).outcome, 'open');
  assert.deepEqual(target(snapshot).ballots, []);
  assert.deepEqual(target(snapshot).contributions, []);
  assert.deepEqual(target(snapshot).minutes, []);
  assert.deepEqual(target(snapshot).completedTasks, []);
  assert.ok(Date.parse(target(snapshot).closesAt) > NOW);
});

test('replaying the same operation returns its original receipt and one ballot', () => {
  const initial = createDemoData(NOW);
  const ballot = operation(initial);
  const first = applyOperation(initial, ballot, NOW);
  const replay = applyOperation(first.data, ballot, NOW + 5000);
  assert.equal(first.receipt.accepted, true);
  assert.deepEqual(replay.receipt, first.receipt);
  assert.equal(target(replay.snapshot).ballots.length, 1);
  assert.equal(target(initial.snapshot).ballots.length, 0, 'the domain operation is pure');
});

test('an operation ID cannot be reused for a different payload', () => {
  const initial = createDemoData(NOW);
  const ballot = operation(initial);
  const accepted = applyOperation(initial, ballot, NOW);
  const changed = applyOperation(accepted.data, { ...ballot, choice: 'oppose' }, NOW + 1);
  assert.equal(changed.receipt.accepted, false);
  assert.equal(target(changed.snapshot).ballots.length, 1);
  assert.equal(target(changed.snapshot).ballots[0].choice, 'approve');
  const original = applyOperation(changed.data, ballot, NOW + 2);
  assert.deepEqual(original.receipt, accepted.receipt);
});

test('a second device or operation gives the same member no extra vote', () => {
  const initial = createDemoData(NOW);
  const first = applyOperation(initial, operation(initial), NOW);
  const second = applyOperation(first.data, operation(first.data, { choice: 'oppose' }), NOW + 1);
  assert.equal(second.receipt.accepted, false);
  assert.equal(target(second.snapshot).ballots.length, 1);
});

for (const id of ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty']) {
  test(`reserved-looking operation ID ${id} cannot crash or mutate object prototypes`, () => {
    const data = createDemoData(NOW);
    const ballot = operation(data, { id });
    const result = applyOperation(data, ballot, NOW);
    assert.equal(typeof result.receipt.accepted, 'boolean');
    assert.equal(target(result.snapshot).ballots.length, result.receipt.accepted ? 1 : 0);
    const prototype = Object.getPrototypeOf(result.data.receipts);
    assert.ok(prototype === Object.prototype || prototype === null);
    if (result.receipt.accepted) {
      assert.ok(Object.hasOwn(result.data.receipts, id));
      assert.deepEqual(applyOperation(result.data, ballot, NOW + 1).receipt, result.receipt);
    }
    assert.equal(Object.prototype.polluted, undefined);
  });
}

for (const [label, fields] of [
  ['unknown member', { memberId: 'not-a-member' }],
  ['unknown choice', { choice: 'extra-votes' }],
  ['changed proposal revision', { proposalRevision: 2 }],
  ['changed rules', { rulesVersion: 'UNAPPROVED' }],
  ['changed membership', { membershipVersion: 'OTHER-MEMBERS' }],
  ['different room', { roomId: 'another-room' }],
  ['unknown operation type', { type: 'move-money' }],
]) {
  test(`rejects ${label} without adding a ballot`, () => {
    const data = createDemoData(NOW);
    const result = applyOperation(data, operation(data, fields), NOW);
    assert.equal(result.receipt.accepted, false);
    assert.deepEqual(target(result.snapshot).ballots, []);
    assert.equal(target(result.snapshot).outcome, 'open');
  });
}

test('a rejection is itself idempotent with the original reason and timestamp', () => {
  const data = createDemoData(NOW);
  const invalid = operation(data, { rulesVersion: 'old-rules' });
  const rejected = applyOperation(data, invalid, NOW);
  const replay = applyOperation(rejected.data, invalid, NOW + 1000);
  assert.equal(rejected.receipt.accepted, false);
  assert.deepEqual(replay.receipt, rejected.receipt);
});

test('a contribution is shared once and long or empty input is rejected', () => {
  const data = createDemoData(NOW);
  const question = operation(data, { type: 'contribute', text: 'Is the proposed space step-free?' });
  const first = applyOperation(data, question, NOW);
  assert.equal(first.receipt.accepted, true);
  const replay = applyOperation(first.data, question, NOW + 1);
  assert.equal(target(replay.snapshot).contributions.length, 1);
  assert.equal(target(replay.snapshot).contributions[0].text, question.text);
  for (const text of ['', '   ', 'x'.repeat(2001)]) {
    const invalid = applyOperation(first.data, operation(first.data, { type: 'contribute', text }), NOW + 2);
    assert.equal(invalid.receipt.accepted, false);
    assert.equal(target(invalid.snapshot).contributions.length, 1);
  }
});

for (const [choices, expected] of [
  [['approve', 'approve'], 'adopted'],
  [['oppose', 'oppose'], 'not-adopted'],
  [['approve', 'oppose'], 'not-adopted'],
  [['abstain', 'abstain'], 'not-adopted'],
  [['approve', 'abstain'], 'adopted'],
  [['approve'], 'no-quorum'],
  [[], 'no-quorum'],
]) {
  test(`close gives ${expected} for ${choices.join('/') || 'zero accepted ballots'}`, () => {
    let data = createDemoData(NOW);
    choices.forEach((choice, index) => {
      const result = applyOperation(data, operation(data, { memberId: ['alex', 'river', 'jules'][index], choice }), NOW + index);
      assert.equal(result.receipt.accepted, true);
      data = result.data;
    });
    assert.equal(target(data.snapshot).outcome, 'open', 'accepted ballots are provisional before closure');
    const closed = applyOperation(data, operation(data, { type: 'close' }), NOW + 100);
    assert.equal(closed.receipt.accepted, true);
    assert.equal(target(closed.snapshot).outcome, expected);
    assert.ok(target(closed.snapshot).closedAt);
    const late = applyOperation(closed.data, operation(closed.data, { memberId: 'jules' }), NOW + 200);
    assert.equal(late.receipt.accepted, false);
    assert.equal(target(late.snapshot).ballots.length, choices.length);
  });
}

test('the server receipt deadline rejects an offline ballot even if created earlier', () => {
  const data = createDemoData(NOW);
  const savedEarlier = operation(data);
  const late = applyOperation(data, savedEarlier, Date.parse(target(data.snapshot).closesAt) + 1);
  assert.equal(late.receipt.accepted, false);
  assert.equal(target(late.snapshot).outcome, 'no-quorum');
  assert.equal(target(late.snapshot).ballots.length, 0);
});

test('accepted receipt replay stays accepted even after the vote closes', () => {
  const data = createDemoData(NOW);
  const ballot = operation(data);
  const accepted = applyOperation(data, ballot, NOW);
  const closed = applyOperation(accepted.data, operation(accepted.data, { type: 'close' }), NOW + 1);
  const replay = applyOperation(closed.data, ballot, NOW + 2);
  assert.deepEqual(replay.receipt, accepted.receipt);
  assert.equal(target(replay.snapshot).ballots.length, 1);
});

test('minutes are explicitly published after close and corrections preserve history', () => {
  const initial = createDemoData(NOW);
  const early = applyOperation(initial, operation(initial, { type: 'minutes', text: 'A decision happened.' }), NOW);
  assert.equal(early.receipt.accepted, false);
  let data = applyOperation(initial, operation(initial, { type: 'close' }), NOW + 1).data;
  const first = applyOperation(data, operation(data, { type: 'minutes', text: 'No quorum; the proposal remains unadopted.' }), NOW + 2);
  assert.equal(first.receipt.accepted, true);
  const corrected = applyOperation(first.data, operation(first.data, { type: 'minutes', memberId: 'river', text: 'Correction: the group will prepare another proposal.' }), NOW + 3);
  assert.equal(corrected.receipt.accepted, true);
  assert.equal(target(corrected.snapshot).minutes.length, 2);
  assert.equal(target(corrected.snapshot).minutes[0].text, target(first.snapshot).minutes[0].text);
});

test('next tasks require adoption and one task cannot be counted twice', () => {
  const initial = createDemoData(NOW);
  const early = applyOperation(initial, operation(initial, { type: 'complete-task', taskId: 'agenda' }), NOW);
  assert.equal(early.receipt.accepted, false);
  let data = initial;
  for (const memberId of ['alex', 'river']) data = applyOperation(data, operation(data, { memberId }), NOW).data;
  data = applyOperation(data, operation(data, { type: 'close' }), NOW + 1).data;
  const completed = applyOperation(data, operation(data, { type: 'complete-task', taskId: 'agenda' }), NOW + 2);
  assert.equal(completed.receipt.accepted, true);
  const duplicate = applyOperation(completed.data, operation(completed.data, { memberId: 'river', type: 'complete-task', taskId: 'agenda' }), NOW + 3);
  assert.equal(target(duplicate.snapshot).completedTasks.length, 1);
  const invalid = applyOperation(duplicate.data, operation(duplicate.data, { type: 'complete-task', taskId: 'send-money' }), NOW + 4);
  assert.equal(invalid.receipt.accepted, false);
});

test('the file store serializes concurrent submissions and survives restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zaction-domain-'));
  try {
    const filePath = join(directory, 'room.json');
    const store = await createDemoStore({ filePath, now: () => NOW });
    const snapshot = await store.getState();
    const data = { snapshot };
    const ballots = [operation(data), operation(data, { choice: 'oppose' })];
    const receipts = await Promise.all(ballots.map(ballot => store.submit(ballot)));
    assert.equal(receipts.filter(item => item.receipt.accepted).length, 1);
    assert.equal(target(await store.getState()).ballots.length, 1);
    const restored = await createDemoStore({ filePath, now: () => NOW + 1000 });
    assert.equal((await restored.getState()).roomId, snapshot.roomId);
    assert.equal(target(await restored.getState()).ballots.length, 1);
    const replay = await restored.submit(ballots[0]);
    assert.deepEqual(replay.receipt, receipts[0].receipt);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a member-authored action is validated, source-labeled, and created exactly once', () => {
  const initial = createDemoData(NOW);
  const op = operation(initial, { type: 'create-action', actionId: 'library-access', action: authored() });
  const created = applyOperation(initial, op, NOW);
  assert.equal(created.receipt.accepted, true);
  assert.equal(created.receipt.actionId, 'library-access');
  assert.equal(created.snapshot.actions.length, 2);
  assert.equal(target(created.snapshot, 'library-access').createdBy, 'alex');
  assert.equal(target(created.snapshot, 'library-access').sourceKind, 'member-provided');
  assert.equal(target(created.snapshot, 'library-access').title, op.action.title);
  assert.deepEqual(target(created.snapshot, 'library-access').ballots, []);
  assert.deepEqual(target(created.snapshot, 'library-access').contributions, []);
  assert.ok(created.snapshot.sequence > initial.snapshot.sequence);
  const reordered = { ...op, action: Object.fromEntries(Object.entries(op.action).reverse()) };
  const replay = applyOperation(created.data, reordered, NOW + 1);
  assert.deepEqual(replay.receipt, created.receipt, 'nested object key order does not change a retry');
  assert.equal(replay.snapshot.actions.length, 2);
  assert.equal(replay.snapshot.sequence, created.snapshot.sequence);
  const anotherID = applyOperation(replay.data, { ...op, id: randomUUID() }, NOW + 2);
  assert.equal(anotherID.receipt.accepted, false);
  assert.equal(anotherID.snapshot.actions.length, 2);
});

for (const [label, fields] of [
  ['blank title', { title: '  ' }],
  ['oversized title', { title: 'x'.repeat(101) }],
  ['blank description', { description: '' }],
  ['missing proposal', { proposalTitle: '' }],
  ['insecure source URL', { sourceUrl: 'http://example.org/reference' }],
  ['script source URL', { sourceUrl: 'javascript:alert(1)' }],
  ['malformed source URL', { sourceUrl: 'this is not a URL' }],
  ['nonzero budget', { budget: 150 }],
]) {
  test(`invalid action creation rejects ${label} and retains its rejected payload`, () => {
    const data = createDemoData(NOW);
    const op = operation(data, { type: 'create-action', actionId: 'invalid-action', action: authored(fields) });
    const result = applyOperation(data, op, NOW);
    assert.equal(result.receipt.accepted, false);
    assert.equal(result.receipt.actionId, 'invalid-action');
    assert.equal(result.snapshot.actions.length, 1);
    assert.deepEqual(result.data.receipts[op.id].operation, op);
    assert.deepEqual(applyOperation(result.data, op, NOW + 1).receipt, result.receipt);
  });
}

for (const [label, fields] of [
  ['missing action ID', { actionId: undefined }],
  ['empty action ID', { actionId: '' }],
  ['unknown action ID', { actionId: 'nonexistent-action' }],
]) {
  test(`a ${label} cannot silently fall back to the seeded action`, () => {
    const data = createDemoData(NOW);
    const result = applyOperation(data, operation(data, fields), NOW);
    assert.equal(result.receipt.accepted, false);
    assert.equal(target(result.snapshot).ballots.length, 0);
    assert.equal(result.snapshot.actions.length, 1);
  });
}

test('an accepted operation ID cannot be retargeted to another action', () => {
  const created = createAction(createDemoData(NOW));
  const ballot = operation(created.data);
  const first = applyOperation(created.data, ballot, NOW);
  const changed = applyOperation(first.data, { ...ballot, actionId: 'library-access' }, NOW + 1);
  assert.equal(changed.receipt.accepted, false);
  assert.equal(target(changed.snapshot).ballots.length, 1);
  assert.equal(target(changed.snapshot, 'library-access').ballots.length, 0);
});

test('two actions keep conversations, equal ballots, closures, minutes, and tasks separate', () => {
  let data = createAction(createDemoData(NOW)).data;
  for (const [actionId, memberId, text] of [
    [SEED, 'alex', 'Can the reading circle provide a plain-language agenda?'],
    ['library-access', 'river', 'Does the library have a step-free entrance?'],
  ]) data = applyOperation(data, operation(data, { type: 'contribute', actionId, memberId, text }), NOW).data;
  for (const actionId of [SEED, 'library-access']) {
    const vote = applyOperation(data, operation(data, { actionId, memberId: 'alex' }), NOW);
    assert.equal(vote.receipt.accepted, true, 'the same eligible member has one equal ballot in each action');
    data = vote.data;
  }
  data = applyOperation(data, operation(data, { memberId: 'river' }), NOW).data;
  data = applyOperation(data, operation(data, { actionId: 'library-access', memberId: 'river', choice: 'oppose' }), NOW).data;
  data = applyOperation(data, operation(data, { type: 'close' }), NOW + 1).data;
  assert.equal(target(data).outcome, 'adopted');
  assert.equal(target(data, 'library-access').outcome, 'open');
  assert.equal(target(data).contributions[0].memberId, 'alex');
  assert.equal(target(data, 'library-access').contributions[0].memberId, 'river');
  data = applyOperation(data, operation(data, { type: 'minutes', text: 'The reading circle plan was adopted; logistics remain tentative.' }), NOW + 2).data;
  data = applyOperation(data, operation(data, { type: 'complete-task', taskId: 'agenda' }), NOW + 2).data;
  assert.equal(target(data, 'library-access').minutes.length, 0);
  assert.equal(target(data, 'library-access').completedTasks.length, 0);
  data = applyOperation(data, operation(data, { actionId: 'library-access', type: 'close' }), NOW + 3).data;
  assert.equal(target(data, 'library-access').outcome, 'not-adopted');
  data = applyOperation(data, operation(data, { actionId: 'library-access', type: 'minutes', text: 'The library plan was not adopted; prepare a revision.' }), NOW + 4).data;
  assert.equal(target(data).minutes.length, 1);
  assert.equal(target(data, 'library-access').minutes.length, 1);
  assert.notEqual(target(data).minutes[0].text, target(data, 'library-access').minutes[0].text);
});

test('expiry closes only the action whose own deadline has elapsed', () => {
  const initial = createDemoData(NOW);
  const tomorrow = NOW + 24 * 60 * 60 * 1000;
  const created = createAction(initial, 'library-access', {}, tomorrow);
  const justAfterFirstDeadline = Date.parse(target(created.snapshot).closesAt) + 1;
  const result = applyOperation(created.data, operation(created.data, { actionId: 'library-access' }), justAfterFirstDeadline);
  assert.equal(target(result.snapshot).outcome, 'no-quorum');
  assert.equal(target(result.snapshot, 'library-access').outcome, 'open');
  assert.equal(target(result.snapshot, 'library-access').ballots.length, 1);
});

function legacyFixture() {
  const receivedAt = new Date(NOW).toISOString();
  const snapshot = {
    schemaVersion: 1, roomId: 'preserved-legacy-room', proposalRevision: 1,
    rulesVersion: 'DEMO-RULES-v1', membershipVersion: 'DEMO-MEMBERS-v1',
    closesAt: new Date(NOW + 7 * 86400000).toISOString(),
    contributions: [{ id: 'legacy-question', memberId: 'river', text: 'Keep this prior question.', createdAt: receivedAt }],
    ballots: [{ id: 'legacy-ballot', memberId: 'alex', choice: 'approve', createdAt: receivedAt }],
    outcome: 'open', closedAt: null, minutes: [], completedTasks: [],
  };
  const op = { id: 'legacy-ballot', memberId: 'alex', type: 'vote', choice: 'approve', roomId: snapshot.roomId,
    proposalRevision: 1, rulesVersion: snapshot.rulesVersion, membershipVersion: snapshot.membershipVersion };
  const receipt = { id: op.id, accepted: true, reason: 'Accepted by the demo room.', receivedAt, type: 'vote' };
  return { snapshot, receipts: { [op.id]: { operation: op, receipt } } };
}

test('v1 migration preserves room and records and makes old receipt retries target-explicit', () => {
  const legacy = legacyFixture();
  const original = structuredClone(legacy);
  const migrated = migrateDemoData(legacy);
  assert.equal(migrated.snapshot.schemaVersion, 2);
  assert.equal(migrated.snapshot.roomId, legacy.snapshot.roomId);
  assert.equal(migrated.snapshot.actions.length, 1);
  assert.deepEqual(target(migrated).contributions, legacy.snapshot.contributions);
  assert.deepEqual(target(migrated).ballots, legacy.snapshot.ballots);
  assert.equal(target(migrated).outcome, legacy.snapshot.outcome);
  assert.equal(migrated.receipts['legacy-ballot'].operation.actionId, SEED);
  assert.equal(migrated.receipts['legacy-ballot'].receipt.actionId, SEED);
  const replay = applyOperation(migrated, migrated.receipts['legacy-ballot'].operation, NOW + 1);
  assert.deepEqual(replay.receipt, migrated.receipts['legacy-ballot'].receipt);
  assert.equal(target(replay.snapshot).ballots.length, 1);
  assert.deepEqual(legacy, original, 'the migrator never mutates the v1 input');
  assert.deepEqual(migrateDemoData(migrated), migrated, 'v2 data is not reset or reseeded');
});

test('v1 file migration makes an exact backup and later restarts preserve both actions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zaction-migration-'));
  try {
    const filePath = join(directory, 'room.json');
    const original = JSON.stringify(legacyFixture(), null, 4) + '\n';
    await writeFile(filePath, original);
    const store = await createDemoStore({ filePath, now: () => NOW });
    assert.equal(await readFile(filePath + '.v1-backup.json', 'utf8'), original);
    assert.equal((await store.getState()).roomId, 'preserved-legacy-room');
    const before = { snapshot: await store.getState() };
    const created = await store.submit(operation(before, { type: 'create-action', actionId: 'library-access', action: authored() }));
    assert.equal(created.receipt.accepted, true);
    await store.submit(operation({ snapshot: created.snapshot }, { actionId: 'library-access', memberId: 'river' }));
    const restored = await createDemoStore({ filePath, now: () => NOW + 1000 });
    const snapshot = await restored.getState();
    assert.equal(snapshot.actions.length, 2);
    assert.equal(target(snapshot).ballots.length, 1);
    assert.equal(target(snapshot, 'library-access').ballots.length, 1);
    assert.equal(await readFile(filePath + '.v1-backup.json', 'utf8'), original);
    const disk = JSON.parse(await readFile(filePath, 'utf8'));
    const replay = await restored.submit(disk.receipts['legacy-ballot'].operation);
    assert.deepEqual(replay.receipt, disk.receipts['legacy-ballot'].receipt);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('migration preserves corrupt or conflicting legacy data for outside recovery', async () => {
  const malformed = legacyFixture();
  malformed.snapshot.ballots = 'corrupt';
  const before = JSON.stringify(malformed);
  assert.throws(() => migrateDemoData(malformed));
  assert.equal(JSON.stringify(malformed), before);
  const directory = await mkdtemp(join(tmpdir(), 'zaction-conflict-'));
  try {
    const filePath = join(directory, 'room.json');
    const original = JSON.stringify(legacyFixture());
    await writeFile(filePath, original);
    await writeFile(filePath + '.v1-backup.json', 'different pre-existing backup');
    await assert.rejects(createDemoStore({ filePath, now: () => NOW }));
    assert.equal(await readFile(filePath, 'utf8'), original);
    assert.equal(await readFile(filePath + '.v1-backup.json', 'utf8'), 'different pre-existing backup');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function withCommunityStore(run) {
  const directory = await mkdtemp(join(tmpdir(), 'zaction-community-'));
  try {
    const filePath = join(directory, 'room.json');
    const store = await createDemoStore({ filePath, now: () => NOW });
    const first = await store.joinProfile({ name: 'Maya', cityId: 'new-york' });
    const second = await store.joinProfile({ name: 'Noah', cityId: 'new-york' });
    const op = async fields => operation({ snapshot: await store.getState() }, { memberId: first.profile.id, actionId: 'community-bbq', ...fields });
    const create = await store.submit(await op({ type: 'create-action', action: authored({ title: 'Bring a dish to the neighborhood BBQ', planning: planning() }) }));
    assert.equal(create.receipt.accepted, true);
    await run({ store, first, second, op, filePath });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('anonymous community sessions are persisted as digests and never enter public snapshots', async () => {
  await withCommunityStore(async ({ store, first, second, filePath }) => {
    assert.equal(first.profile.name, 'Maya');
    assert.equal(first.profile.synthetic, false);
    assert.equal(first.profile.cityId, 'new-york');
    assert.ok(first.token.length >= 40);
    assert.equal(await store.authorized(first.profile.id, first.token), true);
    assert.equal(await store.authorized(first.profile.id, second.token), false);
    assert.equal(await store.authorized(first.profile.id, 'incorrect-token'), false);
    const publicState = await store.getState();
    assert.ok(publicState.profiles.some(profile => profile.id === first.profile.id));
    assert.equal(Object.hasOwn(publicState, 'sessions'), false);
    assert.equal(JSON.stringify(publicState).includes(first.token), false);
    const raw = await readFile(filePath, 'utf8');
    assert.equal(raw.includes(first.token), false, 'raw bearer credentials are never written to disk');
    const disk = JSON.parse(raw);
    assert.ok(Object.keys(disk.sessions).every(key => /^[a-f0-9]{64}$/.test(key)));
    const restored = await createDemoStore({ filePath, now: () => NOW + 1 });
    assert.equal(await restored.authorized(first.profile.id, first.token), true);
  });
});

test('a valid private session resumes its profile and an invalid session cannot create a replacement', async () => {
  await withCommunityStore(async ({ store, first }) => {
    const count = (await store.getState()).profiles.length;
    const resumed = await store.joinProfile({ name: 'Maya Updated', cityId: 'austin' }, first.token);
    assert.equal(resumed.profile.id, first.profile.id);
    assert.equal(resumed.profile.name, 'Maya Updated');
    assert.equal(resumed.profile.cityId, 'austin');
    assert.equal((await store.getState()).profiles.length, count);
    await assert.rejects(store.joinProfile({ name: 'Unapproved replacement', cityId: 'austin' }, 'unrecognized-private-session'));
    assert.equal((await store.getState()).profiles.length, count);
    assert.equal(await store.authorized(first.profile.id, first.token), true);
  });
});

test('interest reactions are durable idempotent toggles, isolated from other actions and votes', async () => {
  await withCommunityStore(async ({ store, first, op }) => {
    const reaction = await op({ type: 'react', active: true });
    const accepted = await store.submit(reaction);
    assert.equal(accepted.receipt.accepted, true);
    const replay = await store.submit(reaction);
    assert.deepEqual(replay.receipt, accepted.receipt);
    assert.equal(target(replay.snapshot, 'community-bbq').reactions.length, 1);
    assert.equal(target(replay.snapshot).reactions.length, 0);
    assert.equal(target(replay.snapshot, 'community-bbq').ballots.length, 0);
    await store.submit(await op({ type: 'react', active: true }));
    assert.equal(target(await store.getState(), 'community-bbq').reactions.length, 1);
    await store.submit(await op({ type: 'react', active: false }));
    assert.equal(target(await store.getState(), 'community-bbq').reactions.length, 0);
    const vote = await store.submit(await op({ type: 'vote', choice: 'approve' }));
    assert.equal(vote.receipt.accepted, true);
    assert.equal(target(vote.snapshot, 'community-bbq').ballots[0].memberId, first.profile.id);
    assert.equal(target(vote.snapshot, 'community-bbq').ballots.length, 1, 'a registered member has exactly one equal-weight ballot');
    const duplicate = await store.submit(await op({ type: 'vote', choice: 'oppose' }));
    assert.equal(duplicate.receipt.accepted, false);
  });
});

test('RSVP changes replace one member status without voting, changing other actions, or duplicating retries', async () => {
  await withCommunityStore(async ({ store, op }) => {
    const going = await op({ type: 'rsvp', status: 'going' });
    const first = await store.submit(going);
    assert.equal(first.receipt.accepted, true);
    const replay = await store.submit(going);
    assert.deepEqual(replay.receipt, first.receipt);
    assert.equal(target(replay.snapshot, 'community-bbq').rsvps.length, 1);
    await store.submit(await op({ type: 'rsvp', status: 'maybe' }));
    const state = await store.getState();
    assert.equal(target(state, 'community-bbq').rsvps.length, 1);
    assert.equal(target(state, 'community-bbq').rsvps[0].status, 'maybe');
    assert.equal(target(state, 'community-bbq').ballots.length, 0);
    assert.equal(target(state).rsvps.length, 0);
    const invalid = await store.submit(await op({ type: 'rsvp', status: 'pay-to-join' }));
    assert.equal(invalid.receipt.accepted, false);
    const nongathering = await store.submit(await op({ actionId: SEED, type: 'rsvp', status: 'going' }));
    assert.equal(nongathering.receipt.accepted, false, 'RSVP is not invented for an action with no gathering plan');
    await store.submit(await op({ type: 'rsvp', status: 'none' }));
    assert.equal(target(await store.getState(), 'community-bbq').rsvps.length, 0);
  });
});

test('legacy fixture voting eligibility stays separate from community participation', async () => {
  await withCommunityStore(async ({ store, op }) => {
    const vote = await store.submit(await op({ actionId: SEED, type: 'vote', choice: 'approve' }));
    assert.equal(vote.receipt.accepted, false, 'new profiles do not rewrite the old frozen fixture membership');
    const comment = await store.submit(await op({ actionId: SEED, type: 'contribute', text: 'A community question on the sample source.' }));
    assert.equal(comment.receipt.accepted, true);
    const reaction = await store.submit(await op({ actionId: SEED, type: 'react', active: true }));
    assert.equal(reaction.receipt.accepted, true);
    assert.equal(target(reaction.snapshot).ballots.length, 0);
  });
});

test('comment replies require an existing parent on the same action', async () => {
  await withCommunityStore(async ({ store, second, op }) => {
    const parentOp = await op({ type: 'contribute', text: 'Can we include vegetarian choices?' });
    const parent = await store.submit(parentOp);
    assert.equal(parent.receipt.accepted, true);
    const reply = await store.submit(await op({ type: 'contribute', memberId: second.profile.id, text: 'I can bring a vegetarian dish.', parentId: parentOp.id }));
    assert.equal(reply.receipt.accepted, true);
    assert.equal(target(reply.snapshot, 'community-bbq').contributions[1].parentId, parentOp.id);
    const other = await store.submit(await op({ type: 'create-action', actionId: 'second-community-action', action: authored() }));
    assert.equal(other.receipt.accepted, true);
    const crossTarget = await store.submit(await op({ type: 'contribute', actionId: 'second-community-action', text: 'Do not put this reply on a different action.', parentId: parentOp.id }));
    assert.equal(crossTarget.receipt.accepted, false);
    assert.equal(target(crossTarget.snapshot, 'second-community-action').contributions.length, 0);
    const missing = await store.submit(await op({ type: 'contribute', text: 'Unknown parent.', parentId: 'missing-comment' }));
    assert.equal(missing.receipt.accepted, false);
  });
});

const planning = fields => ({ kind: 'bbq', date: '2026-11-07', timeHint: 'Afternoon', cityId: 'new-york', place: 'Public park, exact spot to be agreed',
  budgetCents: 8000, expectedPeople: 8, rainPlan: 'Move to a free covered public space after checking access.', accessibility: 'Step-free route and seating', bring: ['A dish to share', 'Water bottle'], ...fields });

test('a social plan stores a budget estimate and rain/access details without creating payments', async () => {
  await withCommunityStore(async ({ store, op }) => {
    const created = await store.submit(await op({ type: 'create-action', actionId: 'budgeted-bbq', action: authored({ planning: planning() }) }));
    assert.equal(created.receipt.accepted, true);
    const action = target(created.snapshot, 'budgeted-bbq');
    assert.equal(action.planning.budgetCents, 8000);
    assert.equal(action.planning.expectedPeople, 8);
    assert.equal(action.planning.budgetCents / action.planning.expectedPeople, 1000);
    assert.match(action.planning.rainPlan, /covered/);
    assert.equal(Object.hasOwn(action, 'payments'), false);
  });
});

for (const [label, fields] of [
  ['negative estimate', { budgetCents: -1 }],
  ['fractional cents', { budgetCents: 100.5 }],
  ['oversized estimate', { budgetCents: 1_000_001 }],
  ['zero people', { expectedPeople: 0 }],
  ['fractional people', { expectedPeople: 2.5 }],
  ['oversized group', { expectedPeople: 101 }],
  ['unsupported city', { cityId: 'not-a-city' }],
  ['invalid calendar date', { date: '2026-02-31' }],
  ['unrecognized activity', { kind: 'pay-for-votes' }],
  ['too many bring items', { bring: Array(9).fill('item') }],
]) {
  test(`social planning rejects ${label} without changing the authored actions`, () => {
    const data = createDemoData(NOW);
    const result = createAction(data, 'invalid-social-plan', { planning: planning(fields) });
    assert.equal(result.receipt.accepted, false);
    assert.equal(result.snapshot.actions.length, 1);
  });
}
