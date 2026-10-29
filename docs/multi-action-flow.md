# Multi-action authoring increment

Target: `0.1.0-preview.2`. This document describes the authoring increment, its acceptance contract, and the local release-candidate evidence below. Tagged-release validation belongs to that exact source's workflow run; earlier-release results do not establish the new behavior.

## Why the first fixture needed a next step

The first preview exercised one seeded school-budget reading-circle proposal. It demonstrated local drafts, equal-weight demo voting, explicit acceptance receipts, and a recorded outcome, but a fixed proposal did not satisfy the spec's principle that **any member can draft a proposal** with a goal, budget, deadline, and beneficiaries (§3.5, p.9). It was a useful fixture, not a complete civic-action authoring product.

The new increment adds member-created actions with their own proposals and keeps state separate for each action. It remains within Phase 1's **proposal voting without money** boundary (§9, pp.22–23). The source pin is [Spec.pdf at `262a06b2e67ca676d30c8f11d92d6fb4a902ac88`](https://github.com/Sanokei/Zaction/blob/262a06b2e67ca676d30c8f11d92d6fb4a902ac88/Spec.pdf), SHA-256 `243bb265e8a5aa80621070a73f858b375149cebdbcbeccf3500a4d12576baa3f`.

The previous release's **34 domain checks and 11 browser-flow checks**, associated with source `99efe90b12c0eccfddb3b3a987bb377fb5df16f5` and tag `v0.1.0-preview.1`, are historical evidence for that source only. They are not the current increment's claimed counts.

## Concrete delta

| Before | New increment | Still bounded |
|---|---|---|
| One fixed reading-circle proposal | Any selected synthetic demo member can create a $0 action and proposal | Three synthetic memberships remain a demonstration, not production identity |
| One global discussion/progress record | Each action has its own discussion and minutes drafts, progress, ballots, outcome, minutes history, and next tasks | Progress never grants extra voting weight or ranks people |
| Implicit single proposal target | Every operation explicitly names an `actionId`; the server rejects an unknown or incompatible target | No automatic fallback to the example action when another action is missing |
| Synthetic agenda only | Member text plus an optional HTTPS source link, labeled public and unverified | A source link or majority vote does not establish truth, official status, or licensing |
| First-preview schema | Automatic v1→v2 migration preserving room/browser state and retry identity | No data reset; a server backup is written before conversion |

## One end-to-end flow

1. **Choose a public demo persona.** Alex, River, and Jules remain explicitly synthetic. No phone number, follower count, or participation threshold is introduced.
2. **Create an action.** Enter the action title and goal/description, the proposed decision, beneficiaries, tentative time/place, and source label. A source URL is optional and must use HTTPS. The budget is fixed at $0; no donation, booking, or outside message occurs.
3. **Save or submit the draft.** The creation draft has a stable local ID. Offline submission is durable but pending, not published. The form remains recoverable after queuing or rejection. Voting cannot begin on a local-only action.
4. **Reconcile explicitly.** On foreground reconnect/retry, the server accepts or rejects the same operation ID under the current room/rules. Acceptance adds the action to the shared list. Rejection keeps the original draft and its reason; switching actions does not retarget the queued operation.
5. **Participate in that action.** Read its source card, privately save a short discussion draft, and explicitly publish a question/correction. Switching between actions retains each action's discussion and minutes drafts.
6. **Review and vote.** Open the selected action's frozen proposal and published fixture rules. Every eligible synthetic member has one equal ballot in that action regardless of personal progress. Offline ballots remain pending until their action-specific acceptance receipt arrives.
7. **Record the outcome and next step.** The labeled demo close control produces the selected action's adopted/not-adopted/no-quorum result. A human reviews/publishes minutes and self-reports next-task completion. Another action's votes, outcome, minutes, and tasks remain unchanged.

The author supplies tentative logistics, while the demonstration's fixed rules supply the visible receipt deadline and closing behavior. Arbitrary group rule/deadline editing, real membership eligibility, and production finality remain separate decisions; authoring does not silently approve a production governance mechanism.

## Required state behavior

| State | Expected behavior |
|---|---|
| Empty authoring form | Clear field labels and errors; no invented activity or source |
| Editing / local save | Preserve the actual text; show saved only after browser persistence succeeds |
| Offline creation | Keep a pending creation and the original form; do not expose a fake accepted action or ballot |
| Reconnect / retry | Reuse operation and action IDs; accept once or retain an explicit rejection |
| Switching actions | Restore the selected action's drafts/progress; never copy or publish text into a different action |
| Unknown or unavailable action | Explain the missing target; keep local work and queued intent; do not fall back silently |
| Server rejection | Show the action-specific reason and recoverable draft; do not mark the action published |
| Storage failure | Keep visible input available and say it is unsaved; no false queued/saved confirmation |
| Accepted action | Other browsers see it after sync; only its own contributions and ballots affect its milestones/outcome |
| Upgrade | Preserve the original room, receipts, identity, drafts, queues, and reading-circle history; keep migration backups |

## Verification and release evidence

The new source must be checked for action creation and validation, HTTPS-only optional links, operation/receipt idempotency, per-action isolation, duplicate-member vote protection within each action, offline creation/contribution/voting, explicit rejection/recovery, and v1 server/browser migrations. Production-artifact browser checks should exercise more than one action and at least two browser contexts.

Visual evidence should include desktop plus original **390×844** viewport captures of open, pending, rejected, and recovered states. These are browser viewport checks, not actual-phone validation. A screenshot of a seeded fixture does not establish authoring, migration, or network reconciliation; the functional checks must demonstrate those behaviors separately.

### Local release-candidate evidence

The completed local pipeline for this increment passed `npm test` (**52 domain/HTTP checks**), `npm run build`, and `npm run test:e2e` (**16 browser-flow checks**). The browser flow includes multiple actions and contexts, per-action draft/progress/ballot isolation, offline creation and replay, explicit rejection, server/browser migration preservation, failed-save recovery, and actual restoration of a rejected contribution to its original action without changing an unrelated action's draft.

The [current screenshot index](screenshots/preview2/README.md) links all eight original captures: desktop, narrow home, open proposal, pending submission, rejected submission, retained input after a failed save, saved input after retry, and the rejected contribution restored to its original target. Narrow images are exactly 390×844 pixels with `fullPage: false`; the browser uses America/New_York time. They are evidence of the displayed states, while the functional tests establish the transitions.

This records local release-candidate results. It does not claim a successful tag workflow or a reachable hosted deployment. The final ZIP's `RELEASE.json` and GitHub release notes identify its exact source commit; verify the corresponding workflow separately after publication.

Publish a new immutable `v0.1.0-preview.2` GitHub prerelease only after the tagged source's build and relevant checks pass. Keep `v0.1.0-preview.1` unchanged. Downloads remain a ready-to-host PWA ZIP plus `SHA256SUMS`; no reachable public hosted deployment is established by local testing or a release download.

This increment does not complete the spec's remaining map/report, civic-data, audited private-sync, on-device inference, real-phone, fiscal-host, or logistics work. Personal progress and shared milestones remain the selected incentive direction; no point system, personal leaderboard, or participation-weighted ballot is introduced.
