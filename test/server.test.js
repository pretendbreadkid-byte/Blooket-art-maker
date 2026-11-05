import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 5199;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'test-password';
const SHAPE = {
  name: 'Blob', category: 'Tests',
  subpaths: [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 9 }] }],
};

let server, dataDir, token;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'blook-test-'));
  server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT, ADMIN_PASSWORD: PASSWORD, DATA_DIR: dataDir },
  });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => { if (String(d).includes('Running at')) resolve(); });
    server.on('exit', reject);
  });
});

after(() => {
  server.removeAllListeners('exit');
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
});

const api = (method, path, body, auth = true) => fetch(BASE + path, {
  method,
  headers: { 'Content-Type': 'application/json', ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});

test('serves the app', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Blook Berry/);
});

test('does not serve files outside public', async () => {
  for (const path of ['/..%2fserver.js', '/..%2f..%2fserver.js', '/%2e%2e/package.json']) {
    const res = await fetch(BASE + path);
    assert.notEqual(res.status, 200, path);
  }
});

test('anyone can read the catalog but not change it', async () => {
  assert.equal((await api('GET', '/api/shapes', null, false)).status, 200);
  assert.equal((await api('POST', '/api/shapes', SHAPE, false)).status, 401);
  assert.equal((await api('DELETE', '/api/shapes/abc', null, false)).status, 401);
});

test('anyone can list the Blook assets and open one', async () => {
  const { blooks } = await (await fetch(`${BASE}/api/blooks`)).json();
  assert.ok(blooks.length > 200);
  const toast = blooks.find((b) => b.file === 'toast.svg');
  assert.equal(toast.name, 'Toast');
  const res = await fetch(`${BASE}/blooks/toast.svg`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/svg+xml');
});

test('a wrong password is refused', async () => {
  assert.equal((await api('POST', '/api/admin/login', { password: 'nope' }, false)).status, 401);
});

test('an admin can add, rename and delete a shape', async () => {
  const login = await api('POST', '/api/admin/login', { password: PASSWORD }, false);
  assert.equal(login.status, 200);
  ({ token } = await login.json());

  const created = await api('POST', '/api/shapes', SHAPE);
  assert.equal(created.status, 201);
  const { shape } = await created.json();
  assert.equal(shape.name, 'Blob');

  await api('PATCH', `/api/shapes/${shape.id}`, { name: 'Renamed' });
  const list = await (await api('GET', '/api/shapes')).json();
  assert.equal(list.shapes.find((s) => s.id === shape.id).name, 'Renamed');

  assert.equal((await api('DELETE', `/api/shapes/${shape.id}`)).status, 200);
  assert.equal((await api('DELETE', `/api/shapes/${shape.id}`)).status, 404);
});

test('only numbers survive in uploaded geometry', async () => {
  const evil = {
    ...SHAPE,
    subpaths: [{ closed: true, onload: 'x', nodes: [{ x: 0, y: 0, extra: '<script>' }, { x: 1, y: 1 }] }],
  };
  const { shape } = await (await api('POST', '/api/shapes', evil)).json();
  assert.ok(!JSON.stringify(shape).includes('script'));
  assert.ok(!JSON.stringify(shape).includes('onload'));

  const bad = { ...SHAPE, subpaths: [{ closed: true, nodes: [{ x: '"/><script>', y: 0 }, { x: 1, y: 1 }] }] };
  assert.equal((await api('POST', '/api/shapes', bad)).status, 400);
  assert.equal((await api('POST', '/api/shapes', { name: 'empty' })).status, 400);
});
