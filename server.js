// Blook Maker server. Serves the app and the shared shapes catalog.
// No dependencies: run it with `node server.js`.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const DATA = process.env.DATA_DIR || join(ROOT, 'data');
const SHAPES_FILE = join(DATA, 'shapes.json');
const PASSWORD_FILE = join(DATA, 'admin-password.txt');
const PORT = Number(process.env.PORT || 5180);
const HOST = process.env.HOST || '127.0.0.1';

const MAX_BODY = 2 * 1024 * 1024;
const MAX_NODES = 20000;
const SESSION_MS = 8 * 60 * 60 * 1000;

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
let failedLogins = 0;

let shapes = existsSync(SHAPES_FILE) ? JSON.parse(readFileSync(SHAPES_FILE, 'utf8')) : [];

function saveShapes() {
  const tmp = SHAPES_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(shapes, null, 1));
  renameSync(tmp, SHAPES_FILE);
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
    subpaths,
  };
}

async function api(req, res, path) {
  if (req.method === 'GET' && path === '/api/shapes') return send(res, 200, { shapes });

  if (req.method === 'POST' && path === '/api/admin/login') {
    if (failedLogins >= 10) return send(res, 429, { error: 'Too many tries. Restart the server to try again.' });
    const { password } = await readJson(req);
    if (!passwordMatches(password)) {
      failedLogins += 1;
      return send(res, 401, { error: 'That password is not right.' });
    }
    failedLogins = 0;
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
server.listen(PORT, HOST, () => {
  console.log(`Running at http://localhost:${PORT}`);
  console.log(process.env.ADMIN_PASSWORD ? 'Admin password: set from ADMIN_PASSWORD' : `Admin password: ${adminPassword}`);
});
