// What differs between two versions of an attestation graph. Compared drafts
// are each diffed against their common ancestor (see compare.ts), so
// "current" is a draft and "other" what it grew from. Pure, like model.ts.
//
// Cells and pages are matched by id, so a cell edited in one draft and left
// alone in the other lines up with itself.

import type { Cell, GraphDoc } from "./model";

/**
 * How a cell or page differs from the other version: only in this one
 * (added), only in the other (deleted), with other content or wiring
 * (changed), or the same but somewhere else (moved).
 */
export type Change = "added" | "deleted" | "changed" | "moved";

/** Cell id → how it differs. Cells that are the same aren't in it. */
export type CellDiff = Map<string, Change>;

// What a cell says and how it's wired, as opposed to where it sits.
const CONTENT = ["value", "parent", "vertex", "edge", "source", "target"] as const;
const PLACE = ["x", "y", "width", "height", "relative"] as const;
// Style keys that only say where an edge leaves and enters its nodes: moving
// a node re-anchors its edges, which is moving them, not changing them.
const ANCHORS = /^(exit|entry)(X|Y|Dx|Dy|Perimeter)$/;

export function diffCells(current: Cell[], other: Cell[]): CellDiff {
  const diff: CellDiff = new Map();
  const before = new Map(other.map((c) => [c.id, c]));
  const now = new Set<string>();
  for (const cell of current) {
    now.add(cell.id);
    const old = before.get(cell.id);
    const change = old ? cellChange(old, cell) : "added";
    if (change) diff.set(cell.id, change);
  }
  for (const cell of other) if (!now.has(cell.id)) diff.set(cell.id, "deleted");
  return diff;
}

function cellChange(before: Cell, after: Cell): Change | null {
  const differs = (key: keyof Cell) => !same(before[key], after[key]);
  if (
    CONTENT.some(differs) ||
    !same(before.attrs ?? {}, after.attrs ?? {}) ||
    !same(styleWithout(before.style, ANCHORS), styleWithout(after.style, ANCHORS))
  )
    return "changed";
  if (
    PLACE.some(differs) ||
    !same(before.points ?? [], after.points ?? []) ||
    before.style !== after.style
  )
    return "moved";
  return null;
}

/** A draw.io style as key → value (flags map to ""), leaving out `skip`. */
function styleWithout(style: string | undefined, skip: RegExp): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const part of (style ?? "").split(";")) {
    if (!part) continue;
    const at = part.indexOf("=");
    const key = at < 0 ? part : part.slice(0, at);
    if (!skip.test(key)) entries[key] = at < 0 ? "" : part.slice(at + 1);
  }
  return entries;
}

/**
 * Page id → how the page differs: added or deleted as a whole, or changed
 * when its name or any of its cells did (moves included).
 */
export function diffPages(current: GraphDoc | undefined, other: GraphDoc | undefined): Map<string, Change> {
  const pages = new Map<string, Change>();
  const before = new Map((other?.diagrams ?? []).map((d) => [d.id, d]));
  const now = new Set<string>();
  for (const page of current?.diagrams ?? []) {
    now.add(page.id);
    const old = before.get(page.id);
    if (!old) pages.set(page.id, "added");
    else if (old.name !== page.name || diffCells(page.cells ?? [], old.cells ?? []).size)
      pages.set(page.id, "changed");
  }
  for (const page of other?.diagrams ?? []) if (!now.has(page.id)) pages.set(page.id, "deleted");
  return pages;
}

/** Which draft made a change since the common ancestor. */
export type By = "ours" | "theirs" | "both";

/** How a cell or page is marked: how it changed, and, combined, by which draft. */
export type Mark = { change: Change | "inside"; by?: By };

/**
 * One mark for what each draft did to a cell or page since the common
 * ancestor, as combined shows it. Only one did something: that, by it. Both
 * did: by both; the same change if they agree (or one's only "inside"),
 * else "changed" (one deleting what the other edited is a conflict, not a
 * deletion).
 */
export function attribute(
  ours: Change | "inside" | undefined,
  theirs: Change | "inside" | undefined,
): Mark | undefined {
  if (ours && theirs) {
    const change =
      ours === theirs ? ours : ours === "inside" ? theirs : theirs === "inside" ? ours : "changed";
    return { change, by: "both" };
  }
  if (ours) return { change: ours, by: "ours" };
  if (theirs) return { change: theirs, by: "theirs" };
  return undefined;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  if (typeof a !== "object" || typeof b !== "object") return false;
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}

// Automerge hands back keys in its own order: compare without it.
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sorted((value as Record<string, unknown>)[k])]),
    );
  return value;
}
