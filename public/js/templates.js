// Project templates in Blooket's shapes. Some come with an overlay: a shadow or
// shine drawn above all the art, which can be switched on or off, sized and made
// darker or lighter in the Canvas panel.

const UNDERBELLY = 'M-113.62 42.93L113.62 42.93C133.71 42.93 150 26.64 150 6.55L150 -42.93C150 -42.93 144.79 -4.43 103.96 1.53C63.12 7.5 -68.48 4.79 -93.48 4.79C-143.48 4.79 -150 -42.93 -150 -42.93L-150 6.55C-150 26.64 -133.71 42.93 -113.62 42.93Z';
const UNDERBELLY_HALF = 42.93;
const STRIP = 'M-187.54 -421.77L187.54 -421.77L187.54 421.77L-187.54 421.77Z';

const num = (v) => +v.toFixed(4);

// The underbelly grows upwards from the bottom edge, so it never leaves a gap there.
const shadow = (x, y, sx, sy) => ({ size, strength }) => {
  const bottom = y + UNDERBELLY_HALF * sy;
  return `<path transform="translate(${x} ${num(bottom - UNDERBELLY_HALF * sy * size)}) scale(${sx} ${num(sy * size)})" d="${UNDERBELLY}" fill="#000" fill-opacity="${num(strength)}"/>`;
};
const strip = (x, y, sx) => ({ size, strength }) => `<path transform="translate(${x} ${y}) rotate(36.65) scale(${num(sx * size)} 2.3114)" d="${STRIP}" fill="#fff" fill-opacity="${num(strength)}"/>`;

const UNDERBELLY_LOOK = { sizeLabel: 'Underbelly size', strengthLabel: 'Shadow darkness', strength: 0.28, maxSize: 3 };

export const TEMPLATES = {
  blook: {
    name: 'Blook', note: 'The square Blook shape', width: 512, height: 512, radius: 77, background: '#2ca5e8', words: ['Your Blook', 'Here'],
    overlay: { name: 'Underbelly shadow', ask: 'Add the underbelly?', note: 'A see-through shadow along the bottom that curves up each side. It stays on top of your art.', ...UNDERBELLY_LOOK, markup: shadow(256.17, 446.08, 1.7231, 1.6086) },
  },
  banner: {
    name: 'Banner', note: 'A long banner', width: 301, height: 66, radius: 4, background: '#2da1e9', words: ['Your Banner'],
    overlay: { name: 'Underbelly shadow', ask: 'Add the underbelly?', note: 'The same see-through shadow as a Blook, stretched along the banner. It stays on top of your art.', ...UNDERBELLY_LOOK, markup: shadow(150.5, 54.8, 1.0033, 0.26) },
  },
  background: {
    name: 'Blook background', note: 'What shows behind a Blook', width: 452, height: 461, radius: 0, background: '#2ca7e7', words: ['Blook', 'Background'],
  },
  // The little picture in a pack card's corner. Its shape shows as a faint
  // silhouette, so it starts see-through.
  icon: {
    name: 'Icon', note: 'Blook size with sharp corners, for the corner of a pack card', width: 512, height: 512, radius: 0, background: 'none', preview: '#b9a6c9', words: ['Icon'],
  },
  pack: {
    name: 'Pack art', note: 'The picture on the front of a pack', width: 1131, height: 929, radius: 0, background: '#2ca3e8', words: ['Your Pack', 'Art Here'],
    overlay: {
      name: 'Pack shine', ask: 'Add the pack shine?', note: 'Two see-through white strips from edge to edge, one thicker than the other. They stay on top of your art.',
      sizeLabel: 'Shine thickness', strengthLabel: 'Shine strength', strength: 0.1, maxSize: 2.5,
      markup: (look) => strip(412.96, 650.53, 1)(look) + strip(775.57, 833.1, 0.5166)(look),
    },
  },
};

// How big and how strong a project's overlay is. Older projects use the template's own.
export function overlayLook(doc) {
  const overlay = TEMPLATES[doc.template]?.overlay;
  return { size: doc.overlaySize ?? 1, strength: doc.overlayStrength ?? overlay?.strength ?? 0 };
}

export function overlayMarkup(doc) {
  const template = TEMPLATES[doc.template];
  if (!doc.overlay || !template?.overlay) return '';
  return `<g pointer-events="none" transform="scale(${doc.width / template.width} ${doc.height / template.height})">${template.overlay.markup(overlayLook(doc))}</g>`;
}

// A small drawing of the template, for the new project steps.
export function templatePreview(id, withOverlay = true) {
  const t = TEMPLATES[id];
  const longest = Math.max(...t.words.map((word) => word.length));
  const size = Math.min(t.height / 2, t.width / (longest * 0.72));
  const text = t.words.map((word, i) => `<text x="${t.width / 2}" y="${t.height / 2 + (i - (t.words.length - 1) / 2) * size * 1.15}" font-size="${size}" font-family="Titan One" text-anchor="middle" dominant-baseline="central" fill="#fff">${word}</text>`).join('');
  const clip = `template-${id}-${withOverlay ? 'on' : 'off'}`;
  const overlay = withOverlay && t.overlay ? t.overlay.markup({ size: 1, strength: t.overlay.strength }) : '';
  return `<svg class="template-art" viewBox="0 0 ${t.width} ${t.height}" aria-hidden="true"><clipPath id="${clip}"><rect width="${t.width}" height="${t.height}" rx="${t.radius}"/></clipPath>
    <g clip-path="url(#${clip})"><rect width="${t.width}" height="${t.height}" fill="${t.preview || t.background}"/>${text}${overlay}</g></svg>`;
}
