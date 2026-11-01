// The rules of a pack: rarities, odds and what comes out when one is opened.

export const RARITIES = {
  Uncommon: { color: '#4bc22e', odds: 40, sells: 5 },
  Rare: { color: '#2b6df0', odds: 25, sells: 20 },
  Epic: { color: '#d11f1f', odds: 15, sells: 75 },
  Legendary: { color: '#ff910f', odds: 5, sells: 200 },
  Chroma: { color: '#00ccff', odds: 1, sells: 300 },
  Mystical: { color: '#a335ee', odds: 0.1, sells: 1000 },
};

export const newPack = () => ({ price: 25, art: null, back: null, blooks: [] });

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
