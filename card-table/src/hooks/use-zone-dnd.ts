import type { DocHandle } from "@automerge/automerge-repo";
import { useCallback, type DragEvent } from "react";
import { addZone, dealCards, moveCardByRef, removeZoneIfEmpty } from "../ops/zones";
import { deckCardCount } from "../ops/deck";
import {
  readDragPayload,
  writeDragPayload,
  type CardDragPayload,
} from "../dnd";
import { dragUrlWithTool, writePatchworkDrag } from "../patchwork-drag";
import { subZoneUrl } from "../paths";
import type { CardTableDoc, CardZone } from "../types";

function newPlayZoneId(): string {
  return `play-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Wire up the dragend reconciliation for a speculative zone minted at dragstart.
 *   • a target zone claimed the drag → it already removed the speculative zone
 *   • dropped on canvas (dropEffect !== "none") → run `onKeep` to populate it
 *   • cancelled → discard the empty speculative zone
 */
function resolveSpeculative(
  handle: DocHandle<CardTableDoc>,
  node: HTMLElement,
  speculativeId: string,
  onKeep: (draft: CardTableDoc) => void,
) {
  let resolved = false;
  const onEnd = (e: globalThis.DragEvent) => {
    if (resolved) return;
    resolved = true;
    node.removeEventListener("dragend", onEnd);
    window.removeEventListener("dragend", onEnd);

    const doc = handle.doc();
    const spec = doc?.zones.find((z) => z.id === speculativeId);
    if (!spec) return; // a target zone claimed the drag and cleaned up

    if ((e.dataTransfer?.dropEffect ?? "none") === "none") {
      handle.change((draft) => removeZoneIfEmpty(draft, speculativeId));
      return;
    }
    handle.change((draft) => onKeep(draft));
  };
  node.addEventListener("dragend", onEnd);
  window.addEventListener("dragend", onEnd);
}

/**
 * Drag/drop wiring shared by every zone: accept stock deals from the deck and
 * card moves from any other zone, and emit card drags from this zone. The deck
 * zone (`role: "deck"`) only emits stock drags and accepts nothing.
 */
export function useZoneDnd(
  handle: DocHandle<CardTableDoc>,
  table: CardTableDoc,
  zoneId: string,
  options?: { canDragOut?: boolean; isDeck?: boolean },
) {
  const ready = table.phase === "ready" && !!table.publishedDeck?.length;
  const canDragOut = options?.canDragOut ?? true;
  const isDeck = options?.isDeck ?? false;
  const zone = { id: zoneId };

  const accepts = useCallback(
    (payload: CardDragPayload): boolean => {
      if (!ready || isDeck) return false;
      if (payload.type === "stock") {
        return deckCardCount(table) > 0;
      }
      // Claim card drops even back onto the origin zone (a no-op move), so the
      // drop doesn't bubble to the canvas and spawn a stray play area.
      return true;
    },
    [ready, isDeck, table, zoneId],
  );

  const onDrop = useCallback(
    (payload: CardDragPayload) => {
      if (isDeck) return;
      handle.change((draft) => {
        if (payload.type === "stock") {
          dealCards(draft, zoneId, 1);
          // This zone took the deal, so the speculative canvas zone is unused.
          if (payload.speculativeId) {
            removeZoneIfEmpty(draft, payload.speculativeId);
          }
          return;
        }
        // No-ops when dropped back on the origin zone.
        moveCardByRef(draft, payload.from, zone, payload.index);
        // This zone claimed the card, so the speculative canvas zone is unused.
        if (payload.speculativeId) {
          removeZoneIfEmpty(draft, payload.speculativeId);
        }
      });
    },
    [handle, isDeck, zoneId],
  );

  // Dragging a single card mints an *empty* "speculative" zone so the canvas has
  // a real URL to embed, but the card itself stays put until drop — moving it at
  // dragstart would unmount the dragged node and abort the drag. We reconcile on
  // dragend:
  //   • a target zone claimed it → that zone already removed the speculative zone
  //   • dropped on canvas → move the card into the (now embedded) speculative zone
  //   • cancelled → discard the empty speculative zone; the card never moved
  const beginCardDrag = useCallback(
    (event: DragEvent<HTMLDivElement>, offset: number, index: number) => {
      if (!ready || !canDragOut || isDeck) return;

      const node = event.currentTarget;
      const speculativeId = newPlayZoneId();
      const tableUrl = handle.url;

      handle.change((draft) => {
        addZone(draft, {
          id: speculativeId,
          title: "Play area",
          faceUp: false,
          layout: "row",
        });
      });

      // Internal move payload (origin → target zone)…
      writeDragPayload(event.dataTransfer, {
        type: "card",
        from: { id: zoneId },
        offset,
        index,
        speculativeId,
      });
      // …and a standard patchwork drag so a canvas drop embeds the speculative zone.
      writePatchworkDrag(event.dataTransfer, "card-zone", [
        {
          id: speculativeId,
          url: dragUrlWithTool(subZoneUrl(tableUrl, speculativeId), "card-zone"),
          name: "Play area",
        },
      ]);

      // Kept on canvas → move the card into the embedded speculative zone.
      resolveSpeculative(handle, node, speculativeId, (draft) => {
        const origin = draft.zones.find((z) => z.id === zoneId);
        const at = origin ? [...origin.cards].indexOf(offset) : -1;
        if (at !== -1) {
          moveCardByRef(draft, { id: zoneId }, { id: speculativeId }, at);
        } else {
          // Nothing to place — drop the empty zone rather than leave it.
          removeZoneIfEmpty(draft, speculativeId);
        }
      });
    },
    [ready, canDragOut, isDeck, handle, zoneId],
  );

  return { ready, accepts, onDrop, beginCardDrag, canDragOut };
}

/**
 * Deck → card drag. Mirrors `beginCardDrag` but deals a fresh card from the
 * stock: dropping on a zone deals into that zone, dropping on the canvas deals
 * into a new play area.
 */
export function useStockDrag(handle: DocHandle<CardTableDoc>) {
  const tableUrl = handle.url;
  return useCallback(
    (event: DragEvent<HTMLElement>) => {
      const node = event.currentTarget;
      const speculativeId = newPlayZoneId();

      handle.change((draft) => {
        addZone(draft, {
          id: speculativeId,
          title: "Play area",
          faceUp: false,
          layout: "row",
        });
      });

      writeDragPayload(event.dataTransfer, {
        type: "stock",
        tableUrl,
        speculativeId,
      });
      writePatchworkDrag(event.dataTransfer, "card-zone", [
        {
          id: speculativeId,
          url: dragUrlWithTool(subZoneUrl(tableUrl, speculativeId), "card-zone"),
          name: "Play area",
        },
      ]);

      resolveSpeculative(handle, node, speculativeId, (draft) => {
        try {
          dealCards(draft, speculativeId, 1);
        } catch {
          removeZoneIfEmpty(draft, speculativeId);
        }
      });
    },
    [handle, tableUrl],
  );
}

export function deckLabel(deck: CardZone, table: CardTableDoc): string {
  return `${deck.title} · ${deck.cards.length}/${table.deckSize}`;
}

export function canDragDeck(table: CardTableDoc, deck: CardZone): boolean {
  return table.phase === "ready" && deck.cards.length > 0;
}

/** Parse a drop event into a payload, for callers that wire their own handlers. */
export function payloadFromDrop(
  dataTransfer: DataTransfer,
): CardDragPayload | null {
  return readDragPayload(dataTransfer);
}
