// Blook Berry server. Serves the app and the shared shapes catalog.
// No dependencies: run it with `node server.js`.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const KEEP_AWAKE_MS = 10 * 60 * 1000;
const TRY_WINDOW_MS = 15 * 60 * 1000;
const MAX_TRIES = 20;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.png': 'image/png', '.webp': 'image/webp', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

mkdirSync(DATA, { recursive: true });

// Spaces, line breaks and quote marks pasted in by accident are not part of it.
const cleanPassword = (value) => String(value ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();

function loadPassword() {
  const fromEnv = cleanPassword(process.env.ADMIN_PASSWORD);
  if (fromEnv) return fromEnv;
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

/* ---------- Admin ---------- */

// Wrong admin passwords are limited per address.
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

const digest = (s) => createHash('sha256').update(String(s)).digest();
const passwordMatches = (attempt) => timingSafeEqual(digest(cleanPassword(attempt)), digest(adminPassword));

function isAdmin(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const expires = sessions.get(token);
  if (!expires) return false;
  if (expires < Date.now()) { sessions.delete(token); return false; }
  return true;
}

function send(res, status, body, type = 'application/json', cache = 'no-cache') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function readJson(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('That is too big to save.'), { status: 413 })); req.destroy(); return; }
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
    subpaths,
  };
}

async function api(req, res, path) {
  if (req.method === 'GET' && path === '/api/shapes') {
    return send(res, 200, { shapes, temporary: TEMPORARY_DISK });
  }
  if (req.method === 'GET' && path === '/api/blooks') return send(res, 200, { blooks: listBlooks() });
  if (path === '/api/tutorials' && req.method === 'GET') return send(res, 200, { tutorials: tutorialSummaries() });

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

// Every deploy serves its code from its own folder, /v/<version>/, so no browser
// or Cloudflare can keep running an old copy after an update. Those files never
// change, so they can be kept for a long time. The page itself is never kept.
const VERSION = (process.env.RENDER_GIT_COMMIT || '').slice(0, 10) || Date.now().toString(36);
const VERSIONED = /^\/v\/[\w-]{1,40}(\/.*)$/;
const FOREVER = 'public, max-age=31536000, immutable';

async function servePage(res) {
  const html = (await readFile(join(PUBLIC, 'index.html'), 'utf8'))
    .replace(/(href|src)="\/(app\.css|js\/[\w-]+\.js)"/g, `$1="/v/${VERSION}/$2"`);
  return send(res, 200, html, TYPES['.html'], 'no-cache');
}

async function serveStatic(req, res, path) {
  if (path === '/' || path === '/index.html') return servePage(res);
  if (path === '/tutorials' || path.startsWith('/tutorials/')) return serveTutorials(res, path);
  if (path.startsWith('/tutorials-media/')) return serveTutorialMedia(req, res, path);
  if (path === '/sitemap.xml') return serveSitemap(res);
  const versioned = path.match(VERSIONED);
  const rel = normalize(decodeURIComponent(versioned ? versioned[1] : path)).replace(/^[/\\]+/, '');
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + sep)) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    return send(res, 200, await readFile(file), TYPES[extname(file)] || 'application/octet-stream', versioned ? FOREVER : 'no-cache');
  } catch {
    return send(res, 404, 'Not found', 'text/plain');
  }
}

/* ---------- Tutorials ---------- */

// Video guides on /tutorials. They live in the tutorials folder beside this
// file: tutorials.json lists them, and their videos and thumbnails sit next to it.
//   { "slug": "first-blook", "name": "...", "description": "...", "date": "2026-11-13",
//     "video": "first-blook.mp4" or "youtube": "https://youtu.be/...", "thumbnail": "first-blook.jpg" }
const TUTORIALS_DIR = join(ROOT, 'tutorials');
const SITE_URL = (process.env.SITE_URL || 'https://blookberry.com').replace(/\/$/, '');
const MEDIA_TYPES = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

function youtubeId(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/) || v.trim().match(/^([\w-]{11})$/);
  return m ? m[1] : null;
}

// Read fresh each time, so a new tutorial shows as soon as it is deployed.
function tutorialList() {
  try {
    const list = JSON.parse(readFileSync(join(TUTORIALS_DIR, 'tutorials.json'), 'utf8'));
    return (Array.isArray(list) ? list : []).filter((t) => t && /^[a-z0-9-]{1,80}$/.test(t.slug) && t.name).map((t) => ({
      ...t, yt: youtubeId(t.youtube),
    }));
  } catch {
    return [];
  }
}

const mediaUrl = (file) => `/tutorials-media/${encodeURIComponent(file)}`;
const thumbUrl = (t) => (t.thumbnail ? mediaUrl(t.thumbnail) : t.yt ? `https://i.ytimg.com/vi/${t.yt}/hqdefault.jpg` : null);
const absolute = (u) => (u ? (u.startsWith('http') ? u : `${SITE_URL}${u}`) : `${SITE_URL}/og.png`);

// Videos and thumbnails, sent a part at a time when a player asks, so it can skip around.
async function serveTutorialMedia(req, res, path) {
  const name = decodeURIComponent(path.slice('/tutorials-media/'.length));
  if (!/^[\w.-]{1,120}$/.test(name) || name.startsWith('.') || name === 'tutorials.json') return send(res, 404, 'Not found', 'text/plain');
  const type = MEDIA_TYPES[extname(name).toLowerCase()];
  const file = join(TUTORIALS_DIR, name);
  if (!type || !existsSync(file)) return send(res, 404, 'Not found', 'text/plain');
  const bytes = await readFile(file);
  const total = bytes.length;
  const head = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' };
  const range = String(req.headers.range || '').match(/^bytes=(\d*)-(\d*)$/);
  if (!range || (range[1] === '' && range[2] === '')) {
    res.writeHead(200, { ...head, 'Content-Length': total });
    return res.end(bytes);
  }
  const start = Math.max(0, range[1] === '' ? total - Number(range[2]) : Number(range[1]));
  const end = range[1] === '' || range[2] === '' ? total - 1 : Math.min(Number(range[2]), total - 1);
  if (start > end || start >= total) {
    res.writeHead(416, { 'Content-Range': `bytes */${total}` });
    return res.end();
  }
  res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': end - start + 1 });
  return res.end(bytes.subarray(start, end + 1));
}

/* ---------- Pages Google and Discord can read ---------- */

const html = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const firstLine = (s, n = 160) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

function tutorialShell({ title, description, url, image, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${html(title)}</title>
  <meta name="description" content="${html(description)}">
  <link rel="canonical" href="${SITE_URL}${url}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Blook Berry">
  <meta property="og:title" content="${html(title)}">
  <meta property="og:description" content="${html(description)}">
  <meta property="og:url" content="${SITE_URL}${url}">
  <meta property="og:image" content="${image}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#b8344f">
  <link rel="icon" type="image/svg+xml" href="/logo.svg">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@500;600;700;800&display=swap">
  <link rel="stylesheet" href="/v/${VERSION}/tutorials.css">
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6503835134557426" crossorigin="anonymous"></script>
</head>
<body>
  <header class="tut-top">
    <a class="tut-brand" href="/"><img src="/logo.svg" alt=""><b>Blook Berry</b></a>
    <nav><a href="/tutorials">Tutorials</a><a class="tut-cta" href="/#/">Start drawing</a></nav>
  </header>
  <main class="tut-main">${body}</main>
  <footer class="tut-foot"><a href="/">Blook Berry</a> · <a href="/tutorials">Tutorials</a> · <a href="/privacy.html">Privacy</a></footer>
</body>
</html>`;
}

function playerMarkup(t) {
  if (t.yt) {
    return `<div class="tut-player"><iframe src="https://www.youtube-nocookie.com/embed/${html(t.yt)}" title="${html(t.name)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
  }
  if (t.video) {
    return `<div class="tut-player"><video controls preload="metadata" playsinline${t.thumbnail ? ` poster="${html(mediaUrl(t.thumbnail))}"` : ''} src="${html(mediaUrl(t.video))}"></video></div>`;
  }
  return '<div class="tut-player tut-novideo"><p>The video for this one is on its way.</p></div>';
}

async function serveTutorials(res, path) {
  const list = tutorialList();
  const slug = path.match(/^\/tutorials\/([a-z0-9-]{1,80})\/?$/)?.[1];
  if (slug) {
    const t = list.find((x) => x.slug === slug);
    if (!t) return send(res, 404, tutorialShell({ title: 'Not found · Blook Berry', description: 'That tutorial could not be found.', url: '/tutorials', image: `${SITE_URL}/og.png`, body: '<h1 class="tut-missing">That tutorial could not be found.</h1><p class="tut-back"><a href="/tutorials">See all tutorials</a></p>' }), TYPES['.html']);
    const body = `<p class="tut-back"><a href="/tutorials">← All tutorials</a></p>
      <article class="tut-one">
        ${playerMarkup(t)}
        <h1>${html(t.name)}</h1>
        <div class="tut-desc">${html(t.description).replace(/\n/g, '<br>')}</div>
      </article>`;
    return send(res, 200, tutorialShell({
      title: `${t.name} · Blook Berry tutorials`, description: firstLine(t.description) || `${t.name}: a Blook Berry tutorial.`,
      url: `/tutorials/${t.slug}`, image: absolute(thumbUrl(t)), body,
    }), TYPES['.html']);
  }
  const body = `<section class="tut-hero"><h1>Tutorials</h1><p>Learn to make Blooket-style art: draw a Blook, add shading, animate it and build packs.</p></section>
    <div class="tut-grid">${list.length ? list.map((t) => `<a class="tut-card" href="/tutorials/${t.slug}">
        <span class="tut-thumb">${thumbUrl(t) ? `<img src="${html(thumbUrl(t))}" alt="" loading="lazy">` : '<img src="/logo.svg" alt="" class="tut-noimg">'}${t.video || t.yt ? '<i class="tut-play"></i>' : ''}</span>
        <b>${html(t.name)}</b><small>${html(firstLine(t.description, 110))}</small>
      </a>`).join('') : '<p class="tut-empty">New tutorials are coming soon.</p>'}</div>`;
  return send(res, 200, tutorialShell({
    title: 'Tutorials · Blook Berry', description: 'Free video tutorials for making Blooket-style Blooks, packs and animations with Blook Berry.',
    url: '/tutorials', image: `${SITE_URL}/og.png`, body,
  }), TYPES['.html']);
}

// For the landing page: the newest few.
function tutorialSummaries() {
  return tutorialList().map((t) => ({ slug: t.slug, name: t.name, thumb: thumbUrl(t) }));
}

async function serveSitemap(res) {
  const urls = ['/', '/tutorials', '/privacy.html', ...tutorialList().map((t) => `/tutorials/${t.slug}`)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE_URL}${u}</loc></url>`).join('\n')}\n</urlset>\n`;
  return send(res, 200, xml, 'application/xml; charset=utf-8');
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname.startsWith('/api/')) await api(req, res, pathname);
    else await serveStatic(req, res, pathname);
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

console.log('Starting Blook Berry...');
// Render's free plan sleeps after 15 quiet minutes and shows its own loading page
// to the next visitor. KEEP_AWAKE=true visits the site from here so it stays up.
if (process.env.KEEP_AWAKE === 'true' && process.env.RENDER_EXTERNAL_URL) {
  setInterval(() => { fetch(process.env.RENDER_EXTERNAL_URL).catch(() => {}); }, KEEP_AWAKE_MS);
}
server.listen(PORT, HOST, () => {
  console.log(`Running at http://localhost:${PORT}`);
  // The length, never the password, so a stray space or a typo shows up in the logs.
  console.log(cleanPassword(process.env.ADMIN_PASSWORD) ? `Admin password: set from ADMIN_PASSWORD (${adminPassword.length} characters)` : `Admin password: ${adminPassword}`);
});
