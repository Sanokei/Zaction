# Social community and practical planning increment

Target: `0.1.0-preview.3`. This is the product rationale and acceptance boundary for the social redesign. Current validation and captures are recorded only after their actual checks complete; results from earlier releases remain historical.

## Product direction and the PDF

Zaction should feel like people making plans together, rather than a task dashboard built around one fixture. The useful Reddit pattern is a readable topic feed with conversational replies. The useful Instagram pattern is an image-led card that communicates a plan quickly. Zaction uses those patterns to make a next action understandable, without follower hierarchies, personal popularity rankings, fabricated activity, or extra voting power.

The PDF remains the source: [Spec.pdf at `262a06b2e67ca676d30c8f11d92d6fb4a902ac88`](https://github.com/Sanokei/Zaction/blob/262a06b2e67ca676d30c8f11d92d6fb4a902ac88/Spec.pdf), SHA-256 `243bb265e8a5aa80621070a73f858b375149cebdbcbeccf3500a4d12576baa3f`.

| Spec requirement | Design response |
|---|---|
| §3.3 p.8: easy joining, community events, separate group layers | Public-pseudonym onboarding, coarse city, local interests, social plans, and clearly separate proposal decisions |
| §3.4 pp.8–9: people discuss; debate and voting are distinct | Comments/replies support conversation; reactions and RSVPs do not cast a ballot |
| §3.5 p.9: any member can draft a goal, budget, deadline, and beneficiaries | Member-authored plans and proposals, tentative logistics, transparent estimates, and a visible decision deadline; no payment custody |
| §3.8 p.11: everybody has a say; votes decide what, never who | Equal profile ballots, optional private progress, shared milestones, no follower or popularity leaderboard |
| §9 pp.22–23: Phase 1 organizing without money; later private/financial work remains gated | Social participation and practical planning now; no donations, collection, booking, E2EE, or inference claims |

Original local SVG illustrations make BBQ, potluck, games, walk, help, and idea templates easy to recognize. They are suggestions for a new plan, not photos or claims of an existing gathering. The [frontend design review](frontend-design-review.md) records application of the upstream `frontend-design` guide at `anthropics/skills@ca45fc496a3436251f191354091d557da31c15b5`; it was read/applied from source rather than represented as an installed plugin. Self-hosted Bricolage Grotesque (`@fontsource-variable/bricolage-grotesque` 5.3.0) supplies offline WOFF2 type with the [OFL license](../public/fonts/Bricolage-Grotesque-OFL.txt); no font/image CDN is required.

## One useful community flow

1. **Join with a pseudonym.** Choose a public name and one coarse city. Pick interests that stay on this device. Explain what is public before completing onboarding; do not ask for a phone, email, home address, or GPS location.
2. **Find people through plans.** Browse member posts or start from a template. A member-created post is labeled as member content; the retained reading-circle example and old fixture identities stay explicitly synthetic.
3. **Make a BBQ plan concrete.** State its purpose, who benefits, tentative time/place, guest estimate, estimated cost, rain alternative, accessibility needs, what to bring, and source label. Optional external source URLs must use HTTPS. Saving locally does not publish a plan.
4. **Check the practical constraints.** Request a city/date forecast when within the supported window. Show actual provider data or an honest unavailable/stale/out-of-range state. Calculate an estimated per-person amount without collecting or transferring money.
5. **Participate socially.** Comment or reply, mark interest, save privately, or choose going/maybe. Counts reflect accepted public activity, not seeded popularity. An RSVP is a stated intention, not proof of attendance.
6. **Decide deliberately.** Open the separate proposal and its visible rules. Each eligible profile has one equal ballot regardless of interests, posting, reactions, RSVP, private progress, or popularity. Adoption does not book a venue, pay a vendor, or establish that an event occurred.
7. **Follow through.** Publish reviewed decision notes and track the actual next tasks. Private progress and shared milestones acknowledge contribution without ranking people or exposing ballot choice through progress.

## Public identity and private session storage

New profiles have a public pseudonym and coarse city. The city represents a named city centroid, not GPS or a home address; preferences/interests remain device-local. A profile is not proof of a unique human, and pseudonymous participation is not a guarantee of anonymity.

The server issues a random private session credential for a newly joined profile, stores only its hash in the private room data file, and checks ownership for that profile's writes. The browser stores the credential separately in private IndexedDB storage; it must never enter public snapshots, shared operations/history, screenshots, or release archives. Losing local session storage does not imply an implemented account-recovery service.

New actions use the explicit `COMMUNITY-PREVIEW-v1` eligibility policy with the published demo voting rules: registered profiles have equal weight, quorum is two accepted ballots, and approve must exceed oppose. These are inspectable preview policies, not approved production governance or anti-Sybil protection. Existing `DEMO-MEMBERS-v1` actions keep their old Alex/River/Jules fixture policy and history; the old identities remain compatibility/debug tools rather than the onboarding default.

The schema remains version 2 with additive profile/social metadata. Existing rooms, action IDs, accepted/rejected receipts, pending targets, ballots, notes, drafts, and identity data are retained. No upgrade resets the room. The original schema-1 backup policy still applies when upgrading an older first-preview file.

## Weather and estimates

Forecast requests use Open-Meteo through the same-origin weather endpoint, for one of the supported city centroids: New York, Austin, Seattle, Chicago, or Los Angeles. The selected city centroid, date range, and city timezone are sent to the provider; no home address or GPS coordinate is collected for this feature.

The supported date window is **today through 15 days ahead**, inclusive, in the selected city's timezone (`forecast_days=16`). Successful data may be cached for 30 minutes. If refresh fails and prior data exists, the app preserves its original checked time and marks it stale. Unknown cities, invalid dates, out-of-range dates, and provider failures produce unavailable states without fabricated temperatures, rainfall, or weather icons presented as observed forecasts.

The provider is [Open-Meteo](https://open-meteo.com/); API requests use `api.open-meteo.com`. Show provider attribution and a source link. Its [official README at `e29ee554151b43076ae32724028eea9cdefab7c4`](https://github.com/open-meteo/open-meteo/blob/e29ee554151b43076ae32724028eea9cdefab7c4/README.md) documents the free noncommercial API and CC BY 4.0 data attribution: give appropriate credit and a [license link](https://creativecommons.org/licenses/by/4.0/), and indicate changes when applicable. The [forecast schema at that same source pin](https://github.com/open-meteo/open-meteo/blob/e29ee554151b43076ae32724028eea9cdefab7c4/openapi/forecast.yml) documents the 16-day maximum. Review current terms before a different deployment/licensing use.

Run `npm run check:weather` for a separate live-provider smoke check. It uses `node --use-env-proxy scripts/check-weather.mjs` on Node.js 24.5+, requests a forecast for New York tomorrow, and fails when the provider is unavailable. The actual cloud command on October 29, 2026 exited **1**, returning unavailable and no forecasts; the underlying provider request was blocked by proxy CONNECT 403. Controlled-response tests can verify parsing and failure states, but cannot establish current provider access. CI and release workflows now observe the live provider in a separate **nonblocking** step with a notice/warning; overall job success is not evidence that this observation passed.

Cost and per-person amounts are estimates, not contributions collected, approved payouts, vendor quotes, or a funding ledger. Going/maybe counts are stated intentions and must not be presented as a guaranteed crowd. The app does not execute a purchase or booking when a plan is adopted.

## State and acceptance contract

| State or transition | Required behavior |
|---|---|
| First visit / no public profile | Explain public pseudonym/city and private interests; templates contain no fabricated posts or RSVPs |
| Onboarding failure | Retain entered fields; do not claim an account/session exists before server acceptance |
| Feed empty / loading / error | Distinguish the states; show a real create-plan path without inventing people or activity |
| Compose / offline | Retain local text and planning details; pending is separate from published; stable action/operation IDs survive retry |
| Comment/reply | Keep the target action and reply parent explicit; do not move text to another plan |
| Interest / save / RSVP | Keep public interest and RSVP separate from private saved state and formal ballots |
| Profile ownership | Reject a write without its required session or with a mismatched profile; never expose session credentials in public API state |
| Weather fresh / stale / unavailable / out of range | Preserve source and checked time; no guessed data or fake provider success |
| Estimate missing / guest count invalid | Explain the incomplete calculation; never divide by zero or claim a funded amount |
| Reconnect / rejection / restoration | Preserve original drafts and targets; show explicit acceptance/rejection; retry cannot duplicate accepted work |
| Upgrade | Preserve existing metadata and records; no fixture reset; keep private session data out of served/public files |

Validation must cover the social flow in multiple browsers, dynamic-profile ownership, reaction/RSVP/ballot separation, per-action isolation, offline recovery, migration, and weather parsing/error handling. Original desktop and narrow viewport captures should show actual onboarding, feed, planning, and weather-unavailable states; they are not real-phone validation.

## Local validation and provider observation

The finalized local source pipeline passed a frozen dependency install, `npm test` (**81 checks: 65 domain, 6 HTTP, 10 weather fixtures**), `npm run build`, and `npm run test:e2e` (**14 social browser flows**). The final browser run includes the skill-guided palette/type/touch/accessibility and copy changes, plus new-profile onboarding, social interactions, offline recovery, keyboard navigation, same-profile preference persistence, and bundled-font availability offline. These are source-pipeline results; extracted-ZIP and tagged-workflow results are separate until actually run and verified.

Available/rainy weather in the browser scenarios comes from visibly labeled **test forecasts**. The deterministic unavailable scenario is a controlled failure. A separate unmocked browser request to the actual configured provider observed **unavailable**, consistent with the live command's failure. That observation is not counted as a passing live-provider check and is not part of the 81/14 totals.

The [11 original QA captures](screenshots/preview3/README.md) include onboarding, feed, planning, controlled available/unavailable weather, actual provider-unavailable observation, pending/rejected/recovery states, and the final feed. Narrow captures are exactly 390×844 with `fullPage: false`; desktop is 1440×1100. Maya and Noah are temporary test profiles, not evidence of a live crowd or existing community. Prior-release screenshots remain unchanged.

The saved cloud network draft adds the exact `api.open-meteo.com` destination while preserving existing settings. That draft change was not applied to the running instance during these checks. Retry live access after the relevant runtime configuration changes; a saved allowlist change alone establishes no successful forecast.

Previous preview.2 evidence—52 domain/HTTP checks and 16 browser checks at `14f314293bfd95b04ec732b9308b65cf398f0e1f`—remains historical. Current results, exact source commit, release workflow outcome, downloadable assets, and any live-provider blocker must be reported separately. A ZIP and local browser check do not establish a reachable hosted deployment.
