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
const remoteFiles = new Map();
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
      const remoteFile = remoteFiles.get(req.url);
      if (req.method === 'GET') {
        if (!remoteFile) { res.writeHead(404).end('{}'); return; }
        const raw = String(req.headers.accept).includes('raw');
        res.writeHead(200).end(raw ? Buffer.from(remoteFile.content, 'base64') : JSON.stringify(remoteFile));
        return;
      }
      if (req.url.includes('/readonly/')) { res.writeHead(404).end('{}'); return; }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (remoteFile && body.sha !== remoteFile.sha) { res.writeHead(409).end('{}'); return; }
      if (req.method === 'DELETE') { remoteFiles.delete(req.url); res.writeHead(200).end('{}'); return; }
      githubWrites += 1;
      const saved = { sha: `sha${githubWrites}`, content: body.content };
      remoteFiles.set(req.url, saved);
      res.writeHead(200).end(JSON.stringify({ content: { sha: saved.sha } }));
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

const artCall = (method, path, token, body) => fetch(BASE + path, {
  method,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});

const project = (id, updatedAt) => ({ doc: { id, updatedAt, name: 'Art', layers: [] }, thumb: 'data:image/png;base64,AAAA' });

test('art saves to the account and survives a restart', async () => {
  let server = await startServer();
  const { token } = await (await post('/api/auth/register', { username: 'painter', password: 'hunter22' })).json();
  assert.equal((await artCall('GET', '/api/art')).status, 401);
  assert.equal((await artCall('PUT', '/api/art/p1', token, project('p1', 100))).status, 200);
  assert.equal((await artCall('PUT', '/api/art/folders', token, { folders: [{ id: 'f1', name: 'Mine' }], at: 5 })).status, 200);
  await stopServer(server);

  server = await startServer();
  const index = await (await artCall('GET', '/api/art', token)).json();
  assert.deepEqual(index.projects, { p1: 100 });
  assert.deepEqual(index.folders, [{ id: 'f1', name: 'Mine' }]);
  const saved = await (await artCall('GET', '/api/art/p1', token)).json();
  assert.equal(saved.doc.name, 'Art');
  assert.equal(saved.thumb, 'data:image/png;base64,AAAA');
  await stopServer(server);
});

test('nobody can see or change art on another account', async () => {
  const server = await startServer();
  const a = (await (await post('/api/auth/register', { username: 'owner1', password: 'hunter22' })).json()).token;
  const b = (await (await post('/api/auth/register', { username: 'owner2', password: 'hunter22' })).json()).token;
  await artCall('PUT', '/api/art/secret', a, project('secret', 100));
  assert.equal((await artCall('GET', '/api/art/secret', b)).status, 404);
  assert.deepEqual((await (await artCall('GET', '/api/art', b)).json()).projects, {});
  await artCall('DELETE', '/api/art/secret', b);
  assert.equal((await artCall('GET', '/api/art/secret', a)).status, 200);
  await stopServer(server);
});

test('an older save never replaces a newer one, and deleted art stays deleted', async () => {
  const server = await startServer();
  const { token } = await (await post('/api/auth/register', { username: 'twodevice', password: 'hunter22' })).json();
  await artCall('PUT', '/api/art/p1', token, project('p1', 200));
  assert.equal((await artCall('PUT', '/api/art/p1', token, project('p1', 100))).status, 409);
  assert.equal((await (await artCall('GET', '/api/art/p1', token)).json()).doc.updatedAt, 200);
  assert.equal((await artCall('DELETE', '/api/art/p1', token)).status, 200);
  assert.equal((await artCall('PUT', '/api/art/p1', token, project('p1', 200))).status, 410);
  const index = await (await artCall('GET', '/api/art', token)).json();
  assert.deepEqual(index.projects, {});
  assert.ok(index.deleted.p1);
  await stopServer(server);
});

test('bad project ids and mismatched projects are refused', async () => {
  const server = await startServer();
  const { token } = await (await post('/api/auth/register', { username: 'badids', password: 'hunter22' })).json();
  assert.equal((await artCall('PUT', '/api/art/p1', token, project('other', 100))).status, 400);
  assert.equal((await artCall('GET', '/api/art/..%2F..%2Fusers', token)).status, 404);
  await stopServer(server);
});

test('art kept in GitHub survives a wiped disk', async () => {
  const github_env = { GITHUB_TOKEN: 'fake-token', DATA_REPO: 'me/data', GITHUB_API: `http://127.0.0.1:${GITHUB_PORT}` };
  const firstDisk = mkdtempSync(join(tmpdir(), 'blook-disk-'));
  let server = await startServer({ ...github_env, DATA_DIR: firstDisk });
  const { token } = await (await post('/api/auth/register', { username: 'cloudart', password: 'hunter22' })).json();
  assert.equal((await artCall('PUT', '/api/art/p1', token, project('p1', 100))).status, 200);
  assert.equal((await artCall('PUT', '/api/art/p1', token, project('p1', 200))).status, 200);
  await stopServer(server);
  rmSync(firstDisk, { recursive: true, force: true });

  const freshDisk = mkdtempSync(join(tmpdir(), 'blook-disk-'));
  server = await startServer({ ...github_env, DATA_DIR: freshDisk });
  assert.deepEqual((await (await artCall('GET', '/api/art', token)).json()).projects, { p1: 200 });
  assert.equal((await (await artCall('GET', '/api/art/p1', token)).json()).doc.updatedAt, 200);
  assert.equal((await artCall('DELETE', '/api/art/p1', token)).status, 200);
  assert.equal((await artCall('GET', '/api/art/p1', token)).status, 404);
  await stopServer(server);
  rmSync(freshDisk, { recursive: true, force: true });
});

test('logins last through a restart on a wiped disk with no admin password', async () => {
  const name = `wake${Date.now() % 100000}`;
  const disk = () => mkdtempSync(join(tmpdir(), 'blook-disk-'));
  const github = { GITHUB_TOKEN: 'fake-token', DATA_REPO: 'me/data', GITHUB_API: `http://127.0.0.1:${GITHUB_PORT}`, ADMIN_PASSWORD: '' };
  let server = await startServer({ ...github, DATA_DIR: disk() });
  const { token } = await (await fetch(`${BASE}/api/auth/register`, { method: 'POST', body: JSON.stringify({ username: name, password: 'secret12' }) })).json();
  await stopServer(server);
  server = await startServer({ ...github, DATA_DIR: disk() });
  const me = await fetch(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(me.status, 200);
  await stopServer(server);
});

test('uploaded pictures stay on the account and only that account', async () => {
  let server = await startServer();
  const signUp = async (username) => (await (await fetch(`${BASE}/api/auth/register`, { method: 'POST', body: JSON.stringify({ username, password: 'secret12' }) })).json()).token;
  const stamp = Date.now() % 100000;
  const mine = await signUp(`up${stamp}`);
  const theirs = await signUp(`ot${stamp}`);
  const ask = (token, method, path, body) => fetch(`${BASE}/api/uploads${path}`, { method, headers: { Authorization: `Bearer ${token}` }, body: body && JSON.stringify(body) });
  const href = 'data:image/png;base64,iVBORw0KGgo=';

  assert.equal((await fetch(`${BASE}/api/uploads`)).status, 401);
  assert.equal((await ask(mine, 'PUT', '/up-1', { name: 'Script', href: 'javascript:alert(1)' })).status, 400);
  assert.equal((await ask(mine, 'PUT', '/up-1', { name: 'Page', href: 'data:text/html;base64,AAAA' })).status, 400);
  assert.equal((await ask(mine, 'PUT', '/index', { name: 'Index', href })).status, 404);
  assert.equal((await ask(mine, 'PUT', '/up-1', { name: 'Cat', href })).status, 200);

  await stopServer(server);
  server = await startServer();
  assert.deepEqual((await (await ask(mine, 'GET', '')).json()).uploads, [{ id: 'up-1', name: 'Cat' }]);
  assert.equal((await (await ask(mine, 'GET', '/up-1')).json()).href, href);
  assert.deepEqual((await (await ask(theirs, 'GET', '')).json()).uploads, []);
  assert.equal((await ask(theirs, 'GET', '/up-1')).status, 404);

  assert.equal((await ask(mine, 'DELETE', '/up-1')).status, 200);
  assert.equal((await ask(mine, 'GET', '/up-1')).status, 404);
  await stopServer(server);
  server = await startServer();
  assert.deepEqual((await (await ask(mine, 'GET', '')).json()).uploads, []);
  await stopServer(server);
});

test('a storage repo that cannot be written to does not stop the site starting', async () => {
  const server = await startServer({ GITHUB_TOKEN: 'fake-token', DATA_REPO: 'me/readonly/tree/main', GITHUB_API: `http://127.0.0.1:${GITHUB_PORT}`, ADMIN_PASSWORD: '', DATA_DIR: mkdtempSync(join(tmpdir(), 'blook-disk-')) });
  assert.equal((await fetch(`${BASE}/api/blooks`)).status, 200);
  await stopServer(server);
});
