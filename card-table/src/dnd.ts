export const CARD_TABLE_MIME = "application/x-patchwork-card-table";

import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ZoneRef } from "./types";

export type CardDragPayload =
  | {
      type: "stock";
      tableUrl: AutomergeUrl;
      /** Empty zone minted at dragstart; dealt into if the drag lands on canvas. */
      speculativeId?: string;
    }
  | {
      type: "card";
      from: ZoneRef;
      offset: number;
      index: number;
      /** Empty zone minted at dragstart; embedded if the card lands on canvas. */
      speculativeId?: string;
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

export function sameZone(a: ZoneRef, b: ZoneRef): boolean {
  return a.id === b.id;
}
