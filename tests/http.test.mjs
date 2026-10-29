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
