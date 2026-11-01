// The rules of a pack: rarities, odds and what comes out when one is opened.

// gems: how many fly out. intro: how long the build-up lasts, in ms.
// entrance: how the card arrives. Rarer Blooks make more of a fuss.
export const RARITIES = {
  Common: { color: '#a9b3b6', odds: 40, sells: 1, gems: 16, intro: 200, entrance: 'pop' },
  Uncommon: { color: '#48b82c', odds: 30, sells: 5, gems: 34, intro: 250, entrance: 'pop' },
  Rare: { color: '#0a18d6', odds: 15, sells: 20, gems: 46, intro: 350, entrance: 'bounce' },
  Epic: { color: '#d3350b', odds: 8, sells: 75, gems: 60, intro: 550, entrance: 'slam' },
  Legendary: { color: '#ff910f', odds: 3, sells: 200, gems: 80, intro: 800, entrance: 'slam' },
  Chroma: { color: '#17c4e6', odds: 1, sells: 300, gems: 100, intro: 1100, entrance: 'spin' },
  Unique: { color: '#00918d', odds: 0.1, sells: 500, gems: 120, intro: 1300, entrance: 'spin' },
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
