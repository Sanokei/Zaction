import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MEMBERS = new Set(['alex', 'river', 'jules']);
const TYPES = new Set(['contribute', 'vote', 'close', 'minutes', 'complete-task']);
const TASKS = new Set(['accessibility', 'agenda', 'minutes']);
const timestamp = now => new Date(now).toISOString();
const clone = value => structuredClone(value);
const canonical = op => JSON.stringify(Object.fromEntries(Object.keys(op).sort().map(key => [key, op[key]])));

export function createDemoState(now = Date.now()) {
  return {
    schemaVersion: 1,
    roomId: randomUUID(),
    proposalRevision: 1,
    rulesVersion: 'DEMO-RULES-v1',
    membershipVersion: 'DEMO-MEMBERS-v1',
    closesAt: timestamp(Number(new Date(now)) + 7 * 24 * 60 * 60 * 1000),
    contributions: [], ballots: [], outcome: 'open', closedAt: null, minutes: [], completedTasks: [],
  };
}

export function createDemoData(now = Date.now()) {
  return { snapshot: createDemoState(now), receipts: {} };
}

function closeSnapshot(snapshot, now) {
  if (snapshot.outcome !== 'open') return;
  const approve = snapshot.ballots.filter(ballot => ballot.choice === 'approve').length;
  const oppose = snapshot.ballots.filter(ballot => ballot.choice === 'oppose').length;
  snapshot.outcome = snapshot.ballots.length < 2 ? 'no-quorum' : approve > oppose ? 'adopted' : 'not-adopted';
  snapshot.closedAt = timestamp(now);
}

function finalizeExpired(snapshot, now) {
  if (snapshot.outcome === 'open' && Number(new Date(now)) >= Date.parse(snapshot.closesAt)) closeSnapshot(snapshot, now);
}

export function applyOperation(input, operation, now = Date.now()) {
  const data = clone(input);
  const snapshot = data.snapshot;
  finalizeExpired(snapshot, now);
  const op = operation && typeof operation === 'object' && !Array.isArray(operation) ? operation : {};
  const validId = typeof op.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(op.id) && !['__proto__', 'constructor', 'prototype'].includes(op.id);
  const original = validId && Object.hasOwn(data.receipts, op.id) ? data.receipts[op.id] : null;
  if (original) {
    if (canonical(original.operation) === canonical(op)) return { data, snapshot, receipt: clone(original.receipt) };
    return { data, snapshot, receipt: { id: op.id, accepted: false, reason: 'This operation ID was already used for different content.', receivedAt: timestamp(now), type: TYPES.has(op.type) ? op.type : 'contribute' } };
  }
  const receipt = { id: validId ? op.id : '', accepted: false, reason: '', receivedAt: timestamp(now), type: TYPES.has(op.type) ? op.type : 'contribute' };
  const reject = reason => {
    receipt.reason = reason;
    if (validId) data.receipts[op.id] = { operation: clone(op), receipt: clone(receipt) };
    return { data, snapshot, receipt };
  };
  if (!validId || !TYPES.has(op.type)) return reject('Invalid operation. A supported type and stable operation ID are required.');
  if (!MEMBERS.has(op.memberId)) return reject('This demo membership is not eligible. Choose Alex, River, or Jules.');
  if (op.roomId !== snapshot.roomId) return reject('This saved action belongs to a different demo room. Review the current room before trying again.');
  if (op.proposalRevision !== snapshot.proposalRevision) return reject('The proposal revision has changed. Your saved action was not transferred to a new revision.');
  if (op.rulesVersion !== snapshot.rulesVersion || op.membershipVersion !== snapshot.membershipVersion) return reject('The rules or eligibility snapshot has changed. Review the current rules before submitting.');
  if (['contribute', 'minutes'].includes(op.type) && (typeof op.text !== 'string' || !op.text.trim() || op.text.length > 2000)) return reject('Enter between 1 and 2,000 characters.');
  if (op.type === 'vote') {
    if (!['approve', 'oppose', 'abstain'].includes(op.choice)) return reject('Choose approve, oppose, or abstain.');
    if (snapshot.outcome !== 'open') return reject('This vote is closed. Your saved ballot was not accepted before the closing deadline.');
    if (snapshot.ballots.some(ballot => ballot.memberId === op.memberId)) return reject('This demo member already has an accepted final ballot. A second device does not add a vote.');
    snapshot.ballots.push({ id: op.id, memberId: op.memberId, choice: op.choice, createdAt: receipt.receivedAt });
  } else if (op.type === 'contribute') {
    snapshot.contributions.push({ id: op.id, memberId: op.memberId, text: op.text.trim(), createdAt: receipt.receivedAt });
  } else if (op.type === 'close') {
    if (snapshot.outcome !== 'open') return reject('This demo vote has already closed.');
    closeSnapshot(snapshot, now);
  } else if (op.type === 'minutes') {
    if (snapshot.outcome === 'open') return reject('Close the demo vote before publishing its decision notes.');
    snapshot.minutes.push({ id: op.id, memberId: op.memberId, text: op.text.trim(), createdAt: receipt.receivedAt });
  } else if (op.type === 'complete-task') {
    if (snapshot.outcome !== 'adopted') return reject('Next-action completion is available after a plan is adopted.');
    if (!TASKS.has(op.taskId)) return reject('This task does not belong to the demo plan.');
    if (snapshot.completedTasks.some(task => task.id === op.taskId)) return reject('This task is already marked complete. It is counted once for the group.');
    snapshot.completedTasks.push({ id: op.taskId, memberId: op.memberId, createdAt: receipt.receivedAt });
  }
  receipt.accepted = true;
  receipt.reason = 'Accepted by the demo room.';
  data.receipts[op.id] = { operation: clone(op), receipt: clone(receipt) };
  return { data, snapshot, receipt };
}

export async function createDemoStore({ filePath, now = () => Date.now() }) {
  const path = resolve(filePath);
  let data;
  try {
    data = JSON.parse(await readFile(path, 'utf8'));
    const snapshot = data?.snapshot;
    if (snapshot?.schemaVersion !== 1 || typeof snapshot.roomId !== 'string' || !snapshot.roomId ||
        snapshot.proposalRevision !== 1 || snapshot.rulesVersion !== 'DEMO-RULES-v1' || snapshot.membershipVersion !== 'DEMO-MEMBERS-v1' ||
        !Number.isFinite(Date.parse(snapshot.closesAt)) || !['open', 'adopted', 'not-adopted', 'no-quorum'].includes(snapshot.outcome) ||
        !['contributions', 'ballots', 'minutes', 'completedTasks'].every(key => Array.isArray(snapshot[key])) ||
        !data.receipts || typeof data.receipts !== 'object' || Array.isArray(data.receipts)) {
      throw new Error('Unsupported or corrupt demo store. Preserve the data file and inspect it before restarting.');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    data = createDemoData(now());
  }
  const persist = async next => {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    await rename(temporary, path);
  };
  await persist(data);
  let queue = Promise.resolve();
  const serialized = task => {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  };
  return {
    getState() {
      return serialized(async () => {
        const next = clone(data);
        finalizeExpired(next.snapshot, now());
        if (next.snapshot.outcome !== data.snapshot.outcome) { await persist(next); data = next; }
        return clone(data.snapshot);
      });
    },
    submit(operation) {
      return serialized(async () => {
        const result = applyOperation(data, operation, now());
        await persist(result.data);
        data = result.data;
        return { receipt: clone(result.receipt), snapshot: clone(result.snapshot) };
      });
    },
  };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json' };
const json = (response, status, value) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(value));
};

export function createAppServer({ store, distDir = resolve(ROOT, 'dist') }) {
  const dist = resolve(distDir);
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/health' && request.method === 'GET') return json(response, 200, { ok: true, mode: 'public-demo' });
        if (url.pathname === '/api/state' && request.method === 'GET') return json(response, 200, await store.getState());
        if (url.pathname === '/api/operations' && request.method === 'POST') {
          if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) return json(response, 403, { error: 'Cross-origin writes are not allowed.' });
          if (!(request.headers['content-type'] || '').startsWith('application/json')) return json(response, 415, { error: 'Send application/json.' });
          const chunks = [];
          let bytes = 0;
          for await (const chunk of request) {
            bytes += chunk.length;
            if (bytes <= 16_384) chunks.push(chunk);
          }
          if (bytes > 16_384) return json(response, 413, { error: 'Request body is too large.' });
          const body = Buffer.concat(chunks).toString('utf8');
          let operation;
          try { operation = JSON.parse(body); } catch { return json(response, 400, { error: 'Invalid JSON.' }); }
          return json(response, 200, await store.submit(operation));
        }
        if (['/api/health', '/api/state', '/api/operations'].includes(url.pathname)) return json(response, 405, { error: 'Method not allowed.' });
        return json(response, 404, { error: 'Unknown API route.' });
      }
      if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { error: 'Method not allowed.' });
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { return json(response, 400, { error: 'Invalid path.' }); }
      const target = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (target !== dist && !target.startsWith(dist + sep)) return json(response, 403, { error: 'Forbidden path.' });
      try {
        if (!(await stat(target)).isFile()) return json(response, 404, { error: 'Not found.' });
        const buffer = await readFile(target);
        response.writeHead(200, {
          'content-type': MIME[extname(target)] || 'application/octet-stream',
          'content-length': buffer.length,
          'cache-control': ['.html', '.webmanifest'].includes(extname(target)) || pathname === '/sw.js' ? 'no-cache' : 'public, max-age=3600',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'strict-origin-when-cross-origin',
          'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        });
        response.end(request.method === 'HEAD' ? undefined : buffer);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return json(response, 404, { error: 'Not found. Run npm run build before starting the app.' });
      }
    } catch (error) {
      console.error('Request failed:', error.message);
      if (!response.headersSent) json(response, 500, { error: 'The demo room could not save this request. Your local work is retained; retry later.' });
      else response.end();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || '127.0.0.1';
  const filePath = process.env.ZACTION_DATA_FILE || resolve(ROOT, '.local/demo-room.json');
  const store = await createDemoStore({ filePath });
  const server = createAppServer({ store });
  server.listen(port, host, () => console.log(`Zaction public demo listening on ${host}:${port}. Synthetic memberships only; do not enter private data.`));
}
