export const CARD_TABLE_MIME = "application/x-patchwork-card-table";

import type { AutomergeUrl } from "@automerge/automerge-repo";

export type CardDragPayload =
  | { source: "stock"; tableUrl: AutomergeUrl }
  | {
      source: "hand";
      handId: string;
      cardIndex: number;
      offset: number;
    }
  | {
      source: "pile";
      pileId: string;
      cardIndex: number;
      offset: number;
    };

export function writeDragPayload(
  dataTransfer: DataTransfer,
  payload: CardDragPayload,
) {
  dataTransfer.setData(CARD_TABLE_MIME, JSON.stringify(payload));
  dataTransfer.effectAllowed = "move";
}

export function readDragPayload(
  dataTransfer: DataTransfer,
): CardDragPayload | null {
  const raw = dataTransfer.getData(CARD_TABLE_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CardDragPayload;
  } catch {
    return null;
  }
}
