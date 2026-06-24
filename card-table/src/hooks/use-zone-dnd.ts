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
import type { CardTableDoc, SecureDeckZone, ZoneRef } from "../types";

/**
 * Drag/drop wiring shared by hands and piles: accept stock deals from the deck
 * and card moves from any other zone, and emit card drags from this zone.
 */
export function useZoneDnd(
  handle: DocHandle<CardTableDoc>,
  table: CardTableDoc,
  zone: ZoneRef,
  options?: { canDragOut?: boolean },
) {
  const ready = table.phase === "ready" && !!table.publishedDeck?.length;
  const canDragOut = options?.canDragOut ?? true;

  const accepts = useCallback(
    (payload: CardDragPayload): boolean => {
      if (!ready) return false;
      if (payload.type === "stock") {
        return zone.kind !== "deck" && deckCardCount(table) > 0;
      }
      return !sameZone(payload.from, zone);
    },
    [ready, table, zone.kind, zone.id],
  );

  const onDrop = useCallback(
    (payload: CardDragPayload) => {
      handle.change((draft) => {
        if (payload.type === "stock") {
          if (zone.kind === "deck") return;
          dealCards(
            draft,
            zone.kind === "hand" ? { handId: zone.id } : { pileId: zone.id },
            1,
          );
          return;
        }
        moveCardByRef(draft, payload.from, zone, payload.index);
      });
    },
    [handle, zone.kind, zone.id],
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
    [canDragOut, zone.kind, zone.id],
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

export function deckLabel(deck: SecureDeckZone, table: CardTableDoc): string {
  return `${deck.title} · ${deck.cards.length}/${table.deckSize}`;
}

export function canDragDeck(table: CardTableDoc, deck: SecureDeckZone): boolean {
  return table.phase === "ready" && deck.cards.length > 0;
}

/** Parse a drop event into a payload, for callers that wire their own handlers. */
export function payloadFromDrop(
  dataTransfer: DataTransfer,
): CardDragPayload | null {
  return readDragPayload(dataTransfer);
}
