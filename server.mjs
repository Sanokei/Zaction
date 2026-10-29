import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ACTION_ID = 'reading-circle';
const MEMBERS = new Set(['alex', 'river', 'jules']);
const TYPES = new Set(['create-action', 'contribute', 'vote', 'close', 'minutes', 'complete-task']);
const TASKS = new Set(['accessibility', 'agenda', 'minutes']);
const PROTOTYPE_KEYS = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
const ACTION_FIELDS = { title: [3, 100], description: [10, 1200], proposalTitle: [3, 140], beneficiaries: [3, 240], whenWhere: [0, 240], sourceLabel: [0, 120], sourceUrl: [0, 1000] };
const MOVED_FIELDS = ['proposalRevision', 'rulesVersion', 'membershipVersion', 'closesAt', 'contributions', 'ballots', 'outcome', 'closedAt', 'minutes', 'completedTasks'];
const timestamp = now => new Date(now).toISOString();
const clone = value => structuredClone(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const operationId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const actionId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) && !PROTOTYPE_KEYS.has(value);
const sortObject = value => Array.isArray(value) ? value.map(sortObject) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sortObject(value[key])])) : value;
const canonical = value => JSON.stringify(sortObject(value));

function createActionRecord(id, input, memberId, now, sourceKind = 'member-provided') {
  return {
    ...input, id, createdBy: memberId, createdAt: timestamp(now), sourceKind,
    proposalRevision: 1, rulesVersion: 'DEMO-RULES-v1', membershipVersion: 'DEMO-MEMBERS-v1',
    closesAt: timestamp(Number(new Date(now)) + 7 * 24 * 60 * 60 * 1000),
    contributions: [], ballots: [], outcome: 'open', closedAt: null, minutes: [], completedTasks: [],
  };
}

function createSeedAction(now) {
  return createActionRecord(DEFAULT_ACTION_ID, {
    title: 'Better questions. Better local decisions.',
    description: 'Read a sample school-budget agenda. Add one question that could help everyone understand it.',
    proposalTitle: 'Let’s host a free school-budget reading circle.',
    beneficiaries: 'Anyone who wants to understand',
    whenWhere: 'To be agreed · Venue unconfirmed',
    sourceLabel: 'Synthetic demonstration agenda', sourceUrl: '',
  }, null, now, 'synthetic');
}

export function createDemoState(now = Date.now()) {
  return { schemaVersion: 2, roomId: randomUUID(), sequence: 0, actions: [createSeedAction(now)] };
}

export function createDemoData(now = Date.now()) {
  return { snapshot: createDemoState(now), receipts: {} };
}

function validActionRecords(action) {
  if (!object(action) || !actionId(action.id) ||
      !(action.createdBy === null || MEMBERS.has(action.createdBy)) || !Number.isFinite(Date.parse(action.createdAt)) ||
      !['synthetic', 'member-provided'].includes(action.sourceKind) ||
      !Object.keys(ACTION_FIELDS).every(key => typeof action[key] === 'string') ||
      action.proposalRevision !== 1 || action.rulesVersion !== 'DEMO-RULES-v1' || action.membershipVersion !== 'DEMO-MEMBERS-v1' ||
      !Number.isFinite(Date.parse(action.closesAt)) || !['open', 'adopted', 'not-adopted', 'no-quorum'].includes(action.outcome) ||
      !(action.closedAt === null || Number.isFinite(Date.parse(action.closedAt))) ||
      !['contributions', 'ballots', 'minutes', 'completedTasks'].every(key => Array.isArray(action[key]))) return false;
  const memberRecord = record => object(record) && typeof record.id === 'string' && MEMBERS.has(record.memberId) && Number.isFinite(Date.parse(record.createdAt));
  if (!action.contributions.every(record => memberRecord(record) && typeof record.text === 'string') ||
      !action.minutes.every(record => memberRecord(record) && typeof record.text === 'string') ||
      !action.ballots.every(record => memberRecord(record) && ['approve', 'oppose', 'abstain'].includes(record.choice)) ||
      !action.completedTasks.every(record => memberRecord(record) && TASKS.has(record.id)) ||
      new Set(action.ballots.map(ballot => ballot.memberId)).size !== action.ballots.length ||
      new Set(action.completedTasks.map(task => task.id)).size !== action.completedTasks.length) return false;
  return true;
}

function assertDemoData(data) {
  const snapshot = data?.snapshot;
  if (!object(data) || !object(snapshot) || snapshot.schemaVersion !== 2 || typeof snapshot.roomId !== 'string' || !snapshot.roomId ||
      !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 0 || !Array.isArray(snapshot.actions) ||
      !snapshot.actions.every(validActionRecords) || new Set(snapshot.actions.map(action => action.id)).size !== snapshot.actions.length ||
      !object(data.receipts) || !Object.values(data.receipts).every(record => object(record) && object(record.operation) && object(record.receipt) &&
        typeof record.receipt.id === 'string' && typeof record.receipt.actionId === 'string' && typeof record.receipt.accepted === 'boolean' &&
        typeof record.receipt.reason === 'string' && Number.isFinite(Date.parse(record.receipt.receivedAt)) && TYPES.has(record.receipt.type))) {
    throw new Error('Unsupported or corrupt demo store. Preserve the data file and inspect it before restarting.');
  }
}

export function migrateDemoData(input) {
  const data = clone(input);
  if (data?.snapshot?.schemaVersion === 1) {
    const previous = data.snapshot;
    if (typeof previous.roomId !== 'string' || !previous.roomId || !Number.isFinite(Date.parse(previous.closesAt)) ||
        previous.proposalRevision !== 1 || previous.rulesVersion !== 'DEMO-RULES-v1' || previous.membershipVersion !== 'DEMO-MEMBERS-v1' ||
        !object(data.receipts) || !Object.values(data.receipts).every(record => object(record) && object(record.operation) && object(record.receipt))) {
      throw new Error('Unsupported or corrupt demo store. Preserve the data file and inspect it before restarting.');
    }
    const seed = createSeedAction(Date.parse(previous.closesAt) - 7 * 24 * 60 * 60 * 1000);
    for (const key of MOVED_FIELDS) seed[key] = clone(previous[key]);
    data.snapshot = { ...previous, schemaVersion: 2, roomId: previous.roomId, sequence: 0, actions: [seed] };
    for (const key of MOVED_FIELDS) delete data.snapshot[key];
    for (const key of Object.keys(data.receipts)) {
      const record = data.receipts[key];
      data.receipts[key] = {
        ...record,
        operation: { ...record.operation, actionId: DEFAULT_ACTION_ID },
        receipt: { ...record.receipt, actionId: DEFAULT_ACTION_ID },
      };
    }
  }
  assertDemoData(data);
  return data;
}

function closeAction(action, now) {
  if (action.outcome !== 'open') return;
  const approve = action.ballots.filter(ballot => ballot.choice === 'approve').length;
  const oppose = action.ballots.filter(ballot => ballot.choice === 'oppose').length;
  action.outcome = action.ballots.length < 2 ? 'no-quorum' : approve > oppose ? 'adopted' : 'not-adopted';
  action.closedAt = timestamp(now);
}

function finalizeExpired(snapshot, now) {
  for (const action of snapshot.actions) {
    if (action.outcome === 'open' && Number(new Date(now)) >= Date.parse(action.closesAt)) {
      closeAction(action, now);
      snapshot.sequence += 1;
    }
  }
}

function validateActionInput(input) {
  if (!object(input) || Object.keys(input).some(key => !Object.hasOwn(ACTION_FIELDS, key))) return { error: 'Use only the supported action fields. Every action has a $0 budget; payment and budget fields are not supported.' };
  const normalized = {};
  for (const [key, [minimum, maximum]] of Object.entries(ACTION_FIELDS)) {
    const raw = input[key] === undefined && minimum === 0 ? '' : input[key];
    if (typeof raw !== 'string') return { error: `The ${key} field must be text.` };
    const value = raw.trim();
    if (value.length < minimum || value.length > maximum) return { error: `The ${key} field must contain ${minimum}–${maximum} characters.` };
    normalized[key] = value;
  }
  if (normalized.sourceUrl) {
    try {
      const source = new URL(normalized.sourceUrl);
      if (source.protocol !== 'https:' || !source.hostname || source.username || source.password) throw new Error('Unsupported URL.');
    } catch { return { error: 'A source URL must use HTTPS and must not include a username or password.' }; }
  }
  return { value: normalized };
}

export function applyOperation(input, operation, now = Date.now()) {
  const data = clone(input);
  const snapshot = data.snapshot;
  finalizeExpired(snapshot, now);
  const op = object(operation) ? operation : {};
  const validId = operationId(op.id);
  const original = validId && Object.hasOwn(data.receipts, op.id) ? data.receipts[op.id] : null;
  const target = typeof op.actionId === 'string' ? op.actionId : '';
  if (original) {
    if (canonical(original.operation) === canonical(op)) return { data, snapshot, receipt: clone(original.receipt) };
    return { data, snapshot, receipt: { id: op.id, actionId: target, accepted: false, reason: 'This operation ID was already used for different content or a different action.', receivedAt: timestamp(now), type: TYPES.has(op.type) ? op.type : 'contribute' } };
  }
  const receipt = { id: validId ? op.id : '', actionId: target, accepted: false, reason: '', receivedAt: timestamp(now), type: TYPES.has(op.type) ? op.type : 'contribute' };
  const reject = reason => {
    receipt.reason = reason;
    if (validId) {
      data.receipts[op.id] = { operation: clone(op), receipt: clone(receipt) };
      snapshot.sequence += 1;
    }
    return { data, snapshot, receipt };
  };
  if (!validId || !TYPES.has(op.type)) return reject('Invalid operation. A supported type and stable operation ID are required.');
  if (!actionId(op.actionId)) return reject('A valid action ID is required. This operation was not applied to any other action.');
  if (!MEMBERS.has(op.memberId)) return reject('This demo membership is not eligible. Choose Alex, River, or Jules.');
  if (op.roomId !== snapshot.roomId) return reject('This saved action belongs to a different demo room. Review the current room before trying again.');
  if (op.proposalRevision !== 1) return reject('The proposal revision has changed. Your saved action was not transferred to a new revision.');
  if (op.rulesVersion !== 'DEMO-RULES-v1' || op.membershipVersion !== 'DEMO-MEMBERS-v1') return reject('The rules or eligibility snapshot has changed. Review the current rules before submitting.');
  if (op.type === 'create-action') {
    if (snapshot.actions.some(action => action.id === op.actionId)) return reject('This action ID already belongs to an existing action.');
    const validation = validateActionInput(op.action);
    if (validation.error) return reject(validation.error);
    snapshot.actions.push(createActionRecord(op.actionId, validation.value, op.memberId, now));
  } else {
    const action = snapshot.actions.find(item => item.id === op.actionId);
    if (!action) return reject('This action is not available. Your saved action was not applied to a different action.');
    if (op.proposalRevision !== action.proposalRevision || op.rulesVersion !== action.rulesVersion || op.membershipVersion !== action.membershipVersion) return reject('The proposal rules or eligibility snapshot has changed. Review this action before submitting.');
    if (['contribute', 'minutes'].includes(op.type) && (typeof op.text !== 'string' || !op.text.trim() || op.text.length > 2000)) return reject('Enter between 1 and 2,000 characters.');
    if (op.type === 'vote') {
      if (!['approve', 'oppose', 'abstain'].includes(op.choice)) return reject('Choose approve, oppose, or abstain.');
      if (action.outcome !== 'open') return reject('This vote is closed. Your saved ballot was not accepted before the closing deadline.');
      if (action.ballots.some(ballot => ballot.memberId === op.memberId)) return reject('This demo member already has an accepted final ballot for this action. A second device does not add a vote.');
      action.ballots.push({ id: op.id, memberId: op.memberId, choice: op.choice, createdAt: receipt.receivedAt });
    } else if (op.type === 'contribute') {
      action.contributions.push({ id: op.id, memberId: op.memberId, text: op.text.trim(), createdAt: receipt.receivedAt });
    } else if (op.type === 'close') {
      if (action.outcome !== 'open') return reject('This demo vote has already closed.');
      closeAction(action, now);
    } else if (op.type === 'minutes') {
      if (action.outcome === 'open') return reject('Close the demo vote before publishing its decision notes.');
      action.minutes.push({ id: op.id, memberId: op.memberId, text: op.text.trim(), createdAt: receipt.receivedAt });
    } else if (op.type === 'complete-task') {
      if (action.outcome !== 'adopted') return reject('Next-action completion is available after a plan is adopted.');
      if (!TASKS.has(op.taskId)) return reject('This task does not belong to this action’s plan.');
      if (action.completedTasks.some(task => task.id === op.taskId)) return reject('This task is already marked complete. It is counted once for this action.');
      action.completedTasks.push({ id: op.taskId, memberId: op.memberId, createdAt: receipt.receivedAt });
    }
  }
  receipt.accepted = true;
  receipt.reason = 'Accepted by the demo room.';
  data.receipts[op.id] = { operation: clone(op), receipt: clone(receipt) };
  snapshot.sequence += 1;
  return { data, snapshot, receipt };
}

export async function createDemoStore({ filePath, now = () => Date.now() }) {
  const path = resolve(filePath);
  let data;
  let original;
  try {
    original = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (original === undefined) {
    data = createDemoData(now());
  } else {
    const parsed = JSON.parse(original);
    data = migrateDemoData(parsed);
    if (parsed?.snapshot?.schemaVersion === 1) {
      const backupPath = `${path}.v1-backup.json`;
      try { await writeFile(backupPath, original, { flag: 'wx', mode: 0o600 }); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (await readFile(backupPath, 'utf8') !== original) throw new Error(`The migration backup already exists with different data: ${backupPath}. Preserve both files and inspect them before restarting.`);
      }
    }
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
        if (next.snapshot.sequence !== data.snapshot.sequence) { await persist(next); data = next; }
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
