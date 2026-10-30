# Hosting and installation

The release ZIP contains `dist/`, `server.mjs`, its `weather.mjs` provider adapter, the shared `civic-sources.mjs` catalog, `package.json`, `LICENSE`, `HOSTING.md`, and `RELEASE.json`. It is a web application distribution; Node.js 24.5+ can serve the app and its public preview API without installing npm packages. The production assets include self-hosted Bricolage Grotesque WOFF2 files and `dist/fonts/Bricolage-Grotesque-OFL.txt`; no font CDN is required.

```bash
node --use-env-proxy server.mjs
```

Open `http://127.0.0.1:4173`. For a new standalone demo room, set `ZACTION_DATA_FILE` to a new writable filename. The default data path is `.local/demo-room.json`. Stop the server before moving or backing up its data file. Tests use their own temporary files. The file-backed room is single-process: do not run multiple server instances against the same data file.

## Upgrading from preview.1

The multi-action schema migrates a preview.1 server room automatically on startup. It retains the room ID, the original reading-circle action's contributions, ballots, outcome, minutes, tasks and closing time, and the complete operation/receipt history. Legacy operations and receipts are assigned to `reading-circle` so an old retry does not become an operation against another action.

Before writing the migrated room, the server creates an exclusive backup at `${ZACTION_DATA_FILE}.v1-backup.json` (for the default path, `.local/demo-room.json.v1-backup.json`). It does not overwrite a backup. A different existing backup blocks startup for operator review rather than discarding data. Keep the backup and the current room file when moving an existing room.

Browser storage also migrates the original saved state: the original action's drafts/progress, queued operations, receipts, and local identity are retained, with a legacy-state backup. Previously queued work stays targeted to `reading-circle`; it is not silently applied to a newly selected action. A pending action creation remains unaccepted until the server returns its receipt. No migration resets the room or replaces user input with an empty demo.

## Upgrading the multi-action room to the social preview

The social preview keeps schema version 2 and adds profiles/social metadata without replacing the room. Existing actions, unknown metadata, room IDs, receipt histories, pending action targets, ballots, notes, and browser drafts remain intact. Legacy Alex/River/Jules fixture records are retained. New profile onboarding does not grant their historical ballots to a new profile or reset old decisions.

The existing room JSON file now also contains a private map of session-token hashes to profile IDs. Treat the room file and its backups as private server data; keep them outside `dist/`, static public roots, source archives, and release ZIPs. The server does not include that private map in public snapshots. Raw session credentials are issued only to the joining browser and stored in its private IndexedDB record, not public state or pending-operation history.

New public profiles have pseudonyms and coarse city IDs; interests and private saves stay on the device. The server checks a profile's session for owned writes, but this does not establish a unique human, protect against all abuse, or provide account recovery. The intentionally tokenless legacy identities remain explicit compatibility tools rather than onboarding defaults.

## Bring-item intentions and upgrade preservation

Bring & share adds an optional `bringClaims` collection to each action within schema version 2. Existing actions without that collection are treated as having no accepted item offers; existing records, private sessions, ballots, RSVPs, notes, and room IDs are preserved. A malformed stored collection is an error to review, not permission to reset the room or replace saved data.

Each immutable published `planning.bring` entry is a distinct slot identified by action ID and its original item index. Duplicate labels are separate slots. A single member may offer several items, but each slot has only one accepted owner. This increment provides no editing/reordering, quantities, shared ownership, payment, or automatic assignment; do not reorder published entries in the backing file as a workaround.

The server serializes claims. A release must match the acting owner and the exact currently accepted claim ID, so a delayed offline release cannot remove a later reclaim. Stable retries return the original receipt. Pending claims do not reserve an item, pending releases do not free it, and the recorded owner remains visible until acceptance. A conflict is a rejected receipt: the member reviews current availability before a deliberate new attempt.

The public nickname and item intention are visible to the room. Accepted offers do not change voting weight, ballots, going/maybe RSVPs, private progress, task completion, or verified attendance/delivery. They are statements of intent; no notification, purchase, or booking is performed.

## Help discovery and return

Feed availability and **My help** reuse the existing item/task slots, accepted claims, pending operations, and receipts. There is no backend, schema, or confirmation-state migration, and no second ledger to move or back up. The return view is scoped to the selected profile and room; it links to the exact original plan and numbered slot, including cancelled/superseded history. A successor does not inherit an offer.

Cached availability is provisional until synchronization. Pending offers do not reserve a slot, pending withdrawals do not free it, and rejected attempts stay distinct from shared offers. A withdrawal still requires the exact current claim on its original plan. Public nicknames and item/task intentions are visible; server acceptance is not organizer confirmation, readiness, attendance, delivery, or completion. These views add no vote/RSVP/progress effects, shift/hour tracking, notifications, or new assignment power.

## Author changes, cancellation, and preserved history

Plan lifecycle metadata is additive within schema version 2. Missing legacy lifecycle metadata defaults to active; malformed existing metadata is an error rather than permission to reset records. Listing status (`active`, `superseded`, or `cancelled`) is separate from the proposal's `outcome`. An adopted group decision can therefore remain adopted in history after its author withdraws the listing. Inactive listings do not manufacture a later decision just because an old deadline passes.

An author change requires the original author's session, the exact expected lifecycle token, a short reason, and a validated fresh replacement ID and plan. The server atomically links the old and new records and marks the old listing superseded. Only editable plan fields are copied: the fresh proposal starts with no inherited ballots, RSVPs, reactions, comments, bring claims, minutes, tasks, or private progress. Private saves and pending operations are not retargeted. Original terms and participation remain accessible as history.

Cancellation similarly requires the author, current lifecycle token, and explicit reason. It withdraws the Zaction listing; it does not erase votes, rewrite an adopted decision, notify participants, send outside messages, or cancel venue/vendor arrangements. **Plan again** creates an explicitly reviewed fresh linked proposal. The old cancelled ID stays cancelled, with its reason and records intact; each old listing has at most one immediate successor.

Offline author drafts and operations retain their original target, lifecycle token, reason, and stable operation ID. While pending, the public original stays unchanged. A race or stale token produces a concrete rejection; a new attempt requires deliberate review rather than automatic rebasing. Stable-ID replay cannot create a duplicate successor.

Superseded/cancelled plans reject new participation against their original IDs instead of silently moving it to the successor. The exact owner may still release the exact current bring-item claim on that original inactive plan. A release does not move the offer to a fresh plan or establish delivery. These controls use existing pseudonymous preview ownership, not new production authentication, group authority, notifications, payment, or location tracking.

## Comment acknowledgement and local receipt metadata

Comment status derives from the exact existing room/profile/action/reply target, submitted text, operation ID and receipt. A posted acknowledgement also requires the same-ID accepted contribution; identical wording on another post is not proof of acceptance. Matching pending/posted requests are guarded in the atomic browser enqueue, while different text or reply targets remain editable. Late receipts never automatically clear a composer.

A deliberate **Start another comment** clears only a freshly matched raw durable discussion draft and its matching reply target after the accepted operation/receipt/contribution and absence of a matching pending request are checked. Changed text/targets, unavailable records and save failures leave work intact. The UI additionally checks its captured editor version before clearing or moving focus, so typing during the durable reset wins. Missing reply targets require explicit recovery, not silent root posting. Other action drafts, minutes and original submission history are preserved.

The only local shape extension is optional private `composerReset: true` on an existing local receipt wrapper. It records a successfully handled deliberate reset so retyping identical words after reload is a new intent. It is not a new ledger, collection, schema version, server receipt/operation field, migration or backfill. Missing markers remain missing; stable replay preserves locally owned markers and never trusts a marker supplied remotely. Original operation text and receipt ID/reason/time/acceptance remain unchanged. Existing private browser data and sessions remain outside release ZIPs. This increment changes no server protocol, source catalog, vote, RSVP, progress or external messaging behavior.

## Discussion and gathering wording

Lifecycle wording follows the explicit original record: `planning.kind: idea` is a discussion, other known kinds are gatherings, and absent/unknown kinds use neutral plan/listing language. A source citation, title, route, or default empty form cannot reclassify a saved record. Pending creation/change descriptions use their exact payload; withdrawal and historical descriptions use the immutable original target. An explicitly different successor type never relabels its original.

This is a presentation correction: no schema, migration, server protocol, ledger, lifecycle token, operation ID, or stored text is changed. Existing ballots, bring offers, RSVPs and source references remain intact; discussion wording does not hide planning fields or item/task intentions. Withdrawing a discussion affects only its Zaction listing, preserves the group result/history, and sends no notification or cancellation to an outside organization. The `civic-sources.mjs` runtime and dated source observations remain unchanged.

## Dated Learn & serve sources

Keep `civic-sources.mjs` beside `server.mjs` in the extracted runtime: the server imports it, and the client bundles the same append-only curated catalog. This release adds one NYC Mesh outreach/design note for New York City. NYC Mesh is a community-network organization, not government or an election authority. The exact publisher-maintained [guide snapshot](https://github.com/nycmeshnet/nycmesh.net/blob/d53de89ba20682d348cc0d4271e64e9875985dcf/content/volunteer/index.md) returned HTTP 200 at `2026-10-29T23:12:57.514461Z`, body SHA-256 `6760307447a464cf5e6aa4f9b0d9ae82fdf72c5fd99bed2733fa83e8cea10403`. The separate canonical website check at `2026-10-29T23:13:25.939411Z` failed with proxy CONNECT 403; a successful source-snapshot read does not establish live-site access. See the [source and scope record](learn-serve-increment.md).

The optional `sourceRef` is the exact `{opportunityId, snapshotId}` pair. New publications must resolve a known snapshot. Existing records without it remain unchanged; well-shaped unknown references are preserved and shown as unavailable rather than replaced with the newest entry. Malformed incoming/stored references fail validation while existing work is retained. Published snapshots must remain append-only so older plans, queued operations, rejected receipts, successors, and original history retain their exact meaning. No room reset or schema-version migration is required.

The saved note works with the loaded offline app; it is a summary, not an offline copy of the organization’s website. Older/offline labels use the publisher’s New York calendar and do not claim a legal expiry. Page opens, sync, reconnect, and external clicks never advance the recorded review date. There is no live-source checker, organization submission, signup, eligibility/placement guarantee, or automatic progress. Starting a question uses the existing private composer, preserves unrelated unfinished work, and still requires the member’s review/publication. Community questions and corrections remain public, unverified member content; votes and practical offers stay separate.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4173` | Combined production web/API server port |
| `HOST` | `127.0.0.1` | Bind address; only widen it intentionally |
| `ZACTION_DATA_FILE` | `.local/demo-room.json` | Private writable JSON for shared preview records and session-token hashes |
| `CHROMIUM_PATH` | System Chromium, then Playwright's managed path | Browser executable for the test runner, not application runtime |

The app expects hosting at the origin root. The Node server supplies the same-origin `/api` routes used for profiles, shared plans, and weather lookup. Hosting `dist/` alone does not supply those services: the cached interface may load, but new public profiles/submissions cannot be accepted and a forecast cannot be fetched without a compatible API. Do not promise shared state from static file hosting alone.

## Weather network access

Forecast lookup requires outbound HTTPS access to `api.open-meteo.com`. The provider receives a selected public city centroid and timezone, not a home address or GPS location. Keep TLS verification enabled and display provider attribution. The supported window is the selected city's today through 15 days ahead; failed requests show unavailable or clearly stale data instead of an invented forecast.

Plan dates are civil dates, displayed with the year independently of the viewer's timezone. `timeHint` is optional raw text: blank/whitespace means **Time to be agreed**, and notes such as “Late afternoon” or “7 pm Pacific” are preserved without parsing or conversion. The selected city's IANA reference zone is shown separately; it does not assign that zone to an arbitrary note or create an unprovided event instant.

Weather is a daily city outlook, not the free-text venue or meetup hour. Daily maximum precipitation chance summarizes hourly probabilities and is not a forecast for the event's hour. Client responses must match the requested city/date, including unavailable payloads; changed queries synchronously leave the old display scope, and delayed responses cannot overwrite a newer query. Invalid/mismatched payloads produce honest unavailable guidance for the requested query.

The backend's city/day cache and 30-minute duration are unchanged. A cache hit retains its original `checkedAt`; a failed refresh can expose only that same query's explicitly stale data. Invalid or out-of-range dates return unavailable before provider access or cache fallback. Same-city/day weather can be reused across linked plans with that original timestamp, but it carries no attendance, consent, or readiness state. In-place offline views label retained data as cached/uncertain; API responses remain outside the service-worker cache, and no persistent weather store is added. Offline reload therefore has no saved forecast metrics. Retry/reconnect checks the current query rather than resurrecting a different date or location.

Use `npm run check:weather` in a source checkout for a separate live-provider smoke check. A proxy CONNECT 403 during cloud implementation was a network blocker, not a passing weather check. Deterministic integration tests do not establish live provider access. No weather API credential is embedded in the application or needed for the documented free noncommercial endpoint; review current provider terms for your deployment.

The start/dev-server and weather-check scripts enable Node's environment-proxy support with `--use-env-proxy`, requiring Node.js 24.5+. This preserves HTTPS verification. The current recorded cloud probe on October 29, 2026 at **5:49:48 PM EDT** requested `new-york` / `2026-10-30` and exited **1**, unavailable, without `checkedAt` or measurements. Its observation time is not a forecast timestamp. Earlier preview.6 main/release notices verified real provider checks for that prior source; they do not establish current cloud access. The schedule/weather quality increment changes no provider provisioning or network-setting application. Saved environment requirements are not proof of runtime connectivity.

CI and release workflows make a separate nonblocking live-provider observation with a notice or warning. Inspect that step's actual result: overall workflow success and fixture/domain/HTTP checks do not imply provider success.

## Public hosting

Place the server behind an HTTPS reverse proxy for browser installation on normal domains. Forward requests for the whole origin, including `/api`, and preserve the original `Host` header: the demo server compares the request `Origin` with `Host` for same-origin write checks. Configure a writable, backed-up demo data path. If a container or proxy requires an externally reachable bind address, set `HOST` intentionally and apply the hosting platform's network controls.

The server is a public community preview, not a service for confidential groups or production ballots. Public pseudonyms and member posts are unverified, and anybody who can reach onboarding can create another profile. Session ownership is not anti-Sybil proof. HTTPS protects transport; it does not make group content end-to-end encrypted. Going/maybe and interest counts are separate from proposal ballots; planning estimates do not collect payments or confirm bookings.

## Browser installation and offline behavior

Install from the running HTTPS site using the browser's install menu. Safari on iOS uses Share → Add to Home Screen. Downloading the ZIP or double-clicking `index.html` is not browser installation.

After a successful online load, the service worker can serve the cached application shell. Private drafts/progress persist in browser storage when writes succeed. A shared operation saved offline remains pending until the demo server returns an acceptance or rejection. The app must be opened to reconcile work; it does not depend on background sync. Browser storage can be evicted and is not a permanent backup.

No model weights, remote inference endpoint, licensed civic feed, external messaging account, or private key is included in the release. GPU, phone, encryption, and production sync behavior require separate validation.
