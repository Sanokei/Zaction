import test from 'node:test';
import assert from 'node:assert/strict';
import { commentStateFor, localReceiptFor, resetPostedComment } from '../src/comments.ts';
import { emptyLocalState } from '../src/migrations.ts';
import { createDemoState } from '../server.mjs';

const NOW = '2026-10-30T00:30:00.000Z';
const RAW = '  A useful question\n';
const context = (fields = {}) => ({ roomId: 'room-current', memberId: 'maya', actionId: 'discussion', parentId: null, text: RAW, ...fields });
const operation = (fields = {}) => ({ id: 'comment-1', type: 'contribute', roomId: 'room-current', memberId: 'maya', actionId: 'discussion',
  proposalRevision: 1, rulesVersion: 'DEMO-RULES-v1', membershipVersion: 'COMMUNITY-PREVIEW-v1', text: RAW.trim(), ...fields });
const receipt = (op = operation(), accepted = true, fields = {}) => ({ id: op.id, actionId: op.actionId, type: op.type, operation: structuredClone(op),
  accepted, reason: accepted ? 'Accepted by the demo room.' : 'This discussion is no longer active.', receivedAt: NOW, ...fields });
const contribution = (op = operation(), fields = {}) => ({ id: op.id, memberId: op.memberId, text: op.text.trim(), createdAt: NOW,
  ...(op.parentId ? { parentId: op.parentId } : {}), ...fields });
const state = (fields = {}) => {
  const snapshot = createDemoState(Date.parse(NOW));
  const action = { ...snapshot.actions[0], id: 'discussion', contributions: [contribution()] };
  return { ...emptyLocalState(), memberId: 'maya', selectedActionId: 'discussion', snapshot: { ...snapshot, roomId: 'room-current', actions: [action, { ...action, id: 'other-plan', contributions: [] }] },
    drafts: { discussion: { discussion: RAW, minutes: 'Keep these minutes.' }, 'other-plan': { discussion: 'Unrelated work.', minutes: 'Other minutes.' } },
    pending: [], receipts: [receipt()], ...fields };
};
const request = (fields = {}) => ({ ...context(), operationId: 'comment-1', ...fields });
const action = current => current.snapshot.actions.find(item => item.id === 'discussion');

test('comment acknowledgement stays scoped to its exact room, profile, plan, parent and submitted text', () => {
  const current = state();
  const before = structuredClone(current);
  assert.equal(commentStateFor(current, context()).kind, 'posted');
  assert.equal(commentStateFor({ ...current, selectedActionId: 'other-plan' }, context()).kind, 'posted', 'another tab’s selection is not an operation target');
  for (const fields of [{ roomId: 'other-room' }, { memberId: 'noah' }, { actionId: 'other-plan' }, { parentId: 'parent-1' }, { text: 'A different question' }, { text: '  ' }]) {
    assert.equal(commentStateFor(current, context(fields)).kind, 'ready');
  }
  for (const fields of [{ roomId: 'other-room' }, { memberId: 'noah' }, { actionId: 'other-plan' }, { parentId: 'parent-1' }, { text: 'Different words' }, { type: 'minutes' }]) {
    assert.equal(commentStateFor({ ...current, pending: [operation(fields)] }, context()).kind, 'posted', 'unrelated queued work cannot acknowledge or block this composer');
  }
  assert.equal(commentStateFor({ ...current, snapshot: null }, context()).kind, 'ready');
  assert.equal(commentStateFor({ ...current, memberId: null }, context()).kind, 'ready');
  assert.deepEqual(current, before, 'selectors never modify local history, drafts, progress or shared records');
});

test('matching pending work wins and server receipt time prevents an old accepted replay from masking a newer rejection', () => {
  const older = receipt(operation({ id: 'old-comment' }));
  const rejected = receipt(operation({ id: 'new-attempt' }), false, { receivedAt: '2026-10-30T00:31:00.000Z' });
  const current = state({ receipts: [rejected, older] });
  action(current).contributions = [contribution(older.operation)];
  assert.equal(commentStateFor(current, context()).kind, 'rejected');
  assert.equal(commentStateFor(current, context()).operation.id, rejected.id);
  const pending = operation({ id: 'pending-comment' });
  assert.deepEqual(commentStateFor({ ...current, pending: [pending] }, context()), { kind: 'pending', operation: pending });
  const tied = receipt(operation({ id: 'same-millisecond' }), true, { receivedAt: rejected.receivedAt });
  action(current).contributions.push(contribution(tied.operation));
  const result = commentStateFor({ ...current, receipts: [rejected, tied, older] }, context());
  assert.equal(result.kind, 'posted');
  assert.equal(result.operation.id, tied.id, 'equal original receipt times use saved array order');
  for (const malformed of [{ ...tied, id: 'wrong-receipt-id' }, { ...tied, actionId: 'other-plan' }, { ...tied, type: 'minutes' }, { ...tied, receivedAt: 'not-a-time' }]) {
    assert.equal(commentStateFor({ ...current, receipts: [rejected, malformed] }, context()).kind, 'rejected');
  }
});

test('Posted requires the same-ID accepted contribution, author, text and reply target, not identical words elsewhere', () => {
  for (const fields of [{ id: 'somebody-else-same-words' }, { memberId: 'noah' }, { text: 'Different accepted words' }, { parentId: 'another-parent' }]) {
    const current = state();
    action(current).contributions = [contribution(operation(), fields)];
    assert.equal(commentStateFor(current, context()).kind, 'unconfirmed');
    assert.equal(resetPostedComment(current, request()).result, 'unavailable');
  }
  const reply = operation({ parentId: 'parent-1' });
  const replyState = state({ receipts: [receipt(reply)], replyTargets: { discussion: 'parent-1' } });
  const parent = contribution(operation({ id: 'parent-1', memberId: 'noah', text: 'The original question' }));
  action(replyState).contributions = [parent, contribution(reply)];
  assert.equal(commentStateFor(replyState, context({ parentId: 'parent-1' })).kind, 'posted');
  action(replyState).contributions = [contribution(reply)];
  assert.equal(commentStateFor(replyState, context({ parentId: 'parent-1' })).kind, 'unconfirmed', 'a missing original parent is not silently converted into a root comment');
});

test('local receipt reconciliation ignores remote reset metadata and retains it only for an exact immutable replay', () => {
  const op = operation();
  const incoming = { ...receipt(op), composerReset: true, operation: operation({ memberId: 'forged-profile' }), remoteField: 'discard' };
  const clean = localReceiptFor([], incoming, op);
  assert.equal(Object.hasOwn(clean, 'composerReset'), false);
  assert.equal(Object.hasOwn(clean, 'remoteField'), false);
  assert.deepEqual(clean.operation, op);
  assert.notEqual(clean.operation, op, 'the original operation is copied, not borrowed from a mutable caller');
  const handled = { ...clean, composerReset: true };
  const reordered = Object.fromEntries(Object.entries(op).reverse());
  const replay = localReceiptFor([handled], receipt(op), reordered);
  assert.equal(replay.composerReset, true);
  assert.deepEqual(replay.operation, op);
  for (const fields of [{ id: 'other-id' }, { actionId: 'other-plan' }, { accepted: false }, { reason: 'Another receipt' }, { receivedAt: '2026-10-30T00:31:00.000Z' }, { type: 'minutes' }]) {
    assert.equal(Object.hasOwn(localReceiptFor([handled], { ...receipt(op), ...fields }, op), 'composerReset'), false);
  }
  for (const fields of [{ roomId: 'other-room' }, { memberId: 'noah' }, { actionId: 'other-plan' }, { parentId: 'parent-1' }, { text: 'Changed words' }, { proposalRevision: 2 }]) {
    assert.equal(Object.hasOwn(localReceiptFor([handled], receipt(op), { ...op, ...fields }), 'composerReset'), false);
  }
  assert.deepEqual(handled, { ...clean, composerReset: true }, 'reconciliation preserves the existing wrapper and server receipt fields');
});

test('deliberate reset atomically clears only the matching raw discussion and parent while marking handled receipt identities', () => {
  const reply = operation({ parentId: 'parent-1' });
  const oldReply = operation({ id: 'older-posted', parentId: 'parent-1' });
  const olderRejection = receipt(operation({ id: 'older-rejected', parentId: 'parent-1' }), false, { receivedAt: '2026-10-30T00:29:00.000Z' });
  const unrelated = receipt(operation({ id: 'other-context', actionId: 'other-plan' }));
  const malformed = receipt(reply, false, { id: 'mismatched-identity' });
  const current = state({ receipts: [receipt(oldReply, true, { receivedAt: '2026-10-30T00:28:00.000Z' }), olderRejection, unrelated, malformed, receipt(reply)],
    replyTargets: { discussion: 'parent-1', 'other-plan': 'keep-other-parent' }, pending: [operation({ actionId: 'other-plan' })] });
  action(current).contributions = [contribution(operation({ id: 'parent-1', memberId: 'noah' })), contribution(oldReply), contribution(reply)];
  const before = structuredClone(current);
  const result = resetPostedComment(current, request({ parentId: 'parent-1' }));
  assert.equal(result.result, 'cleared');
  assert.equal(result.state.drafts.discussion.discussion, '');
  assert.equal(result.state.drafts.discussion.minutes, before.drafts.discussion.minutes);
  assert.deepEqual(result.state.drafts['other-plan'], before.drafts['other-plan']);
  assert.deepEqual(result.state.replyTargets, { discussion: null, 'other-plan': 'keep-other-parent' });
  assert.deepEqual(result.state.receipts.filter(item => item.composerReset).map(item => item.id), ['older-posted', 'older-rejected', 'comment-1']);
  assert.deepEqual(result.state.receipts.map(({ composerReset, ...serverRecord }) => serverRecord), before.receipts);
  for (const key of Object.keys(before).filter(key => !['drafts', 'replyTargets', 'receipts'].includes(key))) assert.deepEqual(result.state[key], before[key], `${key} remains untouched`);
  assert.deepEqual(current, before, 'the compare-and-swap helper never mutates its input');
});

test('reset refuses newer raw work or changed context and an intentional identical comment stays new after reload and old replay', () => {
  const current = state();
  const pending = operation({ id: 'still-waiting' });
  const newer = receipt(operation({ id: 'newer-posted' }), true, { receivedAt: '2026-10-30T00:31:00.000Z' });
  const changed = [
    { ...current, memberId: 'noah' },
    { ...current, snapshot: { ...current.snapshot, roomId: 'other-room' } },
    { ...current, drafts: { ...current.drafts, discussion: { ...current.drafts.discussion, discussion: RAW + ' ' } } },
    { ...current, drafts: { ...current.drafts, discussion: { ...current.drafts.discussion, discussion: 'A newer unsent question' } } },
    { ...current, replyTargets: { discussion: 'a-new-parent' } },
    { ...current, pending: [pending] },
    { ...current, receipts: [...current.receipts, { ...newer, accepted: false }] },
  ];
  for (const newerState of changed) {
    const before = structuredClone(newerState);
    const result = resetPostedComment(newerState, request());
    assert.equal(result.result, 'changed');
    assert.equal(result.state, newerState);
    assert.deepEqual(newerState, before);
  }
  assert.equal(resetPostedComment(current, request({ operationId: 'different-posted-id' })).result, 'changed');
  assert.equal(resetPostedComment({ ...current, snapshot: null }, request()).result, 'unavailable');
  const missing = state(); action(missing).contributions = [];
  assert.equal(resetPostedComment(missing, request()).result, 'unavailable');
  const cleared = resetPostedComment(current, request());
  assert.equal(cleared.result, 'cleared');
  const reloaded = JSON.parse(JSON.stringify(cleared.state));
  reloaded.drafts.discussion.discussion = RAW;
  assert.equal(commentStateFor(reloaded, context()).kind, 'ready', 'the deliberate reset survives reload even when exactly the same words are typed');
  const replayed = localReceiptFor(reloaded.receipts, receipt(), operation());
  reloaded.receipts = [...reloaded.receipts.filter(item => item.id !== replayed.id), replayed];
  assert.equal(commentStateFor(reloaded, context()).kind, 'ready', 'late old acceptance cannot acknowledge a new same-text intention');
  const second = operation({ id: 'intentional-second-comment' });
  assert.equal(commentStateFor({ ...reloaded, pending: [second] }, context()).kind, 'pending');
  reloaded.receipts.push(localReceiptFor(reloaded.receipts, receipt(second, true, { receivedAt: '2026-10-30T00:32:00.000Z' }), second));
  action(reloaded).contributions.push(contribution(second));
  assert.equal(commentStateFor(reloaded, context()).kind, 'posted');
  assert.equal(commentStateFor(reloaded, context()).operation.id, second.id);
  assert.equal(resetPostedComment(reloaded, request()).result, 'changed', 'a stale reset cannot clear the new operation’s composer');
  assert.equal(resetPostedComment(reloaded, request({ operationId: second.id })).result, 'cleared');
});
