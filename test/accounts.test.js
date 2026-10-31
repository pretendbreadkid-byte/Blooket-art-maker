import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 5198, GITHUB_PORT = 5197;
const BASE = `http://127.0.0.1:${PORT}`;

let dataDir;
let github;
let remoteFile = null;
let githubWrites = 0;

async function startServer(extra = {}) {
  const server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT, ADMIN_PASSWORD: 'admin-pw', DATA_DIR: dataDir, ...extra },
  });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => { if (String(d).includes('Running at')) resolve(); });
    server.once('exit', reject);
  });
  server.removeAllListeners('exit');
  return server;
}

const stopServer = (server) => new Promise((resolve) => { server.once('exit', resolve); server.kill(); });

const post = (path, body, token) => fetch(BASE + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body || {}),
});

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'blook-accounts-'));
  github = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.headers.authorization !== 'Bearer fake-token') { res.writeHead(401).end('{}'); return; }
      if (req.method === 'GET') {
        if (!remoteFile) { res.writeHead(404).end('{}'); return; }
        res.writeHead(200).end(JSON.stringify(remoteFile));
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (remoteFile && body.sha !== remoteFile.sha) { res.writeHead(409).end('{}'); return; }
      githubWrites += 1;
      remoteFile = { sha: `sha${githubWrites}`, content: body.content };
      res.writeHead(200).end(JSON.stringify({ content: { sha: remoteFile.sha } }));
    });
  });
  await new Promise((r) => { github.listen(GITHUB_PORT, r); });
});

after(() => {
  github.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test('accounts sign up, log in, stay signed in and survive a restart', async () => {
  let server = await startServer();
  const created = await post('/api/auth/register', { username: 'Breadlet', password: 'hunter22' });
  assert.equal(created.status, 201);
  const { token, user } = await created.json();
  assert.deepEqual(user, { name: 'Breadlet', plus: false });

  assert.equal((await post('/api/auth/register', { username: 'breadlet', password: 'another1' })).status, 409);
  assert.equal((await post('/api/auth/login', { username: 'Breadlet', password: 'wrong-one' })).status, 401);
  assert.equal((await post('/api/auth/login', { username: 'BREADLET', password: 'hunter22' })).status, 200);

  await stopServer(server);
  server = await startServer();
  const me = await fetch(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.name, 'Breadlet');
  await stopServer(server);
});

test('passwords are never stored as plain text', () => {
  const stored = readFileSync(join(dataDir, 'users.json'), 'utf8');
  assert.ok(!stored.includes('hunter22'));
  assert.ok(stored.includes('"hash"'));
});

test('bad sign-ups are refused', async () => {
  const server = await startServer();
  assert.equal((await post('/api/auth/register', { username: 'a', password: 'hunter22' })).status, 400);
  assert.equal((await post('/api/auth/register', { username: 'okname', password: '123' })).status, 400);
  assert.equal((await post('/api/auth/register', { username: '<script>', password: 'hunter22' })).status, 400);
  await stopServer(server);
});

test('a forged token is refused', async () => {
  const server = await startServer();
  const payload = Buffer.from(JSON.stringify({ u: 'breadlet', e: Date.now() + 100000 })).toString('base64url');
  const res = await fetch(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${payload}.forged` } });
  assert.equal(res.status, 401);
  await stopServer(server);
});

test('Plus is free for now and can be switched off later', async () => {
  let server = await startServer();
  const { token } = await (await post('/api/auth/register', { username: 'plususer', password: 'hunter22' })).json();
  assert.equal((await post('/api/plus/join')).status, 401);
  const joined = await post('/api/plus/join', null, token);
  assert.equal(joined.status, 200);
  assert.equal((await joined.json()).user.plus, true);
  await stopServer(server);

  server = await startServer({ PLUS_IS_FREE: 'false' });
  const { token: other } = await (await post('/api/auth/register', { username: 'laterone', password: 'hunter22' })).json();
  assert.equal((await post('/api/plus/join', null, other)).status, 402);
  await stopServer(server);
});

test('accounts kept in GitHub survive a wiped disk', async () => {
  const github_env = { GITHUB_TOKEN: 'fake-token', DATA_REPO: 'me/data', GITHUB_API: `http://127.0.0.1:${GITHUB_PORT}` };
  const firstDisk = mkdtempSync(join(tmpdir(), 'blook-disk-'));
  let server = await startServer({ ...github_env, DATA_DIR: firstDisk });
  assert.equal((await post('/api/auth/register', { username: 'cloudy', password: 'hunter22' })).status, 201);
  await stopServer(server);
  assert.equal(githubWrites, 1);
  rmSync(firstDisk, { recursive: true, force: true });

  const freshDisk = mkdtempSync(join(tmpdir(), 'blook-disk-'));
  server = await startServer({ ...github_env, DATA_DIR: freshDisk });
  assert.equal((await post('/api/auth/login', { username: 'cloudy', password: 'hunter22' })).status, 200);
  assert.equal((await post('/api/auth/register', { username: 'second', password: 'hunter22' })).status, 201);
  assert.equal(githubWrites, 2);
  await stopServer(server);
  rmSync(freshDisk, { recursive: true, force: true });
});
