import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
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
  const filePath = join(directory, 'room.json');
  const store = await createDemoStore({ filePath });
  const server = createAppServer({ store, distDir });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = (path, options = {}) => fetch(origin + path, { ...options, signal: AbortSignal.timeout(5000) });
    await run({ request, origin, store, filePath });
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

const replacementPlan = (fields = {}) => ({
  title: 'Neighborhood picnic on a better day',
  description: 'Meet our neighbors with a revised rain plan and a shorter shopping list.',
  proposalTitle: 'Agree on the revised neighborhood picnic', beneficiaries: 'Our local neighbors',
  whenWhere: 'A public park, new details to be agreed', sourceLabel: '', sourceUrl: '',
  planning: { kind: 'potluck', date: '', timeHint: 'Late afternoon', cityId: 'new-york', place: 'Public park',
    budgetCents: 1800, expectedPeople: 6, rainPlan: 'Move to another day if rain is likely', accessibility: 'Step-free access',
    bring: ['Water', 'Fruit'] },
  ...fields,
});

test('authenticated author plan replacement is atomic, keeps the old decision history, and starts fresh participation', async () => {
  await withServer(async ({ request }) => {
    const { maya, noah, operation, send } = await bringFixture(request);
    const contribute = await send(operation(noah, 'picnic-one', { type: 'contribute', text: 'Can we pick a day with less rain?' }), noah.token);
    assert.equal(contribute.receipt.accepted, true);
    assert.equal((await send(operation(noah, 'picnic-one', { type: 'react', active: true }), noah.token)).receipt.accepted, true);
    assert.equal((await send(operation(maya, 'picnic-one', { type: 'rsvp', status: 'going' }), maya.token)).receipt.accepted, true);
    const claim = operation(noah, 'picnic-one', { itemIndex: 0, intent: 'claim' });
    assert.equal((await send(claim, noah.token)).receipt.accepted, true);
    for (const profile of [maya, noah]) assert.equal((await send(operation(profile, 'picnic-one', { type: 'vote', choice: 'approve' }), profile.token)).receipt.accepted, true);
    assert.equal((await send(operation(maya, 'picnic-one', { type: 'close' }), maya.token)).receipt.accepted, true);
    assert.equal((await send(operation(maya, 'picnic-one', { type: 'minutes', text: 'The group adopted a tentative picnic plan.' }), maya.token)).receipt.accepted, true);
    const before = (await (await request('/api/state')).json()).actions.find(action => action.id === 'picnic-one');
    assert.equal(before.outcome, 'adopted');
    const change = operation(maya, 'picnic-one', { type: 'change-plan', replacementActionId: 'picnic-revised', action: replacementPlan(),
      changeReason: 'Choose a different day and reduce the estimated budget.', expectedChangeId: null });
    const nonAuthor = await send({ ...change, id: randomUUID(), memberId: noah.profile.id }, noah.token);
    assert.equal(nonAuthor.receipt.accepted, false);
    const forged = await send(change, noah.token);
    assert.equal(forged.status, 403);
    assert.equal(forged.receipt.accepted, false);
    const invalid = await send({ ...change, id: randomUUID(), replacementActionId: 'invalid-replacement', action: replacementPlan({ title: '' }) }, maya.token);
    assert.equal(invalid.receipt.accepted, false);
    assert.equal(invalid.snapshot.actions.some(action => action.id === 'invalid-replacement'), false);
    assert.equal(invalid.snapshot.actions.find(action => action.id === 'picnic-one').lifecycle.status, 'active');
    const accepted = await send(change, maya.token);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.receipt.accepted, true, 'a forged request cannot reserve or poison the genuine author’s operation');
    const oldPlan = accepted.snapshot.actions.find(action => action.id === 'picnic-one');
    const successor = accepted.snapshot.actions.find(action => action.id === 'picnic-revised');
    assert.equal(oldPlan.lifecycle.status, 'superseded');
    assert.equal(oldPlan.lifecycle.changeId, change.id);
    assert.equal(oldPlan.lifecycle.changedBy, maya.profile.id);
    assert.equal(oldPlan.lifecycle.reason, change.changeReason);
    assert.equal(oldPlan.lifecycle.replacementActionId, successor.id);
    assert.deepEqual(successor.origin, { actionId: oldPlan.id, reason: change.changeReason, kind: 'change' });
    assert.equal(successor.createdBy, maya.profile.id);
    assert.equal(successor.planning.budgetCents, 1800);
    assert.equal(successor.lifecycle.status, 'active');
    assert.equal(successor.outcome, 'open');
    for (const field of ['ballots', 'contributions', 'minutes', 'rsvps', 'reactions', 'bringClaims', 'completedTasks']) {
      assert.deepEqual(oldPlan[field], before[field], `historical ${field} stay on their original plan`);
      assert.deepEqual(successor[field], [], `new ${field} require fresh participation`);
    }
    assert.equal(oldPlan.outcome, 'adopted');
    assert.equal(oldPlan.closedAt, before.closedAt);
    const replay = await send(change, maya.token);
    assert.deepEqual(replay.receipt, accepted.receipt);
    assert.equal(replay.snapshot.actions.filter(action => action.id === successor.id).length, 1);
    assert.equal(replay.snapshot.actions.find(action => action.id === 'picnic-two').lifecycle.status, 'active');
  });
});

test('cancelled plans retain adopted outcomes, reject new participation, permit exact-owner release, and restart once with a fresh ID', async () => {
  await withServer(async ({ request }) => {
    const { maya, noah, operation, send } = await bringFixture(request);
    const claim = operation(noah, 'picnic-one', { itemIndex: 0, intent: 'claim' });
    assert.equal((await send(claim, noah.token)).receipt.accepted, true);
    for (const profile of [maya, noah]) assert.equal((await send(operation(profile, 'picnic-one', { type: 'vote', choice: 'approve' }), profile.token)).receipt.accepted, true);
    assert.equal((await send(operation(maya, 'picnic-one', { type: 'close' }), maya.token)).receipt.accepted, true);
    const cancel = operation(maya, 'picnic-one', { type: 'cancel-plan', expectedChangeId: null, changeReason: 'The planned gathering can no longer take place.' });
    const accepted = await send(cancel, maya.token);
    assert.equal(accepted.receipt.accepted, true);
    const cancelled = accepted.snapshot.actions.find(action => action.id === 'picnic-one');
    assert.equal(cancelled.lifecycle.status, 'cancelled');
    assert.equal(cancelled.lifecycle.changeId, cancel.id);
    assert.equal(cancelled.outcome, 'adopted', 'author withdrawal does not rewrite the earlier group decision');
    const historicalBallots = structuredClone(cancelled.ballots);
    const denied = [
      { type: 'contribute', text: 'A late comment must stay on its original target.' },
      { type: 'react', active: true }, { type: 'rsvp', status: 'going' }, { type: 'vote', choice: 'approve' },
      { type: 'close' }, { type: 'minutes', text: 'These are new notes after the listing became inactive.' },
      { type: 'complete-task', taskId: 'agenda' }, { type: 'bring-item', itemIndex: 1, intent: 'claim' },
    ];
    for (const fields of denied) {
      const result = await send(operation(maya, 'picnic-one', fields), maya.token);
      assert.equal(result.receipt.accepted, false, `${fields.type} must not act on an inactive plan`);
      assert.equal(result.receipt.actionId, 'picnic-one');
    }
    const foreignRelease = await send(operation(maya, 'picnic-one', { itemIndex: 0, intent: 'release', claimId: claim.id }), maya.token);
    assert.equal(foreignRelease.receipt.accepted, false);
    assert.equal(foreignRelease.snapshot.actions.find(action => action.id === 'picnic-one').bringClaims.length, 1);
    const released = await send(operation(noah, 'picnic-one', { itemIndex: 0, intent: 'release', claimId: claim.id }), noah.token);
    assert.equal(released.receipt.accepted, true);
    assert.deepEqual(released.snapshot.actions.find(action => action.id === 'picnic-one').bringClaims, []);
    const restart = operation(maya, 'picnic-one', { type: 'change-plan', replacementActionId: 'picnic-start-again', action: replacementPlan(),
      changeReason: 'We have reviewed the cancellation and prepared a separate new plan.', expectedChangeId: cancel.id });
    const stale = await send({ ...restart, id: randomUUID(), replacementActionId: 'stale-restart', expectedChangeId: null }, maya.token);
    assert.equal(stale.receipt.accepted, false);
    assert.equal(stale.snapshot.actions.some(action => action.id === 'stale-restart'), false);
    const restarted = await send(restart, maya.token);
    assert.equal(restarted.receipt.accepted, true);
    const preserved = restarted.snapshot.actions.find(action => action.id === 'picnic-one');
    const successor = restarted.snapshot.actions.find(action => action.id === 'picnic-start-again');
    assert.equal(preserved.lifecycle.status, 'cancelled');
    assert.equal(preserved.lifecycle.changeId, cancel.id);
    assert.equal(preserved.lifecycle.reason, cancel.changeReason);
    assert.equal(preserved.lifecycle.replacementActionId, successor.id);
    assert.equal(preserved.outcome, 'adopted');
    assert.deepEqual(preserved.ballots, historicalBallots);
    assert.deepEqual(successor.origin, { actionId: preserved.id, reason: restart.changeReason, kind: 'restart' });
    assert.deepEqual(successor.ballots, []);
    const secondRestart = await send({ ...restart, id: randomUUID(), replacementActionId: 'another-successor' }, maya.token);
    assert.equal(secondRestart.receipt.accepted, false);
    assert.equal(secondRestart.snapshot.actions.some(action => action.id === 'another-successor'), false);
    const cancelReplay = await send(cancel, maya.token);
    assert.deepEqual(cancelReplay.receipt, accepted.receipt);
    assert.equal(cancelReplay.snapshot.actions.find(action => action.id === 'picnic-one').lifecycle.replacementActionId, successor.id);
    const oldTarget = await send(operation(noah, 'picnic-one', { type: 'rsvp', status: 'maybe' }), noah.token);
    assert.equal(oldTarget.receipt.accepted, false);
    assert.deepEqual(oldTarget.snapshot.actions.find(action => action.id === successor.id).rsvps, []);
  });
});

test('author cancel-versus-change requests with the same lifecycle token have exactly one winner', async () => {
  await withServer(async ({ request }) => {
    const { maya, operation, send } = await bringFixture(request);
    const missingToken = await send(operation(maya, 'picnic-one', { type: 'cancel-plan', changeReason: 'This request omitted explicit lifecycle consent.' }), maya.token);
    assert.equal(missingToken.receipt.accepted, false);
    const reusedTarget = await send(operation(maya, 'picnic-one', { type: 'change-plan', expectedChangeId: null,
      replacementActionId: 'picnic-two', action: replacementPlan(), changeReason: 'Do not replace an unrelated existing plan.' }), maya.token);
    assert.equal(reusedTarget.receipt.accepted, false);
    const cancel = operation(maya, 'picnic-one', { type: 'cancel-plan', expectedChangeId: null, changeReason: 'This gathering needs to be cancelled.' });
    const change = operation(maya, 'picnic-one', { type: 'change-plan', expectedChangeId: null,
      replacementActionId: 'race-successor', action: replacementPlan(), changeReason: 'The weather calls for a revised plan.' });
    const outcomes = await Promise.all([send(cancel, maya.token), send(change, maya.token)]);
    assert.deepEqual(outcomes.map(result => result.status), [200, 200]);
    assert.equal(outcomes.filter(result => result.receipt.accepted).length, 1);
    const cancelWon = outcomes[0].receipt.accepted;
    const current = await (await request('/api/state')).json();
    const source = current.actions.find(action => action.id === 'picnic-one');
    assert.equal(source.lifecycle.status, cancelWon ? 'cancelled' : 'superseded');
    assert.equal(source.lifecycle.changeId, cancelWon ? cancel.id : change.id);
    assert.equal(current.actions.some(action => action.id === 'race-successor'), !cancelWon);
    assert.equal(current.actions.length, cancelWon ? 3 : 4);
    const loser = cancelWon ? change : cancel;
    const rejectedReceipt = cancelWon ? outcomes[1].receipt : outcomes[0].receipt;
    const replay = await send(loser, maya.token);
    assert.deepEqual(replay.receipt, rejectedReceipt);
    assert.equal(replay.snapshot.actions.find(action => action.id === 'picnic-one').lifecycle.changeId, source.lifecycle.changeId);
    const synthetic = await send({ ...operation(maya, 'reading-circle', { type: 'cancel-plan', expectedChangeId: null, changeReason: 'A synthetic example has no actual listing author.' }),
      memberId: 'alex', membershipVersion: 'DEMO-MEMBERS-v1' });
    assert.equal(synthetic.status, 200);
    assert.equal(synthetic.receipt.accepted, false);
    assert.equal(synthetic.snapshot.actions.find(action => action.id === 'reading-circle').lifecycle.status, 'active');
  });
});

test('curated source references survive authenticated HTTP publication, immutable retries, and rejected-payload restart', async () => {
  await withServer(async ({ request, filePath }) => {
    const joined = await request('/api/community/join', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Maya', cityId: 'new-york' }),
    });
    assert.equal(joined.status, 200);
    const member = await joined.json();
    const sourceRef = { opportunityId: 'nyc-mesh-outreach', snapshotId: '2026-10-29-6760307447a4' };
    const sourceAction = {
      title: 'Bring an outreach question back to the group',
      description: 'What should our group ask about nontechnical outreach with NYC Mesh?',
      proposalTitle: 'Discuss an outreach question together', beneficiaries: 'Neighbors interested in community networking',
      whenWhere: 'Details to be agreed', sourceLabel: 'NYC Mesh volunteer guide — a member question',
      sourceUrl: 'https://www.nycmesh.net/volunteer/', sourceRef,
    };
    const operation = {
      id: randomUUID(), actionId: 'mesh-source-question', type: 'create-action', memberId: member.profile.id,
      roomId: member.snapshot.roomId, proposalRevision: 1, rulesVersion: 'DEMO-RULES-v1',
      membershipVersion: 'COMMUNITY-PREVIEW-v1', action: sourceAction,
    };
    const send = async op => {
      const response = await request('/api/operations', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${member.token}` },
        body: JSON.stringify(op),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    const accepted = await send(operation);
    assert.equal(accepted.receipt.accepted, true);
    const readPublished = async () => (await (await request('/api/state')).json()).actions.find(action => action.id === operation.actionId);
    const published = await readPublished();
    assert.deepEqual(published.sourceRef, sourceRef);
    assert.equal(published.sourceKind, 'member-provided', 'a curated reference does not turn the member’s question into an official assertion');
    assert.equal(published.sourceLabel, sourceAction.sourceLabel);
    assert.equal(published.sourceUrl, sourceAction.sourceUrl);
    const unknownRef = { ...sourceRef, snapshotId: '2026-10-29-000000000000' };
    const tampered = await send({ ...operation, action: { ...sourceAction, sourceRef: unknownRef } });
    assert.equal(tampered.receipt.accepted, false, 'an accepted operation ID cannot be reused with another nested source snapshot');
    assert.deepEqual((await readPublished()).sourceRef, sourceRef);
    const replay = await send(operation);
    assert.deepEqual(replay.receipt, accepted.receipt);
    assert.equal(replay.snapshot.actions.filter(action => action.id === operation.actionId).length, 1);
    const unknownCreate = { ...operation, id: randomUUID(), actionId: 'unlisted-source-question', action: { ...sourceAction, sourceRef: unknownRef } };
    const rejectedUnknown = await send(unknownCreate);
    assert.equal(rejectedUnknown.receipt.accepted, false);
    assert.equal(rejectedUnknown.snapshot.actions.some(action => action.id === unknownCreate.actionId), false);
    const malformedChange = {
      ...operation, id: randomUUID(), type: 'change-plan', replacementActionId: 'malformed-source-successor',
      expectedChangeId: null, changeReason: 'Review a separate proposal with its source kept explicit.',
      action: { ...sourceAction, sourceRef: null },
    };
    const rejectedMalformed = await send(malformedChange);
    assert.equal(rejectedMalformed.receipt.accepted, false);
    assert.equal(rejectedMalformed.snapshot.actions.some(action => action.id === malformedChange.replacementActionId), false);
    assert.equal((await readPublished()).lifecycle.status, 'active');
    assert.deepEqual((await readPublished()).sourceRef, sourceRef);
    const disk = JSON.parse(await readFile(filePath, 'utf8'));
    assert.deepEqual(disk.receipts[operation.id].operation, operation, 'tampered retries never replace the stored original publication payload');
    assert.deepEqual(disk.receipts[unknownCreate.id].operation, unknownCreate);
    assert.deepEqual(disk.receipts[malformedChange.id].operation, malformedChange);
    const restored = await createDemoStore({ filePath });
    assert.equal(await restored.authorized(member.profile.id, member.token), true);
    assert.deepEqual((await restored.submit(operation)).receipt, accepted.receipt);
    assert.deepEqual((await restored.submit(unknownCreate)).receipt, rejectedUnknown.receipt);
    assert.deepEqual((await restored.submit(malformedChange)).receipt, rejectedMalformed.receipt);
    assert.deepEqual((await restored.getState()).actions.find(action => action.id === operation.actionId).sourceRef, sourceRef);
  });
});
