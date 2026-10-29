# Hosting and installation

The release ZIP contains `dist/`, `server.mjs`, `package.json`, `LICENSE`, `HOSTING.md`, and `RELEASE.json`. It is a web application distribution; Node.js 24 can serve the app and its demonstration API without installing npm packages.

```bash
node server.mjs
```

Open `http://127.0.0.1:4173`. For a new standalone demo room, set `ZACTION_DATA_FILE` to a new writable filename. The default data path is `.local/demo-room.json`. Stop the server before moving or backing up its data file. Tests use their own temporary files.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4173` | Combined production web/API server port |
| `HOST` | `127.0.0.1` | Bind address; only widen it intentionally |
| `ZACTION_DATA_FILE` | `.local/demo-room.json` | Writable JSON file for the synthetic shared demo room |
| `CHROMIUM_PATH` | System Chromium, then Playwright's managed path | Browser executable for the test runner, not application runtime |

The app expects hosting at the origin root. The Node server supplies the same-origin `/api` routes used for the shared public fixture. Hosting `dist/` alone does not supply that service: the cached interface may load, but new group submissions cannot be accepted without a compatible API. Do not promise shared state from static file hosting alone.

## Public hosting

Place the server behind an HTTPS reverse proxy for browser installation on normal domains. Forward requests for the whole origin, including `/api`, and preserve same-origin request behavior. Configure a writable, backed-up demo data path. If a container or proxy requires an externally reachable bind address, set `HOST` intentionally and apply the hosting platform's network controls.

The server is a public demonstration fixture, not a service for real membership, confidential groups, or production ballots. Anyone who can reach it can choose a synthetic persona and exercise demo controls. Use made-up material only. HTTPS protects transport; it does not make group content end-to-end encrypted.

## Browser installation and offline behavior

Install from the running HTTPS site using the browser's install menu. Safari on iOS uses Share → Add to Home Screen. Downloading the ZIP or double-clicking `index.html` is not browser installation.

After a successful online load, the service worker can serve the cached application shell. Private drafts/progress persist in browser storage when writes succeed. A shared operation saved offline remains pending until the demo server returns an acceptance or rejection. The app must be opened to reconcile work; it does not depend on background sync. Browser storage can be evicted and is not a permanent backup.

No model weights, remote inference endpoint, licensed civic feed, external messaging account, or private key is included in the release. GPU, phone, encryption, and production sync behavior require separate validation.
