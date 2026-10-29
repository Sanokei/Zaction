# Zaction

Small actions. Shared power.

Zaction is a youth civic action PWA for finding your people and making useful things happen together. This **public community preview** brings local plans into a social feed: a neighborhood BBQ, a potluck, games, a walk, practical help, or a civic idea. Create a public pseudonym, find a small way to join in, and turn a conversation into a plan. Personal progress and shared milestones encourage participation without rankings or extra voting power.

The [social and planning increment](docs/social-planning-increment.md) explains onboarding, the social design, practical event planning, and the preserved voting/privacy boundaries. Templates and their original illustrations are starting points, not fabricated events or attendance. The [frontend design review](docs/frontend-design-review.md) records the applied upstream skill, park palette, typography, and mobile critique. Bricolage Grotesque is bundled locally with its [OFL license](public/fonts/Bricolage-Grotesque-OFL.txt), so the interface needs no font CDN.

The [plan changes and withdrawal increment](docs/plan-lifecycle-increment.md) lets an author explain changed terms or cancel their listing while keeping its original proposal, group outcome, and participation history. Accepted changes create a linked fresh proposal; votes, RSVPs, offers, and pending work never transfer silently. A cancelled plan stays cancelled even if its author explicitly plans again under a new ID. Local source validation passed **151 Node checks** (129 domain, 12 HTTP, 10 weather fixtures), the final production build, and **26 browser flows** (19 existing plus 7 lifecycle flows). The [10 original QA captures](docs/screenshots/preview5/README.md) show changed, pending, superseded, cancelled, rejected, stale, restart, and recovery states in exact narrow and desktop viewports. Extracted-package and tagged-release validation remain separate until actually completed.

The [Bring & share increment](docs/bring-items-increment.md) lets members offer listed items and release their own accepted offers. Each entry has one accepted owner; pending claims do not reserve it and pending releases do not free it. Preview.4 source `3501ce55e9f5f9bb0fed898c27a8ab94511efcfa` passed **118 Node checks** (99 domain, 9 HTTP, 10 weather fixtures), the production build, and **19 browser flows** (14 existing plus 5 bring-item flows). Its [original QA captures](docs/screenshots/preview4/README.md) are historical evidence for that source, not validation of the new plan-change flow.

Preview.3 source `f47aa1bf1d0f3dc099f27741f25f63e6e33ac8ca` passed a frozen install, **81 Node checks** (65 domain, 6 HTTP, 10 weather fixtures), the production build, and **14 social browser flows**. Its [11 QA captures](docs/screenshots/preview3/README.md) are historical evidence for that source, not validation of Bring & share. Forecast fixtures are explicitly labeled tests; the separate unmocked cloud request observed unavailable. See the [preview.3 validation record](docs/social-planning-increment.md#local-validation-and-provider-observation).

The [multi-action increment](docs/multi-action-flow.md) and [preview.2 capture set](docs/screenshots/preview2/README.md) are historical evidence for source `14f314293bfd95b04ec732b9308b65cf398f0e1f`: 52 domain/HTTP checks, the production build, and 16 browser-flow checks. Those counts do not claim validation of the new social preview.

The original [desktop home](docs/screenshots/home-desktop.png), [narrow home](docs/screenshots/home-mobile.png), and [narrow proposal/outcome](docs/screenshots/proposal-mobile.png) captures document preview.1; they remain historical evidence for that release.

## Download and run

Open [GitHub Releases](https://github.com/Sanokei/Zaction/releases) and download the newest `zaction-v…-web.zip` asset and `SHA256SUMS`. Prereleases are labeled as previews. The ZIP contains the built web app and its small Node.js server; it needs **Node.js 24.5+** and no runtime package installation.

1. Verify the ZIP against `SHA256SUMS` using your platform's SHA-256 tool.
2. Extract the ZIP and open a terminal in the extracted directory.
3. Run `node --use-env-proxy server.mjs`.
4. Open `http://127.0.0.1:4173` in your browser.
5. Use the app's install instructions or your browser's install menu. On iOS, use Safari's Share menu → Add to Home Screen.

The ZIP is a ready-to-host **web build**, not a native phone or desktop installer. Opening `index.html` directly is not the supported installation path. Normal deployment needs an HTTPS origin; localhost is suitable for development. The download includes [hosting instructions](docs/hosting.md) and build provenance. Checksums detect download corruption; they are not publisher signatures.

## Try the community preview

- Choose a public pseudonym and a coarse city, then pick interests for your own feed preferences. Your pseudonym and city are public; interests stay on this device. No phone number or email is required.
- Explore the community feed or start with an illustrated BBQ, potluck, games, walk, help, or idea template. Publish only when your plan is ready; suggestions are not existing events.
- Add the goal, proposed decision, beneficiaries, tentative time/place, and source label. Optional source links must use HTTPS. Member-provided content is public and unverified.
- Plan an estimated total cost and guest count to see an estimated amount per person. This is planning information, not payment, donation collection, an approved expense, or a booking.
- For an outdoor plan, request a forecast for a supported city/date. Weather comes from Open-Meteo when available; stale, unavailable, and out-of-range states never invent a forecast. See [weather behavior and validation](docs/social-planning-increment.md#weather-and-estimates).
- Comment or reply, mark interest, privately save a plan, or choose going/maybe. These social signals and RSVPs are separate from a proposal ballot and do not authorize spending or guarantee attendance.
- In a plan's **Bring & share** list, offer an available item or release your own accepted offer. Your public nickname and item intention are visible. Identical item labels are separate entries; only one member can own each entry. Offline changes stay pending with the confirmed owner still shown. If another offer wins first, review the conflict and current availability before deliberately retrying.
- As a plan's author, prepare changes in a separate private draft, give a reason, and review the old/new terms before sharing a linked fresh proposal. The original stays active until acceptance. Other members make their own new participation choices; nothing is copied over as consent.
- To withdraw a gathering listing, explicitly confirm cancellation and its reason. Its prior group decision and records remain visible; Zaction does not notify people or cancel outside arrangements automatically. **Plan again** creates a separate linked plan rather than reactivating the cancelled ID. You can still release your exact accepted bring-item offer on the original inactive plan.
- Save drafts and submissions offline. A pending creation is not yet published, and voting starts only after server acceptance. Reconnect or retry to receive an acceptance or rejection; the original draft remains available.
- Review a plan's proposal and its explicit preview rules, then approve, oppose, or abstain. Every eligible profile has equal voting weight; reading, posting, popularity, RSVPs, or progress do not add votes.
- Disconnect after the app has loaded: saved material and drafts remain available. Shared submissions stay pending until the server accepts them on reconnect.
- Use the labeled demo closing control to inspect an adopted, not-adopted, or no-quorum result. Review and publish minutes, and track the next tasks separately from the decision.
- Keep a private progress checklist and inspect shared milestones. Participation does not disclose a ballot choice through progress or grant extra influence.

This is a public preview. Profiles and member posts are public and unverified. A private browser session authorizes activity as your pseudonym; it is not proof of a unique person or a guarantee of anonymity. The old Alex/River/Jules identities remain explicitly synthetic compatibility tools, not the default onboarding. Production membership and distributed-governance guarantees remain outside this preview.

## Develop

Use Node.js 24.5+ and the committed lockfile:

```bash
npm ci
npm run dev:relay
```

In a second terminal:

```bash
npm run dev
```

The Vite development server uses port 5173 and proxies `/api` to the demo server on port 4174. For a production build and the combined web/API server:

```bash
npm run build
npm start
```

The combined server uses `127.0.0.1:4173` by default. Shared room state is local to that server; private interests, saves, progress, and drafts are local to each browser. Session credentials stay in private storage and never enter public snapshots or release downloads. Existing rooms and saved browser work migrate additively without resetting them. See [hosting and configuration](docs/hosting.md) for migration backups, session-data handling, HTTPS, and service dependencies.

## Verify and package

```bash
npm test
npm run build
npm run test:e2e
npm run release:package
```

Browser tests use Chromium. Set `CHROMIUM_PATH` to an installed executable, or install the pinned Playwright browser with `npx playwright-core install --with-deps chromium`. The runner supports the system Chromium path and Playwright's managed executable. It starts an isolated production server and uses temporary room data.

In a source checkout, `npm run check:weather` performs the independent live-provider smoke check with Node's environment-proxy support. The actual cloud check returned unavailable with exit 1; the underlying provider request was blocked by proxy CONNECT 403. CI and release workflows observe this separately as a nonblocking step with an explicit notice or warning. A green workflow does not mean weather passed; controlled-response tests and screenshots do not establish live provider access.

Packaging writes the production ZIP and `SHA256SUMS` under `artifacts/`. It requires a built `dist/` directory. [CI](.github/workflows/ci.yml) runs the build, domain checks, and browser flow. The [release workflow](.github/workflows/release.yml) repeats validation for a matching `v<package-version>` tag before attaching downloads. See [release instructions](docs/releasing.md).

## Scope and limits

The preview implements social participation, public bring-item intentions, and author-managed listing changes around member-authored plans, plus the separate action → participation → proposal vote → recorded outcome loop. Listing status is separate from the group decision: cancellation or supersession preserves the original result and history. The exact author/session and current lifecycle token govern changes; stale or unauthorized requests are rejected instead of rewriting newer state. Pending work retains its original target and is never redirected to a successor. A late item release cannot remove a newer accepted claim. Item offers do not change ballots, RSVPs, private progress, or task completion, and do not prove attendance or delivery. Sources supplied by members are labeled unverified; a link, reaction, RSVP, or group vote does not verify a claim. Official civic links are provided for users to consult directly; opening a link never counts as registration or voting in an official election. The retained demonstration agenda and legacy people are labeled synthetic.

Production membership and anti-duplicate-human checks, decentralized voting finality, Automerge/libp2p sync, encrypted operations, on-device Qwen inference, phone validation, voice, payments, donations, and paid logistics are **not established by this preview**. There is no hidden cloud inference or model download. Group content is not end-to-end encrypted. A service worker caches the app shell; server acceptance still requires connectivity, and uncached first visits cannot work offline. Downloadable releases do not establish a reachable hosted deployment.

The source specification is [Spec.pdf](Spec.pdf), pinned for the planning baseline at commit `262a06b2e67ca676d30c8f11d92d6fb4a902ac88`, SHA-256 `243bb265e8a5aa80621070a73f858b375149cebdbcbeccf3500a4d12576baa3f`. The [planning archive](docs/planning/implementation-plan.md), [screen flow](docs/planning/screen-flow.md), and [primary-source register](docs/planning/sources.md) preserve the phase boundaries and outstanding feasibility gates.

Licensed under the [MIT License](LICENSE).
