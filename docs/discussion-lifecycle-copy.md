# Discussion lifecycle wording follows the authored type

Bounded P2 checkpoint, October 29, 2026 (America/New_York), before edits. Accepted source: `af19b9102d32a14b5c73933672baafefe056270a`, public preview.9. Actual [Spec.pdf](https://github.com/Sanokei/Zaction/blob/262a06b2e67ca676d30c8f11d92d6fb4a902ac88/Spec.pdf) remains SHA-256 `243bb265e8a5aa80621070a73f858b375149cebdbcbeccf3500a4d12576baa3f`. No applicable AGENTS.md was found.

## Boundary researched and problem

Spec §3.3 distinguishes events from deliberation spaces. §3.4 (printed pp.8–9) includes open discussion, questions and proposals-in-progress, and states that a debate and vote are different. An author withdrawing a Zaction discussion cannot cancel an external organization's event. Listing status remains separate from its recorded group decision and history (§§3.5–3.6).

The reviewed preview.9 screenshot shows an intentionally authored community question followed by “Your plan,” “Cancel gathering” and “withdraw this gathering.” The mismatch extends to confirmation, pending state, accepted notice, historical banners, restart/update copy and receipt titles. Source reference is citation metadata, not an authored object type.

Existing persisted `planning.kind: 'idea'` is presented as **Good conversations**; the server already excludes that kind from gathering RSVPs. Learn's question handoff explicitly stores it, queues preserve it, and reviewed changes copy it into a separate immutable successor. Other known kinds represent gatherings. Legacy records without planning have no durable type and need neutral wording. A successor may explicitly select a different kind; its own type cannot relabel the original.

The current schema does not distinguish a literal question from other conversation/idea posts. Use **discussion** for that existing category, including the authored question, rather than infer a narrower type from a source link, title punctuation, civic subject or renderer route. This satisfies the question/update/withdraw intent without adding a question enum, ledger, schema, migration or authority. Removing a citation leaves the discussion type unchanged. An idea may legitimately have planning fields or bring offers; changing its wording must not hide or discard those records.

## Small correction

1. Share one presentation classifier based on the explicit recorded kind: idea → discussion; known other kinds → gathering; absent/unknown → neutral plan/listing. Do not classify persisted history using the form's `emptyPlanning` fallback.
2. Use discussion/update/withdraw/restart wording consistently in management, confirmation, pending/rejected/accepted states, update editor, original/replacement banners and submission history. Keep actual gathering copy. Pending create/change history uses its exact operation payload; withdrawal uses its original immutable target, never a linked successor or currently selected form.
3. A discussion withdrawal explicitly affects only this Zaction discussion. It does not cancel an organization event, reverse a group result or notify anyone. Keep operation types, lifecycle tokens, IDs, membership/session checks, receipts, focus ownership, ballot terms, claims, RSVPs and all stored text/data unchanged.
4. Keep source context visibly separate from unverified member content; source-linked gatherings remain gatherings, source-free discussions remain discussions. No automatic source reclassification or new reference lookup.

## Focused verification and artifact

Extend the existing Learn/Serve journey rather than add a broad suite: revise a real authored question, withdraw it offline with reload/retry and original receipts/history, and inspect desktop/390px labels. Exercise a source-linked actual BBQ control to disprove citation-based inference; keep existing gathering confirmation/focus behavior. Preserve meaningful existing exact-token and history assertions. Use normal required Node/build/CI/release gates; no extra repeated baseline browser suite merely for counts. Refresh the user-facing gallery and publish a new immutable download after actual checks.

After the correction is visible in the actual flow, record the next observed Spec-aligned usability gap and its bounded plan before further code. Do not expand this P2 into new sources, type migrations or participation features.

## Next observed gap: a posted comment still looks ready to post

The affected journey again shows Bo's accepted correction in the conversation while the identical text remains in the private composer with **Post comment** enabled. This is visible in the original member-correction viewport and confirmed by `publishContribution`/accepted-receipt handling: posting enqueues the text, and acceptance records a receipt but does not acknowledge the matching composer draft. This is existing behavior, not a failed comment or a new lifecycle regression. It makes successful participation ambiguous and invites an accidental second post with a new operation ID.

Next bounded goal, derived from Spec §3.4's usable open discussion: a member can tell that their particular comment was saved, pending or posted, then deliberately begin another comment without losing text typed while the first submission was in flight.

Plan before code:

1. Derive composer acknowledgement from the existing exact room/profile/action/reply target and original operation/receipt; do not add another ledger or infer completion from button clicks or matching text elsewhere in the thread.
2. When the current composer still corresponds to that pending/accepted submission, show a clear waiting/posted acknowledgement and prevent accidental duplicate submission. Offer an explicit **Start another comment** action after acceptance. Keep the posted comment and original receipt available.
3. Preserve newer or different unsent text, a changed reply target, rejected work, offline reload/retry and another plan's drafts. Do not automatically clear a newer draft when a delayed response or older replay arrives. A storage failure must retain the text and not claim a successful reset.
4. Exercise one actual two-profile comment/reply journey with pending, acceptance, newer typing, deliberate next comment and rejected/reload recovery. Reuse the existing discussion, durability and idempotence checks. Keep source facts, equal ballots, private progress and external contacts untouched.

This follow-on is planned separately; this P2 artifact changes lifecycle presentation only. No acknowledgement/reset behavior is implemented here.

## Implemented and locally verified

`contentKindFor` shares the explicit recorded-kind boundary across the renderer and accepted-submission notices. Discussion labels now persist through editing, revision, withdrawal, offline pending state, accepted history and a separate restart. Original withdrawal history resolves the original target only in its matching room, with neutral wording when that context is unavailable. Create/change history reads the original operation payload. Replacement links resolve the replacement's own kind. Mixed-kind reason copy is neutral about both records, rather than assigning the successor's noun to the original.

No persisted field, schema, server operation, lifecycle token, source snapshot, proposal text, ballot term, RSVP, claim, outcome, focus mechanism or queued payload was changed. The existing source-question layout remains scoped as before; visible lifecycle/editor nouns no longer depend on a citation or edit route. Actual gathering labels remain unchanged. Source facts and unverified member content remain separate.

Executed checks: frozen `npm ci --no-audit --no-fund`; existing **167 Node tests**; production TypeScript/Vite/service-worker build; **four existing focused Learn/Serve browser flows**, extended with affected discussion and actual gathering assertions without adding a new suite or count. A direct boundary check also covered source-free ideas, source-linked BBQ/help, removed citations, untyped/unknown legacy records and independent original/successor kinds. The final focused run includes the last mixed-kind copy fix and refreshed desktop source context. Full baseline browser replay locally was not used to inflate counts; required main/tag CI still runs the normal 39 checks.

The actual question was revised, withdrawn offline, reopened through the real production service worker and retried under the same operation ID; its original source, reason, receipts and history remained intact. A separate restart retained the original withdrawn ID. A source-linked BBQ kept gathering controls/confirmation and remained active after Keep. The later source-free idea recovered with discussion labels. Root reviewed the [14 original narrow/desktop captures](screenshots/preview10/README.md); no material overflow or lifecycle wording blocker remained. The next comment-composer acknowledgement gap above was re-observed in that same actual flow and planned before any follow-on code.

Packaging, public-download verification and required main/release CI remain separate gates after this source checkpoint. Existing room and backup preservation are checked before recommending the new download; previous release evidence is retained at its own immutable source.
