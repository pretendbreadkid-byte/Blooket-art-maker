// Blook Maker server. Serves the app and the shared shapes catalog.
// No dependencies: run it with `node server.js`.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual, createHash, createHmac, scrypt as scryptCallback } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const BLOOKS = join(PUBLIC, 'blooks');
const DATA = process.env.DATA_DIR || join(ROOT, 'data');
// The catalog lives in the repo, so pushing to GitHub is what keeps it safe.
const SHAPES_FILE = process.env.DATA_DIR ? join(DATA, 'shapes.json') : join(ROOT, 'catalog', 'shapes.json');
// Render sets this. Its disk is wiped on every restart.
const TEMPORARY_DISK = !!process.env.RENDER;
const PASSWORD_FILE = join(DATA, 'admin-password.txt');
const PORT = Number(process.env.PORT || 5180);
const HOST = process.env.HOST || '127.0.0.1';

const MAX_BODY = 2 * 1024 * 1024;
const MAX_NODES = 20000;
const SESSION_MS = 8 * 60 * 60 * 1000;
const ACCOUNT_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const TRY_WINDOW_MS = 15 * 60 * 1000;
const MAX_TRIES = 20;

// Plus costs nothing for now. Set PLUS_IS_FREE=false once payment is connected.
const PLUS_IS_FREE = process.env.PLUS_IS_FREE !== 'false';

// Render's free disk is wiped on restart, so accounts can also be kept in a
// private GitHub repo. Set GITHUB_TOKEN and DATA_REPO (owner/name) to turn it on.
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const DATA_REPO = process.env.DATA_REPO;
const GITHUB_API = process.env.GITHUB_API || 'https://api.github.com';
const USERS_IN_GITHUB = !!(GITHUB_TOKEN && DATA_REPO);
const USERS_FILE = join(DATA, 'users.json');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

mkdirSync(DATA, { recursive: true });

function loadPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (existsSync(PASSWORD_FILE)) return readFileSync(PASSWORD_FILE, 'utf8').trim();
  const generated = randomBytes(9).toString('base64url');
  writeFileSync(PASSWORD_FILE, generated + '\n');
  return generated;
}

const adminPassword = loadPassword();
const sessions = new Map();
const tries = new Map();

let shapes = existsSync(SHAPES_FILE) ? JSON.parse(readFileSync(SHAPES_FILE, 'utf8')) : [];

function saveShapes() {
  const tmp = SHAPES_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(shapes, null, 1));
  renameSync(tmp, SHAPES_FILE);
}

/* ---------- Accounts ---------- */

const scrypt = promisify(scryptCallback);
const sessionSecret = createHash('sha256').update(`blook-session:${adminPassword}`).digest();
const usersUrl = `${GITHUB_API}/repos/${DATA_REPO}/contents/users.json`;
const githubHeaders = {
  Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'blook-maker',
};

let users = {};
let usersSha = null;
let usersWrite = Promise.resolve();

async function loadUsers() {
  if (!USERS_IN_GITHUB) {
    if (existsSync(USERS_FILE)) users = JSON.parse(readFileSync(USERS_FILE, 'utf8'));
    return;
  }
  const res = await fetch(usersUrl, { headers: githubHeaders });
  if (res.status === 404) return;
  if (!res.ok) throw new Error(`Could not read accounts from GitHub (${res.status}).`);
  const file = await res.json();
  usersSha = file.sha;
  users = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
}

async function writeUsers() {
  const json = JSON.stringify(users);
  if (!USERS_IN_GITHUB) {
    const tmp = USERS_FILE + '.tmp';
    writeFileSync(tmp, json);
    renameSync(tmp, USERS_FILE);
    return;
  }
  const res = await fetch(usersUrl, {
    method: 'PUT',
    headers: { ...githubHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Update accounts',
      content: Buffer.from(json).toString('base64'),
      ...(usersSha ? { sha: usersSha } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Could not save accounts to GitHub (${res.status}).`);
  usersSha = (await res.json()).content.sha;
}

// One save at a time, and a failed save does not block the next one.
function saveUsers() {
  const next = usersWrite.catch(() => {}).then(writeUsers);
  usersWrite = next;
  return next;
}

const hashPassword = async (password, salt) => (await scrypt(password, salt, 32)).toString('hex');
const publicUser = (u) => ({ name: u.name, plus: !!u.plus });
const sign = (payload) => createHmac('sha256', sessionSecret).update(payload).digest('base64url');

function issueToken(key) {
  const payload = Buffer.from(JSON.stringify({ u: key, e: Date.now() + ACCOUNT_SESSION_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function currentUser(req) {
  const [payload, signature] = (req.headers.authorization || '').replace(/^Bearer /, '').split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const { u, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  return e > Date.now() ? users[u] || null : null;
}

function triesFor(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim();
  const now = Date.now();
  let record = tries.get(ip);
  if (!record || record.reset < now) {
    record = { count: 0, reset: now + TRY_WINDOW_MS };
    tries.set(ip, record);
  }
  return record;
}

const TOO_MANY = { error: 'Too many tries. Wait a few minutes and try again.' };

async function register(req, res) {
  const record = triesFor(req);
  if (record.count >= MAX_TRIES) return send(res, 429, TOO_MANY);
  record.count += 1;
  const { username, password } = await readJson(req);
  if (typeof username !== 'string' || !/^[\w-]{3,20}$/.test(username)) {
    return send(res, 400, { error: 'Usernames need 3 to 20 letters or numbers.' });
  }
  if (typeof password !== 'string' || password.length < 6 || password.length > 100) {
    return send(res, 400, { error: 'Passwords need at least 6 characters.' });
  }
  const key = username.toLowerCase();
  const salt = randomBytes(16).toString('hex');
  const hash = await hashPassword(password, salt);
  if (users[key]) return send(res, 409, { error: 'That username is taken.' });
  users[key] = { name: username, salt, hash, plus: false, createdAt: Date.now() };
  await saveUsers();
  return send(res, 201, { token: issueToken(key), user: publicUser(users[key]) });
}

async function login(req, res) {
  const record = triesFor(req);
  if (record.count >= MAX_TRIES) return send(res, 429, TOO_MANY);
  const { username, password } = await readJson(req);
  const key = String(username || '').toLowerCase();
  const user = users[key];
  const attempt = user && typeof password === 'string' ? await hashPassword(password, user.salt) : '';
  if (!user || attempt.length !== user.hash.length || !timingSafeEqual(Buffer.from(attempt), Buffer.from(user.hash))) {
    record.count += 1;
    return send(res, 401, { error: 'That username or password is not right.' });
  }
  return send(res, 200, { token: issueToken(key), user: publicUser(user) });
}

const digest = (s) => createHash('sha256').update(String(s)).digest();
const passwordMatches = (attempt) => timingSafeEqual(digest(attempt), digest(adminPassword));

function isAdmin(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const expires = sessions.get(token);
  if (!expires) return false;
  if (expires < Date.now()) { sessions.delete(token); return false; }
  return true;
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('That shape is too big.'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('Bad request.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

// Drop an SVG into public/blooks and it shows up in the editor.
function listBlooks() {
  if (!existsSync(BLOOKS)) return [];
  return readdirSync(BLOOKS).filter((f) => f.endsWith('.svg')).sort().map((file) => {
    const name = file.replace(/\.svg$/, '').replace(/-/g, ' ');
    return { file, name: name[0].toUpperCase() + name.slice(1) };
  });
}

const cleanText = (v, max, fallback) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback);

// Rebuilds the shape from numbers only, so nothing but geometry is ever stored.
function cleanShape(input) {
  const subpaths = [];
  let total = 0;
  if (!Array.isArray(input?.subpaths) || !input.subpaths.length) throw new Error('This shape has no outline.');
  for (const sp of input.subpaths) {
    if (!Array.isArray(sp?.nodes) || sp.nodes.length < 2) continue;
    total += sp.nodes.length;
    if (total > MAX_NODES) throw new Error('This shape has too many points.');
    const nodes = sp.nodes.map((n) => {
      const out = {};
      for (const key of ['x', 'y', 'ix', 'iy', 'ox', 'oy', 'r']) {
        if (n[key] === undefined) continue;
        if (!Number.isFinite(n[key])) throw new Error('This shape has invalid points.');
        out[key] = n[key];
      }
      if (out.x === undefined || out.y === undefined) throw new Error('This shape has invalid points.');
      return out;
    });
    subpaths.push({ closed: !!sp.closed, nodes });
  }
  if (!subpaths.length) throw new Error('This shape has no outline.');
  return {
    name: cleanText(input.name, 60, 'Shape'),
    category: cleanText(input.category, 40, 'Uploaded'),
    fillRule: input.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
    lineOnly: !!input.lineOnly,
    plus: !!input.plus,
    subpaths,
  };
}

async function api(req, res, path) {
  if (req.method === 'GET' && path === '/api/shapes') {
    return send(res, 200, { shapes, temporary: TEMPORARY_DISK, accountsTemporary: TEMPORARY_DISK && !USERS_IN_GITHUB });
  }
  if (req.method === 'GET' && path === '/api/blooks') return send(res, 200, { blooks: listBlooks() });
  if (req.method === 'POST' && path === '/api/auth/register') return register(req, res);
  if (req.method === 'POST' && path === '/api/auth/login') return login(req, res);
  if (path === '/api/me' || path === '/api/plus/join') {
    const user = currentUser(req);
    if (!user) return send(res, 401, { error: 'Please log in.' });
    if (req.method === 'GET' && path === '/api/me') return send(res, 200, { user: publicUser(user) });
    if (req.method === 'POST' && path === '/api/plus/join') {
      if (!PLUS_IS_FREE) return send(res, 402, { error: 'Plus is not available yet.' });
      user.plus = true;
      await saveUsers();
      return send(res, 200, { user: publicUser(user) });
    }
  }

  if (req.method === 'POST' && path === '/api/admin/login') {
    const record = triesFor(req);
    if (record.count >= MAX_TRIES) return send(res, 429, TOO_MANY);
    const { password } = await readJson(req);
    if (!passwordMatches(password)) {
      record.count += 1;
      return send(res, 401, { error: 'That password is not right.' });
    }
    const token = randomBytes(24).toString('hex');
    sessions.set(token, Date.now() + SESSION_MS);
    return send(res, 200, { token });
  }

  if (!isAdmin(req)) return send(res, 401, { error: 'Please sign in as an admin.' });

  if (req.method === 'POST' && path === '/api/shapes') {
    const shape = { id: 's' + randomBytes(6).toString('hex'), ...cleanShape(await readJson(req)) };
    shapes.push(shape);
    saveShapes();
    return send(res, 201, { shape });
  }

  const match = path.match(/^\/api\/shapes\/([\w-]+)$/);
  const index = match ? shapes.findIndex((s) => s.id === match[1]) : -1;
  if (match && index < 0) return send(res, 404, { error: 'Shape not found.' });

  if (req.method === 'PATCH' && match) {
    const patch = await readJson(req);
    shapes[index].name = cleanText(patch.name, 60, shapes[index].name);
    shapes[index].category = cleanText(patch.category, 40, shapes[index].category);
    if (typeof patch.plus === 'boolean') shapes[index].plus = patch.plus;
    saveShapes();
    return send(res, 200, { shape: shapes[index] });
  }

  if (req.method === 'DELETE' && match) {
    shapes.splice(index, 1);
    saveShapes();
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: 'Not found.' });
}

async function serveStatic(res, path) {
  const rel = normalize(decodeURIComponent(path === '/' ? '/index.html' : path)).replace(/^[/\\]+/, '');
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + sep)) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    return send(res, 200, await readFile(file), TYPES[extname(file)] || 'application/octet-stream');
  } catch {
    return send(res, 404, 'Not found', 'text/plain');
  }
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname.startsWith('/api/')) await api(req, res, pathname);
    else await serveStatic(res, pathname);
  } catch (err) {
    if (!res.headersSent) send(res, err.status || 400, { error: err.message || 'Something went wrong.' });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Running at http://localhost:${PORT} (already started)`);
    process.exit(0);
  }
  throw err;
});

console.log('Starting Blook Maker...');
await loadUsers();
if (TEMPORARY_DISK && !USERS_IN_GITHUB) {
  console.log('Warning: accounts will be lost on restart. Set GITHUB_TOKEN and DATA_REPO to keep them.');
}
server.listen(PORT, HOST, () => {
  console.log(`Running at http://localhost:${PORT}`);
  console.log(process.env.ADMIN_PASSWORD ? 'Admin password: set from ADMIN_PASSWORD' : `Admin password: ${adminPassword}`);
});
