// Append-only reviewed snapshots. Never rewrite a published snapshot or resolve
// an older reference through the current-source pointer.
const ref = Object.freeze({ opportunityId: 'nyc-mesh-outreach', snapshotId: '2026-10-29-6760307447a4' });
const source = Object.freeze({
  ref,
  title: 'Explore outreach/design with NYC Mesh',
  publisher: 'NYC Mesh',
  publisherKind: 'community-organization',
  jurisdiction: 'New York City, New York',
  cityId: 'new-york',
  timezone: 'America/New_York',
  summary: 'A community network’s own guide to helping with outreach and design.',
  facts: Object.freeze([
    'The guide lists outreach, design, event coordination and community organizing as ways to help.',
    'Its FAQ says technical experience is not required for these kinds of contribution.',
    'Design and outreach materials are among its remote-friendly tasks. This does not establish your eligibility or an available role.',
  ]),
  sourceTitle: 'Volunteer',
  sourceUrl: 'https://github.com/nycmeshnet/nycmesh.net/blob/d53de89ba20682d348cc0d4271e64e9875985dcf/content/volunteer/index.md',
  sourceCommit: 'd53de89ba20682d348cc0d4271e64e9875985dcf',
  sourceBodySha256: '6760307447a464cf5e6aa4f9b0d9ae82fdf72c5fd99bed2733fa83e8cea10403',
  sourceReviewedAt: '2026-10-29T23:12:57.514461Z',
  officialUrl: 'https://www.nycmesh.net/volunteer/',
  livePageCheck: Object.freeze({
    attemptedAt: '2026-10-29T23:13:25.939411Z',
    status: 'unavailable',
    reason: 'The live website was unavailable during review. The dated publisher-maintained source was read separately.',
  }),
  nextSteps: Object.freeze([
    'Read the organization’s current volunteer guide when reachable.',
    'Confirm age and role requirements, current needs and arrangements with the organization before committing. This guide does not establish your eligibility or placement.',
    'Bring a question or possible correction back to a community discussion. Share only what you are comfortable making public.',
  ]),
});

export const CIVIC_SOURCES = Object.freeze([source]);
export const CURRENT_SOURCE_REFS = Object.freeze([ref]);
const safeId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
export function validSourceRefShape(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === 2 && Object.hasOwn(value, 'opportunityId') && Object.hasOwn(value, 'snapshotId') &&
    safeId(value.opportunityId) && safeId(value.snapshotId);
}
export function sourceFor(value) {
  if (!validSourceRefShape(value)) return undefined;
  return CIVIC_SOURCES.find(item => item.ref.opportunityId === value.opportunityId && item.ref.snapshotId === value.snapshotId);
}
export function validKnownSourceRef(value) { return Boolean(sourceFor(value)); }

function localDay(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
}

export function sourceNoteState(value, now = new Date(), online = true) {
  const known = sourceFor(value);
  if (!known) return { kind: 'unavailable', label: 'Source reference unavailable', detail: 'This app version cannot resolve this exact source snapshot. The original reference is kept; no newer source has been substituted.', older: false };
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return { kind: 'unavailable', label: 'Check the recorded review date', detail: 'The device date is unavailable. This remains a dated source note, not a live verification.', older: false };
  const older = localDay(now, known.timezone) > localDay(new Date(known.sourceReviewedAt), known.timezone);
  if (!online) return { kind: 'offline', label: older ? 'Offline · older source note' : 'Offline source note', detail: 'Saved summary only. The live page needs a connection; current needs and arrangements have not been verified.', older };
  if (older) return { kind: 'older', label: 'Older source note', detail: 'Reviewed on an earlier New York date. Guidance may have changed; check the organization’s current instructions before acting.', older };
  return { kind: 'dated', label: 'Dated source note', detail: 'This is a saved summary, not a live check. Confirm current needs and requirements with the organization before acting.', older };
}
