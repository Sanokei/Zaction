# Zaction

Small actions. Shared power.

Zaction is a youth civic action PWA for learning, contributing, and making group decisions. This **public demonstration** lets members create their own $0 civic actions and proposals, discuss them, vote, and record outcomes and next steps. A synthetic school-budget reading circle remains as an example. Personal progress and shared milestones encourage participation without rankings or extra voting power.

The [multi-action increment and flow](docs/multi-action-flow.md) describes member authoring, action-scoped state, offline recovery, and migration from the first preview. Its local release candidate passed **52 domain/HTTP checks, the production build, and 16 browser-flow checks**. The [current capture set](docs/screenshots/preview2/README.md) shows desktop and original 390×844 open, pending, rejected, input-recovery, saved-recovery, and rejected-submission restoration states. These are browser viewport checks, not actual-phone validation.

The original [desktop home](docs/screenshots/home-desktop.png), [narrow home](docs/screenshots/home-mobile.png), and [narrow proposal/outcome](docs/screenshots/proposal-mobile.png) captures document preview.1; they remain historical evidence for that release.

## Download and run

Open [GitHub Releases](https://github.com/Sanokei/Zaction/releases) and download the newest `zaction-v…-web.zip` asset and `SHA256SUMS`. Prereleases are labeled as previews. The ZIP contains the built web app and its small Node.js demo server; it needs **Node.js 24** and no runtime package installation.

1. Verify the ZIP against `SHA256SUMS` using your platform's SHA-256 tool.
2. Extract the ZIP and open a terminal in the extracted directory.
3. Run `node server.mjs`.
4. Open `http://127.0.0.1:4173` in your browser.
5. Use the app's install instructions or your browser's install menu. On iOS, use Safari's Share menu → Add to Home Screen.

The ZIP is a ready-to-host **web build**, not a native phone or desktop installer. Opening `index.html` directly is not the supported installation path. Normal deployment needs an HTTPS origin; localhost is suitable for development. The download includes [hosting instructions](docs/hosting.md) and build provenance. Checksums detect download corruption; they are not publisher signatures.

## Try the demo

- Join as one of three explicitly synthetic members: Alex, River, or Jules. Another browser can join the same server as another demo member.
- Open **Create civic action** and draft its title, goal, proposed decision, beneficiaries, tentative time/place, and source label. A source link is optional and must use HTTPS. All member-provided material is public and unverified; the budget stays $0.
- Save or submit an action while offline. A pending creation is not yet published, and voting starts only after server acceptance. Reconnect or retry to receive an acceptance or rejection; the original draft remains available.
- Choose an action, read its source card, and save a private discussion draft. Publish a short question or correction when ready. Each action keeps its own discussion, minutes draft, progress, votes, outcome, and tasks.
- Review that action's proposal and the explicit demo rules, then approve, oppose, or abstain. Reading or posting first is optional; every eligible demo member has equal voting weight in each action.
- Disconnect after the app has loaded: saved material and drafts remain available. Shared submissions stay pending until the server accepts them on reconnect.
- Use the labeled demo closing control to inspect an adopted, not-adopted, or no-quorum result. Review and publish minutes, and track the next tasks separately from the decision.
- Keep a private progress checklist and inspect shared milestones. Participation does not disclose a ballot choice through progress or grant extra influence.

This is a shared, public fixture. Use invented content and no personal or sensitive information. Demo persona selection is not authentication or proof of unique people. The server enforces the published fixture rules; it is not a production distributed-governance system.

## Develop

Use Node.js 24 and the committed lockfile:

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

The combined server uses `127.0.0.1:4173` by default. Its demo-room state is local to that server; private progress and action drafts are local to each browser. Existing preview.1 rooms and saved browser work migrate without resetting them. See [hosting and configuration](docs/hosting.md) for migration backups, data paths, HTTPS, and service dependencies.

## Verify and package

```bash
npm test
npm run build
npm run test:e2e
npm run release:package
```

Browser tests use Chromium. Set `CHROMIUM_PATH` to an installed executable, or install the pinned Playwright browser with `npx playwright-core install --with-deps chromium`. The runner supports the system Chromium path and Playwright's managed executable. It starts an isolated production server and uses temporary room data.

Packaging writes the production ZIP and `SHA256SUMS` under `artifacts/`. It requires a built `dist/` directory. [CI](.github/workflows/ci.yml) runs the build, domain checks, and browser flow. The [release workflow](.github/workflows/release.yml) repeats validation for a matching `v<package-version>` tag before attaching downloads. See [release instructions](docs/releasing.md).

## Scope and limits

The demo implements member action authoring and the manual action → participation → proposal vote → recorded outcome loop, with explicit action targeting throughout. Sources supplied by members are labeled unverified; a group vote does not verify a claim. Official civic links are provided for users to consult directly; opening a link never counts as registration or voting in an official election. Demonstration agendas and people are labeled as synthetic.

Production membership and anti-duplicate-human checks, decentralized voting finality, Automerge/libp2p sync, encrypted operations, on-device Qwen inference, phone validation, voice, donations, and paid logistics are **not established by this demo**. There is no hidden cloud inference or model download. Group content is not end-to-end encrypted. A service worker caches the app shell; server acceptance still requires connectivity, and uncached first visits cannot work offline.

The source specification is [Spec.pdf](Spec.pdf), pinned for the planning baseline at commit `262a06b2e67ca676d30c8f11d92d6fb4a902ac88`, SHA-256 `243bb265e8a5aa80621070a73f858b375149cebdbcbeccf3500a4d12576baa3f`. The [planning archive](docs/planning/implementation-plan.md), [screen flow](docs/planning/screen-flow.md), and [primary-source register](docs/planning/sources.md) preserve the phase boundaries and outstanding feasibility gates.

Licensed under the [MIT License](LICENSE).
