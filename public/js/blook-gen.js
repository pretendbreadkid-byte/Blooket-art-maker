// Blookberry AI's drawing: turns a few words into a Blook, for free, on your own
// device. Words pick a colour, a kind of thing (dragon, pumpkin, robot...), a mood
// and extras like hats. Everything is drawn in the house style of the real Blooks:
// a chunky rounded body on a 300 × 345 canvas, a darker underbelly, big eyes.

/* ---------- Colours ---------- */

function toHsl(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function toHex([h, s, l]) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return `#${[f(0), f(8), f(4)].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

const shade = (hex, by) => { const [h, s, l] = toHsl(hex); return toHex([h, s, Math.max(0, Math.min(1, l + by))]); };

export const COLORS = {
  red: '#e8453c', orange: '#f5891f', yellow: '#ffcd2e', gold: '#f2b632', green: '#5cbf4a', lime: '#9bd93c', mint: '#7fe0b8',
  teal: '#1fb5a8', blue: '#3b8fe8', navy: '#2f4a8a', purple: '#8d5ce0', violet: '#a35ce0', pink: '#ff8ab8', magenta: '#e04aa8',
  brown: '#a0612f', tan: '#e3b77a', white: '#f5f3f0', black: '#3a3a44', gray: '#9aa0a8', grey: '#9aa0a8', silver: '#c4cad2',
  cyan: '#38c9e8', peach: '#ffb48a', cream: '#fff1cf', maroon: '#8a2a3a',
};

/* ---------- What the words mean ---------- */

// Each kind brings its own colour and parts. Words not listed still work: they
// just get a random colour and face.
const KINDS = {
  cat: { color: 'orange', ears: 'cat', mouth: 'cat' }, kitten: { color: 'peach', ears: 'cat', mouth: 'cat' },
  tiger: { color: 'orange', ears: 'cat', mouth: 'cat', pattern: 'stripes' }, lion: { color: 'gold', ears: 'round', mouth: 'cat' },
  dog: { color: 'tan', ears: 'floppy', mouth: 'tongue' }, puppy: { color: 'tan', ears: 'floppy', mouth: 'tongue' },
  bear: { color: 'brown', ears: 'round' }, panda: { color: 'white', ears: 'round', patches: true }, koala: { color: 'gray', ears: 'round' },
  bunny: { color: 'white', ears: 'bunny' }, rabbit: { color: 'white', ears: 'bunny' }, mouse: { color: 'gray', ears: 'round' },
  fox: { color: 'orange', ears: 'cat' }, wolf: { color: 'gray', ears: 'cat', mouth: 'fangs' }, pig: { color: 'pink', ears: 'cat', mouth: 'snout' },
  cow: { color: 'white', horns: 'small', pattern: 'spots', mouth: 'snout' }, frog: { color: 'green', eyes: 'round' },
  dragon: { color: 'green', horns: 'horns', mouth: 'fangs', pattern: 'scales' }, dinosaur: { color: 'lime', mouth: 'fangs', pattern: 'spots' },
  devil: { color: 'red', horns: 'horns', mouth: 'fangs' }, demon: { color: 'maroon', horns: 'horns', mouth: 'fangs' },
  monster: { color: 'purple', horns: 'horns', mouth: 'fangs' }, vampire: { color: 'gray', mouth: 'fangs', hat: 'none' },
  ghost: { color: 'white', mouth: 'o' }, zombie: { color: 'lime', mouth: 'frown', eyes: 'sleepy' },
  robot: { color: 'silver', top: 'antenna', eyes: 'screen', mouth: 'grill' }, bot: { color: 'silver', top: 'antenna', eyes: 'screen', mouth: 'grill' },
  alien: { color: 'lime', top: 'antenna', eyes: 'sparkle' }, bee: { color: 'yellow', top: 'antenna', pattern: 'stripes' },
  ladybug: { color: 'red', top: 'antenna', pattern: 'spots' }, chick: { color: 'yellow', mouth: 'beak' }, bird: { color: 'blue', mouth: 'beak' },
  duck: { color: 'yellow', mouth: 'beak' }, penguin: { color: 'navy', mouth: 'beak', belly: true }, owl: { color: 'brown', mouth: 'beak', ears: 'tufts', eyes: 'sparkle' },
  unicorn: { color: 'white', top: 'unicorn' }, pumpkin: { color: 'orange', top: 'stem', eyes: 'triangle', mouth: 'jack', pattern: 'ribs' },
  apple: { color: 'red', top: 'stem' }, cherry: { color: 'red', top: 'stem' }, orange: { color: 'orange', top: 'stem' },
  strawberry: { color: 'red', top: 'leaves', pattern: 'seeds' }, lemon: { color: 'yellow', top: 'stem' }, grape: { color: 'purple', top: 'stem' },
  cupcake: { color: 'pink', pattern: 'sprinkles' }, donut: { color: 'pink', pattern: 'sprinkles' }, cake: { color: 'cream', pattern: 'sprinkles', hat: 'party' },
  cookie: { color: 'tan', pattern: 'chips' }, toast: { color: 'tan' }, bread: { color: 'tan' }, cheese: { color: 'yellow', pattern: 'holes' },
  watermelon: { color: 'green', pattern: 'stripes' }, snowman: { color: 'white', hat: 'tophat', mouth: 'smile' },
  cloud: { color: 'white', eyes: 'happy' }, storm: { color: 'gray', eyes: 'angry', mouth: 'frown' }, sun: { color: 'yellow', eyes: 'happy', mouth: 'grin' },
  star: { color: 'gold', eyes: 'sparkle' }, slime: { color: 'lime', eyes: 'sparkle', mouth: 'grin' }, fish: { color: 'cyan', mouth: 'o', pattern: 'scales' },
  shark: { color: 'gray', mouth: 'fangs' }, octopus: { color: 'pink', pattern: 'spots' },
  angel: { color: 'white', top: 'halo' }, king: { hat: 'crown' }, queen: { hat: 'crown' }, prince: { hat: 'crown' }, princess: { hat: 'crown' },
  royal: { hat: 'crown' }, witch: { hat: 'witch', color: 'lime' }, wizard: { hat: 'witch', color: 'blue' }, party: { hat: 'party' },
  birthday: { hat: 'party' }, magician: { hat: 'tophat' }, gentleman: { hat: 'tophat' },
};

const HATS = { crown: 'crown', witch: 'witch', wizard: 'witch', party: 'party', tophat: 'tophat', top: 'tophat', hat: 'party', halo: 'halo' };
const MOODS = {
  sleepy: { eyes: 'sleepy', mouth: 'o' }, tired: { eyes: 'sleepy', mouth: 'o' }, angry: { eyes: 'angry', mouth: 'frown' },
  grumpy: { eyes: 'angry', mouth: 'frown' }, mad: { eyes: 'angry', mouth: 'frown' }, happy: { eyes: 'happy', mouth: 'grin' },
  cheerful: { eyes: 'happy', mouth: 'grin' }, sad: { eyes: 'sad', mouth: 'frown' }, cool: { eyes: 'shades', mouth: 'smile' },
  cute: { eyes: 'sparkle', mouth: 'cat' }, scared: { eyes: 'round', mouth: 'o' }, spooky: { eyes: 'triangle', mouth: 'jack' },
  evil: { eyes: 'angry', mouth: 'fangs' }, silly: { eyes: 'round', mouth: 'tongue' }, surprised: { eyes: 'round', mouth: 'o' },
};
const PATTERNS = { spotted: 'spots', spots: 'spots', dotty: 'spots', striped: 'stripes', stripes: 'stripes', sprinkles: 'sprinkles', scaly: 'scales' };

const words = (text) => (text.toLowerCase().match(/[a-z]+/g) || []);
// "dragons" is a dragon too.
const singular = (w) => (w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.endsWith('es') && KINDS[w.slice(0, -2)] ? w.slice(0, -2) : w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

// The parts a description asks for. Later words win over earlier ones, except a
// colour word, which always wins over a kind's own colour.
// Outfit words only dress a Blook up, so "a pumpkin witch" stays a pumpkin.
const OUTFITS = new Set(['angel', 'king', 'queen', 'prince', 'princess', 'royal', 'witch', 'wizard', 'party', 'birthday', 'magician', 'gentleman']);

export function readPrompt(prompt) {
  const list = words(prompt).map(singular);
  const traits = {};
  for (const w of list) if (KINDS[w] && !OUTFITS.has(w)) { Object.assign(traits, KINDS[w]); traits.kind = w; }
  for (const w of list) {
    if (!OUTFITS.has(w)) continue;
    const { color, ...dress } = KINDS[w];
    Object.assign(traits, dress);
    if (!traits.kind) { traits.color = color ?? traits.color; traits.kind = w; }
  }
  for (const w of list) if (MOODS[w]) Object.assign(traits, MOODS[w]);
  for (const w of list) if (PATTERNS[w]) traits.pattern = PATTERNS[w];
  // A plain "hat" only adds one when nothing more particular was asked for.
  for (const w of list) {
    if (!HATS[w] || (w === 'hat' && traits.hat)) continue;
    if (HATS[w] === 'halo') traits.top = 'halo'; else traits.hat = HATS[w];
  }
  const colorWord = list.find((w) => COLORS[w]);
  if (colorWord) traits.color = colorWord;
  traits.colorWord = colorWord || null;
  if (traits.hat === 'none') delete traits.hat;
  return traits;
}

/* ---------- Randomness you can repeat ---------- */

export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rand, list) => list[Math.floor(rand() * list.length)];

/* ---------- Parts ---------- */

const INK = '#2b2730';
const BLUSH = '#ff8fab';
const EYE_L = 105, EYE_R = 195, EYE_Y = 178;

function ears(type, c) {
  const dark = shade(c, -0.18), inner = shade(BLUSH, 0.05);
  if (type === 'cat') {
    return `<path d="M34 128L56 18Q60 10 68 16L136 76Z" fill="${c}"/><path d="M266 128L244 18Q240 10 232 16L164 76Z" fill="${c}"/>`
      + `<path d="M58 98L68 40L108 74Z" fill="${inner}"/><path d="M242 98L232 40L192 74Z" fill="${inner}"/>`;
  }
  if (type === 'round') return `<circle cx="64" cy="74" r="40" fill="${c}"/><circle cx="236" cy="74" r="40" fill="${c}"/><circle cx="64" cy="74" r="20" fill="${dark}"/><circle cx="236" cy="74" r="20" fill="${dark}"/>`;
  if (type === 'bunny') {
    return `<ellipse cx="102" cy="56" rx="25" ry="54" transform="rotate(-12 102 56)" fill="${c}"/><ellipse cx="198" cy="56" rx="25" ry="54" transform="rotate(12 198 56)" fill="${c}"/>`
      + `<ellipse cx="102" cy="60" rx="11" ry="36" transform="rotate(-12 102 60)" fill="${inner}"/><ellipse cx="198" cy="60" rx="11" ry="36" transform="rotate(12 198 60)" fill="${inner}"/>`;
  }
  if (type === 'tufts') return `<path d="M30 110L44 30L110 70Z" fill="${dark}"/><path d="M270 110L256 30L190 70Z" fill="${dark}"/>`;
  return '';
}

// Floppy ears hang in front of the body, so they are drawn after it.
const floppy = (c) => { const d = shade(c, -0.2); return `<ellipse cx="34" cy="150" rx="30" ry="72" transform="rotate(14 34 150)" fill="${d}"/><ellipse cx="266" cy="150" rx="30" ry="72" transform="rotate(-14 266 150)" fill="${d}"/>`; };

function top(type, c, rand) {
  if (type === 'antenna') return `<path d="M150 62V18" stroke="${shade(c, -0.25)}" stroke-width="8" stroke-linecap="round"/><circle cx="150" cy="16" r="13" fill="${pick(rand, ['#ff5a5a', '#ffd23f', '#5ce1e6'])}"/>`;
  if (type === 'stem') return `<rect x="141" y="22" width="18" height="44" rx="8" fill="#7a4a24"/><path d="M156 40Q190 14 222 30Q194 58 156 46Z" fill="#4caf50"/>`;
  if (type === 'leaves') return `<path d="M150 66Q112 30 96 50Q120 76 150 66ZM150 66Q188 30 204 50Q180 76 150 66ZM150 66Q140 22 150 14Q160 22 150 66Z" fill="#43a047"/>`;
  if (type === 'unicorn') return `<path d="M136 66L150 4L164 66Z" fill="#ffd54f"/><path d="M140 52L160 46M143 38L157 33M146 24L154 21" stroke="#f9a825" stroke-width="4" stroke-linecap="round"/>`;
  if (type === 'halo') return `<ellipse cx="150" cy="22" rx="62" ry="13" fill="none" stroke="#ffd54f" stroke-width="10"/>`;
  return '';
}

function horns(type, c) {
  const h = type === 'small' ? '#f3e7d3' : shade(c, 0.32);
  if (type === 'small') return `<path d="M72 74Q52 52 60 34Q78 50 96 64Z" fill="${h}"/><path d="M228 74Q248 52 240 34Q222 50 204 64Z" fill="${h}"/>`;
  return `<path d="M70 80Q30 46 52 4Q70 42 104 62Z" fill="${h}"/><path d="M230 80Q270 46 248 4Q230 42 196 62Z" fill="${h}"/>`;
}

function hat(type, rand) {
  if (type === 'crown') {
    const gem = pick(rand, ['#e53935', '#1e88e5', '#43a047', '#8e24aa']);
    return `<path d="M82 72V20L114 46L150 8L186 46L218 20V72Z" fill="#ffc83d"/><path d="M82 72V60H218V72Z" fill="#e6a417"/><circle cx="150" cy="40" r="9" fill="${gem}"/><circle cx="110" cy="58" r="6" fill="${gem}"/><circle cx="190" cy="58" r="6" fill="${gem}"/>`;
  }
  if (type === 'witch') {
    const band = pick(rand, ['#8e24aa', '#43a047', '#f57c00']);
    return `<ellipse cx="150" cy="66" rx="118" ry="16" fill="#2d2440"/><path d="M98 64Q120 30 150 18Q172 6 196 2Q184 24 196 64Z" fill="#3a2f55"/><path d="M104 54H194V64H100Z" fill="${band}"/>`;
  }
  if (type === 'party') {
    const a = pick(rand, ['#ff5a8a', '#3b8fe8', '#ffcd2e']), b = pick(rand, ['#ffffff', '#5cbf4a', '#8d5ce0']);
    return `<path d="M116 68L150 8L184 68Z" fill="${a}"/><path d="M128 48L172 48L178 58L122 58ZM140 28L160 28L165 37L135 37Z" fill="${b}"/><circle cx="150" cy="10" r="10" fill="${b}"/>`;
  }
  if (type === 'tophat') return `<ellipse cx="150" cy="66" rx="96" ry="13" fill="#2b2730"/><rect x="100" y="4" width="100" height="62" rx="8" fill="#3a3540"/><rect x="100" y="46" width="100" height="12" fill="#c62828"/>`;
  return '';
}

function eyes(type, rand, c) {
  const pupil = (x) => `<circle cx="${x}" cy="${EYE_Y}" r="30" fill="#fff"/><circle cx="${x + 3}" cy="${EYE_Y + 4}" r="18" fill="${INK}"/><circle cx="${x - 3}" cy="${EYE_Y - 4}" r="7" fill="#fff"/>`;
  const line = (d) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>`;
  switch (type) {
    case 'happy': return line(`M80 ${EYE_Y + 8}Q${EYE_L} ${EYE_Y - 22} 130 ${EYE_Y + 8}`) + line(`M170 ${EYE_Y + 8}Q${EYE_R} ${EYE_Y - 22} 220 ${EYE_Y + 8}`);
    case 'sleepy': return line(`M80 ${EYE_Y}Q${EYE_L} ${EYE_Y + 18} 130 ${EYE_Y}`) + line(`M170 ${EYE_Y}Q${EYE_R} ${EYE_Y + 18} 220 ${EYE_Y}`)
      + `<path d="M232 118h18l-18 20h18" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity=".7"/>`;
    case 'angry': return pupil(EYE_L) + pupil(EYE_R) + line(`M72 134L132 152`) + line(`M228 134L168 152`);
    case 'sad': return pupil(EYE_L) + pupil(EYE_R) + line(`M80 152L130 138`) + line(`M220 152L170 138`);
    case 'sparkle': {
      const big = (x) => `<circle cx="${x}" cy="${EYE_Y}" r="32" fill="${INK}"/><circle cx="${x - 9}" cy="${EYE_Y - 11}" r="10" fill="#fff"/><circle cx="${x + 10}" cy="${EYE_Y + 10}" r="5" fill="#fff"/>`;
      return big(EYE_L) + big(EYE_R);
    }
    case 'screen': return `<rect x="66" y="146" width="168" height="62" rx="18" fill="${INK}"/><rect x="86" y="160" width="36" height="34" rx="9" fill="#5ce1e6"/><rect x="178" y="160" width="36" height="34" rx="9" fill="#5ce1e6"/>`;
    case 'triangle': return `<path d="M80 196L106 150L130 196Z" fill="${INK}"/><path d="M170 196L194 150L220 196Z" fill="${INK}"/>`;
    case 'shades': return `<path d="M64 158H236V172Q236 200 206 200Q180 200 172 176H128Q120 200 94 200Q64 200 64 172Z" fill="${INK}"/><path d="M80 168L96 168" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".6"/>`;
    default: return pupil(EYE_L) + pupil(EYE_R);
  }
}

function mouth(type, rand, c) {
  const stroke = (d) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`;
  switch (type) {
    case 'grin': return `<path d="M118 226Q150 274 182 226Z" fill="${INK}"/><path d="M134 252Q150 240 166 252Q158 262 150 262Q142 262 134 252Z" fill="#ff6b8a"/>`;
    case 'frown': return stroke('M126 248Q150 228 174 248');
    case 'o': return `<ellipse cx="150" cy="238" rx="13" ry="16" fill="${INK}"/>`;
    case 'cat': return stroke('M126 230Q138 244 150 230Q162 244 174 230');
    case 'fangs': return `<path d="M116 226Q150 270 184 226Z" fill="${INK}"/><path d="M126 228L134 246L142 230ZM158 230L166 246L174 228Z" fill="#fff"/>`;
    case 'beak': return `<path d="M122 222L150 208L178 222L150 248Z" fill="#ff9f1c"/><path d="M122 222L178 222L150 230Z" fill="#e07b00"/>`;
    case 'snout': return `<ellipse cx="150" cy="234" rx="38" ry="27" fill="${shade(c, -0.08)}"/><ellipse cx="137" cy="234" rx="7" ry="10" fill="${shade(c, -0.35)}"/><ellipse cx="163" cy="234" rx="7" ry="10" fill="${shade(c, -0.35)}"/>`;
    case 'jack': return `<path d="M100 222L120 234L136 222L150 236L164 222L180 234L200 222Q190 268 150 270Q110 268 100 222Z" fill="${INK}"/>`;
    case 'grill': return `<rect x="112" y="222" width="76" height="30" rx="8" fill="${INK}"/><path d="M131 222V252M150 222V252M169 222V252" stroke="${shade(c, 0.1)}" stroke-width="4"/>`;
    case 'tongue': return stroke('M124 226Q150 248 176 226') + `<path d="M140 236H160V256Q150 266 140 256Z" fill="#ff6b8a"/>`;
    default: return stroke('M124 228Q150 252 176 228');
  }
}

function pattern(type, rand, c) {
  const dark = shade(c, -0.2), out = [];
  const n = (lo, hi) => lo + rand() * (hi - lo);
  if (type === 'spots') {
    const spot = toHsl(c)[2] > 0.8 ? INK : dark;
    for (let i = 0; i < 7; i++) out.push(`<ellipse cx="${n(30, 270).toFixed(0)}" cy="${n(70, 300).toFixed(0)}" rx="${n(14, 30).toFixed(0)}" ry="${n(12, 26).toFixed(0)}" fill="${spot}" opacity=".85"/>`);
  } else if (type === 'stripes') {
    for (let y = 80; y < 320; y += 52) out.push(`<path d="M0 ${y}Q150 ${y + 26} 300 ${y}V${y + 20}Q150 ${y + 46} 0 ${y + 20}Z" fill="${dark}" opacity=".8"/>`);
  } else if (type === 'sprinkles') {
    const colors = ['#ff5a8a', '#ffd23f', '#5ce1e6', '#8bc34a', '#ffffff', '#8d5ce0'];
    for (let i = 0; i < 22; i++) out.push(`<rect x="${n(30, 262).toFixed(0)}" y="${n(66, 140).toFixed(0)}" width="16" height="6" rx="3" fill="${pick(rand, colors)}" transform="rotate(${n(0, 180).toFixed(0)} ${n(30, 270).toFixed(0)} ${n(70, 140).toFixed(0)})"/>`);
  } else if (type === 'seeds') {
    for (let i = 0; i < 16; i++) out.push(`<ellipse cx="${n(30, 270).toFixed(0)}" cy="${n(80, 320).toFixed(0)}" rx="4" ry="7" fill="#ffe08a"/>`);
  } else if (type === 'chips') {
    for (let i = 0; i < 9; i++) out.push(`<circle cx="${n(30, 270).toFixed(0)}" cy="${n(80, 320).toFixed(0)}" r="${n(8, 13).toFixed(0)}" fill="#5d3a1a"/>`);
  } else if (type === 'holes') {
    for (let i = 0; i < 7; i++) out.push(`<circle cx="${n(30, 270).toFixed(0)}" cy="${n(80, 320).toFixed(0)}" r="${n(10, 22).toFixed(0)}" fill="${shade(c, -0.1)}"/>`);
  } else if (type === 'scales') {
    for (let y = 270; y < 345; y += 22) for (let x = (y / 22) % 2 ? 0 : 20; x < 300; x += 40) out.push(`<path d="M${x} ${y}A20 20 0 0 0 ${x + 40} ${y}" fill="none" stroke="${dark}" stroke-width="5" opacity=".6"/>`);
  } else if (type === 'ribs') {
    out.push(`<path d="M100 66Q70 200 100 340M200 66Q230 200 200 340M150 60V345" fill="none" stroke="${dark}" stroke-width="7" opacity=".55"/>`);
  }
  return out.join('');
}

/* ---------- A whole Blook ---------- */

const FALLBACK = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'mint', 'peach'];

// One Blook from traits. rand fills in whatever the words did not say.
export function drawBlook(traits, rand = Math.random) {
  const c = COLORS[traits.color] || COLORS[pick(rand, FALLBACK)];
  const light = shade(c, 0.07), dark = shade(c, -0.16);
  const eyeType = traits.eyes || pick(rand, ['round', 'round', 'sparkle', 'happy']);
  const mouthType = traits.mouth || pick(rand, ['smile', 'smile', 'grin', 'cat', 'o']);
  const earType = traits.ears || (traits.kind ? '' : pick(rand, ['', '', 'cat', 'round', 'bunny']));
  const body = 'M68 58H232Q282 58 282 108V309Q282 345 246 345H54Q18 345 18 309V108Q18 58 68 58Z';
  const upper = 'M68 58H232Q282 58 282 108V285Q282 321 246 321H54Q18 321 18 285V108Q18 58 68 58Z';
  const blush = !['screen', 'shades'].includes(eyeType) && !traits.patches
    ? `<ellipse cx="72" cy="220" rx="20" ry="12" fill="${BLUSH}" opacity=".55"/><ellipse cx="228" cy="220" rx="20" ry="12" fill="${BLUSH}" opacity=".55"/>` : '';
  const patches = traits.patches ? `<ellipse cx="${EYE_L}" cy="${EYE_Y + 4}" rx="44" ry="38" transform="rotate(-20 ${EYE_L} ${EYE_Y})" fill="${INK}"/><ellipse cx="${EYE_R}" cy="${EYE_Y + 4}" rx="44" ry="38" transform="rotate(20 ${EYE_R} ${EYE_Y})" fill="${INK}"/>` : '';
  const belly = traits.belly ? `<ellipse cx="150" cy="268" rx="88" ry="80" fill="#f5f3f0"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 345">`
    + `<defs><linearGradient id="bb-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(light, 0.04)}"/><stop offset="1" stop-color="${c}"/></linearGradient>`
    + `<clipPath id="bb-clip"><path d="${upper}"/></clipPath></defs>`
    + (traits.horns ? horns(traits.horns, c) : '') + ears(earType, c)
    + `<path d="${body}" fill="${dark}"/><path d="${upper}" fill="url(#bb-body)"/>`
    + `<g clip-path="url(#bb-clip)">${traits.pattern ? pattern(traits.pattern, rand, c) : ''}${belly}<ellipse cx="96" cy="96" rx="52" ry="22" fill="#fff" opacity=".22"/></g>`
    + (traits.ears === 'floppy' ? floppy(c) : '')
    + patches + blush + eyes(eyeType, rand, c) + mouth(mouthType, rand, c)
    // A hat sits where a stem or antenna would, so only a halo shows with one.
    + (traits.top && (!traits.hat || traits.top === 'halo') ? top(traits.top, c, rand) : '') + (traits.hat ? hat(traits.hat, rand) : '')
    + '</svg>';
}

/* ---------- Starting from a real Blook ---------- */

const HEX = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi;
const long = (h) => (h.length === 4 ? `#${[...h.slice(1)].map((x) => x + x).join('')}` : h).toLowerCase();

const MAIN_HUE_RANGE = 40;
const hueGap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// Turns a real Blook a new colour. Only its main colour family changes (a chick's
// yellows, not its orange beak), each shade keeping its own light and dark so the
// shading stays. Whites, blacks and greys (eyes, shines) stay as they are.
export function recolorSvg(svg, target) {
  const [th, ts, tl] = toHsl(target);
  const grey = ts < 0.12;
  const colourful = (hsl) => hsl[1] >= 0.18 && hsl[2] <= 0.94 && hsl[2] >= 0.08;
  // The main colour is the hue the most colourful paint is closest to.
  const hues = (svg.match(HEX) || []).map((m) => toHsl(long(m))).filter(colourful).map((hsl) => hsl[0]);
  if (!hues.length) return svg;
  const main = hues.reduce((best, h) => {
    const near = hues.filter((x) => hueGap(x, h) <= MAIN_HUE_RANGE / 2).length;
    return near > best.near ? { h, near } : best;
  }, { h: hues[0], near: 0 }).h;
  return svg.replace(HEX, (m) => {
    const hsl = toHsl(long(m));
    if (!colourful(hsl) || hueGap(hsl[0], main) > MAIN_HUE_RANGE) return m;
    const [h, s, l] = hsl;
    if (grey) return toHex([h, 0, Math.max(0.12, Math.min(0.92, l * 0.6 + tl * 0.4))]);
    return toHex([(th + (h - main) + 360) % 360, Math.min(1, (s + ts) / 2), l]);
  });
}

// Adds a hat or other top piece to a real Blook. box: where its art sits.
export function addTopper(svg, traits, box, rand = Math.random) {
  const part = (traits.hat ? hat(traits.hat, rand) : '') + (traits.top && traits.top !== 'stem' ? top(traits.top, '#ffffff', rand) : '');
  if (!part) return svg;
  const k = Math.max(0.3, box.width / 264);
  // Room above the Blook for the hat: the canvas grows upwards if it has to.
  const [minX, minY, w, h] = (svg.match(/viewBox="([^"]+)"/)?.[1] || '0 0 300 345').split(/[\s,]+/).map(Number);
  const newMinY = Math.min(minY, box.y - 66 * k - 4);
  const sized = svg.replace(/viewBox="[^"]+"/, `viewBox="${minX} ${newMinY.toFixed(1)} ${w} ${(h + minY - newMinY).toFixed(1)}"`);
  const placed = `<g transform="translate(${(box.x + box.width / 2).toFixed(1)} ${(box.y + 6 * k).toFixed(1)}) scale(${k.toFixed(3)}) translate(-150 -66)">${part}</g>`;
  return sized.replace(/<\/svg>\s*$/, `${placed}</svg>`);
}

// The real Blooks whose names are in the description, best match first.
export function matchBlooks(prompt, names) {
  const list = words(prompt).map(singular).filter((w) => w.length >= 3 && !COLORS[w] && !MOODS[w] && !HATS[w] && !PATTERNS[w]);
  const hits = [];
  for (const name of names) {
    const key = name.toLowerCase().replace(/[^a-z]/g, '');
    const score = list.reduce((best, w) => Math.max(best, key === w ? 3 : key.startsWith(w) || key.endsWith(w) ? 2 : w.length > 3 && key.includes(w) ? 1 : 0), 0);
    if (score) hits.push({ name, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.name.length - b.name.length).map((h) => h.name);
}
