import type { DocHandle } from "@automerge/automerge-repo/slim";
import {
  isMarkPatch,
  isRunPatch,
  isTextPatch,
  readEntry,
  type AutomergeOp,
  type PatchDoc,
  type PatchEntry,
  type PutValue,
} from "./layers/index.js";

import type { PatchLink } from "./folder.js";

export type Path = (string | number)[];
export type Titled = PatchDoc & { title?: string };

/** One of this document's patches, as the panel lists it. */
export type Entry = {
  link: PatchLink;
  laid: boolean;
  handle: DocHandle<Titled>;
};

// Each patch gets a colour of its own, kept by its url so reordering the
// stack doesn't repaint it. Ink is what reads on top of it.
const COLOURS = [
  { fill: "#ff2284", ink: "#ffffff", wash: "#ff228430" },
  { fill: "#40dcba", ink: "#141414", wash: "#40dcba55" },
  { fill: "#2269ff", ink: "#ffffff", wash: "#2269ff30" },
  { fill: "#ffb020", ink: "#141414", wash: "#ffb02040" },
  { fill: "#8a3ffc", ink: "#ffffff", wash: "#8a3ffc30" },
];

export function colourOf(url: string) {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) | 0;
  return COLOURS[Math.abs(h) % COLOURS.length];
}

export function nameOf(entry: Entry): string {
  return entry.handle.doc()?.title || entry.link.name;
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !(v instanceof Date) &&
    !(v instanceof Uint8Array)
  );
}

export function preview(v: unknown, max = 48): string {
  if (Array.isArray(v)) return `[${v.length}]`;
  if (isObject(v)) return `{${Object.keys(v).length}}`;
  const s = typeof v === "string" ? JSON.stringify(v) : String(v);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** A value as one short line: strings bare, anything else as JSON. */
export function show(v: unknown): string {
  if (v === undefined) return "nothing";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

export function formatPath(path: readonly (string | number)[]): string {
  return path
    .map((k, i) => (typeof k === "number" ? `[${k}]` : i ? `.${k}` : k))
    .join("");
}

export function samePath(
  a: readonly (string | number)[],
  b: readonly (string | number)[]
): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

export function isPrefix(
  prefix: readonly (string | number)[],
  path: readonly (string | number)[]
): boolean {
  return prefix.length <= path.length && prefix.every((k, i) => k === path[i]);
}

// A copy that's safe to put in another document.
export function plain(v: unknown): unknown {
  if (v === undefined) return undefined;
  if (v instanceof Date) return new Date(v.getTime());
  if (v instanceof Uint8Array) return new Uint8Array(v);
  return JSON.parse(JSON.stringify(v));
}

/**
 * A patch's entries as Automerge patches, against the document as it is now:
 * the form the ops editor shows. Text runs come last, last run first, so the
 * positions in each still hold when they're read back in order.
 */
export function toOps<T>(
  target: DocHandle<T>,
  patch: PatchDoc
): AutomergeOp[] {
  const values: AutomergeOp[] = [];
  const marks: AutomergeOp[] = [];
  const texts: { start: number; ops: AutomergeOp[] }[] = [];
  // Marks on this patch's own added text go after its text ops, where that
  // text then is.
  const within: PatchEntry[] = [];
  const runs: { id?: string; path: (string | number)[]; start: number; end: number; length: number }[] = [];
  for (const entry of patch.patches) {
    const path = [...entry.path];
    if (isTextPatch(entry)) {
      const r = readEntry(target, patch, entry).range;
      if (!r) continue;
      const ops: AutomergeOp[] = [];
      if (r.end > r.start) {
        ops.push({ action: "del", path: [...path, r.start], length: r.end - r.start });
      }
      if (entry.text.insert) {
        ops.push({ action: "splice", path: [...path, r.start], value: entry.text.insert });
      }
      texts.push({ start: r.start, ops });
      runs.push({
        id: entry.text.id,
        path,
        start: r.start,
        end: r.end,
        length: entry.text.insert.length,
      });
    } else if (isMarkPatch(entry) && entry.mark.within !== undefined) {
      within.push(entry);
    } else if (isMarkPatch(entry)) {
      const r = readEntry(target, patch, entry).range;
      if (!r) continue;
      const { name, value } = entry.mark;
      marks.push(
        value === null
          ? { action: "unmark", path, name, start: r.start, end: r.end }
          : { action: "mark", path, marks: [{ name, value, start: r.start, end: r.end }] }
      );
    } else if (isRunPatch(entry)) {
      const start = path[path.length - 1];
      if (typeof start !== "number") continue;
      entry.values.forEach((value, i) =>
        values.push({
          action: "put",
          path: [...path.slice(0, -1), start + i],
          value: value as PutValue,
        })
      );
    } else if ("value" in entry) {
      values.push({ action: "put", path, value: entry.value as PutValue });
    } else {
      values.push({ action: "del", path });
    }
  }
  texts.sort((a, b) => b.start - a.start);
  const after: AutomergeOp[] = [];
  for (const e of within) {
    if (!isMarkPatch(e)) continue;
    const run = runs.find((r) => r.id === e.mark.within);
    if (!run) continue;
    // Where the run's text starts once every run before it has landed.
    let at = run.start;
    for (const r of runs) {
      if (r !== run && samePath(r.path, run.path) && r.start < run.start) {
        at += r.length - (r.end - r.start);
      }
    }
    const { name, value, start = 0, end = 0 } = e.mark;
    after.push(
      value === null
        ? { action: "unmark", path: [...e.path], name, start: at + start, end: at + end }
        : { action: "mark", path: [...e.path], marks: [{ name, value, start: at + start, end: at + end }] }
    );
  }
  return [...values, ...marks, ...texts.flatMap((t) => t.ops), ...after];
}

/** One op per line, so a list of them reads (and edits) like a list. */
export function formatOps(ops: readonly AutomergeOp[]): string {
  if (ops.length === 0) return "[\n]";
  return `[\n${ops.map((op) => `  ${JSON.stringify(op)}`).join(",\n")}\n]`;
}

export type Kind = "put" | "run" | "remove" | "text" | "insert" | "mark" | "unmark";

export function kindOf(entry: PatchEntry): Kind {
  if (isRunPatch(entry)) return "run";
  if (isTextPatch(entry)) return entry.text.to ? "text" : "insert";
  if (isMarkPatch(entry)) return entry.mark.value === null ? "unmark" : "mark";
  return "value" in entry ? "put" : "remove";
}

export const KIND_LABEL: Record<Kind, string> = {
  put: "put",
  run: "put",
  remove: "hide",
  text: "replace",
  insert: "insert",
  mark: "mark",
  unmark: "unmark",
};

/**
 * Whether an entry decides what's at `path` (or above it). A run decides each
 * item it puts, not just the one its path names.
 */
export function decides(entry: PatchEntry, path: readonly (string | number)[]): boolean {
  if (!isRunPatch(entry)) return isPrefix(entry.path, path);
  const start = entry.path[entry.path.length - 1];
  const parent = entry.path.slice(0, -1);
  if (typeof start !== "number" || path.length <= parent.length) return false;
  if (!isPrefix(parent, path)) return false;
  const k = path[parent.length];
  return typeof k === "number" && k >= start && k < start + entry.values.length;
}

/** What a put or a run puts: the value, or the run's values. */
export function putOf(entry: PatchEntry): unknown {
  return isRunPatch(entry) ? entry.values : (entry as { value?: unknown }).value;
}
