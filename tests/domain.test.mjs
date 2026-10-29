import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoData, applyOperation, createDemoStore } from '../server.mjs';

const NOW = Date.parse('2026-10-29T16:00:00Z');
const operation = (data, fields = {}) => ({
  id: randomUUID(), memberId: 'alex', type: 'vote', choice: 'approve',
  proposalRevision: data.snapshot.proposalRevision,
  rulesVersion: data.snapshot.rulesVersion,
  membershipVersion: data.snapshot.membershipVersion,
  roomId: data.snapshot.roomId,
  ...fields,
});

test('a fresh public demo has no fabricated contributions, ballots, or outcomes', () => {
  const { snapshot } = createDemoData(NOW);
  assert.equal(snapshot.outcome, 'open');
  assert.deepEqual(snapshot.ballots, []);
  assert.deepEqual(snapshot.contributions, []);
  assert.deepEqual(snapshot.minutes, []);
  assert.deepEqual(snapshot.completedTasks, []);
  assert.ok(Date.parse(snapshot.closesAt) > NOW);
});

test('replaying the same operation returns its original receipt and one ballot', () => {
  const initial = createDemoData(NOW);
  const ballot = operation(initial);
  const first = applyOperation(initial, ballot, NOW);
  const replay = applyOperation(first.data, ballot, NOW + 5000);
  assert.equal(first.receipt.accepted, true);
  assert.deepEqual(replay.receipt, first.receipt);
  assert.equal(replay.snapshot.ballots.length, 1);
  assert.equal(initial.snapshot.ballots.length, 0, 'the domain operation is pure');
});

test('an operation ID cannot be reused for a different payload', () => {
  const initial = createDemoData(NOW);
  const ballot = operation(initial);
  const accepted = applyOperation(initial, ballot, NOW);
  const changed = applyOperation(accepted.data, { ...ballot, choice: 'oppose' }, NOW + 1);
  assert.equal(changed.receipt.accepted, false);
  assert.equal(changed.snapshot.ballots.length, 1);
  assert.equal(changed.snapshot.ballots[0].choice, 'approve');
  const original = applyOperation(changed.data, ballot, NOW + 2);
  assert.deepEqual(original.receipt, accepted.receipt);
});

test('a second device or operation gives the same member no extra vote', () => {
  const initial = createDemoData(NOW);
  const first = applyOperation(initial, operation(initial), NOW);
  const second = applyOperation(first.data, operation(first.data, { choice: 'oppose' }), NOW + 1);
  assert.equal(second.receipt.accepted, false);
  assert.equal(second.snapshot.ballots.length, 1);
});

for (const id of ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty']) {
  test(`reserved-looking operation ID ${id} cannot crash or mutate object prototypes`, () => {
    const data = createDemoData(NOW);
    const ballot = operation(data, { id });
    const result = applyOperation(data, ballot, NOW);
    assert.equal(typeof result.receipt.accepted, 'boolean');
    assert.equal(result.snapshot.ballots.length, result.receipt.accepted ? 1 : 0);
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
    assert.deepEqual(result.snapshot.ballots, []);
    assert.equal(result.snapshot.outcome, 'open');
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
  assert.equal(replay.snapshot.contributions.length, 1);
  assert.equal(replay.snapshot.contributions[0].text, question.text);
  for (const text of ['', '   ', 'x'.repeat(2001)]) {
    const invalid = applyOperation(first.data, operation(first.data, { type: 'contribute', text }), NOW + 2);
    assert.equal(invalid.receipt.accepted, false);
    assert.equal(invalid.snapshot.contributions.length, 1);
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
    assert.equal(data.snapshot.outcome, 'open', 'accepted ballots are provisional before closure');
    const closed = applyOperation(data, operation(data, { type: 'close' }), NOW + 100);
    assert.equal(closed.receipt.accepted, true);
    assert.equal(closed.snapshot.outcome, expected);
    assert.ok(closed.snapshot.closedAt);
    const late = applyOperation(closed.data, operation(closed.data, { memberId: 'jules' }), NOW + 200);
    assert.equal(late.receipt.accepted, false);
    assert.equal(late.snapshot.ballots.length, choices.length);
  });
}

test('the server receipt deadline rejects an offline ballot even if created earlier', () => {
  const data = createDemoData(NOW);
  const savedEarlier = operation(data);
  const late = applyOperation(data, savedEarlier, Date.parse(data.snapshot.closesAt) + 1);
  assert.equal(late.receipt.accepted, false);
  assert.equal(late.snapshot.outcome, 'no-quorum');
  assert.equal(late.snapshot.ballots.length, 0);
});

test('accepted receipt replay stays accepted even after the vote closes', () => {
  const data = createDemoData(NOW);
  const ballot = operation(data);
  const accepted = applyOperation(data, ballot, NOW);
  const closed = applyOperation(accepted.data, operation(accepted.data, { type: 'close' }), NOW + 1);
  const replay = applyOperation(closed.data, ballot, NOW + 2);
  assert.deepEqual(replay.receipt, accepted.receipt);
  assert.equal(replay.snapshot.ballots.length, 1);
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
  assert.equal(corrected.snapshot.minutes.length, 2);
  assert.equal(corrected.snapshot.minutes[0].text, first.snapshot.minutes[0].text);
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
  assert.equal(duplicate.snapshot.completedTasks.length, 1);
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
    assert.equal((await store.getState()).ballots.length, 1);
    const restored = await createDemoStore({ filePath, now: () => NOW + 1000 });
    assert.equal((await restored.getState()).roomId, snapshot.roomId);
    assert.equal((await restored.getState()).ballots.length, 1);
    const replay = await restored.submit(ballots[0]);
    assert.deepEqual(replay.receipt, receipts[0].receipt);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
