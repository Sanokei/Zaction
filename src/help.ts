import type { BringClaim, CivicAction, LocalState, Operation, Receipt } from './model';

export interface HelpEntry {
  action: CivicAction;
  itemIndex: number;
  /** Current shared owner, including someone else after an offer conflict. */
  claim?: BringClaim;
  pending?: Operation;
  rejected?: Receipt;
}

type HelpState = Pick<LocalState, 'snapshot' | 'memberId' | 'pending' | 'receipts'>;

/** Stable replay can arrive later while retaining an older server receipt time. */
export function helpReceiptFor(state: HelpState, actionId: string, itemIndex: number): Receipt | undefined {
  if (!state.snapshot || !state.memberId) return undefined;
  let latest: Receipt | undefined;
  for (const receipt of state.receipts) {
    const operation = receipt.operation;
    if (receipt.type !== 'bring-item' || operation?.type !== 'bring-item' || receipt.actionId !== actionId || operation.actionId !== actionId || operation.itemIndex !== itemIndex || operation.memberId !== state.memberId || operation.roomId !== state.snapshot.roomId || !Number.isFinite(Date.parse(receipt.receivedAt))) continue;
    if (!latest || Date.parse(receipt.receivedAt) >= Date.parse(latest.receivedAt)) latest = receipt;
  }
  return latest;
}

/** A view of existing records, never a second participation ledger. */
export function helpEntriesFor(state: HelpState): HelpEntry[] {
  if (!state.snapshot || !state.memberId) return [];
  const { snapshot, memberId } = state;
  const sameMemberAndRoom = (operation: Operation) => operation.type === 'bring-item' && operation.memberId === memberId && operation.roomId === snapshot.roomId;
  const pending = state.pending.filter(sameMemberAndRoom);
  const entries: HelpEntry[] = [];
  for (const action of snapshot.actions) {
    for (let itemIndex = 0; itemIndex < (action.planning?.bring.length ?? 0); itemIndex++) {
      const claim = action.bringClaims?.find(item => item.itemIndex === itemIndex);
      const waiting = pending.findLast(operation => operation.actionId === action.id && operation.itemIndex === itemIndex);
      const receipt = helpReceiptFor(state, action.id, itemIndex);
      const rejected = receipt && !receipt.accepted ? receipt : undefined;
      if (claim?.memberId === memberId || waiting || rejected) entries.push({ action, itemIndex, claim, pending: waiting, rejected });
    }
  }
  return entries;
}
