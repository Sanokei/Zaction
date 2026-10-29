# Bring & share: bounded organizing increment

Planned October 29, 2026 (America/New_York), before implementation. Starting source: `f47aa1bf1d0f3dc099f27741f25f63e6e33ac8ca`, public `v0.1.0-preview.3`. Preserve that release and its assets. The unchanged [Spec.pdf](https://github.com/Sanokei/Zaction/blob/262a06b2e67ca676d30c8f11d92d6fb4a902ac88/Spec.pdf) SHA-256 is `243bb265e8a5aa80621070a73f858b375149cebdbcbeccf3500a4d12576baa3f`. No applicable AGENTS.md was found.

## Research and critique

The actual PDF puts concrete volunteer work in §3.2, human-reviewed event planning in §3.3, visible signups and unfilled needs in §3.7, and labor organizing plus no-money proposal votes in Phase 1 (§9). Equal voice (§3.8) means an offer to bring something never changes a ballot's weight. This increment implements a small public logistics interaction; it does not establish the remaining identity, distributed-sync, encrypted-operations, agent, or real-device gates.

Current `planning.bring` is a static list in the detail sidebar. People cannot see what is still needed or who intends to help. Item text is also used as the React key despite duplicate labels being valid. A useful first flow is: open a plan → see open items → offer one → see the accepted claimant → release it if plans change.

Primary interaction sources read for this increment:

- [W3C ARIA Practices: Button Pattern, exact source](https://github.com/w3c/aria-practices/blob/0f765e4dc33e966026114ac12a8380db1de3b787/content/patterns/button/button-pattern.html), checked October 29, 2026. Native buttons support Enter and Space. A command whose action label changes does not need toggle `aria-pressed` semantics.
- [W3C: Understanding Status Messages, exact source](https://github.com/w3c/wcag/blob/870593bbcd510c09797bf08844ebefc4880360d0/understanding/21/status-messages.html), checked October 29, 2026. Waiting, success, and error feedback should be programmatically available without stealing focus. Announce the changed item, not a repeatedly polling list.
- [pretix's first-party quota documentation](https://github.com/pretix/pretix/blob/e6f8f178aff537bc32dc7359a5f561b8074a269b/doc/api/resources/quotas.rst#L33-L38) warns that displayed availability can be outdated and must not decide critical operations. Its [order transitions](https://github.com/pretix/pretix/blob/e6f8f178aff537bc32dc7359a5f561b8074a269b/doc/api/resources/orders.rst#L1299-L1300) recheck availability before canceled orders reactivate. These are capacity-management analogies, not volunteer/potluck UX or the source of Zaction's exact-claim-ID protocol. Both were read October 29, 2026.
- Official SignUpGenius participant signup/edit help and PerfectPotluck product pages were attempted but blocked by proxy CONNECT 403. Their behavior is not treated as verified. A single owner per slot and the conflict protocol below are explicit Zaction design choices.

Continue the [applied frontend design](frontend-design-review.md): picnic palette, bundled type, clear rows, comfortable native controls, and useful state feedback. Put bring-items in the main plan column before discussion so they are discoverable on narrow screens. Disclose public nickname/item visibility once beside the choice; keep the planning estimate explanation beside the budget.

## State and protocol

- Each immutable published `planning.bring` entry is one slot, identified by action ID + zero-based item index. Duplicate labels remain distinct. One member can offer multiple slots. No editing/reordering, quantities, split ownership, purchases, payment, notifications, or automatic assignments in this increment.
- Add optional `bringClaims` records to schema 2: `{id, itemIndex, memberId, createdAt}`. `id` is the accepted claim operation ID. Only a missing legacy collection defaults to `[]`; malformed existing claims are rejected without replacing saved data. Validate known members, valid IDs/times, bounded integer indexes, and one claim per slot.
- Add a `bring-item` operation with `itemIndex`, `intent: 'claim' | 'release'`, and a required `claimId` for release. The server serializes writes. First accepted claim wins; nobody can take over another member's slot. A release must match both the acting owner and exact current claim ID, preventing delayed offline releases from removing a later reclaim. Stable operation replay retains its original receipt.
- Keep the actual confirmed owner visible during pending work. Queued claims do not reserve; queued releases do not free an item. Durable pending intent uses the existing local queue with its original room, action, item, profile, and operation ID. One pending change per member/slot is sufficient. Conflicts are terminal rejected receipts; explicit retry after reviewing availability creates a new operation ID.
- Accepted item intentions do not set RSVP, reactions, ballots, personal progress, verified attendance/delivery, or task completion. Release remains possible after group-vote closure. Private bearer sessions remain separate from public state and receipt payloads.

## Flow and states

| State | Visible behavior |
|---|---|
| Loading / no saved plan | Existing plan loading/unavailable UI; never invent open slots |
| No requested items | “No shared items listed yet” and a prompt to discuss needs; no fake slots |
| Open item | “Available” with “I'll bring this”; browse-first users can join before offering |
| Own accepted claim | “You plan to bring this” and “Release item” |
| Other claimant | Their public pseudonym and intent; no takeover control |
| Offline / pending | Saved local claim or release with inline waiting text; confirmed ownership stays visible |
| Connecting / unavailable | Cached availability identified; refresh/retry does not claim success |
| Conflict / rejected | Fresh claimant + concrete rejection reason beside the original slot; preserved submission history |
| Reconnect / recovery | Same queued ID retries safely; accepted receipt updates one slot; deliberate new attempt is available when the slot is open |
| Save failure | Existing input/ownership remains; no false queued/shared success; retry after storage recovery |

## Acceptance and release gate

1. Two real preview profiles and two independent plans can claim/release identical item labels without mixing targets, altering votes/RSVPs, or inventing activity.
2. Simultaneous claims yield one owner; another member cannot release it. Owner release/reclaim and stale releases/replays cannot remove later claims. Duplicate list labels and invalid indexes are handled explicitly.
3. Offline claim and release survive a real service-worker reload. Reconnect/lost-response retry is exactly once. Conflict receipts survive reopening, with an explicit reviewed retry after availability changes.
4. Existing preview.3 room/browser records migrate additively; unknown/corrupt claims do not overwrite originals. Existing private credentials, discussions, ballots, outcomes, and minutes stay intact.
5. Native keyboard activation, visible focus, stable focus during refresh, item-specific accessible names, status announcements, and exact 390×844/desktop screenshots establish the actual new interaction. These remain desktop Chromium viewport checks.
6. Run appropriate domain/HTTP, production build, and browser checks; inspect original screenshots; test the extracted release ZIP. Publish a new immutable version through the existing release workflow, then verify the actual public asset, checksum, and source pin. Environment/weather draft publication remains a separate human action.

## Implemented and locally verified

The planned flow is implemented in preview.4. The main-column card shows indexed open/owned slots, an aggregate count of offers, public nickname/item visibility, saved-availability status, and refresh. Native command buttons keep the same DOM node when their command changes from offer to release, preserving keyboard focus. Feedback stays beside the affected item, with the original rejected operation also retained in submission history. No personal leaderboard or extra progress/vote entitlement was introduced.

Actual checks: **118 Node tests** (99 domain, 9 authenticated HTTP, 10 weather fixtures), TypeScript and the production Vite/service-worker build, and **19 production-browser flows** passed. The five added browser flows cover two independently authored plans/two profiles/duplicate labels; native Enter/Space and focus through updates; offline claim and exact-claim release across real service-worker reloads; competing durable offers, terminal rejection, reopening and reviewed new-ID recovery; a real committed request whose response is lost followed by same-ID replay; and malformed incoming claims preserving the existing snapshot/draft/identity. Social signals, ballots, notes, outcomes, task reports, and private progress were compared before/after the interaction.

Server tests also cover same-owner release/reclaim races, replaying historical accepted claims/releases after later ownership changes, validation/auth failures, legacy additive enrichment, restart persistence, and exact preservation of corrupt records. Only absent legacy collections are enriched; a present invalid collection is never reset.

The [seven original viewport captures](screenshots/preview4/README.md) were inspected at 390×844 and 1440×1100. Long/duplicate labels, clear ownership, waiting/conflict text, recoverable actions, and visible focus are readable with no horizontal overflow. Scrolled row views can place the plan title above the viewport; the gallery records their plan context. Weather numbers in the adjacent desktop panel are controlled test data. No new live-weather or actual-phone/GPU claim follows from these checks.

The new immutable milestone is `v0.1.0-preview.4`; its exact release source is recorded by the tag, release notes, and downloadable `RELEASE.json`. Packaging/extracted-artifact and public asset verification are performed after committing, rather than inferred from these source-check results. The unchanged Spec and starting-source pins above preserve the research/plan boundary.
