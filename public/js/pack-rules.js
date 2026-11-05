// The rules of a pack: rarities, odds and what comes out when one is opened.

// intro: how long the build-up lasts, in ms. entrance: how the card arrives.
// confetti: where it comes from and in what colours, as in Blooket: none for
// Common and Uncommon, blue and cyan from the bottom corners for Rare, red from
// both sides for Epic, orange raining from the top for Legendary, and gems with
// confetti from every corner for Chroma and Unique.
export const RARITIES = {
  Common: { color: '#a9b3b6', odds: 40, sells: 1, intro: 200, entrance: 'pop', confetti: { from: 'none' } },
  Uncommon: { color: '#48b82c', odds: 30, sells: 5, intro: 250, entrance: 'pop', confetti: { from: 'none' } },
  Rare: {
    color: '#0a18d6', odds: 15, sells: 20, intro: 350, entrance: 'rise',
    confetti: { from: 'bottom-corners', colors: ['#0a18d6', '#2b54ff', '#17c4e6', '#7fe3ff'], count: 70, speed: 58, waves: 2, gap: 160 },
  },
  Epic: {
    color: '#d3350b', odds: 8, sells: 75, intro: 550, entrance: 'grow',
    confetti: { from: 'sides', colors: ['#d3350b', '#ff4d2e', '#ff8a6b', '#a51f00'], count: 60, speed: 62, waves: 4, gap: 220 },
  },
  Legendary: {
    color: '#ff910f', odds: 3, sells: 200, intro: 800, entrance: 'drop',
    confetti: { from: 'top', colors: ['#ff910f', '#ffb347', '#ffd27a', '#ff6a00'], count: 26, waves: 14, gap: 180 },
  },
  Chroma: {
    color: '#17c4e6', odds: 1, sells: 300, intro: 1100, entrance: 'spin',
    confetti: { from: 'all-corners', colors: ['#17c4e6', '#7fe3ff', '#ffffff', '#00a2c7'], count: 45, speed: 60, waves: 5, gap: 260, gems: true, imageShare: 0.3 },
  },
  Unique: {
    color: '#00918d', odds: 0.1, sells: 500, intro: 1300, entrance: 'spin',
    confetti: { from: 'all-corners', colors: ['#00918d', '#2fd1c2', '#ffffff', '#ffe066'], count: 50, speed: 64, waves: 7, gap: 260, gems: true, imageShare: 0.35 },
  },
};

export const rarityOf = (name) => RARITIES[name] ?? RARITIES.Common;
export const gemOf = (name) => `/rarity/${(RARITIES[name] ? name : 'Common').toLowerCase()}.svg`;

export const newPack = () => ({ price: 25, art: null, back: null, blooks: [], pulled: {} });

export const pullsOf = (pack, blook) => pack.pulled?.[blook.id] ?? 0;

// Counts a pull. Returns true the first time this Blook comes out.
export function recordPull(pack, blook) {
  pack.pulled ??= {};
  pack.pulled[blook.id] = pullsOf(pack, blook) + 1;
  return pack.pulled[blook.id] === 1;
}

const totalOdds = (blooks) => blooks.reduce((sum, b) => sum + Math.max(0, b.odds), 0);

// Odds that don't add up to 100 still work: each Blook gets its share of the total.
export function chanceOf(blook, blooks) {
  const total = totalOdds(blooks);
  return total ? (Math.max(0, blook.odds) / total) * 100 : 0;
}

// roll is a number from 0 up to 1.
export function pickBlook(blooks, roll) {
  let left = roll * totalOdds(blooks);
  for (const blook of blooks) {
    left -= Math.max(0, blook.odds);
    if (left < 0) return blook;
  }
  return blooks.findLast((b) => b.odds > 0) ?? null;
}

// Keeps each Blook's share and makes the odds add up to 100.
export function balanceOdds(blooks) {
  const total = totalOdds(blooks);
  if (!total) return blooks.map((b) => ({ ...b, odds: Math.round(10000 / blooks.length) / 100 }));
  return blooks.map((b) => ({ ...b, odds: Math.round((Math.max(0, b.odds) / total) * 10000) / 100 }));
}

export function whyNotOpen(pack) {
  if (!pack.art) return 'Pick the pack art first.';
  if (!pack.blooks.length) return 'Add at least one Blook first.';
  if (!totalOdds(pack.blooks)) return 'At least one Blook needs odds above 0.';
  return '';
}
