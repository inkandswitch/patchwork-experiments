// Comments on a graph: pure helpers (no DOM, no framework).
//
// Threads live in the project's root document (the frame creates them, on
// `comments:create`, and lists them through the `patchwork:comments`
// provider); this doc only holds what they point at. A thread's `refs` are
// automerge sub-handle urls of this doc, one per cell commented on:
// `handle.sub("diagrams", {id: diagramId}, "cells", {id: cellId}).url`. The
// tool makes them with `handle.sub` when it has it; this builds and reads the
// same urls by hand, so the tool can tell which cells a ref points at
// without the repo, and so the tests and the dev harness work without one.

import { type Cell, type Kind, type GraphDoc, kindOf, plainText, styleGet } from "./model";

/** `patchwork:focus`: what the user has selected, and what the sidebar highlights. */
export type FocusDoc = {
  selection?: Record<string, true>;
  highlight?: Record<string, true>;
};

/** One cell a ref points at. */
export type CellRef = { documentId: string; diagramId: string; cellId: string };

// ------------------------------------------------------------ urls
// automerge-repo's path encoding: a key is URL-encoded, and escaped with a
// backslash when it starts with one of `\ @ { [`; a `{...}` match pattern is
// its JSON, URL-encoded. Heads, if any, follow a `#`.

const keySegment = (key: string) =>
  (/^[\\@{[]/.test(key) ? "%5C" : "") + encodeURIComponent(key);
const matchSegment = (id: string) => encodeURIComponent(JSON.stringify({ id }));

/** The bare document id of an automerge url (no path, no heads). */
export function documentIdOf(url: string): string {
  const m = /^automerge:([^/#]+)/.exec(url);
  return m ? m[1] : "";
}

function withPath(docUrl: string, segments: string[]): string {
  const [base, heads] = docUrl.split("#");
  return `${base}/${segments.join("/")}${heads ? `#${heads}` : ""}`;
}

/** The ref url of one cell, as `handle.sub("diagrams", {id}, "cells", {id}).url` makes it. */
export function cellRefUrl(docUrl: string, diagramId: string, cellId: string): string {
  return withPath(docUrl, ["diagrams", matchSegment(diagramId), "cells", matchSegment(cellId)]);
}

/** A thread's url, as `handle.sub("@comments", "threads", {id}).url` makes it. */
export function threadRefUrl(docUrl: string, threadId: string): string {
  return withPath(docUrl, [keySegment("@comments"), "threads", matchSegment(threadId)]);
}

function matchedId(segment: string): string | null {
  try {
    const parsed = JSON.parse(decodeURIComponent(segment));
    return parsed && typeof parsed === "object" && typeof parsed.id === "string"
      ? parsed.id
      : null;
  } catch {
    return null;
  }
}

/** The cell a ref url points at, or null when it isn't a graph cell ref. */
export function parseCellRef(url: string): CellRef | null {
  const m = /^automerge:([^/#]+)\/([^#]*)/.exec(url);
  if (!m) return null;
  const parts = m[2].split("/");
  if (parts.length !== 4 || parts[0] !== "diagrams" || parts[2] !== "cells") return null;
  const diagramId = matchedId(parts[1]);
  const cellId = matchedId(parts[3]);
  return diagramId && cellId ? { documentId: m[1], diagramId, cellId } : null;
}

/** The cells in the doc at `docUrl` that `refs` point at (other refs ignored). */
export function cellsTargeted(refs: Iterable<string>, docUrl: string): CellRef[] {
  const docId = documentIdOf(docUrl);
  const out: CellRef[] = [];
  const seen = new Set<string>();
  for (const url of refs) {
    const ref = parseCellRef(url);
    if (!ref || ref.documentId !== docId) continue;
    const key = `${ref.diagramId}\u0000${ref.cellId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

/** Ids of the cells on `diagramId` that `refs` point at. */
export function cellIdsOn(refs: Iterable<string>, docUrl: string, diagramId: string): Set<string> {
  return new Set(
    cellsTargeted(refs, docUrl)
      .filter((r) => r.diagramId === diagramId)
      .map((r) => r.cellId),
  );
}

/** A stable key for a set of urls, to tell whether it changed. */
export const urlsKey = (urls: Iterable<string>) => [...urls].sort().join("\n");

// ------------------------------------------------------------ threads

/** An unresolved thread's target and url, as the `patchwork:comments` provider lists them. */
export type CommentEntry = { targetUrl: string; threadUrl: string };

/** cell id → the urls of the distinct unresolved threads on it, for one page. */
export function threadsByCell(
  entries: Iterable<CommentEntry>,
  docUrl: string,
  diagramId: string,
): Map<string, Set<string>> {
  const docId = documentIdOf(docUrl);
  const threads = new Map<string, Set<string>>();
  for (const e of entries) {
    const ref = parseCellRef(e.targetUrl);
    if (!ref || ref.documentId !== docId || ref.diagramId !== diagramId) continue;
    let set = threads.get(ref.cellId);
    if (!set) threads.set(ref.cellId, (set = new Set()));
    set.add(e.threadUrl);
  }
  return threads;
}

/** What the provider lists `threadUrl` as pointing at (in this doc), deduplicated. */
export function refsOfThread(entries: Iterable<CommentEntry>, threadUrl: string): string[] {
  const refs = new Set<string>();
  for (const e of entries) if (e.threadUrl === threadUrl) refs.add(e.targetUrl);
  return [...refs];
}

// ------------------------------------------------------------ describing

/** The cell a ref points at in `doc`, if it still exists. */
export function findCell(doc: GraphDoc | undefined, ref: CellRef): Cell | undefined {
  const page = doc?.diagrams?.find((d) => d.id === ref.diagramId);
  return page?.cells?.find((c) => c.id === ref.cellId);
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

const KIND_NAMES: Record<Kind, string> = {
  trusted: "Trusted",
  untrusted: "Untrusted",
  and: "AND",
  or: "OR",
  output: "Output",
  note: "Note",
  text: "Label",
  box: "Box",
};

/** What to call a node: its text, or its kind when it has none. */
export function cellLabel(cell: Cell): string {
  return clip(plainText(cell.value || ""), 60) || KIND_NAMES[kindOf(cell)];
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * One line naming what a thread is on: `Node “Secure boot verified”`,
 * `Edge`, `3 nodes · A, B, C`; null when none of the cells exist any more.
 */
export function describeCells(cells: Cell[]): string | null {
  if (!cells.length) return null;
  const nodes = cells.filter((c) => !c.edge);
  const edges = cells.length - nodes.length;
  if (cells.length === 1) return nodes.length ? `Node “${cellLabel(nodes[0])}”` : "Edge";
  if (!nodes.length) return plural(edges, "edge");
  const shown = nodes.slice(0, 3).map((c) => clip(cellLabel(c), 24));
  const more = nodes.length > shown.length ? ", …" : "";
  const count = plural(nodes.length, "node") + (edges ? `, ${plural(edges, "edge")}` : "");
  return `${count} · ${shown.join(", ")}${more}`;
}

/** How a cell looks in a thumbnail: its shape and draw.io colours. */
export function cellSwatch(cell: Cell): { shape: "rect" | "rhombus" | "edge"; fill: string; stroke: string } {
  if (cell.edge) return { shape: "edge", fill: "none", stroke: styleGet(cell.style || "", "strokeColor") || "#333333" };
  const kind = kindOf(cell);
  const fill = styleGet(cell.style || "", "fillColor");
  const stroke = styleGet(cell.style || "", "strokeColor");
  return {
    shape: kind === "or" ? "rhombus" : "rect",
    fill: !fill || fill === "none" ? "#ffffff" : fill,
    stroke: !stroke || stroke === "none" ? "#000000" : stroke,
  };
}
