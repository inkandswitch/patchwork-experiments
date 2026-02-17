import type { PlacedCard, DiscoveredView } from "./types.js";

const cache = new Map<string, { x: number; y: number }>();

export function clearPositionCache(): void { cache.clear(); }

export function viewKey(v: DiscoveredView): string {
  if (v.toolId) return `tool:${v.toolId}`;
  if (v.docUrl) return `doc:${v.docUrl}`;
  return `elem:${Math.random()}`;
}

export function initialPositions(cards: PlacedCard[]): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  for (const c of cards) {
    const r = c.view.element.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;

    if (cx < vw / 3) {
      c.x = Math.max(10, r.left - 270);
      c.y = Math.max(10, cy - 30);
    } else if (cx > (2 * vw) / 3) {
      c.x = Math.min(vw - 270, r.right + 20);
      c.y = Math.max(10, cy - 30);
    } else if (cy < vh / 3) {
      c.x = Math.max(10, cx - 120);
      c.y = Math.max(10, r.top - 100);
    } else {
      c.x = Math.max(10, cx - 120);
      c.y = Math.min(vh - 80, r.bottom + 20);
    }
  }
}

export function resolveCollisions(cards: PlacedCard[], iterations = 8): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const a = cards[i], b = cards[j];
        const ox = 260 - Math.abs(a.x - b.x);
        const oy = 80 - Math.abs(a.y - b.y);
        if (ox > 0 && oy > 0) {
          const push = (ox < oy ? ox : oy) / 2 + 4;
          if (ox < oy) {
            if (a.x < b.x) { a.x -= push; b.x += push; } else { a.x += push; b.x -= push; }
          } else {
            if (a.y < b.y) { a.y -= push; b.y += push; } else { a.y += push; b.y -= push; }
          }
        }
      }
    }
    for (const c of cards) {
      c.x = Math.max(4, Math.min(vw - 200, c.x));
      c.y = Math.max(4, Math.min(vh - 60, c.y));
    }
  }
}

export function applyPositions(cards: PlacedCard[]): void {
  for (const c of cards) {
    c.card.style.left = `${c.x}px`;
    c.card.style.top = `${c.y}px`;
  }
}

export function restoreCachedPositions(cards: PlacedCard[]): PlacedCard[] {
  const uncached: PlacedCard[] = [];
  for (const c of cards) {
    const pos = cache.get(c.key);
    if (pos) { c.x = pos.x; c.y = pos.y; } else { uncached.push(c); }
  }
  return uncached;
}

export function savePositionsToCache(cards: PlacedCard[]): void {
  for (const c of cards) cache.set(c.key, { x: c.x, y: c.y });
}

export function updateCacheEntry(key: string, x: number, y: number): void {
  cache.set(key, { x, y });
}
