// Colour and light effects, worked out as SVG filter steps. Each thing keeps its
// effects in o.fx; anything not there is off. They run in a fixed order: colour
// changes first, then outlines and glows (so they keep their own colour), and
// Blur and Pixelate last (render.js adds those).
import { round } from './model.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// How each effect starts out when it is turned on.
export const FX_START = {
  overlay: { color: '#e8453c', strength: 0.5, mode: 'cover' },
  adjust: { bright: 0, contrast: 0, sat: 0, hue: 0 },
  duotone: { dark: '#2b1d5c', light: '#ffd23f', strength: 1 },
  grey: 1,
  hue: 120,
  sepia: 0.7,
  invert: 1,
  posterize: 4,
  sticker: { color: '#ffffff', size: 8 },
  glow: { color: '#ffe066', size: 14, strength: 0.8 },
  grain: { amount: 0.3, size: 2 },
  split: { size: 4, angle: 0 },
};

export const OVERLAY_MODES = { cover: 'Cover', tint: 'Tint', multiply: 'Darken', screen: 'Lighten' };

// The colour as three numbers from 0 to 1. Anything odd comes out grey.
function rgb(color) {
  let h = String(color || '').trim().replace('#', '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}/i.test(h)) return [0.5, 0.5, 0.5];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

const n = (v) => round(v, 4);
const LUMA = '0.2126 0.7152 0.0722';
const GREY = `${LUMA} 0 0 ${LUMA} 0 0 ${LUMA} 0 0 0 0 0 1 0`;

// Turned on and doing something.
export function fxOn(fx, key) {
  const v = fx?.[key];
  if (v == null || v === false) return false;
  if (key === 'adjust') return !!(v.bright || v.contrast || v.sat || v.hue);
  if (key === 'posterize') return v >= 2;
  if (typeof v === 'number') return v > 0;
  if (key === 'overlay' || key === 'duotone' || key === 'glow') return (v.strength ?? 1) > 0;
  if (key === 'sticker') return v.size > 0;
  if (key === 'grain') return v.amount > 0;
  if (key === 'split') return v.size > 0;
  return true;
}

export const hasFx = (fx) => !!fx && Object.keys(FX_START).some((k) => fxOn(fx, k));

// The filter steps for o.fx, starting from the art itself. Returns the steps, how
// far past the art they reach (in canvas pixels), and the name of the last result.
export function fxSteps(fx) {
  if (!hasFx(fx)) return { steps: '', spread: 0, out: 'SourceGraphic' };
  let steps = '', at = 'SourceGraphic', count = 0, spread = 0;
  const next = () => `fx${++count}`;
  // One step that works on what came before.
  const step = (markup) => { const name = next(); steps += markup.replace('%IN%', at).replace('%OUT%', name); at = name; };
  // A full-strength version mixed back with what came before. Colour steps keep
  // the art's see-through parts as they were, so the mix is exact.
  const mixed = (inner, strength) => {
    const from = at;
    inner();
    if (strength >= 1) return;
    const name = next();
    steps += `<feComposite in="${at}" in2="${from}" operator="arithmetic" k1="0" k2="${n(strength)}" k3="${n(1 - strength)}" k4="0" result="${name}"/>`;
    at = name;
  };
  const table = (r, g, b) => `<feComponentTransfer in="%IN%" result="%OUT%"><feFuncR type="table" tableValues="${r}"/><feFuncG type="table" tableValues="${g}"/><feFuncB type="table" tableValues="${b}"/></feComponentTransfer>`;

  if (fxOn(fx, 'adjust')) {
    const { bright = 0, contrast = 0, sat = 0, hue = 0 } = fx.adjust;
    if (bright || contrast) {
      const kb = 1 + bright / 100, kc = 1 + contrast / 100;
      const f = (c) => `<feFunc${c} type="linear" slope="${n(kb * kc)}" intercept="${n(0.5 - 0.5 * kc)}"/>`;
      step(`<feComponentTransfer in="%IN%" result="%OUT%">${f('R')}${f('G')}${f('B')}</feComponentTransfer>`);
    }
    if (sat) step(`<feColorMatrix in="%IN%" type="saturate" values="${n(Math.max(0, 1 + sat / 100))}" result="%OUT%"/>`);
    if (hue) step(`<feColorMatrix in="%IN%" type="hueRotate" values="${n(hue)}" result="%OUT%"/>`);
  }
  if (fxOn(fx, 'hue')) step(`<feColorMatrix in="%IN%" type="hueRotate" values="${n(fx.hue)}" result="%OUT%"/>`);
  if (fxOn(fx, 'grey')) step(`<feColorMatrix in="%IN%" type="saturate" values="${n(1 - Math.min(1, fx.grey))}" result="%OUT%"/>`);
  if (fxOn(fx, 'sepia')) {
    const a = Math.min(1, fx.sepia);
    const s = [[0.393, 0.769, 0.189], [0.349, 0.686, 0.168], [0.272, 0.534, 0.131]];
    const rows = s.map((row, i) => row.map((v, j) => n((i === j ? 1 - a : 0) + v * a)).join(' ') + ' 0 0').join(' ');
    step(`<feColorMatrix in="%IN%" type="matrix" values="${rows} 0 0 0 1 0" result="%OUT%"/>`);
  }
  if (fxOn(fx, 'invert')) {
    const a = Math.min(1, fx.invert), v = `${n(a)} ${n(1 - a)}`;
    step(table(v, v, v));
  }
  if (fxOn(fx, 'duotone')) {
    const { dark, light, strength = 1 } = fx.duotone;
    const [d, l] = [rgb(dark), rgb(light)];
    mixed(() => {
      step(`<feColorMatrix in="%IN%" type="matrix" values="${GREY}" result="%OUT%"/>`);
      step(table(`${n(d[0])} ${n(l[0])}`, `${n(d[1])} ${n(l[1])}`, `${n(d[2])} ${n(l[2])}`));
    }, strength);
  }
  if (fxOn(fx, 'overlay')) {
    const { color, strength = 0.5, mode = 'cover' } = fx.overlay;
    const [r, g, b] = rgb(color);
    mixed(() => {
      if (mode === 'tint') {
        // Dark stays dark and light stays light; the middle takes the colour.
        step(`<feColorMatrix in="%IN%" type="matrix" values="${GREY}" result="%OUT%"/>`);
        step(table(`0 ${n(r)} 1`, `0 ${n(g)} 1`, `0 ${n(b)} 1`));
        return;
      }
      const rows = {
        cover: [`0 0 0 0 ${n(r)}`, `0 0 0 0 ${n(g)}`, `0 0 0 0 ${n(b)}`],
        multiply: [`${n(r)} 0 0 0 0`, `0 ${n(g)} 0 0 0`, `0 0 ${n(b)} 0 0`],
        screen: [`${n(1 - r)} 0 0 0 ${n(r)}`, `0 ${n(1 - g)} 0 0 ${n(g)}`, `0 0 ${n(1 - b)} 0 ${n(b)}`],
      }[mode] || [];
      if (rows.length) step(`<feColorMatrix in="%IN%" type="matrix" values="${rows.join(' ')} 0 0 0 1 0" result="%OUT%"/>`);
    }, Math.min(1, strength));
  }
  if (fxOn(fx, 'posterize')) {
    const levels = Math.max(2, Math.min(16, Math.round(fx.posterize)));
    const v = Array.from({ length: levels }, (_, i) => n(i / (levels - 1))).join(' ');
    step(`<feComponentTransfer in="%IN%" result="%OUT%"><feFuncR type="discrete" tableValues="${v}"/><feFuncG type="discrete" tableValues="${v}"/><feFuncB type="discrete" tableValues="${v}"/></feComponentTransfer>`);
  }
  if (fxOn(fx, 'grain')) {
    // Speckles of light and dark, only where the art is.
    const { amount = 0.3, size = 2 } = fx.grain;
    const from = at, a = Math.min(1, amount);
    const speck = next(), cut = next(), name = next();
    steps += `<feTurbulence type="fractalNoise" baseFrequency="${n(0.9 / Math.max(0.5, size))}" numOctaves="2" seed="7" stitchTiles="stitch"/>`
      + `<feColorMatrix type="matrix" values="${GREY}" result="${speck}"/>`
      + `<feComposite in="${speck}" in2="${from}" operator="in" result="${cut}"/>`
      + `<feComposite in="${cut}" in2="${from}" operator="arithmetic" k1="0" k2="${n(a)}" k3="1" k4="${n(-a / 2)}"/>`
      + `<feComposite in2="${from}" operator="in" result="${name}"/>`;
    at = name;
  }
  if (fxOn(fx, 'split')) {
    // Red one way, blue the other, like a glitchy screen. The three parts add
    // back up to the art wherever they overlap.
    const { size = 4, angle = 0 } = fx.split;
    const s = Math.min(60, size), dx = n(Math.cos((angle * Math.PI) / 180) * s), dy = n(Math.sin((angle * Math.PI) / 180) * s);
    const from = at, r = next(), g = next(), b = next(), rg = next(), name = next();
    const only = (row) => `<feColorMatrix in="${from}" type="matrix" values="${row} 0 0 0 1 0"`;
    steps += `${only('1 0 0 0 0 0 0 0 0 0 0 0 0 0 0')}/><feOffset dx="${-dx}" dy="${-dy}" result="${r}"/>`
      + `${only('0 0 0 0 0 0 1 0 0 0 0 0 0 0 0')} result="${g}"/>`
      + `${only('0 0 0 0 0 0 0 0 0 0 0 0 1 0 0')}/><feOffset dx="${dx}" dy="${dy}" result="${b}"/>`
      + `<feBlend in="${r}" in2="${g}" mode="screen" result="${rg}"/><feBlend in="${rg}" in2="${b}" mode="screen" result="${name}"/>`;
    at = name;
    spread += s;
  }
  if (fxOn(fx, 'sticker')) {
    // A solid edge all the way round, like a sticker. Grown, softened and made
    // sharp again, so round shapes keep round outlines.
    const { color, size } = fx.sticker;
    const from = at, s = Math.min(80, size);
    const edge = next(), name = next();
    steps += `<feMorphology in="${from}" operator="dilate" radius="${n(s * 0.7)}"/>`
      + `<feGaussianBlur stdDeviation="${n(s * 0.3)}"/>`
      + `<feComponentTransfer result="${edge}-shape"><feFuncA type="linear" slope="12" intercept="-4"/></feComponentTransfer>`
      + `<feFlood flood-color="${esc(color)}"/><feComposite in2="${edge}-shape" operator="in" result="${edge}"/>`
      + `<feMerge result="${name}"><feMergeNode in="${edge}"/><feMergeNode in="${from}"/></feMerge>`;
    at = name;
    spread += s + 2;
  }
  if (fxOn(fx, 'glow')) {
    const { color, size = 14, strength = 0.8 } = fx.glow;
    const from = at, s = Math.min(120, size);
    const halo = next(), name = next();
    steps += `<feMorphology in="${from}" operator="dilate" radius="${n(s * 0.25)}"/>`
      + `<feGaussianBlur stdDeviation="${n(s * 0.5)}" result="${halo}-shape"/>`
      + `<feFlood flood-color="${esc(color)}" flood-opacity="${n(Math.min(1, strength))}"/><feComposite in2="${halo}-shape" operator="in" result="${halo}"/>`
      + `<feMerge result="${name}"><feMergeNode in="${halo}"/><feMergeNode in="${from}"/></feMerge>`;
    at = name;
    spread += s * 2;
  }
  return { steps, spread, out: at };
}
