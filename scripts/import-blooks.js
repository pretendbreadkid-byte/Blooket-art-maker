// Copies SVG files from a folder into public/blooks with tidy names, skipping
// exact duplicates. Run: node scripts/import-blooks.js "C:\path\to\folder"
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FROM = process.argv[2];
const TO = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'blooks');

if (!FROM || !existsSync(FROM)) {
  console.log('Tell me which folder to copy from: node scripts/import-blooks.js "C:\\path\\to\\folder"');
  process.exit(1);
}

const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

// "arcticfox (1).svg" becomes "arcticfox", "tanuki animation..svg" becomes "tanuki-animation".
const slug = (file) => file.replace(/\.svg$/i, '').replace(/\s*\(\d+\)\s*$/, '').replace(/\.+$/, '')
  .trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

mkdirSync(TO, { recursive: true });
const seen = new Map(readdirSync(TO).map((f) => [hash(join(TO, f)), f]));
const taken = new Set(seen.values());
let added = 0;

for (const file of readdirSync(FROM).sort()) {
  if (!file.toLowerCase().endsWith('.svg')) continue;
  const source = join(FROM, file);
  const key = hash(source);
  if (seen.has(key)) continue;
  const base = slug(file) || 'blook';
  let name = `${base}.svg`;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}.svg`;
  copyFileSync(source, join(TO, name));
  seen.set(key, name);
  taken.add(name);
  added += 1;
}

console.log(`Added ${added} new. ${taken.size} blooks in public/blooks.`);
