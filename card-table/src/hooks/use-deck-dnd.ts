import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import { useCallback } from "react";
import { dealCards } from "../ops/zones";
import { deckCardCount } from "../ops/deck";
import type { CardTableDoc, SecureDeckZone } from "../types";

export function useDeckDropTarget(
  handle: DocHandle<CardTableDoc>,
  table: CardTableDoc,
  target: { handId?: string; pileId?: string },
) {
  const active = table.phase === "ready" && deckCardCount(table) > 0;

  const onDropStock = useCallback(() => {
    handle.change((draft) => dealCards(draft, target, 1));
  }, [handle, target.handId, target.pileId]);

  return { active, onDropStock };
}

export function useDeckDrag(table: CardTableDoc, deck: SecureDeckZone) {
  const canDrag = table.phase === "ready" && deck.cards.length > 0;
  return {
    canDrag,
    count: deck.cards.length,
    deckSize: table.deckSize,
  };
}

export function deckLabel(deck: SecureDeckZone, table: CardTableDoc): string {
  return `${deck.title} · ${deck.cards.length}/${table.deckSize}`;
}

/** @deprecated use useDeckDropTarget */
export const useStockDropTarget = useDeckDropTarget;

/** @deprecated use useDeckDrag */
export function useStockDrag(table: CardTableDoc) {
  const count = deckCardCount(table);
  return {
    canDrag: table.phase === "ready" && count > 0,
    count,
    deckSize: table.deckSize,
  };
}

/** @deprecated use deckLabel */
export function stockLabel(table: CardTableDoc): string {
  return `Deck · ${deckCardCount(table)}/${table.deckSize}`;
}
