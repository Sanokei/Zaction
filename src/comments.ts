import type { CivicAction, LocalReceipt, LocalState, Operation, Receipt } from './model';

export interface CommentContext {
  roomId: string;
  memberId: string;
  actionId: string;
  parentId: string | null;
  /** The editor's exact value; only the submitted operation is trimmed. */
  text: string;
}

export interface ResetCommentRequest extends CommentContext { operationId: string }

export type CommentState =
  | { kind: 'ready' }
  | { kind: 'pending'; operation: Operation }
  | { kind: 'posted' | 'rejected' | 'unconfirmed'; operation: Operation; receipt: LocalReceipt };

type CommentRecords = Pick<LocalState, 'snapshot' | 'memberId' | 'pending' | 'receipts'>;
type CommentReceipt = LocalReceipt & { operation: Operation };
const parentFor = (value: unknown): string | null | undefined => value === undefined || value === null ? null : typeof value === 'string' && value.length > 0 ? value : undefined;

function currentAction(state: CommentRecords, context: CommentContext): CivicAction | undefined {
  if (!state.snapshot || !state.memberId || state.snapshot.roomId !== context.roomId || state.memberId !== context.memberId ||
      typeof context.text !== 'string' || !context.text.trim() || parentFor(context.parentId) === undefined) return undefined;
  return state.snapshot.actions.find(action => action.id === context.actionId);
}

function matchesOperation(operation: Operation | undefined, context: CommentContext): operation is Operation {
  return Boolean(operation && operation.type === 'contribute' && typeof operation.id === 'string' && operation.id &&
    operation.roomId === context.roomId && operation.memberId === context.memberId && operation.actionId === context.actionId &&
    parentFor(operation.parentId) === context.parentId && typeof operation.text === 'string' && operation.text.trim() === context.text.trim());
}

function matchesReceipt(receipt: LocalReceipt, context: CommentContext): receipt is CommentReceipt {
  return matchesOperation(receipt.operation, context) && receipt.type === 'contribute' && receipt.id === receipt.operation.id &&
    receipt.actionId === context.actionId && typeof receipt.accepted === 'boolean' && typeof receipt.reason === 'string' &&
    typeof receipt.receivedAt === 'string' && Number.isFinite(Date.parse(receipt.receivedAt));
}

function acceptedCommentExists(action: CivicAction, operation: Operation, context: CommentContext): boolean {
  if (context.parentId !== null && !action.contributions.some(comment => comment.id === context.parentId)) return false;
  return action.contributions.some(comment => comment.id === operation.id && comment.memberId === context.memberId &&
    parentFor(comment.parentId) === context.parentId && typeof comment.text === 'string' && comment.text === operation.text?.trim());
}

/** Existing operation/receipt identities acknowledge one composer, never text elsewhere in a thread. */
export function commentStateFor(state: CommentRecords, context: CommentContext): CommentState {
  const action = currentAction(state, context);
  if (!action) return { kind: 'ready' };
  const pending = state.pending.find(operation => matchesOperation(operation, context));
  if (pending) return { kind: 'pending', operation: pending };
  let latest: CommentReceipt | undefined;
  for (const receipt of state.receipts) {
    if (receipt.composerReset === true || !matchesReceipt(receipt, context)) continue;
    if (!latest || Date.parse(receipt.receivedAt) >= Date.parse(latest.receivedAt)) latest = receipt;
  }
  if (!latest) return { kind: 'ready' };
  if (!latest.accepted) return { kind: 'rejected', operation: latest.operation, receipt: latest };
  return { kind: acceptedCommentExists(action, latest.operation, context) ? 'posted' : 'unconfirmed', operation: latest.operation, receipt: latest };
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return keys.length === Object.keys(rightRecord).length && keys.every(key => Object.hasOwn(rightRecord, key) && sameValue(leftRecord[key], rightRecord[key]));
}

/** Only this private wrapper can retain a deliberate reset; remote metadata is discarded. */
export function localReceiptFor(existing: LocalReceipt[], incoming: Receipt, operation: Operation): LocalReceipt {
  const result: LocalReceipt = {
    id: incoming.id, actionId: incoming.actionId, accepted: incoming.accepted,
    reason: incoming.reason, receivedAt: incoming.receivedAt, type: incoming.type,
    operation: structuredClone(operation),
  };
  const receiptKeys = ['id', 'actionId', 'accepted', 'reason', 'receivedAt', 'type'] as const;
  if (existing.some(receipt => receipt.composerReset === true && receiptKeys.every(key => receipt[key] === result[key]) && sameValue(receipt.operation, operation))) result.composerReset = true;
  return result;
}

/** Compare and clear inside updateLocal's transaction; receipt arrival never invokes this reset. */
export function resetPostedComment(state: LocalState, request: ResetCommentRequest): { state: LocalState; result: 'cleared' | 'changed' | 'unavailable' } {
  if (!state.snapshot || !state.memberId) return { state, result: 'unavailable' };
  if (state.snapshot.roomId !== request.roomId || state.memberId !== request.memberId) return { state, result: 'changed' };
  const action = state.snapshot.actions.find(item => item.id === request.actionId);
  if (!action) return { state, result: 'unavailable' };
  const draft = Object.hasOwn(state.drafts, request.actionId) ? state.drafts[request.actionId] : undefined;
  const parentId = state.replyTargets && Object.hasOwn(state.replyTargets, request.actionId) ? state.replyTargets[request.actionId] : null;
  if (!draft || draft.discussion !== request.text || parentId !== request.parentId) return { state, result: 'changed' };
  const current = commentStateFor(state, request);
  if (current.kind === 'ready' || current.kind === 'unconfirmed') return { state, result: 'unavailable' };
  if (current.kind !== 'posted' || current.operation.id !== request.operationId) return { state, result: 'changed' };
  const receivedAt = Date.parse(current.receipt.receivedAt);
  const receipts = state.receipts.map(receipt => matchesReceipt(receipt, request) && Date.parse(receipt.receivedAt) <= receivedAt ? { ...receipt, composerReset: true as const } : receipt);
  return {
    result: 'cleared',
    state: {
      ...state,
      drafts: { ...state.drafts, [request.actionId]: { ...draft, discussion: '' } },
      ...(state.replyTargets && Object.hasOwn(state.replyTargets, request.actionId) ? { replyTargets: { ...state.replyTargets, [request.actionId]: null } } : {}),
      receipts,
    },
  };
}
