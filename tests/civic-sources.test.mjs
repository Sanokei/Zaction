import test from 'node:test';
import assert from 'node:assert/strict';
import { CIVIC_SOURCES, CURRENT_SOURCE_REFS, sourceFor, sourceNoteState, validKnownSourceRef, validSourceRefShape } from '../civic-sources.mjs';
import { emptyLocalState, normalizeLocal, parseSnapshot } from '../src/migrations.ts';
import { createDemoState } from '../server.mjs';

const ref = CURRENT_SOURCE_REFS[0];
const unknown = { opportunityId: ref.opportunityId, snapshotId: 'older-unavailable-snapshot' };

test('source lookup preserves exact immutable snapshot identity instead of falling back to a current opportunity', () => {
  const source = sourceFor({ snapshotId: ref.snapshotId, opportunityId: ref.opportunityId });
  assert.equal(source, CIVIC_SOURCES[0]);
  assert.ok(Object.isFrozen(source) && Object.isFrozen(source.ref) && Object.isFrozen(source.facts));
  assert.equal(validSourceRefShape(unknown), true);
  assert.equal(validKnownSourceRef(unknown), false);
  assert.equal(sourceFor(unknown), undefined);
  assert.equal(sourceNoteState(unknown).kind, 'unavailable');
  for (const bad of [null, undefined, [], { ...ref, checkedAt: 'today' }, { opportunityId: ref.opportunityId }, { ...ref, snapshotId: '__proto__' }]) assert.equal(validSourceRefShape(bad), false);
});

test('source age follows the publisher calendar day and offline/retry cannot advance the successful review', () => {
  const source = sourceFor(ref);
  const before = structuredClone(source);
  assert.equal(sourceNoteState(ref, new Date('2026-10-30T03:59:59Z')).kind, 'dated', 'still October 29 in New York');
  assert.equal(sourceNoteState(ref, new Date('2026-10-30T04:00:00Z')).kind, 'older', 'October 30 in New York');
  assert.deepEqual(sourceNoteState(ref, new Date('2026-10-30T04:00:00Z'), false), {
    kind: 'offline', label: 'Offline · older source note', detail: 'Saved summary only. The live page needs a connection; current needs and arrangements have not been verified.', older: true,
  });
  assert.equal(sourceNoteState(ref, new Date('invalid')).kind, 'unavailable');
  assert.equal(source.livePageCheck.status, 'unavailable', 'a successful source-repository read is not a successful live-page check');
  assert.deepEqual(source, before);
});

test('client snapshots keep known and unavailable references while malformed provenance preserves the original record', () => {
  const snapshot = createDemoState(Date.parse('2026-10-29T23:00:00Z'));
  assert.equal(Object.hasOwn(parseSnapshot(snapshot).actions[0], 'sourceRef'), false, 'legacy source absence is not backfilled');
  for (const sourceRef of [ref, unknown]) {
    snapshot.actions[0].sourceRef = { ...sourceRef };
    const before = structuredClone(snapshot);
    assert.deepEqual(parseSnapshot(snapshot).actions[0].sourceRef, sourceRef);
    assert.deepEqual(snapshot, before);
  }
  snapshot.actions[0].sourceRef = { ...ref, snapshotId: 'bad reference with spaces' };
  const malformed = structuredClone(snapshot);
  assert.throws(() => parseSnapshot(snapshot), /invalid source reference/);
  assert.deepEqual(snapshot, malformed);
});

test('private drafts retain unavailable source identities and text; rejected raw source payloads remain replayable history', () => {
  const local = emptyLocalState();
  local.creationDraft.description = 'Keep this exact question, even when a source cannot be resolved.';
  local.creationDraft.sourceRef = { ...unknown };
  const sourceId = 'original-plan';
  local.planChangeDrafts = { [sourceId]: { ...local.creationDraft, id: 'replacement-plan', change: { actionId: sourceId, expectedChangeId: null, reason: 'Keep the checked original reference.' } } };
  local.pending = [{ id: 'old-client-request', actionId: sourceId, type: 'create-action', action: { sourceRef: null } }];
  local.receipts = [{ id: 'rejected-source', actionId: sourceId, accepted: false, operation: { actionId: sourceId, type: 'create-action', action: { sourceRef: null } } }];
  const before = structuredClone(local);
  assert.deepEqual(normalizeLocal(local), before);
  local.creationDraft.sourceRef = null;
  const malformed = structuredClone(local);
  assert.throws(() => normalizeLocal(local), /Saved data needs review/);
  assert.deepEqual(local, malformed, 'validation never rewrites entered work');
});
