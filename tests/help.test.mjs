import test from 'node:test';
import assert from 'node:assert/strict';
import { helpEntriesFor, helpReceiptFor } from '../src/help.ts';

const NOW = '2026-10-29T20:00:00.000Z';
const claim = (id, itemIndex, memberId = 'maya') => ({ id, itemIndex, memberId, createdAt: NOW });
const action = (id, claims = [], lifecycle = { status: 'active', changeId: null, changedAt: null, changedBy: null, reason: '' }) => ({
  id, title: `${id} community plan`, planning: { bring: ['Welcome people · 2–3 pm', 'Welcome people · 2–3 pm'] }, bringClaims: claims, lifecycle,
});
const op = (fields = {}) => ({ id: 'offer-1', type: 'bring-item', actionId: 'picnic', itemIndex: 0, memberId: 'maya', roomId: 'room-current', intent: 'claim', ...fields });
const receipt = (accepted, fields = {}) => { const operation = op(fields); return { id: operation.id, type: operation.type, actionId: operation.actionId, operation, accepted, reason: accepted ? 'Accepted by the demo room.' : 'This need already has an offer.', receivedAt: NOW }; };
const state = (actions, fields = {}) => ({ snapshot: { roomId: 'room-current', actions }, memberId: 'maya', pending: [], receipts: [], ...fields });

test('My help keeps duplicate practical needs and two plans distinct without changing stored data', () => {
  const current = state([action('picnic', [claim('p0', 0), claim('p1', 1, 'noah')]), action('library', [claim('l1', 1)])]);
  const before = structuredClone(current);
  const entries = helpEntriesFor(current);
  assert.deepEqual(entries.map(entry => [entry.action.id, entry.itemIndex, entry.claim.id]), [['picnic', 0, 'p0'], ['library', 1, 'l1']]);
  assert.deepEqual(current, before, 'reading the index does not create participation, receipts or another ledger');
  assert.deepEqual(helpEntriesFor({ ...current, memberId: 'noah' }).map(entry => [entry.action.id, entry.itemIndex]), [['picnic', 1]]);
  assert.deepEqual(helpEntriesFor({ ...current, memberId: null }), []);
  assert.deepEqual(helpEntriesFor({ ...current, snapshot: null }), []);
});

test('pending offer and exact withdrawal keep current shared ownership visible', () => {
  const current = state([action('picnic', [claim('current-claim', 0)])], {
    pending: [op({ id: 'withdraw', intent: 'release', claimId: 'current-claim' }), op({ id: 'second-offer', itemIndex: 1 })],
  });
  const entries = helpEntriesFor(current);
  assert.equal(entries[0].claim.id, 'current-claim');
  assert.equal(entries[0].pending.claimId, 'current-claim');
  assert.equal(entries[1].claim, undefined, 'queued offer does not reserve an open need');
  assert.equal(entries[1].pending.id, 'second-offer');
  const withdrawn = helpEntriesFor(state([action('picnic')], { receipts: [receipt(true, { id: 'withdraw', intent: 'release', claimId: 'current-claim' })] }));
  assert.deepEqual(withdrawn, [], 'accepted withdrawal no longer appears as a current commitment');
});

test('rejected attempts retain the current competing owner and clear only after a later accepted request', () => {
  const current = state([action('picnic', [claim('other-claim', 0, 'noah')])], { receipts: [receipt(false)] });
  let entry = helpEntriesFor(current)[0];
  assert.equal(entry.claim.memberId, 'noah');
  assert.equal(entry.rejected.id, 'offer-1');
  const pending = op({ id: 'reviewed-new-offer' });
  entry = helpEntriesFor({ ...current, pending: [pending] })[0];
  assert.equal(entry.pending.id, pending.id);
  assert.equal(entry.rejected.id, 'offer-1', 'old refusal remains available while an explicit new attempt waits');
  assert.deepEqual(helpEntriesFor({ ...current, receipts: [...current.receipts, receipt(true, { id: 'later-release', intent: 'release', claimId: 'new-own-claim' })] }), []);
});

test('old rooms, other profiles, mismatched targets and unknown slots never become current help', () => {
  const current = state([action('picnic')], {
    pending: [op({ roomId: 'room-previous' }), op({ memberId: 'noah' }), op({ actionId: 'other-plan' }), op({ itemIndex: 99 })],
    receipts: [receipt(false, { roomId: 'room-previous' }), receipt(false, { memberId: 'noah' }), { ...receipt(false), actionId: 'different-receipt-target' }, receipt(false, { itemIndex: -1 })],
  });
  assert.deepEqual(helpEntriesFor(current), []);
});

test('an old accepted replay arriving last cannot hide a newer rejected attempt', () => {
  const older = { ...receipt(true, { id: 'older-withdrawal', intent: 'release', claimId: 'previous-claim' }), receivedAt: '2026-10-29T20:00:00.000Z' };
  const newer = { ...receipt(false, { id: 'newer-conflict' }), receivedAt: '2026-10-29T20:12:00.000Z' };
  const current = state([action('picnic', [claim('other-claim', 0, 'noah')])], { receipts: [newer, older] });
  assert.equal(helpReceiptFor(current, 'picnic', 0).id, 'newer-conflict');
  assert.equal(helpEntriesFor(current)[0].rejected.id, 'newer-conflict');
  const tied = { ...receipt(true, { id: 'later-same-millisecond' }), receivedAt: newer.receivedAt };
  assert.equal(helpReceiptFor({ ...current, receipts: [newer, tied, older] }, 'picnic', 0).id, tied.id);
});

test('cancelled and superseded offers stay on the historical original, not a linked successor', () => {
  for (const status of ['cancelled', 'superseded']) {
    const life = { status, changeId: 'change-1', changedAt: NOW, changedBy: 'noah', reason: 'Rain needs a new day.', replacementActionId: 'new-picnic' };
    const original = action('picnic', [claim('original-claim', 0)], life);
    const successor = { ...action('new-picnic'), origin: { actionId: 'picnic', kind: status === 'cancelled' ? 'restart' : 'change', reason: life.reason } };
    const current = state([original, successor], { pending: [op({ id: 'late-original-release', intent: 'release', claimId: 'original-claim' })] });
    const [entry, ...others] = helpEntriesFor(current);
    assert.equal(entry.action.id, 'picnic');
    assert.equal(entry.action.lifecycle.status, status);
    assert.equal(entry.pending.actionId, 'picnic');
    assert.equal(entry.claim.id, 'original-claim');
    assert.deepEqual(others, []);
    assert.deepEqual(successor.bringClaims, [], 'a linked replacement carries no consent');
  }
});
