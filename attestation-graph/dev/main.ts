// Dev harness: runs the tool outside Patchwork against an in-memory stand-in
// for a DocHandle. `?doc=zktls` / `?doc=empty` pick the starting document;
// `?dark` flips the theme variables to check the colours invert.
// `?compare=side-by-side` (or inline, stacked, onion-skin, swipe) compares
// two Automerge forks of the graph, each with a few edits of its own, as the
// GAIOS dock would (with `&merging`, the edits against the original);
// add `&collapsed` to fade what's unchanged, `&mix=0.3` for the onion skin,
// `&merging` to look the edits over as a merge.
import p1 from "../examples/p1-graph.drawio?raw";
import zktls from "../examples/zktls-graph.drawio?raw";
import { AttestationGraphDatatype } from "../src/datatype";
import { parseDrawio } from "../src/drawio";
import type { GraphDoc } from "../src/model";
import { addBlock, deleteCells, moveCells, setValue } from "../src/ops";
import { kindOf } from "../src/model";
import { accept } from "@inkandswitch/patchwork-providers";
import Tool from "../src/tool";

function assertNoUndefined(value: unknown, path = "doc") {
  if (value === undefined) throw new Error(`automerge would reject undefined at ${path}`);
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertNoUndefined(v, `${path}.${k}`);
  }
}

function fakeHandle(url: string, initial: GraphDoc) {
  let doc = initial;
  const listeners = new Set<() => void>();
  return {
    url,
    doc: () => doc,
    change(fn: (d: GraphDoc) => void) {
      const draft = structuredClone(doc);
      fn(draft);
      assertNoUndefined(draft);
      doc = draft;
      listeners.forEach((l) => l());
    },
    on: (_: "change", l: () => void) => void listeners.add(l),
    off: (_: "change", l: () => void) => void listeners.delete(l),
  };
}

const params = new URLSearchParams(location.search);
if (params.has("dark")) {
  const s = document.documentElement.style;
  s.setProperty("--editor-fill", "#1c1d21");
  s.setProperty("--editor-line", "#e8e6e1");
}

const which = params.get("doc") ?? "p1";
const doc = {} as GraphDoc;
AttestationGraphDatatype.init(doc);
if (which !== "empty") {
  doc.diagrams = await parseDrawio(which === "zktls" ? zktls : p1);
  doc.title = which === "zktls" ? "zktls-graph" : "p1-graph";
}

// "Existing graph…" lookups: any automerge URL resolves to the zkTLS example,
// except one ending in "file", which resolves to a raw .drawio file document.
(window as any).repo = {
  async find(url: string) {
    if (url.endsWith("file")) return { doc: () => ({ name: "p1-graph.drawio", content: p1 }) };
    return { doc: () => ({ title: "zktls-graph", diagrams: structuredClone(zktlsDiagrams) }) };
  },
};
const zktlsDiagrams = await parseDrawio(zktls);

const comparing = params.get("compare");
const app = document.getElementById("app")!;
const handle = comparing ? await forkedHandle(app, comparing, doc) : fakeHandle("automerge:dev-" + which, doc);
(window as any).handle = handle;
Tool(handle as any, app);

/**
 * Comparing: this draft and the one compared with are forks of `doc`, each
 * with its own edits (merging: the other is `doc` as it was), and this
 * draft's handle is over the Automerge document, so the tool finds their
 * common ancestor as in Patchwork.
 */
async function forkedHandle(element: HTMLElement, mode: string, d: GraphDoc) {
  const A = await import("@automerge/automerge");
  const base = A.from<GraphDoc>(structuredClone(d));
  const theirs = params.has("merging") ? A.clone(base) : A.change(A.clone(base), (x: GraphDoc) => editTheirs(x));
  let ours = A.change(A.clone(base), (x: GraphDoc) => editForCompare(x));
  const listeners = new Set<() => void>();
  await answerCompare(element, mode, A.save(theirs));
  return {
    url: "automerge:dev-" + which,
    doc: () => ours,
    change(fn: (d: GraphDoc) => void) {
      ours = A.change(ours, fn);
      listeners.forEach((l) => l());
    },
    on: (_: "change", l: () => void) => void listeners.add(l),
    off: (_: "change", l: () => void) => void listeners.delete(l),
  };
}

/** The other draft's own edits: a block relabelled, one deleted, one added. */
function editTheirs(d: GraphDoc) {
  const page = d.diagrams[0];
  if (!page) return;
  const blocks = page.cells.filter((c) => c.vertex && (kindOf(c) === "trusted" || kindOf(c) === "untrusted"));
  const [changed, deleted] = [blocks[2], blocks[blocks.length - 2]];
  if (changed) setValue(page, changed.id, `${changed.value} (theirs)`);
  if (deleted && deleted !== changed) deleteCells(page, [deleted.id]);
  const ys = page.cells.filter((c) => c.vertex).map((c) => (c.y ?? 0) + (c.height ?? 0));
  addBlock(page, "untrusted", { x: 80, y: Math.max(0, ...ys) + 120 });
}

/** A handful of edits on the first page: one each of added, changed, moved, deleted. */
function editForCompare(d: GraphDoc) {
  const page = d.diagrams[0];
  if (!page) return;
  const blocks = page.cells.filter((c) => c.vertex && (kindOf(c) === "trusted" || kindOf(c) === "untrusted"));
  const [changed, moved, deleted] = [blocks[0], blocks[1], blocks[blocks.length - 1]];
  if (changed) setValue(page, changed.id, `${changed.value.replace("the correct", "an agreed")} (revised)`);
  if (moved) moveCells(page, [moved.id], 60, 40);
  if (deleted && deleted !== changed && deleted !== moved) deleteCells(page, [deleted.id]);
  const xs = page.cells.filter((c) => c.vertex).map((c) => (c.x ?? 0) + (c.width ?? 0));
  addBlock(page, "trusted", { x: Math.max(0, ...xs) + 140, y: 80 });
}

/** Answers `compare:view` the way the GAIOS dock does while comparing drafts. */
async function answerCompare(element: HTMLElement, mode: string, bytes: Uint8Array) {
  element.addEventListener("patchwork:subscribe", (event) => {
    if (event.detail.selector.type !== "compare:view") return;
    accept<unknown>(event, (respond) =>
      respond({
        mode,
        options: mode === "onion-skin" ? { mix: Number(params.get("mix") ?? 0.5) } : mode === "swipe" ? { at: 0.5 } : null,
        other: bytes,
        missing: false,
        collapsed: params.has("collapsed"),
        names: { ours: "Blue draft", theirs: "Purple draft" },
        merging: params.has("merging"),
      }),
    );
  });
}
