import { mkdir, readFile, writeFile, cp, rm, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const metadata = JSON.parse(await readFile('package.json', 'utf8'));
await readFile('dist/sw.js');
const output = resolve('artifacts');
await mkdir(output, { recursive: true });
const name = `zaction-v${metadata.version}-web.zip`;
const zipPath = join(output, name);
const staging = await mkdtemp(join(tmpdir(), 'zaction-release-'));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
const lockfileSha256 = createHash('sha256').update(await readFile('package-lock.json')).digest('hex');
try {
  await cp('dist', join(staging, 'dist'), { recursive: true });
  for (const file of ['server.mjs', 'package.json', 'LICENSE']) await cp(file, join(staging, file));
  await writeFile(join(staging, 'RELEASE.json'), JSON.stringify({ name: 'Zaction', version: metadata.version, sourceCommit: commit, dirtySource: dirty, builtAt: new Date().toISOString(), node: process.version, lockfileSha256, mode: 'public-demo', validation: 'See the GitHub release notes for actual checks; downloadability is not hardware validation.' }, null, 2));
  await writeFile(join(staging, 'HOSTING.md'), `# Zaction ${metadata.version} public demo\n\nThis is a ready-to-host web build with a local public-demo room, not a native installer.\n\n1. Install Node.js 24 or newer.\n2. Extract this ZIP and run \`node server.mjs\` from the extracted folder. No npm install is required.\n3. Open the served site on port 4173 in your browser. For local development, localhost is a secure context. For other devices or a public deployment, put the site behind HTTPS and a reverse proxy.\n4. Use your browser's install action. On iOS Safari, use Share, then Add to Home Screen. Opening index.html directly is unsupported.\n\nThe server binds 127.0.0.1 by default. PORT and HOST can be configured. The app must be hosted at the origin root, not a subdirectory.\n\nThe server stores synthetic demo activity in .local/demo-room.json; set ZACTION_DATA_FILE to choose another durable location. Back up that file to preserve a room. Different fresh stores have different room IDs, so queued work from an old room is rejected rather than applied to a new room.\n\nThis public demo allows selecting synthetic memberships Alex, River, and Jules. It is not authenticated production governance. Do not enter private information. All shared contributions, ballots, and decision notes are public within the room. The app has no private messaging or end-to-end encryption. HTTPS protects transport only.\n\nOffline: the app shell and saved local drafts work after the first successful online visit. Offline submissions remain pending until the demo server accepts them; deadlines and current rules apply on receipt. A first visit with no network cannot load an uncached app. Foreground reconnect and retry reconcile pending work. Browser storage may be cleared or evicted.\n\nNo model weights, external relay service, civic-data API, payment service, or native binaries are bundled. No GPU, actual-phone, inference, encryption, or live civic-data behavior is implied. Public-election links are external sources, not registration/vote verification.\n\nVerify SHA256SUMS against the ZIP. Checksums detect corruption; they are not publisher signatures.\n`);
  await rm(zipPath, { force: true });
  const result = spawnSync('zip', ['-q', '-r', zipPath, '.'], { cwd: staging, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Release ZIP creation failed. Install the zip command.');
  const hash = createHash('sha256').update(await readFile(zipPath)).digest('hex');
  await writeFile(join(output, 'SHA256SUMS'), `${hash}  ${name}\n`);
  console.log(`Created ${zipPath}\nSHA256 ${hash}\nSource ${commit}${dirty ? ' (working tree has uncommitted changes; rebuild after committing before publication)' : ''}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
