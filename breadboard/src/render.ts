import type { DiscoveredView, EnrichedConfigMap, OnSlotChange, PlacedCard } from "./types.js";
import { createViewCard, clearDocUrlRegistry } from "./cards.js";
import { createSvgOverlay, drawConnections } from "./connections.js";
import { viewKey, initialPositions, resolveCollisions, applyPositions, restoreCachedPositions, savePositionsToCache, updateCacheEntry } from "./layout.js";
import { createArrayEditor } from "./editing.js";

export interface RenderResult {
  svg: SVGSVGElement;
  cardLookup: Map<string, HTMLElement>;
}

export function renderCards(
  overlay: HTMLElement,
  views: DiscoveredView[],
  configMap: EnrichedConfigMap | null,
  onSlotChange: OnSlotChange | null
): RenderResult {
  clearDocUrlRegistry();
  const svg = createSvgOverlay();
  overlay.appendChild(svg);

  const allCards: PlacedCard[] = [];
  const cardLookup = new Map<string, HTMLElement>();

  for (const view of views) {
    if (view.depth === 0 || (!view.toolId && !view.docUrl)) continue;

    const slotInfo = view.toolId ? (configMap?.get(view.toolId) ?? null) : null;
    const arrayEditor = slotInfo?.kind === "array" && onSlotChange ? createArrayEditor(slotInfo, onSlotChange) : null;
    const card = createViewCard(view, slotInfo, onSlotChange, arrayEditor);
    const key = viewKey(view);

    overlay.appendChild(card);
    allCards.push({ card, view, x: 0, y: 0, key });
    cardLookup.set(key, card);
  }

  const uncached = restoreCachedPositions(allCards);
  if (uncached.length > 0) { initialPositions(uncached); resolveCollisions(uncached); }
  applyPositions(allCards);
  savePositionsToCache(allCards);

  drawConnections(svg, allCards);
  const timer = setTimeout(() => drawConnections(svg, allCards), 500);

  for (const c of allCards) {
    c.card.addEventListener("breadboard:moved", () => {
      c.x = c.card.offsetLeft; c.y = c.card.offsetTop;
      updateCacheEntry(c.key, c.x, c.y);
      drawConnections(svg, allCards);
    });
  }

  (overlay as any).__drawTimer = timer;
  return { svg, cardLookup };
}

export function cleanupOverlayTimer(overlay: HTMLElement): void {
  const t = (overlay as any).__drawTimer;
  if (t) clearTimeout(t);
}
