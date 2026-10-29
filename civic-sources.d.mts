export interface SourceRef { opportunityId: string; snapshotId: string }
export interface CivicSourceSnapshot {
  readonly ref: SourceRef;
  readonly title: string;
  readonly publisher: string;
  readonly publisherKind: 'community-organization';
  readonly jurisdiction: string;
  readonly cityId: 'new-york';
  readonly timezone: string;
  readonly summary: string;
  readonly facts: readonly string[];
  readonly sourceTitle: string;
  readonly sourceUrl: string;
  readonly sourceCommit: string;
  readonly sourceBodySha256: string;
  readonly sourceReviewedAt: string;
  readonly officialUrl: string;
  readonly livePageCheck: { readonly attemptedAt: string; readonly status: 'unavailable'; readonly reason: string };
  readonly nextSteps: readonly string[];
}
export const CIVIC_SOURCES: readonly CivicSourceSnapshot[];
export const CURRENT_SOURCE_REFS: readonly SourceRef[];
export function validSourceRefShape(value: unknown): value is SourceRef;
export function sourceFor(value: unknown): CivicSourceSnapshot | undefined;
export function validKnownSourceRef(value: unknown): value is SourceRef;
export function sourceNoteState(value: unknown, now?: Date, online?: boolean): { kind: 'dated' | 'older' | 'offline' | 'unavailable'; label: string; detail: string; older: boolean };
