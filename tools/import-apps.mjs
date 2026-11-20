// Brings the video editor and the code studio into Blook Berry as /video and /code.
// Run: node tools/import-apps.mjs "<path to Frameberry video editor.html>" "<path to CodeBerry.html>"
// It keeps the apps as they are and only changes their name, logo, colours and fonts
// to match Blook Berry. Discover in the code studio needs Claude, so it is hidden here.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [videoSrc, codeSrc] = process.argv.slice(2);
if (!videoSrc || !codeSrc) {
  console.error('Usage: node tools/import-apps.mjs <video editor.html> <code studio.html>');
  process.exit(1);
}
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

function swap(text, from, to, { all = false, optional = false } = {}) {
  if (!text.includes(from)) {
    if (optional) return text;
    throw new Error(`Could not find: ${from.slice(0, 90)}`);
  }
  return all ? text.split(from).join(to) : text.replace(from, () => to);
}

const FONTS = `<link rel="icon" type="image/svg+xml" href="/logo.svg">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@500;600;700;800&display=swap">
<style>@font-face { font-family: "Titan One"; src: url(/fonts/TitanOne.woff2) format("woff2"); font-display: swap; }</style>`;

/* ---------- Video maker ---------- */

let video = readFileSync(videoSrc, 'utf8').replace(/\r\n/g, '\n');
video = swap(video, '<html lang="en">', '<html lang="en" data-theme="light">');
video = swap(video, '<title>Frameberry video editor</title>', `<title>Video maker · Blook Berry</title>\n${FONTS}`);
video = video.replace(/<div class="brand" aria-label="Frameberry">[\s\S]*?<\/div>/, '<a class="brand" href="/#/art" title="Back to Blook Berry"><img src="/logo.svg" alt=""><span>Blook Berry <small>Video</small></span></a>');
video = swap(video, '<rect width="560" height="128" fill="#231A4A"/>', '<rect width="560" height="128" fill="#962843"/>');
video = swap(video, "text:'Hello,\\nFrameberry'", "text:'Hello,\\nBlook Berry'");
video = swap(video, '</style>\n</head>', `
/* ---------- Blook Berry look ---------- */
:root:root {
  --bg: #b8344f; --surface: #ffffff; --surface-2: #faeef0; --surface-3: #f1dde1; --line: #f1dde1;
  --ink: #4f1c28; --muted: #806066; --berry: #0bc2cf; --berry-soft: #dcf6f8; --mint: #5cc443;
  --stage: #1fb3d6; --dot: rgba(255, 255, 255, .18); --scrim: rgba(58, 16, 30, .5);
  --t-video: #7fd6f0; --t-text: #ff8fae; --t-sticker: #ffc93c; --t-audio: #74d65c; --t-fx: #ffa877;
  --item-ink: #3a1020;
  --display: Nunito, "Segoe UI", system-ui, sans-serif;
  --body: Nunito, "Segoe UI", system-ui, sans-serif;
  color-scheme: light;
}
#themeBtn { display: none; }
.brand, .w-in h1, .dialog h2 { font-family: "Titan One", Nunito, sans-serif; font-weight: 400; letter-spacing: .01em; }
.brand { color: #fff; text-shadow: 0 2px 0 rgba(0, 0, 0, .2); text-decoration: none; }
.brand img { width: 36px; height: 36px; filter: drop-shadow(0 2px 0 rgba(0, 0, 0, .25)); }
.brand small { font: 800 13px Nunito, sans-serif; text-shadow: none; background: rgba(255, 255, 255, .2); border-radius: 999px; padding: 2px 9px; margin-left: 4px; vertical-align: 3px; }
.topbar { color: #fff; }
.topbar .proj-name { color: #fff; }
.topbar .proj-name:hover { border-color: rgba(255, 255, 255, .45); }
.topbar .proj-name:focus { color: var(--ink); }
.topbar .icon-btn:hover:not(:disabled) { background: rgba(255, 255, 255, .2); }
.topbar .btn.ghost { color: #fff; border-color: rgba(255, 255, 255, .45); }
.topbar .btn.ghost:hover:not(:disabled) { background: rgba(255, 255, 255, .18); }
.btn { font-weight: 800; }
.btn.primary { box-shadow: 0 4px 0 #0a8f99; }
.btn.primary:active { transform: translateY(3px); box-shadow: 0 1px 0 #0a8f99; }
.play { box-shadow: 0 4px 0 #0a8f99; }
.panel, .timeline-area, .stage { border: 0; box-shadow: 0 6px 0 rgba(0, 0, 0, .14); }
.stage { background-color: var(--stage); background-image: radial-gradient(var(--dot) 1.2px, transparent 1.6px), linear-gradient(150deg, #20c9d6, #2f9cec); background-size: 18px 18px, 100% 100%; }
.transport .tc { color: #fff; }
.transport .tc span { color: rgba(255, 255, 255, .75); }
.transport .icon-btn { color: #fff; }
.transport .icon-btn:hover:not(:disabled) { background: rgba(255, 255, 255, .2); }
.tab[aria-selected="true"] { background: var(--berry-soft); color: #0a8f99; }
.chip.on, .ttile.on { background: var(--berry); color: #fff; }
.playhead, .ph-knob, .ph-split, .insert-mark, .guide { background: #d81e4a; }
.toast { background: var(--ink); color: #fff; }
.toast button { color: #ffc93c; }
.dock button.hot { color: #0a8f99; }
</style>
</head>`);
writeFileSync(join(PUBLIC, 'video.html'), video);

/* ---------- Code studio ---------- */

let code = readFileSync(codeSrc, 'utf8').replace(/\r\n/g, '\n');
// The saved file wraps the page in a second page. Keep only the inner one.
const inner = code.indexOf('<!doctype html>', 10);
if (code.startsWith('<!doctype html><html><head>') && inner > 0) {
  code = code.slice(code.indexOf('\n', 0) + 1).replace(/\n<\/body><\/html>\s*$/, '\n');
}
code = swap(code, '<html lang="en">', '<html lang="en" data-theme="light">');
code = swap(code, '<title>CodeBerry</title>', `<title>Code · Blook Berry</title>\n${FONTS}`);
code = swap(code, `h('div', { class: 'brand', html: LOGO + '<span class="word">CodeBerry</span>' })`,
  `h('a', { class: 'brand', href: '/#/art', title: 'Back to Blook Berry', html: '<img src="/logo.svg" alt=""><span class="word">Blook Berry <small>Code</small></span>' })`);
code = swap(code, "['Share on Discover', openShare], ", '');
code = swap(code, "      h('p', null, 'Discover is where people share projects. Tap Play to try one, or Remix to make your own version.'),\n", '');
code = swap(code, ' Anything you shared on Discover stays there.', '', { optional: true });
// The drawing studio inside uses the Blook Berry reds.
code = swap(code, '--brand: #D6336C; --brand-dark: #A61E55; --brand-soft: #FCE4EE;', '--brand: #d81e4a; --brand-dark: #a3123a; --brand-soft: #fbe3e8;');
code = code.split('CodeBerry').join('Blook Berry Code');
code = swap(code, '</style>\n</head>', `
/* ---------- Blook Berry look ---------- */
:root:root {
  --milk: #ffffff; --jam: #faeef0; --jam2: #f1dde1; --panel: #ffffff;
  --ink: #4f1c28; --ink2: #806066; --berry: #d81e4a; --berry-deep: #a3123a;
  --leaf: #5cc443; --leaf-deep: #46a531; --seed: #ffc93c; --line: #f1dde1;
  --ws: #fffcfd; --dot: #f1dde1; --scrim: rgba(58, 16, 30, .5);
  color-scheme: light;
}
body { font-family: Nunito, "Segoe UI", system-ui, sans-serif; }
.brand, .dialog h2, .dx-hero h2, .tut-body h4 { font-family: "Titan One", Nunito, sans-serif; font-weight: 400; letter-spacing: .01em; }
.top { background: #b8344f; border-bottom: 0; box-shadow: inset 0 -5px 0 rgba(0, 0, 0, .13); color: #fff; }
.brand { color: #fff; text-decoration: none; text-shadow: 0 2px 0 rgba(0, 0, 0, .2); font-size: 22px; }
.brand img { width: 34px; height: 34px; filter: drop-shadow(0 2px 0 rgba(0, 0, 0, .25)); }
.brand small { font: 800 13px Nunito, sans-serif; text-shadow: none; background: rgba(255, 255, 255, .2); border-radius: 999px; padding: 2px 9px; margin-left: 2px; vertical-align: 3px; }
.top .proj { color: #fff; }
.top .proj:hover { border-color: rgba(255, 255, 255, .45); background: transparent; }
.top .proj:focus { color: var(--ink); background: #fff; border-color: #fff; }
.save { color: #f8d2da; font-weight: 700; }
.top .ghost { color: #fff; border-color: rgba(255, 255, 255, .45); }
.top .ghost:hover { background: rgba(255, 255, 255, .16); }
.views { display: none !important; }
#rail { background: #b8344f; border-right: 0; box-shadow: inset -5px 0 0 rgba(0, 0, 0, .13); }
#rail button { color: #fff; }
#rail button.on { background: #fff; color: var(--ink); }
#tabs { background: #b8344f !important; border-top: 0 !important; grid-template-columns: repeat(4, 1fr) !important; }
#tabs button { color: #f8d2da !important; }
#tabs button.on { color: #fff !important; box-shadow: inset 0 3px 0 #ffc93c !important; }
#tabs [data-tab="discover"] { display: none !important; }
.btn { font-weight: 800; }
.btn.primary { box-shadow: 0 3px 0 var(--berry-deep); }
.stage-wrap { border-color: var(--line); }
#toast { background: var(--ink); color: #fff; }
</style>
</head>`);
writeFileSync(join(PUBLIC, 'code.html'), code);
console.log('Wrote public/video.html and public/code.html');
