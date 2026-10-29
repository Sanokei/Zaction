import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createDemoStore, createAppServer } from '../server.mjs';

async function withServer(run) {
  const directory = await mkdtemp(join(tmpdir(), 'zaction-http-'));
  const distDir = join(directory, 'dist');
  await mkdir(distDir);
  await writeFile(join(distDir, 'index.html'), '<!doctype html><title>Zaction test shell</title>');
  await writeFile(join(distDir, 'sw.js'), '/* worker fixture */');
  await writeFile(join(directory, 'outside.txt'), 'OUTSIDE_ROOT_PRIVATE_SENTINEL');
  const store = await createDemoStore({ filePath: join(directory, 'room.json') });
  const server = createAppServer({ store, distDir });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = (path, options = {}) => fetch(origin + path, { ...options, signal: AbortSignal.timeout(5000) });
    await run({ request, origin, store });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}

test('production HTTP serves the shell and uncached JSON state separately', async () => {
  await withServer(async ({ request }) => {
    const shell = await request('/');
    assert.equal(shell.status, 200);
    assert.match(shell.headers.get('content-type'), /text\/html/);
    assert.match(await shell.text(), /Zaction test shell/);
    const state = await request('/api/state');
    assert.equal(state.status, 200);
    assert.match(state.headers.get('content-type'), /application\/json/);
    assert.match(state.headers.get('cache-control'), /no-store/);
    const room = await state.json();
    assert.equal(room.schemaVersion, 2);
    assert.equal(room.actions.find(action => action.id === 'reading-circle').outcome, 'open');
    const worker = await request('/sw.js');
    assert.equal(worker.status, 200);
    assert.match(worker.headers.get('content-type'), /javascript/);
    assert.match(worker.headers.get('cache-control'), /no-store|no-cache|max-age=0/);
  });
});

test('HTTP API rejects malformed JSON and cross-origin writes', async () => {
  await withServer(async ({ request }) => {
    const malformed = await request('/api/operations', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{broken',
    });
    assert.equal(malformed.status, 400);
    const crossOrigin = await request('/api/operations', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://attacker.invalid' }, body: '{}',
    });
    assert.equal(crossOrigin.status, 403);
  });
});

test('HTTP API bounds the request body and never exposes files outside dist', async () => {
  await withServer(async ({ request }) => {
    const huge = await request('/api/operations', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(256 * 1024) }),
    });
    assert.equal(huge.status, 413);
    for (const path of ['/%2e%2e%2foutside.txt', '/..%2foutside.txt', '/outside.txt']) {
      const response = await request(path);
      assert.ok(![200, 201].includes(response.status), `unexpected success for ${path}`);
      assert.doesNotMatch(await response.text(), /OUTSIDE_ROOT_PRIVATE_SENTINEL/);
    }
    assert.equal((await request('/missing.js')).status, 404);
    assert.equal((await request('/api/not-a-route')).status, 404);
  });
});

test('chunked UTF-8 contributions survive a split inside a multibyte character', async () => {
  await withServer(async ({ request, origin }) => {
    const snapshot = await (await request('/api/state')).json();
    const action = snapshot.actions.find(action => action.id === 'reading-circle');
    const text = 'Can we add 字幕 and a step-free route? 🌿';
    const body = Buffer.from(JSON.stringify({
      id: randomUUID(), memberId: 'alex', type: 'contribute', text, actionId: action.id,
      roomId: snapshot.roomId, proposalRevision: action.proposalRevision,
      rulesVersion: action.rulesVersion, membershipVersion: action.membershipVersion,
    }));
    const split = body.indexOf(Buffer.from('字')) + 1;
    assert.ok(split > 0);
    const response = await new Promise((resolve, reject) => {
      const req = httpRequest(origin + '/api/operations', {
        method: 'POST', headers: { 'content-type': 'application/json', 'content-length': body.length },
      }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
          catch (error) { reject(error); }
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(5000, () => req.destroy(new Error('Chunked request timed out')));
      req.write(body.subarray(0, split));
      setTimeout(() => req.end(body.subarray(split)), 20);
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.receipt.accepted, true);
    assert.equal(response.body.snapshot.actions.find(action => action.id === 'reading-circle').contributions[0].text, text);
  });
});

test('community sessions authorize only their own public profile and never appear in public state', async () => {
  await withServer(async ({ request }) => {
    const join = async name => {
      const response = await request('/api/community/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, cityId: 'new-york' }) });
      assert.ok(response.ok);
      return response.json();
    };
    const first = await join('Maya');
    const second = await join('Noah');
    assert.notEqual(first.profile.id, second.profile.id);
    assert.equal(first.profile.synthetic, false);
    const publicState = await (await request('/api/state')).json();
    assert.equal(Object.hasOwn(publicState, 'sessions'), false);
    assert.equal(JSON.stringify(publicState).includes(first.token), false);
    assert.equal(JSON.stringify(first.snapshot).includes(first.token), false);
    const operation = { id: randomUUID(), memberId: first.profile.id, type: 'create-action', actionId: 'my-community-action',
      proposalRevision: 1, rulesVersion: 'DEMO-RULES-v1', membershipVersion: 'COMMUNITY-PREVIEW-v1', roomId: publicState.roomId,
      action: { title: 'Read the library access plan', description: 'Prepare questions about a public library access plan.', proposalTitle: 'Hold a free reading session', beneficiaries: 'Neighbors who use the library', whenWhere: '', sourceLabel: '', sourceUrl: '' } };
    const send = (op, token) => request('/api/operations', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(op) });
    const unauthenticated = await send(operation);
    assert.equal(unauthenticated.status, 401);
    assert.equal((await unauthenticated.json()).receipt.accepted, false);
    const impersonated = await send(operation, second.token);
    assert.equal(impersonated.status, 403);
    assert.equal((await impersonated.json()).receipt.accepted, false);
    const accepted = await send(operation, first.token);
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).receipt.accepted, true, 'auth failures do not poison the stable operation ID');
    const snapshot = await (await request('/api/state')).json();
    assert.equal(snapshot.actions.filter(action => action.id === operation.actionId).length, 1);
    assert.equal(snapshot.actions.find(action => action.id === operation.actionId).membershipVersion, 'COMMUNITY-PREVIEW-v1');
  });
});

test('community onboarding rejects malformed names, unsupported cities, and cross-origin writes', async () => {
  await withServer(async ({ request }) => {
    const initial = await (await request('/api/state')).json();
    for (const input of [{ name: '', cityId: 'new-york' }, { name: 'Maya', cityId: 'unknown-city' }, { name: 'x'.repeat(41), cityId: 'new-york' }]) {
      const response = await request('/api/community/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      assert.equal(response.status, 400);
    }
    const crossOrigin = await request('/api/community/join', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://attacker.invalid' }, body: JSON.stringify({ name: 'Maya', cityId: 'new-york' }) });
    assert.equal(crossOrigin.status, 403);
    const after = await (await request('/api/state')).json();
    assert.equal(after.profiles.length, initial.profiles.length);
  });
});

async function bringFixture(request) {
  const joinProfile = async name => {
    const response = await request('/api/community/join', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, cityId: 'new-york' }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const maya = await joinProfile('Maya');
  const noah = await joinProfile('Noah');
  const roomId = maya.snapshot.roomId;
  const operation = (profile, actionId, fields = {}) => ({
    id: randomUUID(), memberId: profile.profile.id, actionId, roomId, type: 'bring-item',
    proposalRevision: 1, rulesVersion: 'DEMO-RULES-v1', membershipVersion: 'COMMUNITY-PREVIEW-v1',
    ...fields,
  });
  const send = async (op, token) => {
    const response = await request('/api/operations', {
      method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(op),
    });
    return { status: response.status, ...await response.json() };
  };
  for (const id of ['picnic-one', 'picnic-two']) {
    const created = await send(operation(maya, id, { type: 'create-action', action: {
      title: `Neighborhood picnic ${id}`, description: 'Share a few snacks and meet our local neighbors.',
      proposalTitle: 'Agree on a simple neighborhood picnic', beneficiaries: 'Our local neighbors',
      whenWhere: 'A public park, with details to be agreed', sourceLabel: '', sourceUrl: '',
      planning: { kind: 'potluck', date: '', timeHint: 'Afternoon', cityId: 'new-york', place: 'Public park',
        budgetCents: 2500, expectedPeople: 8, rainPlan: 'Choose another day', accessibility: 'Step-free access',
        bring: ['Water', 'Water', 'Plates'] },
    } }), maya.token);
    assert.equal(created.status, 200);
    assert.equal(created.receipt.accepted, true);
  }
  return { maya, noah, operation, send };
}

test('authenticated bring-item claims use slot indexes and serialize competing owners without changing votes or RSVPs', async () => {
  await withServer(async ({ request }) => {
    const { maya, noah, operation, send } = await bringFixture(request);
    const first = operation(maya, 'picnic-one', { itemIndex: 0, intent: 'claim' });
    const second = operation(noah, 'picnic-one', { itemIndex: 0, intent: 'claim' });
    const results = await Promise.all([send(first, maya.token), send(second, noah.token)]);
    assert.deepEqual(results.map(result => result.status), [200, 200]);
    assert.equal(results.filter(result => result.receipt.accepted).length, 1);
    assert.equal(results.filter(result => !result.receipt.accepted).length, 1);
    const winningOperation = results[0].receipt.accepted ? first : second;
    const winner = winningOperation.memberId === maya.profile.id ? maya : noah;
    const loser = winner === maya ? noah : maya;
    const occupied = await send(operation(winner, 'picnic-one', { itemIndex: 0, intent: 'claim' }), winner.token);
    assert.equal(occupied.receipt.accepted, false, 'even its owner cannot replace an existing claim with a new operation');
    const identicalLabel = await send(operation(loser, 'picnic-one', { itemIndex: 1, intent: 'claim' }), loser.token);
    assert.equal(identicalLabel.receipt.accepted, true, 'a duplicate label is a distinct slot');
    const otherPlan = await send(operation(loser, 'picnic-two', { itemIndex: 0, intent: 'claim' }), loser.token);
    assert.equal(otherPlan.receipt.accepted, true, 'the same index on another plan stays independent');
    const snapshot = await (await request('/api/state')).json();
    const firstPlan = snapshot.actions.find(action => action.id === 'picnic-one');
    const secondPlan = snapshot.actions.find(action => action.id === 'picnic-two');
    assert.equal(firstPlan.bringClaims.length, 2);
    assert.equal(firstPlan.bringClaims.find(claim => claim.itemIndex === 0).id, winningOperation.id);
    assert.equal(secondPlan.bringClaims.length, 1);
    for (const plan of [firstPlan, secondPlan]) {
      assert.deepEqual(plan.ballots, []);
      assert.deepEqual(plan.rsvps, []);
      assert.deepEqual(plan.completedTasks, []);
      assert.equal(plan.outcome, 'open');
      assert.equal(plan.planning.budgetCents, 2500);
    }
  });
});

test('bring-item releases require the owner session and exact claim, and old replay cannot erase a later reclaim', async () => {
  await withServer(async ({ request }) => {
    const { maya, noah, operation, send } = await bringFixture(request);
    const firstClaim = operation(maya, 'picnic-one', { itemIndex: 0, intent: 'claim' });
    assert.equal((await send(firstClaim, maya.token)).receipt.accepted, true);
    const otherRelease = await send(operation(noah, 'picnic-one', { itemIndex: 0, intent: 'release', claimId: firstClaim.id }), noah.token);
    assert.equal(otherRelease.status, 200);
    assert.equal(otherRelease.receipt.accepted, false);
    const release = operation(maya, 'picnic-one', { itemIndex: 0, intent: 'release', claimId: firstClaim.id });
    const missingSession = await send(release);
    assert.equal(missingSession.status, 401);
    assert.equal(missingSession.receipt.accepted, false);
    const impersonated = await send(release, noah.token);
    assert.equal(impersonated.status, 403);
    assert.equal(impersonated.receipt.accepted, false);
    const acceptedRelease = await send(release, maya.token);
    assert.equal(acceptedRelease.status, 200);
    assert.equal(acceptedRelease.receipt.accepted, true, 'rejected authentication cannot poison the real owner’s operation ID');
    const newClaim = operation(maya, 'picnic-one', { itemIndex: 0, intent: 'claim' });
    assert.equal((await send(newClaim, maya.token)).receipt.accepted, true);
    const closed = await send(operation(maya, 'picnic-one', { type: 'close' }), maya.token);
    assert.equal(closed.receipt.accepted, true);
    const replay = await send(release, maya.token);
    assert.deepEqual(replay.receipt, acceptedRelease.receipt);
    assert.equal(replay.snapshot.actions.find(action => action.id === 'picnic-one').bringClaims[0].id, newClaim.id);
    const delayed = await send(operation(maya, 'picnic-one', { itemIndex: 0, intent: 'release', claimId: firstClaim.id }), maya.token);
    assert.equal(delayed.receipt.accepted, false, 'a delayed same-owner release must not remove the new claim');
    assert.equal(delayed.snapshot.actions.find(action => action.id === 'picnic-one').bringClaims[0].id, newClaim.id);
    const finalRelease = await send(operation(maya, 'picnic-one', { itemIndex: 0, intent: 'release', claimId: newClaim.id }), maya.token);
    assert.equal(finalRelease.receipt.accepted, true, 'releasing remains possible after the group vote closes');
    const plan = finalRelease.snapshot.actions.find(action => action.id === 'picnic-one');
    assert.deepEqual(plan.bringClaims, []);
    assert.equal(plan.outcome, 'no-quorum');
    assert.deepEqual(plan.rsvps, []);
    assert.deepEqual(plan.ballots, []);
  });
});

test('bring-item HTTP rejects invalid indexes, missing release identity, and unknown action targets without fallback', async () => {
  await withServer(async ({ request }) => {
    const { maya, operation, send } = await bringFixture(request);
    for (const itemIndex of [-1, 0.5, 3, Number.MAX_SAFE_INTEGER + 1, null, '0']) {
      const rejected = await send(operation(maya, 'picnic-one', { itemIndex, intent: 'claim' }), maya.token);
      assert.equal(rejected.status, 200);
      assert.equal(rejected.receipt.accepted, false, `invalid item index ${String(itemIndex)}`);
    }
    for (const fields of [{ itemIndex: 0, intent: 'release' }, { itemIndex: 0, intent: 'take' }, { intent: 'claim' }]) {
      const rejected = await send(operation(maya, 'picnic-one', fields), maya.token);
      assert.equal(rejected.receipt.accepted, false);
    }
    const unknown = await send(operation(maya, 'missing-plan', { itemIndex: 0, intent: 'claim' }), maya.token);
    assert.equal(unknown.receipt.accepted, false);
    const unplanned = await send({ ...operation(maya, 'reading-circle', { itemIndex: 0, intent: 'claim' }), membershipVersion: 'DEMO-MEMBERS-v1' }, maya.token);
    assert.equal(unplanned.receipt.accepted, false);
    const snapshot = await (await request('/api/state')).json();
    assert.ok(snapshot.actions.every(action => action.bringClaims.length === 0));
  });
});
