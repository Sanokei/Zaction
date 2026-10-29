> **Planning baseline, October 29, 2026.** This document records the source-pinned design before implementation. Statements about a documentation-only checkout and unimplemented behavior describe that planning snapshot. See [the current README](../../README.md) for the implemented demo, commands, and current limitations. Example governance remains a labeled demo fixture, not approved production policy.

# Zaction: first-phase implementation plan

Status: proposed implementation sequence, prepared October 29, 2026. No application implementation is included in this deliverable. The prepared cloud environment draft remains available for human review and publication.

## Source and intent

This plan follows **Spec.pdf, “Civic Hub — Master Design Document,” working draft October 27, 2026**, at repository commit `262a06b2e67ca676d30c8f11d92d6fb4a902ac88`. PDF SHA-256: `243bb265e8a5aa80621070a73f858b375149cebdbcbeccf3500a4d12576baa3f`. Printed page numbers match PDF page numbers. See the [source register](sources.md) for immutable links and primary technical references.

The human calls the product **Zaction**, specifies a youth civic action **PWA**, and selected **personal progress and shared group milestones** as the incentive direction. Exact reward mechanics remain open. This choice does not approve points, streaks, prizes, public attribution, or milestone thresholds.

The first flow is [action → participation → group proposal vote → recorded outcome](screen-flow.md). Internal proposal voting follows the group's published rules (§3.5, p.9). Public-election information follows the source-and-deep-link rule (§3.1, p.7; §8, pp.20–21). Zaction does not cast official election ballots or infer that opening an official link means someone registered or voted.

## Nonnegotiable behavior from the spec

| Requirement | Implementation implication | Spec pin |
|---|---|---|
| Learn, Serve, Organize; a hub for doing things | Present one concrete next action, with low-effort ways to contribute | §1 p.2; §3 p.7 |
| No phone-number account; immediate demo group | Create a device-local key using established browser/library primitives; explain the public demo and identity limits | §3.3 p.8; §4.4 p.13 |
| Broadcast, deliberation, and operations are distinct | Label the active space; put proposals and ballots in deliberation; make only transport-security claims in Phase 1 | §3.3 p.8; §9 pp.22–23 |
| Debate and voting are separate | Contributions and a correctable summary precede a separate explicit ballot | §3.4 pp.8–9 |
| Short questions and corrections count; votes decide what, never who | Support quiet/private preparation; no individual rankings, follower counts, popularity elections, or participation-weighted ballots | §3.8 p.11 |
| Decisions have published minutes | Retain proposal/rule versions, participation provenance, outcome, and changes; resolve public attribution and retention before real-group use | §3.6 p.10; §7 pp.19–20 |
| Local first, honest offline behavior | Persist locally before saying saved; distinguish queued work from group-accepted work; show source and sync dates | §§4.1, 4.5–4.6 pp.12–14 |
| Agent proposes; humans decide and publish | Preserve manual authoring; validate tool calls; require per-action approval for sends/publication | §§6–6.1 pp.16–19 |
| No money in Phase 1 | Use a $0 action proposal; no collection, booking, vendor transaction, or treasury integration | §9 pp.22–23 |

## First usable increment: a public demo decision loop

**Demonstration:** two browser sessions join the same clearly labeled public demo, prepare a free school-budget reading circle, contribute a question, deliberate, submit equal-weight demo ballots, and inspect a recorded decision with next actions. One browser disconnects during drafting/submission and reconnects without losing work or duplicating an accepted operation.

The demonstration agenda and people are explicitly synthetic. The source card demonstrates where an official URL, jurisdiction, publication date, and last-checked date belong; it does not impersonate a real school district or supply current election information. A real-group pilot must replace these fixtures with reviewed official material. The proposed event remains tentative: adoption of a plan does not reserve a room or establish that an event happened.

This increment includes an installable shell, IndexedDB persistence, a source card, one action and discussion, one versioned proposal, a ballot, minutes, and a private progress view. A replaceable transport carries public demo changes between the sessions after the relevant sync spike succeeds. Deterministic demo membership and voting rules make the flow inspectable; they do not establish production membership integrity or distributed voting finality.

The map/report, agent, civic-learning, events, and labor work below remains required for the full Phase 1. The thin increment alone does not complete Phase 0 or Phase 1.

## Phase 0: preserve every research and feasibility gate

These gates come from §9 p.22. All remain **unrun or unresolved** in this planning task. For each spike, record source/library/model revisions, hardware/browser/OS, reproducible commands, observed outputs, and a pass/fail decision. A failed spike requires a plan decision before dependent implementation proceeds.

| Gate | Proposed pass evidence | Dependency and present status |
|---|---|---|
| Core documentation and civic sources | Review pinned Automerge/libp2p docs and live official Vote.gov, Ballotpedia Sample Ballot, and Power the Polls routes; record current terms and source dates | Technical source review is partial; civic-route and terms validation remains open |
| Automerge: two browsers through a relay | Concurrent offline edits survive reload; both peers converge after reconnect; duplicate/reordered delivery does not duplicate records; relay can be replaced in the test | Required before choosing the demo's sync adapter; no executed spike |
| libsignal: 50-member group | Establish a supported browser integration and audited design first, then exercise membership changes and encryption/decryption at the required size with pinned dependencies | Official library docs expose native bridges; a drop-in PWA integration is unproven; no crypto implementation selected |
| Qwen3-0.6B: actual WebGPU inference | Pin the exact browser-compatible artifact/runtime; run real inference on real GPU hardware; record download size, adapter, latency, memory, and a narrow draft result; enforce opt-in download | No exposed GPU and no model downloaded; a WebGPU API object or cached weights is insufficient evidence |
| Whisper tiny: mid-range Android | Record actual device/browser/model; transcribe a defined consented sample locally; measure cold/warm behavior and failure handling | No phone validation; no model downloaded |
| Kokoro-82M: iOS Safari | Record actual iPhone/iOS/browser/model; synthesize a defined sample locally; measure download/storage and interruption behavior | No phone validation; no model downloaded |
| Civic licensing | Obtain written current terms/pricing for Ballotpedia, VoteAmerica, and Google Civic voterinfo before selecting licensed data | No outreach or licensing decision authorized/performed; first demo uses no licensed feed |
| Fiscal route | Choose the legal host and written refund/reporting policies before donations | Unresolved; all money features stay in Phase 2 |
| Logistics sources/providers | Verify print/mail terms, jurisdictional permit sources, and population/transit data before related feature use | Unresolved; no mail, permits, or paid-provider integration in the demo |

Full-spec readiness cannot be claimed while these remain open. Design and labeled synthetic fixtures can be reviewed now. The plan keeps later-feature spikes visible even though the first demo does not exercise their features.

## Sequenced implementation work

No front-end framework is specified by the PDF or current checkout. A future coding task should select a small TypeScript PWA build/test setup, pin its versions, and record the decision; this plan does not treat a framework as approved. Browser-only APIs and WebAssembly bundling must be checked before selecting candidate packages. Keep identity, document sync, ballot validation, inference, and UI boundaries explicit.

| Step | Concrete work | Acceptance / exit condition |
|---|---|---|
| 0. Decision and spike packet | Resolve demo governance, attribution, source provenance, and the dependency gates above; document production decisions that remain open | Demo config is labeled and versioned; dependent technology has demonstrated feasibility; no unresolved spike is marked passed |
| 1. Installable public shell | Manifest, responsive navigation, accessible semantic UI, worker update handling, cached shell, device-local identity, demo entry, iOS install education | Clean browser can enter demo without email/phone; reload retains identity; cached shell opens offline; an uncached first visit while offline receives the browser's offline response; loaded install/help content explains the initial-download requirement |
| 2. Action and participation | Source card, optional private checklist, question/correction composer, local persistence, explicit publish action, public-space notice | Refresh and offline reload retain drafts; short and keyboard/screen-reader contributions work; local progress never changes eligibility or ballot weight |
| 3. Deliberation and proposal | Separate contributions/summary/ballot views; rotating facilitation role; correctable human-reviewed summary; versioned $0 proposal | Any eligible demo member can draft; a summary cannot decide a proposal; editing a frozen proposal creates a new revision and follows the explicit re-vote policy |
| 4. Submission and outcome | Membership/rule snapshot, ballot intent, acceptance/rejection receipt, idempotent transport, tally state, minutes, next-action list | Two browser sessions reconcile; offline/late/revised/duplicate cases follow [flow criteria](screen-flow.md#acceptance-scenarios); partial peer totals never masquerade as a final result |
| 5. Complete the Phase 1 surface | Maps and labeled reports; Learn with official deep links and sourced cached rules; events and public pages; volunteer shifts and confirmations; basic source-linked location research | All required tracks below pass their own functional checks; transport security is described honestly; external actions require explicit human approval |
| 6. Narrow on-device agent foundation | After the GPU spike: thread summarization, draft minutes, cached-source civic Q&A; schema-validated harness and per-action approvals | Actual pinned model runs; invalid tool calls are rejected; source dates accompany civic answers; draft/publication boundary survives hostile group-content tests |
| 7. Phase 1 review | Integrate the complete user flow, accessibility, offline recovery, source freshness, privacy, and failure-state checks | Evidence covers the required tracks; missing GPU/phone results and Phase 0 issues remain explicit; no Phase 2 feature is claimed |

## Full Phase 1 coverage and evidence

| Required track | Concrete acceptance evidence | Reference |
|---|---|---|
| Join, invite, QR, public demo, iOS education | Fresh identity can join; invalid/expired invite and unavailable group have useful states; QR pairing never exposes a private key; identity persists through install/reload | §9 p.22; §§3.3, 4.4 |
| Map and reports | Source/date and jurisdiction on official markers; unverified label on unsigned user reports; stale/empty/error/offline map states; optional photo/location and text/list alternative; votes never verify a report | §3.1 p.7; §3.3 p.8; §9 p.22 |
| Debate, proposal, vote, minutes | Correctable summary, explicit governing rules, equal eligible ballot weight, pending acceptance, independent outcome reconstruction under the chosen demo protocol | §§3.4–3.6 pp.8–10 |
| Learn and public pages | Official deep links work; cached rules show source and date; no personal voter lookup or scraped ballot data; human publishes/corrects minutes and public group information; read-only public finance logs have an honest empty state | §3.1 p.7; §8 pp.20–21; §9 p.23 |
| Events, location research, volunteer labor | Tentative vs confirmed event states; cited assumptions for population/transit; signup, confirmation, withdrawal, unfilled shifts, and consented notifications; no automatic commitments | §§3.3, 3.7 pp.8, 10–11; §9 pp.22–23 |
| Agent foundation | Live GPU inference evidence plus schema validation, cached-source answers, manual fallback, visible per-action publication/send approval, and no hidden cloud fallback | §§6–6.1 pp.16–19; §9 p.22 |
| Incentive direction | Private progress and shared milestone treatments can be reviewed without rankings; everyone retains the same ballot entitlement; refusal to share progress does not block action/voting | User choice; §3.8 p.11 |

Full Phase 1 includes a read-only public finance-log surface (§9 p.23), with an honest empty state and an explanation that collection and transactions are unavailable in this phase. The thin first increment can defer that surface; the full Phase 1 cannot. Do not invent financial activity or a collection flow. Private operations/E2EE, production libp2p CRDT sync, identity recovery, voice, treasury, mailers, vendor commerce, and broader logistics remain Phase 2. MLS/native mesh/larger voice models remain Phase 3 (§9 p.23). Validate candidate sync early without relabeling production Phase 2 guarantees as Phase 1 achievements.

## Data and reconciliation decisions to review

Use separately identified records for `localProgress`, `contribution`, `proposalRevision`, `rulesVersion`, `eligibilitySnapshot`, `ballotIntent`, `ballotReceipt`, `outcome`, `minutes`, and `nextAction`. Every operation needs a stable ID; every ballot and outcome names the exact proposal/rule/eligibility revisions. Source cards carry URL, jurisdiction, publication/update date when known, and last-check time. User-visible timestamps must specify their relevant local timezone.

Automerge can merge shared documents. It cannot establish unique humans, vote eligibility, close authority, receipt deadlines, or final outcomes. A local device key is not proof of a unique person. Do not derive production voting authority or a verified report from CRDT convergence, device count, contribution count, or an agent response.

Before real-group voting, decide eligibility and anti-duplicate membership handling; ballot choices; quorum; passing/tie/abstention rules; changing/withdrawing votes; proposal edits; deadline authority and late offline delivery; partition recovery and finality; key loss/rotation; public voter attribution and retention; role rotation and dispute handling. The PDF supplies principles, not all of these policies. The example configuration in the flow is solely a reviewable demo fixture.

## Incentive options within the chosen direction

These are review options. No point value, streak, reward, or public score is approved.

| Option | Useful behavior | Tradeoff / decision needed |
|---|---|---|
| Private completion checklist | Acknowledge reading, one question/correction, proposal review, and participation in a decision | Define self-report labels, undo/reset, and whether completion stays only on the device; do not imply external verification |
| Private reflection/history | Show what the person helped move forward over time | Choose retention and deletion rules; avoid missed-day penalties and pressure to disclose personal activity |
| Shared outcome milestones | Show “questions gathered,” “decision recorded,” and “next action completed” for a chosen group objective | Decide criteria, who can attest/correct, consent, and disclosure rules; aggregate state can still reveal small-group activity |
| Shared commitment totals | Make genuinely unfilled roles and next steps visible | Distinguish pledged, self-reported, and confirmed completion; avoid duplicate counts and naming inactive people |

Recommended first design comparison: a private checklist next to a finite shared objective. Keep both optional and allow direct access to the proposal ballot. Recognize the act of participation regardless of ballot choice; do not expose vote choice through progress. Offer accessible contributions of different sizes. No competitive ranking, extra voting weight, money-for-voting, proof of public-election participation, or incentive to vote a particular way belongs in this increment.

## GitHub pushes and downloadable releases

The human requests regular pushes to GitHub and easy downloads from Releases. For future authorized implementation work, push completed and verified source changes as milestones progress, following the repository's branch/review rules. Confirm the remote result; local commits and environment snapshots do not establish a push.

Runnable milestones should have a versioned GitHub Release pinned to the pushed source commit, with a ready-to-host production PWA ZIP, `SHA256SUMS`, and brief hosting/browser-install instructions. Release notes identify actual build/runtime versions, validation, base-path configuration, external relay/service dependencies, and remaining limitations. Test the extracted ZIP through a web server, including assets, manifest, service worker, cached reload, and declared offline behavior. Exclude credentials, .env files, caches, and node_modules; keep model downloads opt-in unless explicitly included after validation and size budgeting.

The ZIP is a web build for hosting; users normally install the PWA from an HTTPS-hosted site through their browser. It is not a native installer and double-clicking index.html is not the supported installation path. The documentation-only checkout has no runnable app artifact to release yet. Downloadable assets do not imply GPU, phone, inference, or encryption validation. Cloud environment publication remains a separate human-controlled action.

## Present evidence and handoff

The checkout currently contains documentation only and has no AGENTS.md, package manifest, application, build, or test suite. The earlier environment probe passed Chromium launch, secure browser APIs, service worker control, offline cached navigation, and IndexedDB persistence. Those results validate tooling only.

This work has read the actual PDF and inspected current instructions; it has not implemented or run this proposed increment, downloaded models, modified tracked/untracked checkout contents, or published the environment. The later human delivery instruction updates saved startup guidance with the selected incentive direction and GitHub/release requirements; installation, cache, repository, and network settings are preserved. The human can review/save the prepared environment settings and publish through the product. A future authorized coding task should use the existing isolated checkout, begin with the recorded gates/decisions, and produce the first usable increment with the evidence above.
