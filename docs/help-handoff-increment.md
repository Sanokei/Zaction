# Finding a useful way to help, and finding it again

Problem/source/plan checkpoint, October 29, 2026 (America/New_York), before implementation. Baseline: `0985f6ae2a705ee3c18991ea3e988464112a0c94`, public preview.7. The unchanged [Spec.pdf](https://github.com/Sanokei/Zaction/blob/262a06b2e67ca676d30c8f11d92d6fb4a902ac88/Spec.pdf) has SHA-256 `243bb265e8a5aa80621070a73f858b375149cebdbcbeccf3500a4d12576baa3f`. No applicable AGENTS.md was found at the filesystem/workspace/repository roots or within the repository.

## Audit and bounded choice

The actual PDF §3.7 (printed pp.10–11) requires visible volunteer roles, signups and unfilled work. §6 (p.16) distinguishes signing up, confirming, and unfilled work; humans decide. Phase 1, §9 (pp.22–23), includes labor organizing. Equal voice (§3.8) does not depend on practical contributions.

Bring & Share already provides a deliberate offer, one current owner per immutable indexed slot, exact-owner/exact-claim withdrawal, durable offline requests, conflicts, replay-safe receipts, and historical original-plan handling after change/cancellation. A string can already describe a small task as well as something to bring. Replacing this with another role-claim system would duplicate working behavior.

The real missing handoff is **discovery and return**. Feed cards do not show unfilled help, and members have no cross-plan way back to their current offers or queued/rejected attempts. The language also calls every practical task an item. API acceptance is sometimes described as a “confirmed offer,” which can imply more than recorded intent.

An extra confirmation against identical immutable terms would duplicate the original explicit offer: there is no defined reconfirmation request or timepoint. This increment therefore adds no confirmation state, organizer approval, assignment power, or readiness threshold. “Offer shared,” “proposal adopted,” and “real-world arrangements confirmed” remain different facts. The complete shift/skill/hour tracking and confirmation-chasing track remains unfinished; no notification delivery is added.

Primary sources checked October 29, 2026:

- [CiviCRM official event guide, exact source](https://github.com/civicrm/civicrm-user-guide/blob/0fe6ae2fc75accde0e5d27061967cd47d3fc96e3/docs/events/online-event-registration.md#L83-L88): self-service cancellation. [Lines 222–226](https://github.com/civicrm/civicrm-user-guide/blob/0fe6ae2fc75accde0e5d27061967cd47d3fc96e3/docs/events/online-event-registration.md#L222-L226) connect cancellations and available capacity; [lines 249–280](https://github.com/civicrm/civicrm-user-guide/blob/0fe6ae2fc75accde0e5d27061967cd47d3fc96e3/docs/events/online-event-registration.md#L249-L280) describe approval as a separate optional workflow. These are interaction analogies, not Zaction policy or evidence of volunteer verification.
- [W3C Button Pattern, exact source](https://github.com/w3c/aria-practices/blob/0f765e4dc33e966026114ac12a8380db1de3b787/content/patterns/button/button-pattern.html): native keyboard activation and logical focus after navigation.
- [W3C Understanding Status Messages, exact source](https://github.com/w3c/wcag/blob/870593bbcd510c09797bf08844ebefc4880360d0/understanding/21/status-messages.html): announce waiting, success and errors without moving focus for polling updates.

Continue the already applied [frontend design guidance](frontend-design-review.md): useful content first, the existing picnic palette/type, readable compact rows and comfortable native controls.

## Implementation plan and journey

1. Reuse `planning.bring`, `bringClaims`, `bring-item`, exact release, queue and receipts unchanged. Broaden authoring and display copy to items and small practical tasks, with useful instructions entered manually. No schema/backend/provider changes.
2. Feed cards expose actual open slots and a direct “See how to help” handoff into the original plan's existing list. Counts use accepted claims, never pending reservations or staffing/attendance scores. Cached availability remains explicitly provisional.
3. Add a “My help” return page derived from the current profile, saved room, current claims, own pending requests and latest rejected receipts. Show each exact plan/numbered slot, current owner, schedule/place and listing status. Do not save a second ledger. A native link/button returns focus to the original list or exact slot.
4. Shared, pending offer, pending withdrawal, rejected conflict and inactive history are distinct. A pending withdrawal leaves the shared owner visible. Cancelled/superseded offers are historical, with the original listing/reason and optional replacement link; no consent moves. A successful withdrawal clears the current entry; prior receipts remain in the original plan's history.
5. Empty, browse-first, initial loading, unavailable/cached and reconnect states do not invent needs, successful offers or human confirmation. Public pseudonyms/intent are not verified identity, delivery, attendance or official authority. Votes, RSVPs, private progress and rewards remain separate.

## Acceptance and release gate

- A newcomer discovers a real unfilled small task, deliberately joins/offers, sees the original plan/slot in My help, reopens it and withdraws with the existing exact claim ID. An organizer can see current owners and actual remaining gaps.
- Two profiles and two plans with duplicate labels remain independent. Pending/rejected requests are scoped to exact room/profile/plan/index; another member's or room's records never become this member's offers.
- Offline offer and withdrawal survive real service-worker reload, reconnect retries the same operation, and rejected work remains reviewable. Current shared ownership stays visible while pending. Existing lost-response/idempotent protocol checks remain required but are not duplicated solely for counts.
- Changing/cancelling a plan identifies historical offers and returns to the original; fresh plans start empty. Withdrawal never releases a successor's offer. Group outcomes and all existing records stay intact.
- Focused functional checks cover derived return-state boundaries. Original desktop and 390×844 viewport captures, Enter/Space/focus and offline checks exercise the actual handoff. Run the normal frozen-install/Node/build/browser release checks once, then the extracted package check. Publish a new immutable preview and verify public source/download/checksum. Earlier releases and the separate unpublished environment draft remain preserved.

## Implemented and locally verified

The bounded flow is implemented for preview.8. Feed cards expose accepted-claim-based open needs and a keyboard handoff into the existing list. **My help** derives current offers, queued requests and latest rejected attempts from the saved room/profile; it returns to the exact original numbered need. Original schedule/place and cancelled/superseded reasons remain visible. The existing offer/withdrawal protocol and backend are unchanged. Only copy now includes practical tasks as well as things to bring.

Review found two real recovery details worth fixing in the affected paths. Existing bring controls and per-slot queue deduplication now match the current room as well as profile/action/index. Receipt selection uses the original server `receivedAt` (array order breaks equal-time ties), so replaying an older accepted operation cannot hide a newer conflict merely by arriving last. Focus handoffs capture the original room/plan/index, await successful navigation and matching rendered content, and cancel if the room changes. Polling does not repeat focus movement.

Executed checks: frozen `npm ci --no-audit --no-fund`; **157 Node checks** (129 existing domain, 12 HTTP, 10 controlled backend-weather fixtures, 6 help-state checks); production TypeScript/Vite/service-worker build; four focused browser journeys, then the normal **35 production-browser checks** (31 existing plus those four). The focused checks added no second claim/confirmation state. Actual old-room queue/receipt injection verifies that a current-room offer can queue independently without dropping old work; reconnect rejects the old original target rather than redirecting it. Existing exact-claim, lost-response, legacy migration and durable-save barriers remain intact.

The [11 original QA captures](screenshots/preview8/README.md) were copied from the successful normal browser run. Root reviewed narrow discovery, organizer gaps/owner, shared, pending, conflict, cancellation/history and desktop originals; no material overflow or handoff blocker remained. Browser activity uses isolated temporary stores. The preserved room (`509a0d3d-c6c3-4deb-b3bb-d653d24fcdba`) and original v1 backup remained byte-identical after restarting the workbench server: SHA-256 `c2e24b9c6efe1288c6940883bfdda3435e01fa5e50d57ac4713d758220c60547` and `2ce22364cfa689221fa221c932538487d52ddeeeddb357921da86eff1a35b39d`, respectively. No schema migration or environment publication was performed.

Packaging, extracted-package verification and public GitHub workflows/downloads are separate release gates after this source checkpoint. Published workflow runs and the release's `SHA256SUMS`/`RELEASE.json` provide their actual source and artifact evidence. The first usable increment demonstrates a newcomer finding a practical vacancy, deliberately offering, returning to it after reload/offline recovery, and withdrawing while an organizer sees current gaps; changed/cancelled plans retain their original history and require fresh offers on successors. It does not claim the broader Spec shift/skill/hour/confirmation-chasing track is complete.
