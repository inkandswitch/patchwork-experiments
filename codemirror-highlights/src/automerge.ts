import { getCursor, getCursorPosition, type Cursor, type Prop } from "@automerge/automerge";
import type { DocHandle } from "@automerge/automerge-repo";

export type CursorRange = {
  from: Cursor;
  to: Cursor;
};

export type ResolvedRange = {
  from: number;
  to: number;
};

export function createCursorRange(
  handle: DocHandle<any>,
  path: Prop[],
  from: number,
  to: number,
): CursorRange | null {
  const doc = handle.doc();
  if (!doc) return null;

  const start = Math.min(from, to);
  const end = Math.max(from, to);

  return {
    from: getCursor(doc, path, start, "before"),
    to: getCursor(doc, path, end, "after"),
  };
}

export function resolveHighlightRange(
  handle: DocHandle<any>,
  path: Prop[],
  from: Cursor,
  to: Cursor,
): ResolvedRange | null {
  const doc = handle.doc();
  if (!doc) return null;

  const start = getCursorPosition(doc, path, from);
  const end = getCursorPosition(doc, path, to);

  return normalizeRange(start, end);
}

function normalizeRange(from: number, to: number): ResolvedRange {
  return {
    from: Math.min(from, to),
    to: Math.max(from, to),
  };
}
