// Turns a document into SVG markup. The editor, thumbnails, the bucket tool and
// export all use this file, so what you see is what you get.
import { pathD, pathBounds, localToWorld, sample, round, rad, isPages, objectsOn } from './model.js';
import { overlayMarkup } from './templates.js';
import { patternMarkup, texturesOf, bgTexturesOf } from './textures.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MASK_SIZE = 20000;

const transformOf = (o) => `translate(${round(o.x)} ${round(o.y)}) rotate(${round(o.rotation)}) scale(${round(o.scaleX, 4)} ${round(o.scaleY, 4)})`;

function strokeAttrs(o) {
  if (!o.stroke || o.stroke === 'none' || !o.strokeWidth) return 'stroke="none"';
  const cap = o.look?.['stroke-linecap'] || 'round', join = o.look?.['stroke-linejoin'] || 'round';
  return `stroke="${esc(o.stroke)}" stroke-width="${round(o.strokeWidth)}" stroke-linecap="${esc(cap)}" stroke-linejoin="${esc(join)}"`;
}

// Extra drawing settings kept from imported art, like fill-opacity or dashes.
function lookAttrs(o) {
  return Object.entries(o.look || {})
    .filter(([k]) => !['stroke-linecap', 'stroke-linejoin', 'fill-opacity', 'stroke-opacity'].includes(k))
    .map(([k, v]) => ` ${esc(k)}="${esc(v)}"`).join('');
}

// How see-through the fill and the outline are: the panel's setting times any
// that came with imported art.
function opacityAttrs(o) {
  const look = o.look || {};
  const f = (o.fillOpacity ?? 1) * (look['fill-opacity'] !== undefined ? +look['fill-opacity'] : 1);
  const s = (o.strokeOpacity ?? 1) * (look['stroke-opacity'] !== undefined ? +look['stroke-opacity'] : 1);
  return (f < 1 ? ` fill-opacity="${round(Math.max(0, f), 3)}"` : '') + (s < 1 ? ` stroke-opacity="${round(Math.max(0, s), 3)}"` : '');
}

function gradientPoints(g) {
  const a = rad(g.angle), c = Math.cos(a) / 2, s = Math.sin(a) / 2;
  return [round(0.5 - c, 4), round(0.5 - s, 4), round(0.5 + c, 4), round(0.5 + s, 4)];
}

// Imported gradients keep all their stops and their exact place on the art.
function rawGradientMarkup(r, id) {
  const tag = r.type === 'radial' ? 'radialGradient' : 'linearGradient';
  const coords = Object.entries(r.coords).map(([k, v]) => `${esc(k)}="${round(v, 5)}"`).join(' ');
  const stops = r.stops.map(([offset, color, opacity]) => `<stop offset="${round(offset, 4)}" stop-color="${esc(color)}" stop-opacity="${round(opacity, 3)}"/>`).join('');
  return `<${tag} id="${id}" gradientUnits="userSpaceOnUse" spreadMethod="${esc(r.spread)}" gradientTransform="matrix(${r.matrix.map((v) => round(v, 6)).join(' ')})" ${coords}>${stops}</${tag}>`;
}

function gradientMarkup(g, id, animate = () => '') {
  if (g.raw) return rawGradientMarkup(g.raw, id);
  const [x1, y1, x2, y2] = gradientPoints(g);
  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">`
    + ['x1', 'y1', 'x2', 'y2'].map((attr, i) => animate(attr, (h) => gradientPoints(h)[i])).join('')
    + `<stop offset="0" stop-color="${esc(g.from)}">${animate('stop-color', (h) => h.from)}</stop>`
    + `<stop offset="1" stop-color="${esc(g.to)}">${animate('stop-color', (h) => h.to)}</stop></linearGradient>`;
}

const fillOf = (o, gradientId) => (o.gradient ? `url(#${gradientId})` : esc(o.fill));

// Fonts stored in the file, because a saved or exported SVG cannot reach the
// app's own font files.
const embeddedFonts = new Map();
const FONT_TYPES = { woff2: ['font/woff2', 'woff2'], woff: ['font/woff', 'woff'], ttf: ['font/ttf', 'truetype'], otf: ['font/otf', 'opentype'] };
export const embedFont = (family, data, format = 'woff2') => embeddedFonts.set(family, { data, format });

// A project's own fonts (doc.fonts) come first, so an export works even when
// the project is not open.
function fontStyle(doc) {
  const used = new Set(doc.layers.flatMap((l) => l.objects).filter((o) => o.type === 'text').map((o) => o.fontFamily));
  const faces = [...used].map((family) => {
    const font = doc.fonts?.find((f) => f.family === family) || embeddedFonts.get(family);
    const type = font && FONT_TYPES[font.format];
    if (!type || !/^[A-Za-z0-9+/=]+$/.test(font.data)) return '';
    return `@font-face{font-family:"${family.replace(/["\\<>]/g, '')}";src:url(data:${type[0]};base64,${font.data}) format("${type[1]}")}`;
  }).filter(Boolean);
  return faces.length ? `<style>${faces.join('')}</style>` : '';
}

const SHADOW_X = 0.045, SHADOW_Y = 0.06;

/* ---------- Text ---------- */

export const WARPS = { none: 'None', arc: 'Arc', wave: 'Wave', bulge: 'Bulge', pinch: 'Pinch', rise: 'Rise' };
const ANCHORS = { left: 'start', center: 'middle', right: 'end' };
// Roughly how wide a letter is, for sizing an arc before the font is measured.
const LETTER_WIDTH = 0.58;
const MAX_ARC = Math.PI * 1.5;

// Each letter of a line on its own, for warps that move or size letters one by one.
function letters(line, place) {
  const chars = [...line];
  return chars.map((ch, i) => `<tspan ${place(i, chars.length)}>${esc(ch)}</tspan>`).join('');
}

// The lines of a text, laid out for its alignment and warp. id: for the arc paths.
function textLines(o, id) {
  const lines = o.text.split('\n');
  const height = o.fontSize * 1.2;
  const top = (-(lines.length - 1) * height) / 2;
  const warp = WARPS[o.warp?.type] ? o.warp.type : 'none';
  const bend = Math.max(-100, Math.min(100, o.warp?.amount ?? 50)) / 100;
  if (warp === 'arc' && bend) {
    // Each line sits on a circle: bending up makes a hill, down makes a bowl.
    // The text is centred on the top (or bottom) of the circle.
    const paths = lines.map((line, i) => {
      const y = top + i * height;
      const angle = Math.abs(bend) * MAX_ARC;
      const r = Math.max(o.fontSize, ([...line].length * o.fontSize * LETTER_WIDTH) / angle);
      const a = Math.PI - 0.02, up = bend > 0;
      const at = (t) => (up ? [r * Math.sin(t), y + r - r * Math.cos(t)] : [r * Math.sin(t), y - r + r * Math.cos(t)]);
      const [x0, y0] = at(up ? -a : -a), [x1, y1] = at(a);
      return `<path id="${id}-arc${i}" d="M${round(x0)} ${round(y0)}A${round(r)} ${round(r)} 0 1 ${up ? 1 : 0} ${round(x1)} ${round(y1)}" fill="none"/>`;
    });
    return {
      defs: `<defs>${paths.join('')}</defs>`,
      anchor: 'middle',
      content: lines.map((line, i) => `<textPath href="#${id}-arc${i}" startOffset="50%">${esc(line) || ' '}</textPath>`).join(''),
    };
  }
  const anchor = ANCHORS[o.align] || 'middle';
  const lift = o.fontSize * 0.45 * bend;
  const content = lines.map((line, i) => {
    const y = round(top + i * height);
    if (warp === 'wave' && bend) {
      // Letters ride a wave: each is moved by the change from the one before, and tipped to follow it.
      let last = 0;
      return letters(line, (k, n) => {
        const t = n > 1 ? k / (n - 1) : 0.5;
        const now = Math.sin(t * Math.PI * 2) * lift;
        const tilt = Math.cos(t * Math.PI * 2) * 22 * bend;
        const move = round(k === 0 ? y + now : now - last);
        last = now;
        return k === 0 ? `x="0" y="${move}" rotate="${round(-tilt)}"` : `dy="${move}" rotate="${round(-tilt)}"`;
      });
    }
    if ((warp === 'bulge' || warp === 'pinch') && bend) {
      // Letters grow towards the middle (bulge) or the ends (pinch).
      const sign = warp === 'bulge' ? 1 : -1;
      return letters(line, (k, n) => {
        const t = n > 1 ? k / (n - 1) : 0.5;
        const size = o.fontSize * Math.max(0.3, 1 + sign * Math.abs(bend) * 0.7 * (Math.sin(t * Math.PI) - 0.5));
        return `${k === 0 ? `x="0" y="${y}" ` : ''}font-size="${round(size)}"`;
      });
    }
    if (warp === 'rise' && bend) {
      // Letters climb steadily, each tipped the same way.
      const n = [...line].length;
      const step = n > 1 ? (-lift * 2) / (n - 1) : 0;
      const tilt = round(-Math.atan2(step, o.fontSize * LETTER_WIDTH) * (180 / Math.PI));
      return letters(line, (k) => (k === 0 ? `x="0" y="${round(y - (step * (n - 1)) / 2)}" rotate="${tilt}"` : `dy="${round(step)}" rotate="${tilt}"`));
    }
    return `<tspan x="0" y="${y}">${esc(line) || ' '}</tspan>`;
  }).join('');
  return { defs: '', anchor, content };
}

// A texture is the same outline drawn again on top, filled with the pattern.
// Outline-only shapes get it on their outline instead.
function texturePaint(o, textureId) {
  if (o.fill !== 'none') return `fill="url(#${textureId})" stroke="none"`;
  return `fill="none" ${strokeAttrs({ ...o, stroke: `url(#${textureId})` })}`;
}

// The patterns for a thing's textures, and their ids, one per texture.
function texturePatterns(o, base, frame, opt) {
  const list = o.type === 'image' ? [] : texturesOf(o);
  return {
    defs: list.map((tex, i) => patternMarkup(tex, `${base}${i}`, o, frame, opt)).join(''),
    ids: list.map((_, i) => `${base}${i}`),
  };
}

// textureIds: one pattern per texture, each drawn over the last.
function body(o, inner = '', gradientId = '', textureIds = [], textureInner = '') {
  const ids = textureIds || [];
  if (o.type === 'path') {
    const d = pathD(o.subpaths);
    return `<path d="${d}" fill="${fillOf(o, gradientId)}" fill-rule="${o.fillRule}" ${strokeAttrs(o)}${opacityAttrs(o)}${lookAttrs(o)}>${inner}</path>`
      + ids.map((id) => `<path d="${d}" fill-rule="${o.fillRule}" ${texturePaint(o, id)}>${textureInner}</path>`).join('');
  }
  if (o.type === 'text') {
    const { content, defs, anchor } = textLines(o, gradientId.replace(/-paint$/, ''));
    const style = `font-family="${esc(o.fontFamily)}" font-size="${round(o.fontSize)}" font-weight="${o.bold ? 700 : 400}" font-style="${o.italic ? 'italic' : 'normal'}"`;
    const text = `${style} text-anchor="${anchor}" dominant-baseline="central" xml:space="preserve"`;
    const shadow = o.shadow ? `<text ${text} fill="#000000" fill-opacity="0.24" transform="translate(${round(o.fontSize * SHADOW_X)} ${round(o.fontSize * SHADOW_Y)})">${content}</text>` : '';
    // The outline goes round the outside of the letters: it is drawn twice as
    // wide, behind the fill, so the fill covers its inner half.
    const line = !o.stroke || o.stroke === 'none' || !o.strokeWidth ? 'stroke="none"'
      : `${strokeAttrs({ ...o, strokeWidth: o.strokeWidth * 2 })} paint-order="stroke"`;
    return `${defs}${shadow}<text ${text} fill="${fillOf(o, gradientId)}" ${line}${opacityAttrs(o)}>${inner}${content}</text>`
      + ids.map((id) => `<text ${text} ${texturePaint(o, id)}>${content}</text>`).join('');
  }
  return `<image href="${esc(o.href)}" x="${round(-o.w / 2)}" y="${round(-o.h / 2)}" width="${round(o.w)}" height="${round(o.h)}" preserveAspectRatio="none"/>`;
}

function eraseMask(o, id) {
  const lines = o.erase.map((e) => `<path d="${pathD([e.path])}" fill="none" stroke="#000" stroke-width="${round(e.width)}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  const half = MASK_SIZE / 2;
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="${-half}" y="${-half}" width="${MASK_SIZE}" height="${MASK_SIZE}"><rect x="${-half}" y="${-half}" width="${MASK_SIZE}" height="${MASK_SIZE}" fill="#fff"/>${lines}</mask>`;
}

// Imported pieces can stay cut to the shape they were clipped by in the file.
function clipsOf(o, id) {
  const list = o.clips || [];
  return {
    defs: list.map((paths, i) => `<clipPath id="${id}-c${i}">${paths.map((c) => `<path d="${pathD(c.subpaths)}" clip-rule="${esc(c.rule)}"/>`).join('')}</clipPath>`).join(''),
    open: list.map((_, i) => `<g clip-path="url(#${id}-c${i})">`).join(''),
    close: '</g>'.repeat(list.length),
  };
}

export const newUnderbelly = () => ({ size: 1, strength: 0.28, color: '#000000' });

// How deep the band is at size 100%, as a share of the thing's height.
const BELLY_DEPTH = 0.14;

// How tall a thing is in its own units.
function localHeight(o) {
  if (o.type === 'path') return pathBounds(o.subpaths).height + (o.stroke && o.stroke !== 'none' ? o.strokeWidth : 0);
  if (o.type === 'image') return o.h;
  return o.text.split('\n').length * o.fontSize * 1.2;
}

// The underbelly: a see-through band along the bottom of anything (shapes,
// pictures, text), made from its own outline. The outline moved up is cut out of
// the outline, so the band follows the bottom edge and curves up wherever the
// edge does. The cut-out edge is sharpened so straight sides leave no faint line.
function underbellyFilter(o, id) {
  if (!o.underbelly) return '';
  const u = { ...newUnderbelly(), ...o.underbelly };
  const depth = localHeight(o) * BELLY_DEPTH * u.size * Math.sign(o.scaleY || 1);
  if (!depth || !(u.strength > 0)) return '';
  const half = MASK_SIZE / 2;
  return `<filter id="${id}" filterUnits="userSpaceOnUse" x="${-half}" y="${-half}" width="${MASK_SIZE}" height="${MASK_SIZE}" color-interpolation-filters="sRGB">`
    + `<feOffset in="SourceAlpha" dx="0" dy="${round(-depth, 2)}" result="up"/>`
    + '<feComposite in="SourceAlpha" in2="up" operator="out"/>'
    + '<feComponentTransfer result="band"><feFuncA type="linear" slope="2" intercept="-0.5"/></feComponentTransfer>'
    + (u.blur > 0 ? `<feGaussianBlur in="band" stdDeviation="${round(u.blur, 2)}" result="band"/>` : '')
    + `<feFlood flood-color="${esc(u.color)}" flood-opacity="${round(u.strength, 3)}"/>`
    + (u.blur > 0 ? '<feComposite in2="band" operator="in"/><feComposite in2="SourceAlpha" operator="in" result="belly"/>' : '<feComposite in2="band" operator="in" result="belly"/>')
    + '<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="belly"/></feMerge></filter>';
}

// Blur is measured on the canvas, so it sits outside the piece's own scale.
// values: an animated blur, one stdDeviation per frame.
function blurred(markup, id, amount, values = '') {
  if (!(amount > 0) && !values) return markup;
  const half = MASK_SIZE / 2;
  return `<g filter="url(#${id})"><filter id="${id}" filterUnits="userSpaceOnUse" x="${-half}" y="${-half}" width="${MASK_SIZE}" height="${MASK_SIZE}"><feGaussianBlur stdDeviation="${round(amount || 0, 2)}">${values}</feGaussianBlur></filter>${markup}</g>`;
}

// A welded shape's pieces, each in its own colours, cut to the joined outline. The
// outline is filled first, so anywhere the outline was stretched past the pieces
// still has colour. Its texture and line go on top of the pieces.
function weldedParts(o, id, frame, opt, shape = '', textureIds = []) {
  if (o.type !== 'path' || !o.parts?.length) return { defs: '', art: '' };
  const d = pathD(o.subpaths, { uniform: !!shape });
  const parts = o.parts.map((p, i) => objectMarkup(p, frame, { ...opt, editor: false, prefix: `${id}-p${i}`, part: i })).join('');
  const textured = textureIds.map((t) => `<path d="${d}" fill-rule="${esc(o.fillRule || 'nonzero')}" ${texturePaint(o, t)}>${shape}</path>`).join('');
  const line = strokeAttrs(o) === 'stroke="none"' ? '' : `<path d="${d}" fill="none" ${strokeAttrs(o)}>${shape}</path>`;
  return {
    defs: `<clipPath id="${id}-weld"><path d="${d}" clip-rule="${esc(o.fillRule || 'nonzero')}">${shape}</path></clipPath>`,
    art: `<g clip-path="url(#${id}-weld)">${parts}</g>${textured}${line}`,
  };
}

function objectMarkup(raw, frame, opt) {
  const o = sample(raw, frame);
  const maskId = `${opt.prefix || 'erase'}-${raw.id}`;
  const masked = raw.erase?.length > 0;
  // Locked things can't be picked on the canvas.
  const tag = opt.part !== undefined ? ` data-part="${opt.part}"` : opt.editor ? ` data-id="${raw.id}"${raw.locked ? ' pointer-events="none"' : ''}` : '';
  const gradientId = `${maskId}-paint`;
  const clip = clipsOf(raw, maskId);
  const textures = texturePatterns(o, `${maskId}-tex`, frame, opt);
  const texture = textures.defs;
  const belly = underbellyFilter(o, `${maskId}-belly`);
  const parts = weldedParts(o, maskId, frame, opt, '', textures.ids);
  const defs = (masked ? eraseMask(raw, maskId) : '') + (o.gradient ? gradientMarkup(o.gradient, gradientId) : '') + texture + clip.defs + belly + parts.defs;
  return blurred(`<g${tag} transform="${transformOf(o)}" opacity="${round(o.opacity, 3)}">${defs}<g class="b"${masked ? ` mask="url(#${maskId})"` : ''}${belly ? ` filter="url(#${maskId}-belly)"` : ''}>${clip.open}${body(o, '', gradientId, parts.art ? [] : textures.ids)}${parts.art}${clip.close}</g></g>`, `${maskId}-blur`, o.blur);
}

// One object in an animated export, sampled once per frame.
function animatedObject(raw, doc, opt) {
  const count = doc.frames;
  const dur = `${round(count / doc.fps, 3)}s`;
  const samples = Array.from({ length: count }, (_, f) => sample(raw, f));
  samples.push(samples[count - 1]);

  const animate = (attr, fn) => {
    const values = samples.map(fn);
    if (new Set(values).size < 2) return '';
    return `<animate attributeName="${attr}" values="${values.join(';')}" dur="${dur}" repeatCount="indefinite"/>`;
  };
  const motion = (type, fn) => `<animateTransform attributeName="transform" type="${type}" additive="sum" values="${samples.map(fn).join(';')}" dur="${dur}" repeatCount="indefinite"/>`;

  const shape = raw.type === 'path' ? animate('d', (s) => pathD(s.subpaths, { uniform: true })) : '';
  const inner = animate('fill', (s) => s.fill) + animate('stroke', (s) => s.stroke)
    + animate('fill-opacity', (s) => round(s.fillOpacity ?? 1, 3)) + animate('stroke-opacity', (s) => round(s.strokeOpacity ?? 1, 3))
    + animate('stroke-width', (s) => round(s.strokeWidth)) + shape;

  const first = samples[0];
  const maskId = `${opt.prefix || 'erase'}-${raw.id}`;
  const masked = raw.erase?.length > 0;
  const gradientId = `${maskId}-paint`;
  const painted = samples.find((s) => s.gradient)?.gradient;
  const gradientTag = (attr, fn) => animate(attr, (s) => fn(s.gradient || painted));
  const clip = clipsOf(raw, maskId);
  const textures = texturePatterns({ ...first, textures: texturesOf(raw) }, `${maskId}-tex`, 0, opt);
  const texture = textures.defs;
  const belly = underbellyFilter(first, `${maskId}-belly`);
  const parts = weldedParts(first, maskId, 0, opt, shape, textures.ids);
  const blurs = animate('stdDeviation', (s) => round(s.blur || 0, 2));
  return blurred(`<g opacity="${round(first.opacity, 3)}">`
    + motion('translate', (s) => `${round(s.x)} ${round(s.y)}`)
    + motion('rotate', (s) => round(s.rotation))
    + motion('scale', (s) => `${round(s.scaleX, 4)} ${round(s.scaleY, 4)}`)
    + animate('opacity', (s) => round(s.opacity, 3))
    + (masked ? eraseMask(raw, maskId) : '')
    + (painted ? gradientMarkup(painted, gradientId, gradientTag) : '') + texture + clip.defs + belly + parts.defs
    + `<g${masked ? ` mask="url(#${maskId})"` : ''}${belly ? ` filter="url(#${maskId}-belly)"` : ''}>${clip.open}${body({ ...first, gradient: painted }, raw.type === 'image' ? '' : inner, gradientId, parts.art ? [] : textures.ids, shape)}${parts.art}${clip.close}</g></g>`, `${maskId}-blur`, first.blur, blurs);
}

/* ---------- Shadows ---------- */

// Shadows are flat and see-through, like Blooket's art, rather than soft and fading.
export const newDropShadow = () => ({ strength: 0.3, distance: 10, soft: 0, angle: 90 });
export const newAutoShadow = () => ({ on: true, strength: 0.25, size: 10, soft: 0 });

// Roughly where a piece sits on the canvas, to find the ones it overlaps.
function worldBounds(raw, frame) {
  const o = sample(raw, frame);
  let b;
  if (o.type === 'path') {
    const p = pathBounds(o.subpaths), w = o.stroke && o.stroke !== 'none' ? o.strokeWidth / 2 : 0;
    b = { x: p.x - w, y: p.y - w, width: p.width + w * 2, height: p.height + w * 2 };
  } else if (o.type === 'image') {
    b = { x: -o.w / 2, y: -o.h / 2, width: o.w, height: o.h };
  } else {
    const lines = o.text.split('\n');
    const width = Math.max(...lines.map((l) => l.length)) * o.fontSize * 0.7, height = lines.length * o.fontSize * 1.2;
    b = { x: -width / 2, y: -height / 2, width, height };
  }
  const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => localToWorld(o, x, y));
  const grow = (o.blur || 0) * 2;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs) - grow, y0: Math.min(...ys) - grow, x1: Math.max(...xs) + grow, y1: Math.max(...ys) + grow };
}

const touching = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// Big enough for any canvas, measured on the canvas itself.
const region = () => `filterUnits="userSpaceOnUse" x="${-MASK_SIZE / 2}" y="${-MASK_SIZE / 2}" width="${MASK_SIZE}" height="${MASK_SIZE}"`;

// A see-through black copy of whatever the filter is on, moved by dx, dy.
// Solid unless soft is above 0.
const shadeFilter = (id, strength, soft, dx, dy) => `<filter id="${id}" ${region()}>`
  + (soft > 0 ? `<feGaussianBlur in="SourceAlpha" stdDeviation="${round(soft, 2)}"/><feOffset dx="${round(dx, 2)}" dy="${round(dy, 2)}"/>`
    : `<feOffset in="SourceAlpha" dx="${round(dx, 2)}" dy="${round(dy, 2)}"/>`)
  + `<feComponentTransfer><feFuncA type="linear" slope="${round(strength, 3)}"/></feComponentTransfer></filter>`;

// The pieces a drop shadow is made of: a Blook's pieces share one shadow, so
// they don't darken each other. Keyed by the first piece, where it is drawn.
function shadowTeams(list) {
  const teams = new Map(), byGroup = new Map();
  list.forEach((o, i) => {
    if (!o.dropShadow) return;
    const team = o.group && byGroup.get(o.group);
    if (team) { team.push(o); return; }
    const fresh = [o];
    teams.set(i, fresh);
    if (o.group) byGroup.set(o.group, fresh);
  });
  return teams;
}

// Shadows are copies (<use>) of the art itself, so they follow it in animations.
// Auto shadow: each piece casts a flat see-through shadow, only onto the pieces under it.
// Because the piece is drawn over its own shadow, just a solid band shows below its edge.
function withShadows(list, frame, opt, layer, draw) {
  const prefix = `${opt.prefix || 'erase'}-${layer.id}`;
  const ref = (o) => `${prefix}-o-${o.id}`;
  const uses = (items) => items.map((o) => `<use href="#${ref(o)}"/>`).join('');
  const used = new Set();
  const auto = opt.doc?.autoShadow;
  const autoOn = auto?.on && auto.strength > 0 && auto.size > 0;
  const moves = (o) => opt.animate && o.keys?.length;
  const boxes = autoOn ? list.map((o) => worldBounds(o, frame)) : [];
  const teams = shadowTeams(list);
  let defs = autoOn ? `<filter id="${prefix}-solid" ${region()}><feFlood flood-color="#fff"/><feComposite in2="SourceAlpha" operator="in"/></filter>`
    + shadeFilter(`${prefix}-shade`, auto.strength, auto.soft || 0, 0, auto.size) : '';
  const parts = list.map((o, i) => {
    let before = '';
    const team = teams.get(i);
    if (team) {
      const s = { ...newDropShadow(), ...o.dropShadow }, a = rad(s.angle);
      defs += shadeFilter(`${prefix}-ds-${o.id}`, s.strength, s.soft, Math.cos(a) * s.distance, Math.sin(a) * s.distance);
      team.forEach((t) => used.add(t.id));
      before += `<g pointer-events="none" filter="url(#${prefix}-ds-${o.id})">${uses(team)}</g>`;
    }
    const under = autoOn ? list.slice(0, i).filter((b, j) => moves(o) || moves(b) || touching(boxes[i], boxes[j])) : [];
    if (under.length) {
      [o, ...under].forEach((t) => used.add(t.id));
      defs += `<mask id="${prefix}-as-${o.id}" maskUnits="userSpaceOnUse" x="${-MASK_SIZE / 2}" y="${-MASK_SIZE / 2}" width="${MASK_SIZE}" height="${MASK_SIZE}"><g filter="url(#${prefix}-solid)">${uses(under)}</g></mask>`;
      before += `<g pointer-events="none" mask="url(#${prefix}-as-${o.id})"><use href="#${ref(o)}" filter="url(#${prefix}-shade)"/></g>`;
    }
    return { o, before, markup: draw(o) };
  });
  return (defs ? `<defs>${defs}</defs>` : '')
    + parts.map(({ o, before, markup }) => before + (used.has(o.id) ? `<g id="${ref(o)}">${markup}</g>` : markup)).join('');
}

export function layerMarkup(layer, frame, opt = {}) {
  // Hidden things are not drawn, on the canvas or in exports.
  const list = (opt.doc ? objectsOn(opt.doc, layer, frame) : layer.objects).filter((o) => !o.hidden);
  const draw = (o) => (opt.animate && o.keys?.length ? animatedObject(o, opt.doc, opt) : objectMarkup(o, frame, opt));
  const objects = withShadows(list, frame, opt, layer, draw);
  const attrs = opt.editor ? ` data-layer="${layer.id}"` : ` id="${esc(layer.name.replace(/[^\w-]+/g, '-'))}"`;
  return `<g${attrs} opacity="${round(layer.opacity, 3)}">${objects}</g>`;
}

// A looping flipbook: each page shows for its turn, then hides again.
function pagesMarkup(doc, opt) {
  const count = doc.pages.length;
  const dur = `${round(count / doc.fps, 3)}s`;
  const time = (i) => round(i / count, 5);
  return doc.pages.map((_, i) => {
    const art = doc.layers.filter((l) => l.visible).map((l) => layerMarkup(l, i, { ...opt, doc, animate: false, prefix: `page${i}` })).join('');
    if (count < 2) return art;
    const last = i === count - 1;
    const steps = i === 0 ? ['inline', 'none'] : ['none', 'inline', ...(last ? [] : ['none'])];
    const times = i === 0 ? [0, time(1)] : [0, time(i), ...(last ? [] : [time(i + 1)])];
    return `<g display="${i ? 'none' : 'inline'}"><animate attributeName="display" values="${steps.join(';')}" keyTimes="${times.join(';')}" calcMode="discrete" dur="${dur}" repeatCount="indefinite"/>${art}</g>`;
  }).join('');
}

export function layersMarkup(doc, frame, opt = {}) {
  if (opt.animate && isPages(doc)) return pagesMarkup(doc, opt);
  return doc.layers.filter((l) => l.visible).map((l) => layerMarkup(l, frame, { ...opt, doc })).join('');
}

export function backgroundMarkup(doc, prefix = 'frame', frame = 0, opt = {}) {
  const blur = Math.max(0, doc.bgBlur || 0), fade = doc.bgOpacity ?? 1;
  const pad = round(blur * 3);
  const area = pad ? `x="${-pad}" y="${-pad}" width="${doc.width + pad * 2}" height="${doc.height + pad * 2}"` : `width="${doc.width}" height="${doc.height}"`;
  const texture = bgTexturesOf(doc).map((tex, i) => `${patternMarkup(tex, `${prefix}-bgtex${i ? i : ''}`, null, frame, { ...opt, doc })}<rect ${area} fill="url(#${prefix}-bgtex${i ? i : ''})"/>`).join('');
  let art;
  if (doc.bgGradient) {
    const id = `${prefix}-bg`;
    art = `${gradientMarkup(doc.bgGradient, id)}<rect ${area} fill="url(#${id})"/>${texture}`;
  } else if (!doc.background || doc.background === 'none') {
    art = texture;
  } else {
    art = `<rect ${area} fill="${esc(doc.background)}"/>${texture}`;
  }
  if (!art || (fade >= 1 && !blur)) return art;
  const half = MASK_SIZE / 2;
  const filter = blur ? `<filter id="${prefix}-bgblur" filterUnits="userSpaceOnUse" x="${-half}" y="${-half}" width="${MASK_SIZE}" height="${MASK_SIZE}"><feGaussianBlur stdDeviation="${round(blur, 2)}"/></filter>` : '';
  return `${filter}<g${fade < 1 ? ` opacity="${round(Math.max(0, fade), 3)}"` : ''}${blur ? ` filter="url(#${prefix}-bgblur)"` : ''}>${art}</g>`;
}

// Rounded canvases are cut to shape with a clip around all the art.
export function frameClip(doc, prefix = 'frame') {
  if (!doc.cornerRadius) return { defs: '', attr: '' };
  const id = `${prefix}-clip`;
  return {
    defs: `<clipPath id="${id}"><rect width="${doc.width}" height="${doc.height}" rx="${round(doc.cornerRadius)}"/></clipPath>`,
    attr: ` clip-path="url(#${id})"`,
  };
}

// animate: true writes a looping animated SVG. Otherwise a single frame.
// box: draws just the art, with no background or canvas shape, over that area.
export function exportSVG(doc, { frame = 0, animate = false, box = null, overlay = true } = {}) {
  if (box) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}" viewBox="${box.x} ${box.y} ${box.width} ${box.height}">${fontStyle(doc)}${layersMarkup(doc, frame)}</svg>`;
  }
  const clip = frameClip(doc);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">`
    + `<title>${esc(doc.name)}</title>${fontStyle(doc)}${clip.defs}<g${clip.attr}>${backgroundMarkup(doc, 'frame', frame, { animate })}${layersMarkup(doc, frame, { animate })}${overlay ? overlayMarkup(doc) : ''}</g></svg>`;
}

export const svgDataUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export async function rasterize(svg, width, height) {
  const img = new Image();
  img.src = svgDataUrl(svg);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);
  return canvas;
}
