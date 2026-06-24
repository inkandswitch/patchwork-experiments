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
