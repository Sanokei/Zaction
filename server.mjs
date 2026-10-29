import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, createHash } from 'node:crypto';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ACTION_ID = 'reading-circle';
const MEMBERS = new Set(['alex', 'river', 'jules']);
const TYPES = new Set(['create-action', 'contribute', 'vote', 'close', 'minutes', 'complete-task', 'react', 'rsvp']);
const TASKS = new Set(['accessibility', 'agenda', 'minutes']);
const CITIES = new Set(['new-york', 'austin', 'seattle', 'chicago', 'los-angeles']);
const PLAN_KINDS = new Set(['bbq', 'potluck', 'games', 'walk', 'help', 'idea']);
const MEMBERSHIPS = new Set(['DEMO-MEMBERS-v1', 'COMMUNITY-PREVIEW-v1']);
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
const tokenDigest = token => createHash('sha256').update(token).digest('hex');
const profilesAt = now => [
  { id: 'alex', name: 'Alex', color: '#7654cb' },
  { id: 'river', name: 'River', color: '#34755b' },
  { id: 'jules', name: 'Jules', color: '#b65c40' },
].map(profile => ({ ...profile, cityId: 'new-york', createdAt: timestamp(now), synthetic: true }));

function createActionRecord(id, input, memberId, now, sourceKind = 'member-provided') {
  return {
    ...input, id, createdBy: memberId, createdAt: timestamp(now), sourceKind,
    proposalRevision: 1, rulesVersion: 'DEMO-RULES-v1', membershipVersion: sourceKind === 'synthetic' ? 'DEMO-MEMBERS-v1' : 'COMMUNITY-PREVIEW-v1',
    closesAt: timestamp(Number(new Date(now)) + 7 * 24 * 60 * 60 * 1000),
    contributions: [], ballots: [], outcome: 'open', closedAt: null, minutes: [], completedTasks: [], reactions: [], rsvps: [],
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
  return { schemaVersion: 2, roomId: randomUUID(), sequence: 0, profiles: profilesAt(now), actions: [createSeedAction(now)] };
}

export function createDemoData(now = Date.now()) {
  return { snapshot: createDemoState(now), receipts: {}, sessions: {} };
}

function validActionRecords(action, memberIds) {
  if (!object(action) || !actionId(action.id) ||
      !(action.createdBy === null || memberIds.has(action.createdBy)) || !Number.isFinite(Date.parse(action.createdAt)) ||
      !['synthetic', 'member-provided'].includes(action.sourceKind) ||
      !Object.keys(ACTION_FIELDS).every(key => typeof action[key] === 'string') ||
      action.proposalRevision !== 1 || action.rulesVersion !== 'DEMO-RULES-v1' || !MEMBERSHIPS.has(action.membershipVersion) ||
      !Number.isFinite(Date.parse(action.closesAt)) || !['open', 'adopted', 'not-adopted', 'no-quorum'].includes(action.outcome) ||
      !(action.closedAt === null || Number.isFinite(Date.parse(action.closedAt))) ||
      !['contributions', 'ballots', 'minutes', 'completedTasks', 'reactions', 'rsvps'].every(key => Array.isArray(action[key]))) return false;
  const memberRecord = record => object(record) && typeof record.id === 'string' && memberIds.has(record.memberId) && Number.isFinite(Date.parse(record.createdAt));
  const socialRecord = record => object(record) && memberIds.has(record.memberId) && Number.isFinite(Date.parse(record.createdAt));
  if (!action.contributions.every(record => memberRecord(record) && typeof record.text === 'string') ||
      !action.minutes.every(record => memberRecord(record) && typeof record.text === 'string') ||
      !action.ballots.every(record => memberRecord(record) && ['approve', 'oppose', 'abstain'].includes(record.choice)) ||
      !action.completedTasks.every(record => memberRecord(record) && TASKS.has(record.id)) ||
      !action.reactions.every(socialRecord) || !action.rsvps.every(record => socialRecord(record) && ['going', 'maybe'].includes(record.status)) ||
      new Set(action.reactions.map(record => record.memberId)).size !== action.reactions.length ||
      new Set(action.rsvps.map(record => record.memberId)).size !== action.rsvps.length ||
      new Set(action.ballots.map(ballot => ballot.memberId)).size !== action.ballots.length ||
      new Set(action.completedTasks.map(task => task.id)).size !== action.completedTasks.length) return false;
  if (action.contributions.some((record, index) => record.parentId !== undefined && !action.contributions.slice(0, index).some(parent => parent.id === record.parentId))) return false;
  if (action.planning !== undefined && validatePlanning(action.planning).error) return false;
  return true;
}

function assertDemoData(data) {
  const snapshot = data?.snapshot;
  const profiles = snapshot?.profiles;
  const validProfiles = Array.isArray(profiles) && profiles.every(profile => object(profile) && actionId(profile.id) && typeof profile.name === 'string' && profile.name.trim().length >= 2 && profile.name.length <= 40 && CITIES.has(profile.cityId) && /^#[0-9a-fA-F]{6}$/.test(profile.color) && Number.isFinite(Date.parse(profile.createdAt)) && typeof profile.synthetic === 'boolean') && new Set(profiles.map(profile => profile.id)).size === profiles.length && [...MEMBERS].every(id => profiles.some(profile => profile.id === id && profile.synthetic));
  const memberIds = new Set(validProfiles ? profiles.map(profile => profile.id) : []);
  if (!object(data) || !object(snapshot) || snapshot.schemaVersion !== 2 || typeof snapshot.roomId !== 'string' || !snapshot.roomId ||
      !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 0 || !Array.isArray(snapshot.actions) ||
      !validProfiles || !snapshot.actions.every(action => validActionRecords(action, memberIds)) || new Set(snapshot.actions.map(action => action.id)).size !== snapshot.actions.length ||
      !object(data.sessions) || !Object.entries(data.sessions).every(([digest, memberId]) => /^[0-9a-f]{64}$/.test(digest) && memberIds.has(memberId) && !MEMBERS.has(memberId)) ||
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
  if (data?.snapshot?.schemaVersion === 2) {
    const snapshot = data.snapshot;
    let enriched = false;
    const baseline = snapshot.actions?.find(action => Number.isFinite(Date.parse(action?.createdAt)))?.createdAt || '1970-01-01T00:00:00.000Z';
    if (snapshot.profiles === undefined) { snapshot.profiles = []; enriched = true; }
    if (Array.isArray(snapshot.profiles)) {
      for (const profile of profilesAt(baseline)) {
        if (!snapshot.profiles.some(existing => existing?.id === profile.id)) { snapshot.profiles.push(profile); enriched = true; }
      }
    }
    if (Array.isArray(snapshot.actions)) {
      for (const action of snapshot.actions) {
        if (!object(action)) continue;
        if (action.reactions === undefined) { action.reactions = []; enriched = true; }
        if (action.rsvps === undefined) { action.rsvps = []; enriched = true; }
      }
    }
    if (data.sessions === undefined) data.sessions = {};
    if (enriched && Number.isSafeInteger(snapshot.sequence)) snapshot.sequence += 1;
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
  if (!object(input) || Object.keys(input).some(key => !Object.hasOwn(ACTION_FIELDS, key) && key !== 'planning')) return { error: 'Use only the supported action fields. A top-level budget or payment is not supported; planning estimates belong in planning.budgetCents.' };
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
  if (input.planning !== undefined) {
    const planning = validatePlanning(input.planning);
    if (planning.error) return planning;
    normalized.planning = planning.value;
  }
  return { value: normalized };
}

function validatePlanning(input) {
  const limits = { date: 10, timeHint: 100, cityId: 40, place: 240, rainPlan: 600, accessibility: 400 };
  const supported = new Set(['kind', ...Object.keys(limits), 'budgetCents', 'expectedPeople', 'bring']);
  if (!object(input) || Object.keys(input).some(key => !supported.has(key)) || !PLAN_KINDS.has(input.kind)) return { error: 'Choose a supported gathering or idea type and use only the planning fields.' };
  const normalized = { kind: input.kind };
  for (const [key, maximum] of Object.entries(limits)) {
    if (typeof input[key] !== 'string') return { error: `The planning ${key} field must be text.` };
    const value = input[key].trim();
    if (value.length > maximum) return { error: `Keep the planning ${key} field within ${maximum} characters.` };
    normalized[key] = value;
  }
  if (!CITIES.has(normalized.cityId)) return { error: 'Choose one of the supported cities. Precise GPS is not collected.' };
  if (normalized.date && (!/^\d{4}-\d{2}-\d{2}$/.test(normalized.date) || !Number.isFinite(Date.parse(`${normalized.date}T12:00:00Z`)) || new Date(`${normalized.date}T12:00:00Z`).toISOString().slice(0, 10) !== normalized.date)) return { error: 'Use a real calendar date in YYYY-MM-DD format, or leave the date open.' };
  if (!Number.isInteger(input.budgetCents) || input.budgetCents < 0 || input.budgetCents > 1_000_000) return { error: 'The estimated budget must be a whole number of cents between 0 and 1,000,000. No payments are collected.' };
  if (!Number.isInteger(input.expectedPeople) || input.expectedPeople < 1 || input.expectedPeople > 100) return { error: 'Plan for 1 to 100 people; this is an estimate, not confirmed attendance.' };
  if (!Array.isArray(input.bring) || input.bring.length > 8 || input.bring.some(item => typeof item !== 'string' || !item.trim() || item.trim().length > 80)) return { error: 'List up to eight things to bring, each between 1 and 80 characters.' };
  return { value: { ...normalized, budgetCents: input.budgetCents, expectedPeople: input.expectedPeople, bring: input.bring.map(item => item.trim()) } };
}

export function applyOperation(input, operation, now = Date.now()) {
  const data = migrateDemoData(input);
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
  if (!snapshot.profiles.some(profile => profile.id === op.memberId)) return reject('This community profile is not registered. Join the community before sharing or voting.');
  if (op.roomId !== snapshot.roomId) return reject('This saved action belongs to a different demo room. Review the current room before trying again.');
  if (op.proposalRevision !== 1) return reject('The proposal revision has changed. Your saved action was not transferred to a new revision.');
  if (op.rulesVersion !== 'DEMO-RULES-v1' || !MEMBERSHIPS.has(op.membershipVersion)) return reject('The rules or eligibility snapshot has changed. Review the current rules before submitting.');
  if (op.type === 'create-action') {
    if (snapshot.actions.some(action => action.id === op.actionId)) return reject('This action ID already belongs to an existing action.');
    const validation = validateActionInput(op.action);
    if (validation.error) return reject(validation.error);
    snapshot.actions.push(createActionRecord(op.actionId, validation.value, op.memberId, now));
  } else {
    const action = snapshot.actions.find(item => item.id === op.actionId);
    if (!action) return reject('This action is not available. Your saved action was not applied to a different action.');
    if (op.proposalRevision !== action.proposalRevision || op.rulesVersion !== action.rulesVersion || op.membershipVersion !== action.membershipVersion) return reject('The proposal rules or eligibility snapshot has changed. Review this action before submitting.');
    if (action.membershipVersion === 'DEMO-MEMBERS-v1' && !MEMBERS.has(op.memberId) && ['vote', 'close', 'minutes', 'complete-task'].includes(op.type)) return reject('This legacy example vote is limited to its three synthetic demo members. Join a community-created action to take part with your own profile.');
    if (['contribute', 'minutes'].includes(op.type) && (typeof op.text !== 'string' || !op.text.trim() || op.text.length > 2000)) return reject('Enter between 1 and 2,000 characters.');
    if (op.type === 'vote') {
      if (!['approve', 'oppose', 'abstain'].includes(op.choice)) return reject('Choose approve, oppose, or abstain.');
      if (action.outcome !== 'open') return reject('This vote is closed. Your saved ballot was not accepted before the closing deadline.');
      if (action.ballots.some(ballot => ballot.memberId === op.memberId)) return reject('This demo member already has an accepted final ballot for this action. A second device does not add a vote.');
      action.ballots.push({ id: op.id, memberId: op.memberId, choice: op.choice, createdAt: receipt.receivedAt });
    } else if (op.type === 'contribute') {
      if (op.parentId !== undefined && op.replyTo !== undefined && op.parentId !== op.replyTo) return reject('A reply must name one parent comment.');
      const parentId = op.parentId ?? op.replyTo;
      if (parentId !== undefined && (typeof parentId !== 'string' || !action.contributions.some(parent => parent.id === parentId))) return reject('Reply to a comment on this action. A comment from another action cannot be used as the parent.');
      action.contributions.push({ id: op.id, memberId: op.memberId, text: op.text.trim(), createdAt: receipt.receivedAt, ...(parentId !== undefined ? { parentId } : {}) });
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
    } else if (op.type === 'react') {
      if (typeof op.active !== 'boolean') return reject('Choose whether this reaction is active.');
      const existing = action.reactions.find(record => record.memberId === op.memberId);
      if (op.active && !existing) action.reactions.push({ memberId: op.memberId, createdAt: receipt.receivedAt });
      if (!op.active) action.reactions = action.reactions.filter(record => record.memberId !== op.memberId);
    } else if (op.type === 'rsvp') {
      if (!action.planning || action.planning.kind === 'idea') return reject('RSVPs are available for plans with gathering details.');
      if (!['going', 'maybe', 'none'].includes(op.status)) return reject('Choose going, maybe, or no RSVP.');
      action.rsvps = action.rsvps.filter(record => record.memberId !== op.memberId);
      if (op.status !== 'none') action.rsvps.push({ memberId: op.memberId, status: op.status, createdAt: receipt.receivedAt });
    }
  }
  receipt.accepted = true;
  receipt.reason = 'Accepted by the demo room.';
  data.receipts[op.id] = { operation: clone(op), receipt: clone(receipt) };
  snapshot.sequence += 1;
  return { data, snapshot, receipt };
}

function validateJoinInput(input) {
  if (!object(input) || Object.keys(input).some(key => !['name', 'cityId'].includes(key)) || typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 40 || /[\u0000-\u001f\u007f]/.test(input.name) || !CITIES.has(input.cityId)) {
    const error = new Error('Choose a pseudonym of 2–40 characters and one of the supported cities.');
    error.status = 400;
    throw error;
  }
  return { name: input.name.trim(), cityId: input.cityId };
}

function sessionMember(data, bearer) {
  if (typeof bearer !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(bearer)) return null;
  const digest = tokenDigest(bearer);
  return Object.hasOwn(data.sessions, digest) ? data.sessions[digest] : null;
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
    joinProfile(input, bearer) {
      return serialized(async () => {
        const fields = validateJoinInput(input);
        const next = clone(data);
        let profile;
        let token = bearer;
        if (bearer !== undefined) {
          const memberId = sessionMember(next, bearer);
          profile = memberId && next.snapshot.profiles.find(candidate => candidate.id === memberId && !candidate.synthetic);
          if (!profile) { const error = new Error('This device session is not valid for this community. Keep your local work and explicitly rejoin the current room.'); error.status = 401; throw error; }
          if (profile.name !== fields.name || profile.cityId !== fields.cityId) {
            profile.name = fields.name;
            profile.cityId = fields.cityId;
            next.snapshot.sequence += 1;
          }
        } else {
          const id = `member-${randomUUID()}`;
          const colors = ['#7654cb', '#34755b', '#b65c40', '#376fbc', '#a33d76'];
          profile = { id, ...fields, color: colors[next.snapshot.profiles.length % colors.length], createdAt: timestamp(now()), synthetic: false };
          token = randomBytes(32).toString('base64url');
          next.snapshot.profiles.push(profile);
          next.sessions[tokenDigest(token)] = id;
          next.snapshot.sequence += 1;
        }
        await persist(next);
        data = next;
        return { profile: clone(profile), token, snapshot: clone(next.snapshot) };
      });
    },
    authorized(memberId, bearer) {
      return serialized(async () => data.snapshot.profiles.some(profile => profile.id === memberId) && (MEMBERS.has(memberId) && bearer === undefined || sessionMember(data, bearer) === memberId));
    },
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

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8' };
const json = (response, status, value) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(value));
};

export function createAppServer({ store, distDir = resolve(ROOT, 'dist'), weatherService = async query => (await import('./weather.mjs')).getForecast(query) }) {
  const dist = resolve(distDir);
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/health' && request.method === 'GET') return json(response, 200, { ok: true, mode: 'community-preview' });
        if (url.pathname === '/api/state' && request.method === 'GET') return json(response, 200, await store.getState());
        if (url.pathname === '/api/weather' && request.method === 'GET') return json(response, 200, await weatherService({ cityId: url.searchParams.get('cityId') || '', date: url.searchParams.get('date') || '' }));
        if (['/api/operations', '/api/community/join'].includes(url.pathname) && request.method === 'POST') {
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
          const header = request.headers.authorization;
          const bearer = header === undefined ? undefined : /^Bearer [A-Za-z0-9_-]{43}$/.test(header) ? header.slice(7) : '';
          if (url.pathname === '/api/community/join') {
            try { return json(response, 200, await store.joinProfile(operation, bearer)); }
            catch (error) { if (error.status) return json(response, error.status, { error: error.message }); throw error; }
          }
          if (!await store.authorized(operation?.memberId, bearer)) {
            return json(response, header === undefined ? 401 : 403, {
              receipt: {
                id: typeof operation?.id === 'string' ? operation.id : '', actionId: typeof operation?.actionId === 'string' ? operation.actionId : '',
                accepted: false, reason: 'This profile needs its original saved device session. Your submission was not accepted or reassigned to another profile.',
                receivedAt: timestamp(Date.now()), type: TYPES.has(operation?.type) ? operation.type : 'contribute',
              },
              snapshot: await store.getState(),
            });
          }
          return json(response, 200, await store.submit(operation));
        }
        if (['/api/health', '/api/state', '/api/weather', '/api/operations', '/api/community/join'].includes(url.pathname)) return json(response, 405, { error: 'Method not allowed.' });
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
  server.listen(port, host, () => console.log(`Zaction community preview listening on ${host}:${port}. Profiles and shared posts are public; use a pseudonym.`));
}
