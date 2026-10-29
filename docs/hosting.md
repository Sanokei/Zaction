# Hosting and installation

The release ZIP contains `dist/`, `server.mjs`, its `weather.mjs` provider adapter, `package.json`, `LICENSE`, `HOSTING.md`, and `RELEASE.json`. It is a web application distribution; Node.js 24.5+ can serve the app and its public preview API without installing npm packages. The production assets include self-hosted Bricolage Grotesque WOFF2 files and `dist/fonts/Bricolage-Grotesque-OFL.txt`; no font CDN is required.

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

The server serializes claims. A release must match the acting owner and the exact currently accepted claim ID, so a delayed offline release cannot remove a later reclaim. Stable retries return the original receipt. Pending claims do not reserve an item, pending releases do not free it, and the confirmed owner remains visible until acceptance. A conflict is a rejected receipt: the member reviews current availability before a deliberate new attempt.

The public nickname and item intention are visible to the room. Accepted offers do not change voting weight, ballots, going/maybe RSVPs, private progress, task completion, or verified attendance/delivery. They are statements of intent; no notification, purchase, or booking is performed.

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

Use `npm run check:weather` in a source checkout for a separate live-provider smoke check. A proxy CONNECT 403 during cloud implementation was a network blocker, not a passing weather check. Deterministic integration tests do not establish live provider access. No weather API credential is embedded in the application or needed for the documented free noncommercial endpoint; review current provider terms for your deployment.

The start/dev-server and weather-check scripts enable Node's environment-proxy support with `--use-env-proxy`, requiring Node.js 24.5+. This preserves HTTPS verification. The actual cloud smoke check exited 1 with an unavailable result; an unmocked browser request also observed unavailable. The environment draft adds `api.open-meteo.com` to its preserved network requirements, but that saved change was not yet applied to the running instance. Retry after the relevant runtime configuration changes; saving a requirement alone is not a passing provider check.

CI and release workflows make a separate nonblocking live-provider observation with a notice or warning. Inspect that step's actual result: overall workflow success and fixture/domain/HTTP checks do not imply provider success.

## Public hosting

Place the server behind an HTTPS reverse proxy for browser installation on normal domains. Forward requests for the whole origin, including `/api`, and preserve the original `Host` header: the demo server compares the request `Origin` with `Host` for same-origin write checks. Configure a writable, backed-up demo data path. If a container or proxy requires an externally reachable bind address, set `HOST` intentionally and apply the hosting platform's network controls.

The server is a public community preview, not a service for confidential groups or production ballots. Public pseudonyms and member posts are unverified, and anybody who can reach onboarding can create another profile. Session ownership is not anti-Sybil proof. HTTPS protects transport; it does not make group content end-to-end encrypted. Going/maybe and interest counts are separate from proposal ballots; planning estimates do not collect payments or confirm bookings.

## Browser installation and offline behavior

Install from the running HTTPS site using the browser's install menu. Safari on iOS uses Share → Add to Home Screen. Downloading the ZIP or double-clicking `index.html` is not browser installation.

After a successful online load, the service worker can serve the cached application shell. Private drafts/progress persist in browser storage when writes succeed. A shared operation saved offline remains pending until the demo server returns an acceptance or rejection. The app must be opened to reconcile work; it does not depend on background sync. Browser storage can be evicted and is not a permanent backup.

No model weights, remote inference endpoint, licensed civic feed, external messaging account, or private key is included in the release. GPU, phone, encryption, and production sync behavior require separate validation.
