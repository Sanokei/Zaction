import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, join } from 'node:path';

const dist = resolve('dist');
async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(path));
    else if (entry.name !== 'sw.js' && !entry.name.endsWith('.map')) files.push(path);
  }
  return files.sort();
}
const files = await filesIn(dist);
const digest = createHash('sha256');
for (const file of files) digest.update(await readFile(file));
const version = digest.digest('hex').slice(0, 16);
const assets = files.map(file => '/' + relative(dist, file).replaceAll('\\', '/'));
const worker = `// Zaction app-shell cache ${version}. API requests never enter this cache.
const CACHE = 'zaction-shell-${version}';
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith('zaction-shell-') && name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('message', event => { if (event.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => (await caches.open(CACHE)).match('/index.html')));
  } else if (ASSETS.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(url.pathname)) || fetch(event.request)));
  }
});
`;
await writeFile(join(dist, 'sw.js'), worker);
console.log(`Service worker ${version}: ${assets.length} shell assets precached; API traffic excluded.`);
