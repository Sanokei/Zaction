import { DEFAULT_ACTION_ID, ACTION_LIMITS, CITY_OPTIONS, KIND_OPTIONS, MEMBERS, emptyActionInput, type CivicAction, type LocalState, type DemoSnapshot, type Operation, type Receipt } from './model';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const reservedActionIds = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
export const validActionId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) && !reservedActionIds.has(value);
const progressValid = (value: unknown) => record(value) && typeof value.read === 'boolean' && typeof value.reviewed === 'boolean';
const textDraftValid = (value: unknown) => record(value) && typeof value.discussion === 'string' && typeof value.minutes === 'string';
const actionStateValid = (value: unknown) => record(value) && value.proposalRevision === 1 && value.rulesVersion === 'DEMO-RULES-v1' && ['DEMO-MEMBERS-v1', 'COMMUNITY-PREVIEW-v1'].includes(String(value.membershipVersion)) && typeof value.closesAt === 'string' && Number.isFinite(Date.parse(value.closesAt)) && ['open', 'adopted', 'not-adopted', 'no-quorum'].includes(String(value.outcome)) && ['contributions', 'ballots', 'minutes', 'completedTasks'].every(key => Array.isArray(value[key]));

export function parseSnapshot(value: unknown): DemoSnapshot {
  if (!record(value) || value.schemaVersion !== 2 || typeof value.roomId !== 'string' || !value.roomId || !Number.isSafeInteger(value.sequence) || Number(value.sequence) < 0 || !Array.isArray(value.actions)) throw new Error('The demo room returned an unsupported record. Local work is preserved.');
  const ids = new Set<string>();
  const memberIds = new Set(Array.isArray(value.profiles) ? value.profiles.filter(record).map(profile => profile.id) : MEMBERS.map(profile => profile.id));
  for (const item of value.actions) {
    if (!record(item) || !validActionId(item.id) || ids.has(item.id) || !actionStateValid(item) || !Object.keys(ACTION_LIMITS).every(key => typeof item[key] === 'string')) throw new Error('The demo room returned an invalid action. Local work is preserved.');
    ids.add(item.id);
    if (Object.hasOwn(item, 'bringClaims')) {
      if (!Array.isArray(item.bringClaims)) throw new Error('The plan returned unsupported bring-item choices. Local work is preserved.');
      const slots = new Set<number>();
      const claims = new Set<string>();
      for (const claim of item.bringClaims) {
        const list = record(item.planning) && Array.isArray(item.planning.bring) ? item.planning.bring : [];
        if (!record(claim) || typeof claim.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(claim.id) || ['__proto__', 'constructor', 'prototype'].includes(claim.id) || claims.has(claim.id) || !memberIds.has(claim.memberId) || typeof claim.createdAt !== 'string' || !Number.isFinite(Date.parse(claim.createdAt)) || typeof claim.itemIndex !== 'number' || !Number.isSafeInteger(claim.itemIndex) || claim.itemIndex < 0 || claim.itemIndex >= list.length || typeof list[claim.itemIndex] !== 'string' || !list[claim.itemIndex].trim() || slots.has(claim.itemIndex)) throw new Error('The plan returned invalid bring-item choices. Local work is preserved.');
        slots.add(claim.itemIndex);
        claims.add(claim.id);
      }
    }
  }
  if (value.profiles !== undefined && (!Array.isArray(value.profiles) || !value.profiles.every(profile => record(profile) && typeof profile.id === 'string' && typeof profile.name === 'string' && /^#[a-fA-F0-9]{6}$/.test(String(profile.color)) && typeof profile.synthetic === 'boolean'))) throw new Error('The community returned unsupported profiles. Local work is preserved.');
  return value as unknown as DemoSnapshot;
}

export function emptyLocalState(): LocalState {
  return { schemaVersion: 2, memberId: null, selectedActionId: DEFAULT_ACTION_ID, snapshot: null, drafts: {}, progress: {}, creationDraft: { id: crypto.randomUUID(), ...emptyActionInput() }, pending: [], receipts: [], lastSync: null, identityFingerprint: '' };
}

function legacySnapshot(value: unknown): DemoSnapshot | null {
  if (value === null) return null;
  if (!record(value) || value.schemaVersion !== 1 || typeof value.roomId !== 'string' || !actionStateValid(value)) throw new Error('The previous demo snapshot needs review. Your browser data has been preserved.');
  const action: CivicAction = {
    id: DEFAULT_ACTION_ID, title: 'Better questions. Better local decisions.',
    description: 'Read a demonstration school-budget agenda and add a question that could help everyone understand it.',
    proposalTitle: 'Let’s host a free school-budget reading circle.', beneficiaries: 'Anyone who wants to understand',
    whenWhere: 'To be agreed · Venue unconfirmed', sourceLabel: 'Demonstration agenda', sourceUrl: '', sourceKind: 'synthetic', createdBy: null,
    createdAt: new Date(Date.parse(String(value.closesAt)) - 7 * 86400000).toISOString(),
    proposalRevision: 1, rulesVersion: 'DEMO-RULES-v1', membershipVersion: 'DEMO-MEMBERS-v1',
    closesAt: value.closesAt as string, contributions: value.contributions as CivicAction['contributions'], ballots: value.ballots as CivicAction['ballots'],
    outcome: value.outcome as CivicAction['outcome'], closedAt: value.closedAt as string | null,
    minutes: value.minutes as CivicAction['minutes'], completedTasks: value.completedTasks as CivicAction['completedTasks'],
  };
  return { schemaVersion: 2, roomId: value.roomId, sequence: 0, actions: [action] };
}

function legacyOperation(value: unknown): Operation {
  if (!record(value) || typeof value.id !== 'string' || !['contribute', 'vote', 'close', 'minutes', 'complete-task'].includes(String(value.type))) throw new Error('A saved submission needs review. Your original data is preserved.');
  return { ...value, actionId: DEFAULT_ACTION_ID } as unknown as Operation;
}

export function normalizeLocal(value: unknown): LocalState {
  if (value === undefined) return emptyLocalState();
  const fail = () => { throw new Error('Saved data needs review. Your browser data has been preserved.'); };
  if (!record(value) || !Array.isArray(value.pending) || !Array.isArray(value.receipts) || (value.memberId !== null && !validActionId(value.memberId))) return fail();
  if (value.schemaVersion === 2) {
    if (!validActionId(value.selectedActionId) || !record(value.drafts) || !record(value.progress) || !record(value.creationDraft) || !validActionId(value.creationDraft.id) || !Object.keys(ACTION_LIMITS).every(key => typeof (value.creationDraft as RecordValue)[key] === 'string')) return fail();
    if (!Object.entries(value.drafts).every(([id, draft]) => validActionId(id) && textDraftValid(draft)) || !Object.entries(value.progress).every(([id, progress]) => validActionId(id) && progressValid(progress))) return fail();
    if (!value.pending.every(op => record(op) && validActionId(op.actionId)) || !value.receipts.every(receipt => record(receipt) && validActionId(receipt.actionId))) return fail();
    if (value.community !== undefined && (!record(value.community) || typeof value.community.name !== 'string' || !CITY_OPTIONS.some(city => city.id === (value.community as RecordValue).cityId) || !Array.isArray(value.community.interests) || !value.community.interests.every(interest => KIND_OPTIONS.some(kind => kind.id === interest)) || typeof value.community.onboarded !== 'boolean' || typeof value.community.browsing !== 'boolean')) return fail();
    if (value.savedActionIds !== undefined && (!Array.isArray(value.savedActionIds) || !value.savedActionIds.every(validActionId))) return fail();
    if (value.replyTargets !== undefined && (!record(value.replyTargets) || !Object.entries(value.replyTargets).every(([id, parent]) => validActionId(id) && (parent === null || typeof parent === 'string')))) return fail();
    if (value.snapshot !== null) parseSnapshot(value.snapshot);
    return value as unknown as LocalState;
  }
  // Only the known preview.1 shape is translated. Unknown records stay untouched.
  if (value.schemaVersion !== undefined || typeof value.draft !== 'string' || !progressValid(value.progress)) return fail();
  const next = emptyLocalState();
  next.memberId = value.memberId as LocalState['memberId'];
  next.snapshot = legacySnapshot(value.snapshot);
  next.drafts = { [DEFAULT_ACTION_ID]: { discussion: value.draft, minutes: '' } };
  next.progress = { [DEFAULT_ACTION_ID]: value.progress as unknown as LocalState['progress'][string] };
  next.pending = value.pending.map(legacyOperation);
  next.receipts = value.receipts.map(item => {
    if (!record(item) || typeof item.id !== 'string' || typeof item.accepted !== 'boolean') return fail();
    return { ...item, actionId: DEFAULT_ACTION_ID, ...(item.operation ? { operation: legacyOperation(item.operation) } : {}) } as unknown as Receipt;
  });
  next.lastSync = typeof value.lastSync === 'string' ? value.lastSync : null;
  next.identityFingerprint = typeof value.identityFingerprint === 'string' ? value.identityFingerprint : '';
  return next;
}
