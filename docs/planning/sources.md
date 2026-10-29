> **Planning baseline, October 29, 2026.** This document records the source-pinned design before implementation. Statements about a documentation-only checkout and unimplemented behavior describe that planning snapshot. See [the current README](../../README.md) for the implemented demo, commands, and current limitations. Example governance remains a labeled demo fixture, not approved production policy.

# Zaction planning source register

Prepared and checked October 29, 2026, America/New_York. References describe observed documentation snapshots; they do not establish installed dependency versions, completed spikes, or validated phone/GPU behavior.

## Specification pin

| Field | Exact value |
|---|---|
| Repository | `Sanokei/Zaction` |
| Local HEAD | `262a06b2e67ca676d30c8f11d92d6fb4a902ac88` |
| Document | `Spec.pdf`, “Civic Hub — Master Design Document” |
| Document date | Working draft, October 27, 2026 |
| PDF SHA-256 | `243bb265e8a5aa80621070a73f858b375149cebdbcbeccf3500a4d12576baa3f` |
| Size / length | 51,938 bytes; 25 PDF pages; printed and PDF page numbers agree |
| Immutable source | [Spec.pdf at the exact commit](https://github.com/Sanokei/Zaction/blob/262a06b2e67ca676d30c8f11d92d6fb4a902ac88/Spec.pdf) |
| Inspected local file | `/workspace/Zaction/Spec.pdf`, extracted using `pdftotext -layout` |
| Agent instructions | No `AGENTS.md` found at `/`, `/workspace`, the checkout root, or recursively within the checkout |

The checkout contains `.gitattributes`, `LICENSE`, `README.md`, and `Spec.pdf`. It contains no application code or manifest at this pin. Git's tracked and untracked status was clean before planning. The PDF is treated as a design specification; its historical anecdotes and performance claims have not been independently validated or reused as proven technical facts.

## Human requirements recorded alongside the spec

The human identifies the product as Zaction, a youth civic action PWA, and wants everyone incentivised to act and vote. Their answer to the incentive-direction question is **“Personal progress and shared group milestones.”** This selects a direction. Exact completion evidence, thresholds, visualization, retention, public attribution, rewards, and any point system remain undecided. They subsequently requested regular GitHub pushes and easy downloads from GitHub Releases; that delivery requirement is now captured in the plan and saved startup guidance.

The continuation authorizes a concrete first-phase plan and a source-pinned screen flow, preserves the onboarding checkout, and leaves environment publication to the human. These planning documents are outside the checkout. No source implementation, model download, live civic outreach, or environment publication was performed. The later GitHub-delivery instruction updates startup guidance only; it does not publish an application release for the current documentation-only checkout.

## Spec traceability

| Topic | PDF reference | Consequence used in the deliverables |
|---|---|---|
| Civic purpose and nonpartisan content | §1 p.2 | Concrete civic actions; no candidate endorsement |
| Official public-election sources | §3.1 p.7; §8 pp.20–21 | Deep links, source/date, no inferred ballot/registration completion |
| Joining and three group layers | §3.3 p.8 | Public demo; local keys; explicit deliberation/broadcast/operations distinction |
| Debate, proposals, and votes | §§3.4–3.5 pp.8–9 | Separate discussion, summary, ballot, and proposal outcome under published rules |
| Transparency and equal voice | §§3.6, 3.8 pp.10–11 | Correctable minutes; no individual rankings or participation-weighted voting |
| Storage, sync, identity, offline | §§4.1–4.6 pp.12–14 | Durable local drafts; explicit pending state; foreground reconciliation |
| Voice and agent gates | §§5–6.1 pp.15–19 | Real-hardware checks; optional downloads; narrow harness; human-controlled publication |
| Threat/metadata handling | §7 pp.19–20 | Public attribution, retention, and aggregate disclosure need decisions |
| Phase 0 / 1 / 2 / 3 | §9 pp.22–23 | Preserve prerequisite spikes; Phase 1 has no money or E2EE promise; later work stays visible |
| Unresolved legal/operational questions | §10 pp.23–24 | Legal home, moderation, funding, and provider choices remain open |

## Technical sources

Official documentation sites for MDN, WebKit, Automerge, libp2p, and Hugging Face returned proxy CONNECT 403 during source research. Official projects' GitHub-hosted documentation was accessible. The references below were successfully read there, at immutable source commits, without changing network policy or the prepared environment draft.

| ID | Primary source and exact pin | Supported finding | Scope limit |
|---|---|---|---|
| PWA-install | [MDN: Making PWAs installable](https://github.com/mdn/content/blob/a0ec5a931fb40d9307d096de83c1d4d10f0d6ea6/files/en-us/web/progressive_web_apps/guides/making_pwas_installable/index.md#L117), `mdn/content@a0ec5a931fb40d9307d096de83c1d4d10f0d6ea6` | Manifest fields/icons and browser-specific installation behavior; iOS Share-menu installation and unsupported programmatic install prompts | Installation requirements do not prove offline operation or behavior on an actual phone |
| PWA-worker | [MDN: Using service workers](https://github.com/mdn/content/blob/a0ec5a931fb40d9307d096de83c1d4d10f0d6ea6/files/en-us/web/api/service_worker_api/using_service_workers/index.md#L19), same source commit | Secure context required; localhost is allowed for development; installation, activation, and cached responses need explicit handling | A worker being registered does not establish a complete offline app or safe updates |
| PWA-storage | [MDN: IndexedDB API](https://github.com/mdn/content/blob/a0ec5a931fb40d9307d096de83c1d4d10f0d6ea6/files/en-us/web/api/indexeddb_api/index.md#L10), same source commit | Asynchronous transactional same-origin client storage; quotas/eviction vary | Local storage is not a guaranteed permanent backup; actual transaction failures need UI handling |
| PWA-sync | [Mozilla browser compatibility data: SyncManager](https://github.com/mdn/browser-compat-data/blob/aed1f62c2a5cf37c42ae934c1a44f172397a0d8d/api/SyncManager.json), `mdn/browser-compat-data@aed1f62c2a5cf37c42ae934c1a44f172397a0d8d` | Safari is marked unsupported; iOS Safari mirrors that entry | Documentation evidence only; design foreground reconnect and test the actual target devices |
| Automerge | [Automerge Repo README](https://github.com/automerge/automerge-repo/blob/3ab7c33bbc628769e101691e0c32ef4f0c220d5c/README.md#L36), `automerge/automerge-repo@3ab7c33bbc628769e101691e0c32ef4f0c220d5c` | Browser IndexedDB storage and separate WebSocket, MessageChannel, and BroadcastChannel network adapters | Does not establish application identity, ballot validity, finality, or success of the required two-browser relay spike |
| libp2p | [libp2p: WebRTC transport documentation](https://github.com/libp2p/docs/blob/17cee4a438797313d1e878b103abc1dbefdf423e/content/concepts/transports/webrtc.md#L104), `libp2p/docs@17cee4a438797313d1e878b103abc1dbefdf423e` | Browser network restrictions; relays for signalling and STUN for address discovery in private-to-private WebRTC | Record and test actual network infrastructure; no promise of infrastructure-free browser sync |
| Inference | [Transformers.js README](https://github.com/huggingface/transformers.js/blob/656d627317100ac9f9bb7aa7952297b71f8c37b5/README.md#L102), `huggingface/transformers.js@656d627317100ac9f9bb7aa7952297b71f8c37b5` | Browser CPU/WASM default; explicit `device: 'webgpu'`; model-dependent dtypes; Qwen3 listed among supported architectures | Candidate runtime only; does not prove the exact Qwen3-0.6B artifact performs live inference on target hardware |
| Encryption | [Signal libsignal README](https://github.com/signalapp/libsignal/blob/904c8dc8216073b078a5f2f5090e3da8382e6a92/README.md#L19) and [published native artifacts](https://github.com/signalapp/libsignal/blob/904c8dc8216073b078a5f2f5090e3da8382e6a92/README.md#L221), `signalapp/libsignal@904c8dc8216073b078a5f2f5090e3da8382e6a92` | External use is explicitly unsupported; TypeScript uses native Node add-on bridges and published native OS libraries | A TypeScript API is not proof of browser compatibility; require a supported, audited integration decision and the spec's 50-member spike; do not invent crypto or infer impossibility |

The proposed voting state machine, acceptance scenarios, and example demo rules are **design recommendations derived from the spec**, not claims that these libraries provide election governance. Framework, package versions, transport, membership credentials, and the close/reconciliation protocol remain implementation decisions.

## Evidence boundaries

| Evidence | Status |
|---|---|
| Actual PDF, exact local commit, PDF checksum, applicable instructions | Inspected in this task |
| Official technical source documents at the commits above | Read during this task; direct-site access limitations noted |
| Cloud Chromium/PWA API/offline-storage environment probe | Passed during earlier onboarding; validates the synthetic probe and tooling |
| Proposed first increment, including app installability and two-browser voting behavior | Planned; not implemented or tested |
| All five spec Phase 0 technical spikes | No executed evidence in this task |
| Real GPU, Android, iOS, exact model exports, production membership/finality | Unverified |
| Civic data/API licensing, provider inquiries, legal/fiscal/relay operation decisions | Unresolved; no outside messages sent |
| Environment draft | Startup guidance updated after the human's GitHub-delivery instruction; other settings retained for human review/publication; not published |

Recheck official documentation, dependency versions, artifacts, and source terms at implementation time. Preserve these pins so reviewers can distinguish the evidence for this plan from future changes.
