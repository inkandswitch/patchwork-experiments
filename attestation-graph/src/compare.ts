// The version of the graph to compare with, and how, as the panel showing it
// says over `compare:view` (the GAIOS dock does while the checked-out draft
// is compared with another). The tool draws every mode it takes itself, so
// both versions share one viewport: panning or zooming one moves the other.
//
// Neither draft is taken for the older one: drafts are Automerge clones, so
// each is diffed against what both still share, their common ancestor (the
// merge base), and shows what it did since. See `commonAncestor`.

import type * as AutomergeModule from "@automerge/automerge";
import { subscribe } from "@inkandswitch/patchwork-providers";
import { createSignal, onCleanup, type Accessor } from "solid-js";
import type { GraphDoc } from "./model";

// The compare view the panel answers with, as this reads it.
type CompareView = {
  mode: string | null;
  options: unknown;
  other: Uint8Array | null;
  missing: boolean;
  collapsed?: boolean;
  /** the two drafts' names: the one checked out, and the one compared with */
  names?: { ours: string; theirs: string } | null;
  /** a merge is looked over: this is the target after it, `other` before */
  merging?: boolean;
};

/**
 * - inline: one graph, what each draft did since their common ancestor
 *   marked in its draft's colour, what isn't in this one drawn faintly
 * - side-by-side, stacked: both versions next to each other, each marking
 *   what it did since the common ancestor
 * - onion-skin: the other version over this one, as faint as the panel's mix
 * - swipe: the other version over this one, to the right of a divider
 */
export const DRAWN_MODES = ["inline", "side-by-side", "stacked", "onion-skin", "swipe"] as const;
export type DrawnMode = (typeof DRAWN_MODES)[number];

export type Compare = {
  mode: DrawnMode;
  /** the other version; empty when the other draft doesn't have the graph */
  other: GraphDoc;
  /**
   * What both versions grew from: their common ancestor in the shared
   * Automerge history. A merge's target before it, when looking over a
   * merge. Empty when the other draft doesn't have the graph (so all of this
   * one is added) or the two share no history. The other version itself when
   * there's no history to read (this one isn't an Automerge document).
   */
  base: GraphDoc;
  missing: boolean;
  /** fade what didn't change */
  collapsed: boolean;
  /** onion skin: how much of the other version shows, 0 to 1 */
  mix: number;
  /** swipe: where the divider starts, across the width, 0 to 1 */
  at: number;
  /** what to call this version and the other, as the panel names the drafts; empty when it doesn't */
  ours: string;
  theirs: string;
  /** a merge is looked over: this version is after it, the other before */
  merging: boolean;
};

const EMPTY: GraphDoc = { title: "", diagrams: [] };

/** The slice of the tool's DocHandle this reads: the draft checked out. */
export type Ours = {
  doc(): unknown;
  on(event: "change", fn: () => void): void;
  off(event: "change", fn: () => void): void;
};

type Automerge = typeof AutomergeModule;
type Heads = string[];

/**
 * Where two drafts' histories part: the heads of the changes both have, and
 * the earliest changes only the other one has (its side of the fork), which
 * is all that has to be watched to know the ancestor hasn't moved.
 */
export type Ancestor = { heads: Heads; theirsOnlyRoots: Heads };

/**
 * The common ancestor of two forks of one Automerge document: the heads of
 * every change both have. One ahead of the other: the one behind's heads.
 * Diverged: merge them, take the changes only `theirs` has, and the
 * ancestor's heads are what those changes and theirs' heads stand on, less
 * the changes themselves. No shared history at all gives no heads (the empty
 * document). Pure; Automerge passed in, since the host provides it.
 */
export function commonAncestor(A: Automerge, ours: AutomergeModule.Doc<unknown>, theirs: AutomergeModule.Doc<unknown>): Ancestor {
  const oursHeads = A.getHeads(ours);
  const theirsHeads = A.getHeads(theirs);
  if (A.hasHeads(ours, theirsHeads)) return { heads: theirsHeads, theirsOnlyRoots: [] };
  const theirsOnly = A.hasHeads(theirs, oursHeads)
    ? A.getChangesSince(theirs, oursHeads)
    : A.getChangesSince(A.merge(A.clone(theirs), ours), oursHeads);
  const decoded = theirsOnly.map((c) => A.decodeChange(c));
  const only = new Set(decoded.map((c) => c.hash));
  const heads = new Set(theirsHeads);
  for (const c of decoded) for (const dep of c.deps) heads.add(dep);
  for (const hash of only) heads.delete(hash);
  return {
    heads: [...heads],
    theirsOnlyRoots: decoded.filter((c) => !c.deps.some((d) => only.has(d))).map((c) => c.hash),
  };
}

/**
 * Whether `ours` has moved on so the ancestor might have: it no longer has
 * all of it (another draft checked out), or it now has some of what only
 * the other one had (the drafts exchanged changes). Local edits don't move it.
 */
export function ancestorMoved(A: Automerge, ours: AutomergeModule.Doc<unknown>, ancestor: Ancestor): boolean {
  return !A.hasHeads(ours, ancestor.heads) || ancestor.theirsOnlyRoots.some((h) => A.hasHeads(ours, [h]));
}

/** The graph as it was at `heads` in `theirs`, as a plain object. */
export function graphAt(A: Automerge, theirs: AutomergeModule.Doc<unknown>, heads: Heads): GraphDoc {
  return asGraph(heads.length ? A.view(theirs, heads) : {});
}

/** Undefined unless the graph is being compared in a mode it draws. */
export function useCompare(element: HTMLElement, ours?: Ours): Accessor<Compare | undefined> {
  const [compare, setCompare] = createSignal<Compare | undefined>();
  let latest = 0;
  // the last version decoded, so a new mode or mix doesn't decode it again
  let decoded: { bytes: Uint8Array; doc: GraphDoc; am: AutomergeModule.Doc<unknown>; A: Automerge } | null = null;
  // the common ancestor last found, while it's still worth checking
  let found: { ancestor: Ancestor; am: AutomergeModule.Doc<unknown>; A: Automerge } | null = null;

  /** The ancestor of the draft checked out and `am`, or null if there's no history to read. */
  const ancestorOf = (A: Automerge, am: AutomergeModule.Doc<unknown>) => {
    try {
      const doc = ours?.doc();
      if (!doc) return null;
      const ancestor = commonAncestor(A, doc as AutomergeModule.Doc<unknown>, am);
      found = { ancestor, am, A };
      return graphAt(A, am, ancestor.heads);
    } catch (error) {
      // not an Automerge document (a stand-in), or not this Automerge's
      console.warn("[attestation-graph] couldn't find the drafts' common ancestor; comparing with the other draft as it is", error);
      return null;
    }
  };

  const unsubscribe = subscribe(
    element,
    {
      type: "compare:view",
      modes: Object.fromEntries(DRAWN_MODES.map((m) => [m, true])),
      draws: DRAWN_MODES.filter((m) => m !== "inline"),
      collapses: ["inline", "side-by-side", "stacked"],
      prefers: "side-by-side",
    },
    (value) => {
      const view = value as unknown as CompareView;
      const run = ++latest;
      found = null;
      const mode = DRAWN_MODES.find((m) => m === view.mode);
      if (!mode || (!view.missing && !view.other)) return setCompare(undefined);
      const options = (view.options ?? {}) as { mix?: unknown; at?: unknown };
      const told = (other: GraphDoc, base: GraphDoc) => {
        if (run !== latest) return;
        setCompare({
          mode,
          other,
          base,
          missing: view.missing,
          collapsed: !!view.collapsed && mode !== "onion-skin" && mode !== "swipe",
          mix: fraction(options.mix, 0.5),
          at: fraction(options.at, 0.5),
          ours: view.names?.ours ?? "",
          theirs: view.names?.theirs ?? "",
          merging: !!view.merging,
        });
      };
      // the other draft hasn't the graph: nothing's shared, all of this one is added
      if (view.missing) return told(EMPTY, EMPTY);
      const withBase = (d: NonNullable<typeof decoded>) =>
        told(d.doc, view.merging ? d.doc : (ancestorOf(d.A, d.am) ?? d.doc));
      const bytes = view.other!;
      if (decoded && sameBytes(decoded.bytes, bytes)) return withBase(decoded);
      decode(bytes).then(
        (d) => {
          decoded = { bytes, ...d };
          if (run === latest) withBase(decoded);
        },
        (error) => {
          console.warn("[attestation-graph] couldn't read the version compared with", error);
          if (run === latest) setCompare(undefined);
        },
      );
    },
  );
  onCleanup(unsubscribe);

  // this draft changing moves the ancestor only when the drafts exchange
  // changes (or another is checked out): check that cheaply, a beat later
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onOursChange = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const f = found;
      const c = compare();
      if (!f || !c) return;
      let moved: boolean;
      try {
        moved = ancestorMoved(f.A, ours!.doc() as AutomergeModule.Doc<unknown>, f.ancestor);
      } catch {
        moved = true;
      }
      if (!moved) return;
      const base = ancestorOf(f.A, f.am);
      if (base && compare() === c) setCompare({ ...c, base });
    }, 300);
  };
  if (ours) {
    ours.on("change", onOursChange);
    onCleanup(() => {
      clearTimeout(timer);
      ours.off("change", onOursChange);
    });
  }
  return compare;
}

// Automerge comes from the host's import map; loaded only once a compare starts.
async function decode(bytes: Uint8Array) {
  const A = (await import("@automerge/automerge")) as Automerge;
  const am = A.load<unknown>(bytes);
  return { A, am, doc: asGraph(am) };
}

// a plain copy: the views only read it, and it's cheaper to read plain
function asGraph(doc: unknown): GraphDoc {
  const g = JSON.parse(JSON.stringify(doc ?? {})) as Partial<GraphDoc>;
  return { ...g, title: g.title ?? "", diagrams: g.diagrams ?? [] } as GraphDoc;
}

function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function fraction(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}
