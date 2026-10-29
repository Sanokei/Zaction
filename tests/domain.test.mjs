import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile, rename, mkdir } from 'node:fs/promises';
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
const CURATED_SOURCE_REF = Object.freeze({ opportunityId: 'nyc-mesh-outreach', snapshotId: '2026-10-29-6760307447a4' });
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

test('bring offers use immutable item indexes, keeping duplicate labels and separate plans distinct', async () => {
  await withCommunityStore(async ({ store, first, second, op }) => {
    const created = await store.submit(await op({ type: 'create-action', actionId: 'duplicate-items', action: authored({ planning: planning({ bring: ['Water', 'Water'] }) }) }));
    assert.equal(created.receipt.accepted, true);
    assert.deepEqual(target(created.snapshot, 'duplicate-items').bringClaims, []);
    const firstOffer = await op({ type: 'bring-item', actionId: 'duplicate-items', itemIndex: 0, intent: 'claim' });
    const accepted = await store.submit(firstOffer);
    assert.equal(accepted.receipt.accepted, true);
    assert.deepEqual(target(accepted.snapshot, 'duplicate-items').bringClaims, [{ id: firstOffer.id, itemIndex: 0, memberId: first.profile.id, createdAt: accepted.receipt.receivedAt }]);
    const secondSlot = await store.submit(await op({ type: 'bring-item', actionId: 'duplicate-items', itemIndex: 1, intent: 'claim' }));
    assert.equal(secondSlot.receipt.accepted, true, 'one person may offer multiple distinct slots');
    const otherPlan = await store.submit(await op({ type: 'bring-item', memberId: second.profile.id, itemIndex: 0, intent: 'claim' }));
    assert.equal(otherPlan.receipt.accepted, true);
    assert.equal(target(otherPlan.snapshot, 'duplicate-items').bringClaims.length, 2);
    assert.equal(target(otherPlan.snapshot, 'community-bbq').bringClaims.length, 1);
    assert.equal(target(otherPlan.snapshot).bringClaims.length, 0);
    const alteredTarget = await store.submit({ ...firstOffer, actionId: 'community-bbq' });
    assert.equal(alteredTarget.receipt.accepted, false);
    const alteredIndex = await store.submit({ ...firstOffer, itemIndex: 1 });
    assert.equal(alteredIndex.receipt.accepted, false);
    assert.deepEqual(target(alteredIndex.snapshot, 'duplicate-items').bringClaims, target(otherPlan.snapshot, 'duplicate-items').bringClaims);
  });
});

test('serialized competing bring offers choose one owner without replacement, including a same-owner second offer', async () => {
  await withCommunityStore(async ({ store, first, second, op }) => {
    const offerA = await op({ type: 'bring-item', itemIndex: 0, intent: 'claim' });
    const offerB = await op({ type: 'bring-item', memberId: second.profile.id, itemIndex: 0, intent: 'claim' });
    const results = await Promise.all([store.submit(offerA), store.submit(offerB)]);
    assert.deepEqual(results.map(result => result.receipt.accepted), [true, false]);
    const original = target(results[0].snapshot, 'community-bbq').bringClaims[0];
    assert.equal(original.memberId, first.profile.id);
    const duplicate = await store.submit(await op({ type: 'bring-item', itemIndex: 0, intent: 'claim' }));
    assert.equal(duplicate.receipt.accepted, false, 'a fresh operation cannot replace even the same person’s current offer');
    assert.deepEqual(target(duplicate.snapshot, 'community-bbq').bringClaims, [original]);
    const replay = await store.submit(offerA);
    assert.deepEqual(replay.receipt, results[0].receipt);
    assert.deepEqual(target(replay.snapshot, 'community-bbq').bringClaims, [original]);
  });
});

test('bring release requires its owner and exact claim, preventing stale same-owner ABA and old replay takeover', async () => {
  await withCommunityStore(async ({ store, second, op }) => {
    const originalOffer = await op({ type: 'bring-item', itemIndex: 0, intent: 'claim' });
    const acceptedOriginal = await store.submit(originalOffer);
    const unauthorized = await store.submit(await op({ type: 'bring-item', memberId: second.profile.id, itemIndex: 0, intent: 'release', claimId: originalOffer.id }));
    assert.equal(unauthorized.receipt.accepted, false);
    const releaseOriginal = await op({ type: 'bring-item', itemIndex: 0, intent: 'release', claimId: originalOffer.id });
    const released = await store.submit(releaseOriginal);
    assert.equal(released.receipt.accepted, true);
    assert.deepEqual(target(released.snapshot, 'community-bbq').bringClaims, []);
    const reclaimedOffer = await op({ type: 'bring-item', itemIndex: 0, intent: 'claim' });
    const reclaimed = await store.submit(reclaimedOffer);
    assert.equal(reclaimed.receipt.accepted, true);
    const staleNewRelease = await store.submit(await op({ type: 'bring-item', itemIndex: 0, intent: 'release', claimId: originalOffer.id }));
    assert.equal(staleNewRelease.receipt.accepted, false);
    assert.match(staleNewRelease.receipt.reason, /changed|newer/i);
    assert.equal(target(staleNewRelease.snapshot, 'community-bbq').bringClaims[0].id, reclaimedOffer.id);
    const releaseReplay = await store.submit(releaseOriginal);
    assert.deepEqual(releaseReplay.receipt, released.receipt);
    assert.equal(target(releaseReplay.snapshot, 'community-bbq').bringClaims[0].id, reclaimedOffer.id, 'an accepted old release receipt does not release a newer reclaim');
    const firstClaimReplay = await store.submit(originalOffer);
    assert.deepEqual(firstClaimReplay.receipt, acceptedOriginal.receipt);
    assert.equal(target(firstClaimReplay.snapshot, 'community-bbq').bringClaims[0].id, reclaimedOffer.id);
    assert.equal((await store.submit(await op({ type: 'bring-item', itemIndex: 0, intent: 'release', claimId: reclaimedOffer.id }))).receipt.accepted, true);
    const secondPerson = await store.submit(await op({ type: 'bring-item', memberId: second.profile.id, itemIndex: 0, intent: 'claim' }));
    assert.equal(secondPerson.receipt.accepted, true);
    const afterReplay = await store.submit(originalOffer);
    assert.deepEqual(afterReplay.receipt, acceptedOriginal.receipt);
    assert.equal(target(afterReplay.snapshot, 'community-bbq').bringClaims[0].memberId, second.profile.id, 'replaying the original claim never takes an item back from its later owner');
  });
});

test('a conflicted bring offer stays rejected on replay; a reviewed new operation may claim a newly open item', async () => {
  await withCommunityStore(async ({ store, second, op }) => {
    const current = await op({ type: 'bring-item', itemIndex: 0, intent: 'claim' });
    await store.submit(current);
    const pendingOther = await op({ type: 'bring-item', memberId: second.profile.id, itemIndex: 0, intent: 'claim' });
    const conflict = await store.submit(pendingOther);
    assert.equal(conflict.receipt.accepted, false);
    await store.submit(await op({ type: 'bring-item', itemIndex: 0, intent: 'release', claimId: current.id }));
    const replay = await store.submit(pendingOther);
    assert.deepEqual(replay.receipt, conflict.receipt);
    assert.deepEqual(target(replay.snapshot, 'community-bbq').bringClaims, []);
    const deliberateRetry = await store.submit({ ...pendingOther, id: randomUUID() });
    assert.equal(deliberateRetry.receipt.accepted, true);
    assert.equal(target(deliberateRetry.snapshot, 'community-bbq').bringClaims[0].memberId, second.profile.id);
  });
});

test('bring intentions remain independent of RSVPs, ballots, task completion, and vote closure', async () => {
  await withCommunityStore(async ({ store, second, op }) => {
    await store.submit(await op({ type: 'rsvp', status: 'going' }));
    await store.submit(await op({ type: 'vote', choice: 'approve' }));
    await store.submit(await op({ type: 'vote', memberId: second.profile.id, choice: 'oppose' }));
    await store.submit(await op({ type: 'close' }));
    const before = target(await store.getState(), 'community-bbq');
    assert.equal(before.outcome, 'not-adopted');
    const claim = await op({ type: 'bring-item', itemIndex: 0, intent: 'claim' });
    const accepted = await store.submit(claim);
    assert.equal(accepted.receipt.accepted, true, 'closed vote does not prevent an item intention');
    const released = await store.submit(await op({ type: 'bring-item', itemIndex: 0, intent: 'release', claimId: claim.id }));
    assert.equal(released.receipt.accepted, true);
    const after = target(released.snapshot, 'community-bbq');
    for (const field of ['rsvps', 'ballots', 'reactions', 'completedTasks', 'outcome', 'closedAt', 'contributions', 'minutes']) assert.deepEqual(after[field], before[field], `${field} is independent of item intentions`);
  });
});

for (const [label, fields] of [
  ['missing index', { itemIndex: undefined }],
  ['negative index', { itemIndex: -1 }],
  ['fractional index', { itemIndex: 0.5 }],
  ['text index', { itemIndex: '0' }],
  ['out-of-range index', { itemIndex: 2 }],
  ['unsafe integer index', { itemIndex: Number.MAX_SAFE_INTEGER + 1 }],
  ['invalid intent', { intent: 'reserve-with-payment' }],
  ['release without claim identity', { intent: 'release' }],
  ['release with reserved claim identity', { intent: 'release', claimId: '__proto__' }],
  ['claim with stale release identity', { intent: 'claim', claimId: 'an-old-offer' }],
  ['action without listed items', { actionId: SEED }],
]) {
  test(`bring operations reject ${label} without inventing or changing a slot`, () => {
    let data = createDemoData(NOW);
    data = createAction(data, 'bring-bbq', { planning: planning() }).data;
    const result = applyOperation(data, operation(data, { type: 'bring-item', actionId: 'bring-bbq', itemIndex: 0, intent: 'claim', ...fields }), NOW);
    assert.equal(result.receipt.accepted, false);
    assert.deepEqual(target(result.snapshot, 'bring-bbq').bringClaims, []);
    assert.deepEqual(target(result.snapshot).bringClaims, []);
  });
}

test('bring ownership and operation receipts survive file restart without exposing or changing private sessions', async () => {
  await withCommunityStore(async ({ store, first, second, op, filePath }) => {
    const original = await op({ type: 'bring-item', itemIndex: 0, intent: 'claim' });
    const claimed = await store.submit(original);
    const before = JSON.parse(await readFile(filePath, 'utf8'));
    const restored = await createDemoStore({ filePath, now: () => NOW + 1 });
    assert.equal(await restored.authorized(first.profile.id, first.token), true);
    assert.equal(await restored.authorized(second.profile.id, second.token), true);
    const replay = await restored.submit(original);
    assert.deepEqual(replay.receipt, claimed.receipt);
    assert.deepEqual(target(replay.snapshot, 'community-bbq').bringClaims, target(claimed.snapshot, 'community-bbq').bringClaims);
    const after = JSON.parse(await readFile(filePath, 'utf8'));
    assert.deepEqual(after.sessions, before.sessions);
    assert.deepEqual(after.receipts, before.receipts);
    assert.equal(Object.hasOwn(replay.snapshot, 'sessions'), false);
    assert.equal(JSON.stringify(replay.snapshot).includes(first.token), false);
  });
});

test('legacy missing bring collections migrate additively while preserving room, receipts, private data, and unknown metadata', async () => {
  await withCommunityStore(async ({ store, first, op, filePath }) => {
    await store.submit(await op({ type: 'contribute', text: 'An existing discussion must stay intact.' }));
    await store.submit(await op({ type: 'vote', choice: 'approve' }));
    const legacy = JSON.parse(await readFile(filePath, 'utf8'));
    for (const action of legacy.snapshot.actions) delete action.bringClaims;
    legacy.futureMetadata = { keep: ['unknown', 'private-store-extension'] };
    legacy.snapshot.actions[1].futureActionField = 'retain this';
    const original = JSON.stringify(legacy, null, 2);
    await writeFile(filePath, original);
    const migrated = migrateDemoData(legacy);
    assert.equal(migrated.snapshot.roomId, legacy.snapshot.roomId);
    assert.deepEqual(migrated.receipts, legacy.receipts);
    assert.deepEqual(migrated.sessions, legacy.sessions);
    assert.deepEqual(migrated.futureMetadata, legacy.futureMetadata);
    assert.equal(migrated.snapshot.actions[1].futureActionField, 'retain this');
    assert.ok(migrated.snapshot.actions.every(action => Array.isArray(action.bringClaims) && action.bringClaims.length === 0));
    assert.ok(legacy.snapshot.actions.every(action => !Object.hasOwn(action, 'bringClaims')), 'the migration is pure');
    const restored = await createDemoStore({ filePath, now: () => NOW + 1 });
    assert.equal(await restored.authorized(first.profile.id, first.token), true);
    const state = await restored.getState();
    assert.deepEqual(target(state, 'community-bbq').contributions, target(legacy.snapshot, 'community-bbq').contributions);
    assert.deepEqual(target(state, 'community-bbq').ballots, target(legacy.snapshot, 'community-bbq').ballots);
    assert.equal(state.roomId, legacy.snapshot.roomId);
    const disk = JSON.parse(await readFile(filePath, 'utf8'));
    assert.deepEqual(disk.futureMetadata, legacy.futureMetadata);
    assert.deepEqual(disk.receipts, legacy.receipts);
    assert.deepEqual(disk.sessions, legacy.sessions);
  });
});

const validBringClaim = fields => ({ id: 'saved-offer', itemIndex: 0, memberId: 'alex', createdAt: new Date(NOW).toISOString(), ...fields });

test('migration defaults only an absent bring collection and rejects present undefined or unlisted saved claims', () => {
  const data = createDemoData(NOW);
  target(data).bringClaims = undefined;
  assert.throws(() => migrateDemoData(data), /corrupt|unsupported/i);
  assert.ok(Object.hasOwn(target(data), 'bringClaims'));
  target(data).bringClaims = [validBringClaim({})];
  assert.throws(() => migrateDemoData(data), /corrupt|unsupported/i, 'claims cannot invent slots on an action without a bring list');
});

for (const [label, text] of [['empty', ''], ['whitespace-only', '   ']]) {
  test(`a saved bring claim for an ${label} item label preserves the corrupt original file`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zaction-blank-bring-'));
    try {
      const filePath = join(directory, 'room.json');
      let data = createDemoData(NOW);
      data = createAction(data, 'bring-bbq', { planning: planning() }).data;
      const action = target(data, 'bring-bbq');
      action.planning.bring[0] = text;
      action.bringClaims = [validBringClaim({})];
      const original = JSON.stringify(data, null, 2);
      await writeFile(filePath, original);
      assert.throws(() => migrateDemoData(data), /corrupt|unsupported/i);
      await assert.rejects(createDemoStore({ filePath, now: () => NOW }), /corrupt|unsupported/i);
      assert.equal(await readFile(filePath, 'utf8'), original);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}

for (const [label, claims] of [
  ['null collection', null],
  ['object collection', {}],
  ['unknown member', [validBringClaim({ memberId: 'not-registered' })]],
  ['invalid claim ID', [validBringClaim({ id: '__proto__' })]],
  ['missing claim ID', [validBringClaim({ id: undefined })]],
  ['invalid timestamp', [validBringClaim({ createdAt: 'not-a-date' })]],
  ['non-string timestamp', [validBringClaim({ createdAt: NOW })]],
  ['negative slot', [validBringClaim({ itemIndex: -1 })]],
  ['fractional slot', [validBringClaim({ itemIndex: 0.5 })]],
  ['unlisted slot', [validBringClaim({ itemIndex: 2 })]],
  ['unsafe slot', [validBringClaim({ itemIndex: Number.MAX_SAFE_INTEGER + 1 })]],
  ['duplicate slot', [validBringClaim({}), validBringClaim({ id: 'other-offer', memberId: 'river' })]],
  ['duplicate claim ID', [validBringClaim({}), validBringClaim({ itemIndex: 1 })]],
]) {
  test(`malformed existing bring claims preserve the original file: ${label}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zaction-invalid-bring-'));
    try {
      const filePath = join(directory, 'room.json');
      let data = createDemoData(NOW);
      data = createAction(data, 'bring-bbq', { planning: planning() }).data;
      target(data, 'bring-bbq').bringClaims = claims;
      const original = JSON.stringify(data, null, 2);
      await writeFile(filePath, original);
      assert.throws(() => migrateDemoData(data), /corrupt|unsupported/i);
      await assert.rejects(createDemoStore({ filePath, now: () => NOW }), /corrupt|unsupported/i);
      assert.equal(await readFile(filePath, 'utf8'), original, 'corrupt claims are never reset to an empty collection');
    } finally { await rm(directory, { recursive: true, force: true }); }
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

test('a dated source reference stays member-authored and immutable through canonical operation replay', () => {
  const initial = createDemoData(NOW);
  const request = operation(initial, { type: 'create-action', actionId: 'source-question', action: authored({ sourceRef: { ...CURATED_SOURCE_REF } }) });
  const created = applyOperation(initial, request, NOW);
  assert.equal(created.receipt.accepted, true);
  const action = target(created.snapshot, request.actionId);
  assert.deepEqual(action.sourceRef, CURATED_SOURCE_REF);
  assert.equal(action.sourceKind, 'member-provided', 'a publisher reference does not make the authored plan official');
  assert.deepEqual(action.contributions, []);
  assert.deepEqual(action.ballots, []);
  const reordered = { ...request, action: { ...request.action, sourceRef: { snapshotId: CURATED_SOURCE_REF.snapshotId, opportunityId: CURATED_SOURCE_REF.opportunityId } } };
  const replay = applyOperation(created.data, reordered, NOW + 1);
  assert.deepEqual(replay.receipt, created.receipt);
  assert.equal(replay.snapshot.sequence, created.snapshot.sequence);
  const altered = applyOperation(replay.data, { ...request, action: { ...request.action, sourceRef: { ...CURATED_SOURCE_REF, snapshotId: 'different-snapshot' } } }, NOW + 2);
  assert.equal(altered.receipt.accepted, false);
  assert.deepEqual(target(altered.snapshot, request.actionId), action);
  assert.deepEqual(altered.data.receipts[request.id], created.data.receipts[request.id]);
  assert.deepEqual(applyOperation(altered.data, request, NOW + 3).receipt, created.receipt);
});

test('malformed and unavailable source publications reject atomically while their original rejected payloads survive restart', async () => {
  await withCommunityStore(async ({ store, op, filePath }) => {
    const before = await store.getState();
    const references = [null, [], { opportunityId: CURATED_SOURCE_REF.opportunityId }, { ...CURATED_SOURCE_REF, checkedAt: '2026-10-29T23:12:57.514Z' },
      { ...CURATED_SOURCE_REF, opportunityId: 'bad id' }, { ...CURATED_SOURCE_REF, snapshotId: 'unavailable-snapshot' }];
    const rejected = [];
    for (const [index, sourceRef] of references.entries()) {
      const requests = [
        await op({ type: 'create-action', actionId: `invalid-source-${index}`, action: authored({ sourceRef }) }),
        await op({ type: 'change-plan', replacementActionId: `invalid-source-change-${index}`, expectedChangeId: null,
          changeReason: 'Keep the original until this source reference can be reviewed.', action: authored({ sourceRef }) }),
      ];
      for (const request of requests) {
        const result = await store.submit(request);
        assert.equal(result.receipt.accepted, false);
        assert.match(result.receipt.reason, /source reference|source snapshot/i);
        assert.deepEqual(result.snapshot.actions, before.actions, 'neither a rejected create nor change leaves an orphan or edits its original');
        rejected.push({ request, receipt: result.receipt });
      }
    }
    const restarted = await createDemoStore({ filePath, now: () => NOW + 1 });
    const saved = JSON.parse(await readFile(filePath, 'utf8'));
    for (const { request, receipt } of rejected) {
      assert.deepEqual(saved.receipts[request.id].operation, request, 'invalid input is retained as history, not treated as a published record');
      assert.deepEqual((await restarted.submit(request)).receipt, receipt);
    }
    assert.deepEqual((await restarted.getState()).actions, before.actions);
  });
});

test('well-shaped unavailable source history survives migration and a replacement keeps its separately selected known snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zaction-source-history-'));
  try {
    const filePath = join(directory, 'room.json');
    const saved = createAction(createDemoData(NOW), 'older-source-plan').data;
    const unavailable = { ...CURATED_SOURCE_REF, snapshotId: 'older-unavailable-snapshot' };
    target(saved, 'older-source-plan').sourceRef = unavailable;
    saved.keepUnknownRoot = { retain: true };
    const migrated = migrateDemoData(saved);
    assert.deepEqual(migrated, saved, 'a shape-valid unavailable snapshot is neither stripped nor resolved to the current catalog');
    await writeFile(filePath, JSON.stringify(saved));
    const store = await createDemoStore({ filePath, now: () => NOW });
    const before = target(await store.getState(), 'older-source-plan');
    const change = operation({ snapshot: await store.getState() }, { actionId: before.id, type: 'change-plan', replacementActionId: 'new-source-plan',
      expectedChangeId: null, changeReason: 'Start a fresh question using the reviewed source note.', action: authored({ sourceRef: { ...CURATED_SOURCE_REF } }) });
    const accepted = await store.submit(change);
    assert.equal(accepted.receipt.accepted, true);
    const original = target(accepted.snapshot, before.id);
    for (const key of Object.keys(before).filter(key => key !== 'lifecycle')) assert.deepEqual(original[key], before[key], `${key} stays on the historical plan`);
    assert.deepEqual(original.sourceRef, unavailable);
    assert.deepEqual(target(accepted.snapshot, 'new-source-plan').sourceRef, CURATED_SOURCE_REF);
    assert.equal(target(accepted.snapshot, 'new-source-plan').sourceKind, 'member-provided');
    const restarted = await createDemoStore({ filePath, now: () => NOW + 1 });
    const replay = await restarted.submit(change);
    assert.deepEqual(replay.receipt, accepted.receipt);
    assert.deepEqual(target(replay.snapshot, before.id).sourceRef, unavailable);
    assert.deepEqual(target(replay.snapshot, 'new-source-plan').sourceRef, CURATED_SOURCE_REF);
    assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')).keepUnknownRoot, saved.keepUnknownRoot);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('missing legacy source metadata stays absent and malformed published metadata preserves exact saved bytes', async () => {
  const baseline = createAction(createDemoData(NOW)).data;
  assert.deepEqual(migrateDemoData(baseline), baseline);
  assert.ok(baseline.snapshot.actions.every(action => !Object.hasOwn(action, 'sourceRef')));
  const ownUndefined = structuredClone(baseline);
  target(ownUndefined, 'library-access').sourceRef = undefined;
  assert.throws(() => migrateDemoData(ownUndefined), /corrupt|unsupported/i, 'a malformed present property never becomes a missing legacy reference');
  const directory = await mkdtemp(join(tmpdir(), 'zaction-corrupt-source-'));
  try {
    const filePath = join(directory, 'room.json');
    for (const sourceRef of [null, 'not-a-reference', { opportunityId: CURATED_SOURCE_REF.opportunityId }, { ...CURATED_SOURCE_REF, current: true }, { ...CURATED_SOURCE_REF, snapshotId: 'bad id' }]) {
      const malformed = structuredClone(baseline);
      target(malformed, 'library-access').sourceRef = sourceRef;
      const original = JSON.stringify(malformed, null, 4) + '\n';
      await writeFile(filePath, original);
      assert.throws(() => migrateDemoData(malformed), /corrupt|unsupported/i);
      assert.deepEqual(target(malformed, 'library-access').sourceRef, sourceRef);
      await assert.rejects(createDemoStore({ filePath, now: () => NOW }), /corrupt|unsupported/i);
      assert.equal(await readFile(filePath, 'utf8'), original);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('legacy queued creates and changes without source references remain unchanged through restart and replay', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zaction-legacy-source-'));
  try {
    const filePath = join(directory, 'room.json');
    let store = await createDemoStore({ filePath, now: () => NOW });
    const queuedCreate = operation({ snapshot: await store.getState() }, { type: 'create-action', actionId: 'legacy-source-plan', action: authored() });
    store = await createDemoStore({ filePath, now: () => NOW + 1 });
    const created = await store.submit(queuedCreate);
    assert.equal(created.receipt.accepted, true);
    const queuedChange = operation({ snapshot: created.snapshot }, { actionId: queuedCreate.actionId, type: 'change-plan', replacementActionId: 'legacy-source-successor',
      expectedChangeId: null, changeReason: 'Keep the previously prepared member-authored question.', action: authored({ title: 'A reviewed library-access question' }) });
    store = await createDemoStore({ filePath, now: () => NOW + 2 });
    const changed = await store.submit(queuedChange);
    assert.equal(changed.receipt.accepted, true);
    store = await createDemoStore({ filePath, now: () => NOW + 3 });
    assert.deepEqual((await store.submit(queuedCreate)).receipt, created.receipt);
    assert.deepEqual((await store.submit(queuedChange)).receipt, changed.receipt);
    const disk = JSON.parse(await readFile(filePath, 'utf8'));
    assert.ok(disk.snapshot.actions.every(action => !Object.hasOwn(action, 'sourceRef')));
    assert.equal(target(disk, queuedCreate.actionId).sourceKind, 'member-provided');
    assert.equal(target(disk, queuedChange.replacementActionId).sourceKind, 'member-provided');
    assert.deepEqual(disk.receipts[queuedCreate.id].operation, queuedCreate);
    assert.deepEqual(disk.receipts[queuedChange.id].operation, queuedChange);
  } finally { await rm(directory, { recursive: true, force: true }); }
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

const lifecycleChange = (op, fields = {}) => op({ type: 'change-plan', replacementActionId: 'updated-bbq', expectedChangeId: null,
  changeReason: 'Move the gathering to a more accessible location.', action: authored({ title: 'A more accessible neighborhood BBQ', planning: planning({ place: 'A step-free public pavilion', bring: ['Water', 'Water'] }) }), ...fields });

test('author replacement is atomic, preserves adopted history, and starts a fresh linked proposal', async () => {
  await withCommunityStore(async ({ store, first, second, op }) => {
    await store.submit(await op({ type: 'contribute', text: 'Please keep the original discussion available.' }));
    await store.submit(await op({ type: 'react', active: true }));
    await store.submit(await op({ type: 'rsvp', status: 'going' }));
    await store.submit(await op({ type: 'bring-item', itemIndex: 0, intent: 'claim' }));
    await store.submit(await op({ type: 'vote', choice: 'approve' }));
    await store.submit(await op({ type: 'vote', memberId: second.profile.id, choice: 'approve' }));
    await store.submit(await op({ type: 'close' }));
    await store.submit(await op({ type: 'minutes', text: 'The original proposal was adopted; logistics still require confirmation.' }));
    const before = target(await store.getState(), 'community-bbq');
    const change = await lifecycleChange(op, { changeReason: '  Move to a step-free pavilion after reviewing access.  ' });
    const result = await store.submit(change);
    assert.equal(result.receipt.accepted, true);
    const original = target(result.snapshot, 'community-bbq');
    for (const key of Object.keys(before).filter(key => key !== 'lifecycle')) assert.deepEqual(original[key], before[key], `${key} remains historical on its original target`);
    assert.deepEqual(original.lifecycle, { status: 'superseded', changeId: change.id, changedAt: result.receipt.receivedAt, changedBy: first.profile.id,
      reason: change.changeReason.trim(), replacementActionId: 'updated-bbq' });
    const successor = target(result.snapshot, 'updated-bbq');
    assert.deepEqual(successor.origin, { actionId: 'community-bbq', reason: change.changeReason.trim(), kind: 'change' });
    assert.equal(successor.createdBy, first.profile.id);
    assert.equal(successor.lifecycle.status, 'active');
    assert.equal(successor.outcome, 'open');
    for (const field of ['contributions', 'ballots', 'rsvps', 'reactions', 'bringClaims', 'minutes', 'completedTasks']) assert.deepEqual(successor[field], [], `the replacement does not copy ${field}`);
    const replay = await store.submit(change);
    assert.deepEqual(replay.receipt, result.receipt);
    assert.equal(replay.snapshot.actions.filter(action => action.origin?.actionId === 'community-bbq').length, 1);
    const retargeted = await store.submit({ ...change, replacementActionId: 'another-orphan' });
    assert.equal(retargeted.receipt.accepted, false);
    assert.equal(retargeted.snapshot.actions.some(action => action.id === 'another-orphan'), false);
  });
});

test('author lifecycle tokens ignore unrelated room changes but reject missing, stale, unauthorized, and authorless requests', async () => {
  await withCommunityStore(async ({ store, second, op }) => {
    const prepared = await lifecycleChange(op);
    const original = target(await store.getState(), 'community-bbq');
    const missingToken = { ...prepared, id: randomUUID() }; delete missingToken.expectedChangeId;
    const requests = [missingToken, { ...prepared, id: randomUUID(), expectedChangeId: 'unseen-transition' },
      { ...prepared, id: randomUUID(), memberId: second.profile.id }, { ...prepared, id: randomUUID(), expectedChangeId: undefined },
      { ...prepared, id: randomUUID(), changeReason: 'tiny' }, { ...prepared, id: randomUUID(), changeReason: 'x'.repeat(601) },
      await op({ actionId: SEED, type: 'cancel-plan', expectedChangeId: null, changeReason: 'Do not let a member withdraw an authorless example.' })];
    for (const request of requests) {
      const result = await store.submit(request);
      assert.equal(result.receipt.accepted, false);
      assert.deepEqual(target(result.snapshot, 'community-bbq'), original);
      assert.equal(result.snapshot.actions.some(action => action.id === 'updated-bbq'), false);
    }
    await store.submit(await op({ type: 'contribute', memberId: second.profile.id, text: 'An unrelated comment must not stale the author’s lifecycle token.' }));
    const accepted = await store.submit(prepared);
    assert.equal(accepted.receipt.accepted, true, 'the active null token is independent of global snapshot sequence');
  });
});

for (const [label, fields] of [
  ['missing replacement ID', { replacementActionId: undefined }],
  ['original ID reuse', { replacementActionId: 'community-bbq' }],
  ['occupied replacement ID', { replacementActionId: SEED }],
  ['reserved replacement ID', { replacementActionId: '__proto__' }],
  ['missing replacement fields', { action: undefined }],
  ['invalid replacement title', { action: authored({ title: '' }) }],
  ['unsafe replacement source', { action: authored({ sourceUrl: 'javascript:alert(1)' }) }],
  ['unsupported money field', { action: authored({ budget: 100 }) }],
]) {
  test(`invalid author replacement leaves no orphan and preserves original terms: ${label}`, async () => {
    await withCommunityStore(async ({ store, op }) => {
      const before = target(await store.getState(), 'community-bbq');
      const change = await lifecycleChange(op, fields);
      const rejected = await store.submit(change);
      assert.equal(rejected.receipt.accepted, false);
      assert.equal(rejected.snapshot.actions.length, 2);
      assert.deepEqual(target(rejected.snapshot, 'community-bbq'), before);
      assert.deepEqual((await store.submit(change)).receipt, rejected.receipt);
    });
  });
}

for (const firstType of ['cancel-plan', 'change-plan']) {
  test(`serialized cancellation versus replacement accepts only the first ${firstType} request`, async () => {
    await withCommunityStore(async ({ store, op }) => {
      const cancel = await op({ type: 'cancel-plan', expectedChangeId: null, changeReason: 'The author needs to withdraw this tentative gathering.' });
      const change = await lifecycleChange(op);
      const requests = firstType === 'cancel-plan' ? [cancel, change] : [change, cancel];
      const results = await Promise.all(requests.map(request => store.submit(request)));
      assert.deepEqual(results.map(result => result.receipt.accepted), [true, false]);
      const original = target(await store.getState(), 'community-bbq');
      assert.equal(original.lifecycle.status, firstType === 'cancel-plan' ? 'cancelled' : 'superseded');
      assert.equal(original.lifecycle.changeId, requests[0].id);
      assert.equal((await store.getState()).actions.filter(action => action.origin?.actionId === 'community-bbq').length, firstType === 'cancel-plan' ? 0 : 1);
      assert.deepEqual((await store.submit(requests[1])).receipt, results[1].receipt);
    });
  });
}

test('cancelled plan can create one fresh restart only after explicit review of its cancellation token', async () => {
  await withCommunityStore(async ({ store, op }) => {
    const cancel = await op({ type: 'cancel-plan', expectedChangeId: null, changeReason: 'The original date no longer works for the author.' });
    const cancelled = await store.submit(cancel);
    assert.equal(cancelled.receipt.accepted, true);
    const cancellation = target(cancelled.snapshot, 'community-bbq').lifecycle;
    const stale = await store.submit(await lifecycleChange(op));
    assert.equal(stale.receipt.accepted, false);
    const restart = await lifecycleChange(op, { expectedChangeId: cancel.id, replacementActionId: 'new-date-bbq', changeReason: 'Try a new date as a fresh plan that people can choose again.' });
    const restarted = await store.submit(restart);
    assert.equal(restarted.receipt.accepted, true);
    assert.deepEqual(target(restarted.snapshot, 'community-bbq').lifecycle, { ...cancellation, replacementActionId: 'new-date-bbq' });
    assert.deepEqual(target(restarted.snapshot, 'new-date-bbq').origin, { actionId: 'community-bbq', reason: restart.changeReason, kind: 'restart' });
    assert.equal(target(restarted.snapshot, 'new-date-bbq').lifecycle.status, 'active');
    assert.equal((await store.submit(await lifecycleChange(op, { expectedChangeId: cancel.id, replacementActionId: 'second-restart' }))).receipt.accepted, false);
    assert.equal((await store.submit(await op({ type: 'cancel-plan', expectedChangeId: cancel.id, changeReason: 'Do not rewrite the original cancellation.' }))).receipt.accepted, false);
    const oldCancelReplay = await store.submit(cancel);
    assert.deepEqual(oldCancelReplay.receipt, cancelled.receipt);
    assert.equal(target(oldCancelReplay.snapshot, 'community-bbq').lifecycle.replacementActionId, 'new-date-bbq');
    assert.deepEqual((await store.submit(restart)).receipt, restarted.receipt);
    assert.equal((await store.getState()).actions.some(action => action.id === 'second-restart'), false);
  });
});

test('terminal plans reject fresh participation without redirecting; only exact-owner original claim releases remain allowed', async () => {
  await withCommunityStore(async ({ store, second, op }) => {
    const claim = await op({ type: 'bring-item', itemIndex: 0, intent: 'claim' });
    const acceptedClaim = await store.submit(claim);
    const changed = await store.submit(await lifecycleChange(op));
    const original = target(changed.snapshot, 'community-bbq');
    for (const fields of [{ type: 'vote', choice: 'approve' }, { type: 'contribute', text: 'A queued comment must stay on its original inactive plan.' },
      { type: 'react', active: true }, { type: 'rsvp', status: 'going' }, { type: 'close' },
      { type: 'minutes', text: 'No new minutes may rewrite an inactive plan.' }, { type: 'complete-task', taskId: 'agenda' },
      { type: 'bring-item', itemIndex: 1, intent: 'claim' }]) {
      const rejected = await store.submit(await op(fields));
      assert.equal(rejected.receipt.accepted, false, `${fields.type} is not redirected to the new plan`);
      assert.match(rejected.receipt.reason, /superseded|historical|inactive/i);
      assert.deepEqual(target(rejected.snapshot, 'community-bbq'), original);
      assert.deepEqual(target(rejected.snapshot, 'updated-bbq').bringClaims, []);
    }
    assert.equal((await store.submit(await op({ type: 'bring-item', memberId: second.profile.id, itemIndex: 0, intent: 'release', claimId: claim.id }))).receipt.accepted, false);
    assert.equal((await store.submit(await op({ type: 'bring-item', itemIndex: 0, intent: 'release', claimId: 'a-stale-claim-id' }))).receipt.accepted, false);
    assert.deepEqual((await store.submit(claim)).receipt, acceptedClaim.receipt, 'a previous accepted receipt stays accepted without creating a new intention');
    const released = await store.submit(await op({ type: 'bring-item', itemIndex: 0, intent: 'release', claimId: claim.id }));
    assert.equal(released.receipt.accepted, true);
    assert.deepEqual(target(released.snapshot, 'community-bbq').bringClaims, []);
    assert.deepEqual(target(released.snapshot, 'updated-bbq').bringClaims, []);
    assert.equal(target(released.snapshot, 'community-bbq').lifecycle.changeId, original.lifecycle.changeId);
  });
});

test('inactive plan expiry preserves prior open or adopted outcomes and lifecycle chains survive restart', async () => {
  await withCommunityStore(async ({ store, first, second, op, filePath }) => {
    const firstChange = await store.submit(await lifecycleChange(op));
    assert.equal(firstChange.receipt.accepted, true);
    assert.equal(target(firstChange.snapshot, 'community-bbq').outcome, 'open');
    await store.submit(await op({ actionId: 'updated-bbq', type: 'vote', choice: 'approve' }));
    await store.submit(await op({ actionId: 'updated-bbq', type: 'vote', memberId: second.profile.id, choice: 'approve' }));
    await store.submit(await op({ actionId: 'updated-bbq', type: 'close' }));
    const cancel = await op({ actionId: 'updated-bbq', type: 'cancel-plan', expectedChangeId: null, changeReason: 'Withdraw the tentative gathering without rewriting the group decision.' });
    await store.submit(cancel);
    const restart = await lifecycleChange(op, { actionId: 'updated-bbq', replacementActionId: 'third-bbq', expectedChangeId: cancel.id, changeReason: 'Propose a new date with fresh participation.' });
    const created = await store.submit(restart);
    assert.equal(created.receipt.accepted, true);
    const before = JSON.parse(await readFile(filePath, 'utf8'));
    const restored = await createDemoStore({ filePath, now: () => NOW + 9 * 24 * 60 * 60 * 1000 });
    const snapshot = await restored.getState();
    assert.equal(target(snapshot, 'community-bbq').outcome, 'open');
    assert.equal(target(snapshot, 'community-bbq').closedAt, null);
    assert.equal(target(snapshot, 'updated-bbq').outcome, 'adopted');
    assert.equal(target(snapshot, 'third-bbq').outcome, 'no-quorum', 'only the active successor expires normally');
    assert.deepEqual(target(snapshot, 'community-bbq').lifecycle, target(before.snapshot, 'community-bbq').lifecycle);
    assert.deepEqual(target(snapshot, 'updated-bbq').lifecycle, target(before.snapshot, 'updated-bbq').lifecycle);
    assert.equal(await restored.authorized(first.profile.id, first.token), true);
    assert.deepEqual((await restored.submit(restart)).receipt, created.receipt);
    const after = JSON.parse(await readFile(filePath, 'utf8'));
    assert.deepEqual(after.receipts, before.receipts);
    assert.deepEqual(after.sessions, before.sessions);
  });
});

test('a failed atomic file replacement cannot expose a staged lifecycle or orphan successor', async () => {
  await withCommunityStore(async ({ store, first, op, filePath }) => {
    const before = await store.getState();
    const original = await readFile(filePath, 'utf8');
    const preserved = filePath + '.preserved';
    const change = await lifecycleChange(op);
    await rename(filePath, preserved);
    await mkdir(filePath);
    try {
      await assert.rejects(store.submit(change));
      assert.deepEqual(await store.getState(), before, 'the in-memory snapshot is committed only after atomic persistence succeeds');
      assert.equal(await readFile(preserved, 'utf8'), original);
    } finally { await rm(filePath, { recursive: true, force: true }); await rename(preserved, filePath); }
    assert.equal(await store.authorized(first.profile.id, first.token), true);
    const retry = await store.submit(change);
    assert.equal(retry.receipt.accepted, true);
    assert.equal(retry.snapshot.actions.filter(action => action.origin?.actionId === 'community-bbq').length, 1);
  });
});

test('legacy lifecycle defaults additively and the explicit demo author retains controls on a member-provided plan', () => {
  let legacy = createDemoData(NOW);
  legacy = createAction(legacy, 'old-authored-plan').data;
  for (const action of legacy.snapshot.actions) delete action.lifecycle;
  legacy.keepUnknownRoot = { future: true };
  target(legacy, 'old-authored-plan').keepUnknownAction = 'preserve';
  const migrated = migrateDemoData(legacy);
  assert.ok(migrated.snapshot.actions.every(action => action.lifecycle.status === 'active' && action.lifecycle.changeId === null));
  assert.equal(migrated.snapshot.roomId, legacy.snapshot.roomId);
  assert.deepEqual(migrated.receipts, legacy.receipts);
  assert.deepEqual(migrated.sessions, legacy.sessions);
  assert.deepEqual(migrated.keepUnknownRoot, legacy.keepUnknownRoot);
  assert.equal(target(migrated, 'old-authored-plan').keepUnknownAction, 'preserve');
  assert.ok(legacy.snapshot.actions.every(action => !Object.hasOwn(action, 'lifecycle')));
  const changed = applyOperation(migrated, operation(migrated, { actionId: 'old-authored-plan', type: 'change-plan', replacementActionId: 'demo-authored-successor', expectedChangeId: null,
    changeReason: 'The original explicit demo author may prepare another plan.', action: authored() }), NOW);
  assert.equal(changed.receipt.accepted, true);
  const invalid = structuredClone(migrated); target(invalid, 'old-authored-plan').lifecycle = undefined;
  assert.throws(() => migrateDemoData(invalid), /corrupt|unsupported/i, 'a present malformed field never defaults active');
});

const lifecycleCorruptions = [
  ['null lifecycle', data => { target(data, 'community-bbq').lifecycle = null; }],
  ['unknown status', data => { target(data, 'community-bbq').lifecycle.status = 'published-again'; }],
  ['invalid token', data => { target(data, 'community-bbq').lifecycle.changeId = '__proto__'; }],
  ['invalid timestamp', data => { target(data, 'community-bbq').lifecycle.changedAt = 'not-a-date'; }],
  ['wrong author', data => { target(data, 'community-bbq').lifecycle.changedBy = 'river'; }],
  ['missing replacement', data => { target(data, 'community-bbq').lifecycle.replacementActionId = 'missing-plan'; }],
  ['missing origin', data => { delete target(data, 'updated-bbq').origin; }],
  ['origin on wrong source', data => { target(data, 'updated-bbq').origin.actionId = SEED; }],
  ['wrong origin kind', data => { target(data, 'updated-bbq').origin.kind = 'restart'; }],
  ['origin reason mismatch', data => { target(data, 'updated-bbq').origin.reason = 'A different unexplained transition.'; }],
  ['oversized padded transition reason', data => { const reason = ' '.repeat(601) + 'Reviewed change'; target(data, 'community-bbq').lifecycle.reason = reason; target(data, 'updated-bbq').origin.reason = reason; }],
  ['active source with a successor', data => { target(data, 'community-bbq').lifecycle = { status: 'active', changeId: null, changedAt: null, changedBy: null, reason: '', replacementActionId: 'updated-bbq' }; }],
  ['lifecycle cycle', data => {
    const source = target(data, 'community-bbq'); const successor = target(data, 'updated-bbq');
    successor.lifecycle = { status: 'superseded', changeId: 'cycle-change', changedAt: new Date(NOW).toISOString(), changedBy: source.createdBy, reason: source.lifecycle.reason, replacementActionId: source.id };
    source.origin = { actionId: successor.id, reason: source.lifecycle.reason, kind: 'change' };
  }],
];
for (const [label, corrupt] of lifecycleCorruptions) {
  test(`malformed lifecycle preserves the saved original file: ${label}`, async () => {
    await withCommunityStore(async ({ store, op, filePath }) => {
      assert.equal((await store.submit(await lifecycleChange(op))).receipt.accepted, true);
      const data = JSON.parse(await readFile(filePath, 'utf8'));
      corrupt(data);
      const original = JSON.stringify(data, null, 2);
      await writeFile(filePath, original);
      assert.throws(() => migrateDemoData(data), /corrupt|unsupported/i);
      await assert.rejects(createDemoStore({ filePath, now: () => NOW }), /corrupt|unsupported/i);
      assert.equal(await readFile(filePath, 'utf8'), original);
    });
  });
}
