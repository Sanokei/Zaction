# GitHub delivery and releases

The human requests regular GitHub pushes and easy downloads from GitHub Releases. Push coherent, verified source changes as implementation progresses. Follow the repository's actual branch protections and review workflow. Confirm the remote commit; a local commit or cloud snapshot does not prove a push.

## Prepare a runnable milestone

1. Update `package.json` and the lockfile together to the intended version. Use a prerelease version such as `0.1.0-preview.2` while this is a demonstration milestone. Do not move the existing preview.1 tag or replace its published downloads.
2. Install from the lockfile, run domain tests, build, and run the production browser flow:

   ```bash
   npm ci
   npm test
   npm run build
   npm run test:e2e
   npm run release:package
   ```

3. Inspect the extracted ZIP through its Node server. Check the actual manifest/assets, service worker, cached reload, and declared offline behavior. Record material limitations. Keep credentials, `.env` files, caches, and `node_modules` out of the archive.
4. Commit and push the verified source. Create and push a `v<package-version>` tag pointing to that exact commit. The tag must match the package version.
5. The release workflow validates the tagged source and uploads `zaction-v<version>-web.zip` and `SHA256SUMS`. Tags containing `-` produce prereleases. Published downloads are not overwritten on a workflow rerun; use a new version for a changed release.

The workflow needs GitHub Actions enabled and its release job's scoped `contents: write` permission. It uses the platform-provided workflow token; no credential belongs in the repository or build output. Environment publication in the cloud setup UI is separate from GitHub release publication.

## Release notes and download contract

Each runnable release identifies the source commit and package version, describes the demonstrated flow, names the actual validation, and states runtime/browser/service dependencies. `RELEASE.json` records build provenance. The ZIP includes concise hosting instructions; users extract it and run `node server.mjs` with Node.js 24, then install from the served site through their browser. Migration instructions must accompany schema changes; the multi-action preview preserves v1 room/browser data and creates a server-file backup rather than resetting the demo.

Call it a ready-to-host PWA web build. It is not a native phone/desktop installer. Document the root-path and HTTPS requirements, the public demo API, the absence of real membership protection, and remaining GPU/phone/inference/encryption gates. Do not describe checksums as publisher signatures or imply that a downloadable artifact establishes those capabilities.

## Manual release fallback

When the exact tagged source has been verified locally, GitHub CLI can attach the same assets if Actions publication is unavailable:

```bash
gh release create v<version> artifacts/zaction-v<version>-web.zip artifacts/SHA256SUMS \
  --repo Sanokei/Zaction --verify-tag --prerelease \
  --title "Zaction v<version>" --notes-file <reviewed-release-notes.md>
```

Replace the placeholders with the actual package version and reviewed notes; use `--prerelease` for preview tags. Confirm the release URL and asset names after creation. Do not publish a documentation-only package as a working app release.
