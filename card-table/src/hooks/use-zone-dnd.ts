import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import { useCallback, type DragEvent } from "react";
import { dealCards, moveCardByRef } from "../ops/zones";
import { deckCardCount } from "../ops/deck";
import {
  readDragPayload,
  sameZone,
  writeDragPayload,
  type CardDragPayload,
} from "../dnd";
import type { CardTableDoc, CardZone } from "../types";

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
      return !sameZone(payload.from, zone);
    },
    [ready, isDeck, table, zoneId],
  );

  const onDrop = useCallback(
    (payload: CardDragPayload) => {
      if (isDeck) return;
      handle.change((draft) => {
        if (payload.type === "stock") {
          dealCards(draft, zoneId, 1);
          return;
        }
        moveCardByRef(draft, payload.from, zone, payload.index);
      });
    },
    [handle, isDeck, zoneId],
  );

  const dragCard = useCallback(
    (event: DragEvent<HTMLDivElement>, offset: number, index: number) => {
      if (!canDragOut) return;
      writeDragPayload(event.dataTransfer, {
        type: "card",
        from: zone,
        offset,
        index,
      });
    },
    [canDragOut, zoneId],
  );

  return { ready, accepts, onDrop, dragCard, canDragOut };
}

export function useStockDrag(tableUrl: AutomergeUrl) {
  return useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      writeDragPayload(event.dataTransfer, { type: "stock", tableUrl });
    },
    [tableUrl],
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
