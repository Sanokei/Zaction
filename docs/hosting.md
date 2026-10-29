# Hosting and installation

The release ZIP contains `dist/`, `server.mjs`, `package.json`, `LICENSE`, `HOSTING.md`, and `RELEASE.json`. It is a web application distribution; Node.js 24 can serve the app and its demonstration API without installing npm packages.

```bash
node server.mjs
```

Open `http://127.0.0.1:4173`. For a new standalone demo room, set `ZACTION_DATA_FILE` to a new writable filename. The default data path is `.local/demo-room.json`. Stop the server before moving or backing up its data file. Tests use their own temporary files. The file-backed room is single-process: do not run multiple server instances against the same data file.

## Upgrading from preview.1

The multi-action schema migrates a preview.1 server room automatically on startup. It retains the room ID, the original reading-circle action's contributions, ballots, outcome, minutes, tasks and closing time, and the complete operation/receipt history. Legacy operations and receipts are assigned to `reading-circle` so an old retry does not become an operation against another action.

Before writing the migrated room, the server creates an exclusive backup at `${ZACTION_DATA_FILE}.v1-backup.json` (for the default path, `.local/demo-room.json.v1-backup.json`). It does not overwrite a backup. A different existing backup blocks startup for operator review rather than discarding data. Keep the backup and the current room file when moving an existing room.

Browser storage also migrates the original saved state: the original action's drafts/progress, queued operations, receipts, and local identity are retained, with a legacy-state backup. Previously queued work stays targeted to `reading-circle`; it is not silently applied to a newly selected action. A pending action creation remains unaccepted until the server returns its receipt. No migration resets the room or replaces user input with an empty demo.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4173` | Combined production web/API server port |
| `HOST` | `127.0.0.1` | Bind address; only widen it intentionally |
| `ZACTION_DATA_FILE` | `.local/demo-room.json` | Writable JSON file for the synthetic shared demo room |
| `CHROMIUM_PATH` | System Chromium, then Playwright's managed path | Browser executable for the test runner, not application runtime |

The app expects hosting at the origin root. The Node server supplies the same-origin `/api` routes used for the shared public fixture. Hosting `dist/` alone does not supply that service: the cached interface may load, but new group submissions cannot be accepted without a compatible API. Do not promise shared state from static file hosting alone.

## Public hosting

Place the server behind an HTTPS reverse proxy for browser installation on normal domains. Forward requests for the whole origin, including `/api`, and preserve the original `Host` header: the demo server compares the request `Origin` with `Host` for same-origin write checks. Configure a writable, backed-up demo data path. If a container or proxy requires an externally reachable bind address, set `HOST` intentionally and apply the hosting platform's network controls.

The server is a public demonstration fixture, not a service for real membership, confidential groups, or production ballots. Anyone who can reach it can choose a synthetic persona and exercise demo controls. Use made-up material only. HTTPS protects transport; it does not make group content end-to-end encrypted.

## Browser installation and offline behavior

Install from the running HTTPS site using the browser's install menu. Safari on iOS uses Share → Add to Home Screen. Downloading the ZIP or double-clicking `index.html` is not browser installation.

After a successful online load, the service worker can serve the cached application shell. Private drafts/progress persist in browser storage when writes succeed. A shared operation saved offline remains pending until the demo server returns an acceptance or rejection. The app must be opened to reconcile work; it does not depend on background sync. Browser storage can be evicted and is not a permanent backup.

No model weights, remote inference endpoint, licensed civic feed, external messaging account, or private key is included in the release. GPU, phone, encryption, and production sync behavior require separate validation.
