// Comparing with another version, as the GAIOS dock asks over
// `compare:view`. Both drafts are real Automerge forks of one document, so
// each is diffed against their common ancestor.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as A from "@automerge/automerge";
import { accept } from "@inkandswitch/patchwork-providers";
import { beforeAll, describe, expect, it } from "vitest";
import { ancestorMoved, commonAncestor, graphAt } from "../src/compare";
import { parseDrawio } from "../src/drawio";
import type { Diagram, GraphDoc } from "../src/model";
import { moveCells, setValue, deleteCells, addBlock } from "../src/ops";
import Tool from "../src/tool";

beforeAll(() => {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  const proto = HTMLElement.prototype as any;
  proto.setPointerCapture = () => {};
  proto.releasePointerCapture = () => {};
  proto.hasPointerCapture = () => false;
});

/** A DocHandle over an Automerge document. */
function amHandle(initial: A.Doc<GraphDoc>) {
  let doc = initial;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    url: "automerge:test" + Math.random(),
    doc: () => doc,
    change(fn: (d: GraphDoc) => void) {
      doc = A.change(doc, fn);
      emit();
    },
    /** take in another fork's changes */
    merge(other: A.Doc<GraphDoc>) {
      doc = A.merge(doc, other);
      emit();
    },
    on: (_: "change", l: () => void) => void listeners.add(l),
    off: (_: "change", l: () => void) => void listeners.delete(l),
  };
}

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const page = (d: GraphDoc, id = "top") => d.diagrams.find((x) => x.id === id)!;

async function topPage() {
  const xml = readFileSync(resolve(__dirname, "../examples/p1-graph.drawio"), "utf8");
  return (await parseDrawio(xml)).find((d) => d.id === "top")!;
}

/**
 * Two forks of the example's top page. This one changes one cell, moves one,
 * deletes one and adds a block. Unless `theirsSame`, the other changes
 * top_in3, deletes top_lg3 and adds a block of its own. `extraPage` gives
 * the other a page it added.
 */
async function mountCompared(
  mode: string | null,
  opts: {
    extraPage?: boolean;
    collapsed?: boolean;
    unnamed?: boolean;
    merging?: boolean;
    theirsSame?: boolean;
    /** the other draft changes top_in1 too */
    bothEdit?: boolean;
  } = {},
) {
  const base = A.from<GraphDoc>({ title: "t", diagrams: [await topPage()] });
  let theirs = A.clone(base);
  let theirsAdded = "";
  if (!opts.theirsSame)
    theirs = A.change(theirs, (d) => {
      setValue(page(d), "top_in3", "<b>Attestation</b><br>theirs revised");
      deleteCells(page(d), ["top_lg3"]);
      theirsAdded = addBlock(page(d), "untrusted", { x: 1600, y: 400 });
      if (opts.bothEdit) setValue(page(d), "top_in1", "<b>Attestation</b><br>theirs");
      if (opts.extraPage) d.diagrams.push({ id: "gone", name: "Gone page", model: {}, cells: [] } as Diagram);
    });
  if (opts.merging) theirs = A.clone(base);
  const handle = amHandle(A.clone(base));
  let added = "";
  handle.change((d) => {
    setValue(page(d), "top_in1", "<b>Attestation</b><br>revised");
    moveCells(page(d), ["top_in2"], 60, 40);
    deleteCells(page(d), ["top_lg1"]);
    added = addBlock(page(d), "trusted", { x: 1600, y: 100 });
  });

  const el = document.createElement("div");
  document.body.append(el);
  el.addEventListener("patchwork:subscribe", (event) => {
    if (event.detail.selector.type !== "compare:view") return;
    accept<unknown>(event, (respond) =>
      respond({
        mode,
        options: null,
        other: mode ? A.save(theirs) : null,
        missing: false,
        collapsed: !!opts.collapsed,
        names: mode && !opts.unnamed ? { ours: "Blue draft", theirs: "Purple draft" } : null,
        merging: !!opts.merging,
      }),
    );
  });
  const dispose = Tool(handle as any, el);
  await settle();
  const paneOf = (pane: "this" | "other") => (pane === "this" ? ".ag-canvas:not(.ag-other)" : ".ag-other");
  // a node drawn in a pane, not what's drawn faintly there
  const node = (id: string, pane: "this" | "other" = "this") =>
    el.querySelector<HTMLElement>(`${paneOf(pane)} > .ag-world > [data-node-id="${id}"]`);
  const ghost = (id: string, pane: "this" | "other" = "this") =>
    el.querySelector<HTMLElement>(`${paneOf(pane)} .ag-ghosts [data-node-id="${id}"]`);
  const versions = (pane: "this" | "other" = "this") =>
    [
      ...el.querySelectorAll<HTMLElement>(
        `${pane === "this" ? ".ag-canvas:not(.ag-other)" : ".ag-other"} > .ag-versions .ag-version`,
      ),
    ].map((v) => `${v.dataset.side ?? ""}:${v.textContent}`);
  return { el, handle, dispose, node, ghost, added, theirsAdded, versions, theirs };
}

describe("the drafts' common ancestor", () => {
  const graph = (title: string): GraphDoc => ({ title, diagrams: [] });
  const titled = (d: A.Doc<GraphDoc>, title: string) => A.change(d, (x) => void (x.title = title));

  it("diverged: what both have, not either one's own changes", () => {
    const base = titled(A.from(graph("base")), "base, edited");
    const ours = A.change(A.clone(base), (d) => void d.diagrams.push({ id: "o", name: "O", model: {}, cells: [] } as any));
    const theirs = titled(A.clone(base), "theirs");
    const ancestor = commonAncestor(A, ours, theirs);
    expect(new Set(ancestor.heads)).toEqual(new Set(A.getHeads(base)));
    expect(graphAt(A, theirs, ancestor.heads)).toEqual({ title: "base, edited", diagrams: [] });
    // only an exchange of changes moves it, not more local edits
    const more = titled(ours, "ours");
    expect(ancestorMoved(A, more, ancestor)).toBe(false);
    expect(ancestorMoved(A, A.merge(A.clone(more), theirs), ancestor)).toBe(true);
    expect(ancestorMoved(A, A.from(graph("someone else")), ancestor)).toBe(true);
  });

  it("one ahead: the one behind", () => {
    const base = A.from(graph("base"));
    const ahead = titled(A.clone(base), "ahead");
    expect(commonAncestor(A, ahead, base).heads).toEqual(A.getHeads(base));
    expect(commonAncestor(A, base, ahead).heads).toEqual(A.getHeads(base));
    expect(graphAt(A, ahead, commonAncestor(A, base, ahead).heads).title).toBe("base");
  });

  it("identical: itself; unrelated: nothing", () => {
    const base = A.from(graph("base"));
    expect(commonAncestor(A, A.clone(base), base)).toEqual({ heads: A.getHeads(base), theirsOnlyRoots: [] });
    const unrelated = commonAncestor(A, A.from(graph("a")), base);
    expect(unrelated.heads).toEqual([]);
    expect(graphAt(A, base, unrelated.heads)).toEqual({ title: "", diagrams: [] });
  });
});

describe("comparing with another version", () => {
  it("side by side: each draft marks what it did since the ancestor, and one viewport moves both", async () => {
    const t = await mountCompared("side-by-side");
    expect(t.el.querySelector(".ag-stage")!.getAttribute("data-layout")).toBe("side-by-side");
    // this draft's changes, in its pane
    expect(t.node("top_in1")!.dataset.diff).toBe("changed");
    expect(t.node("top_in2")!.dataset.diff).toBe("moved");
    expect(t.node(t.added)!.dataset.diff).toBe("added");
    expect(t.node("top_lg1")).toBeNull();
    expect(t.ghost("top_lg1")!.dataset.diff).toBe("deleted");
    expect(t.node("top_in3")!.dataset.diff).toBeUndefined();
    expect(t.node("top_lg3")!.dataset.diff).toBeUndefined();
    // the other's, in its: what this one deleted is just there, not added
    expect(t.node("top_lg1", "other")!.dataset.diff).toBeUndefined();
    expect(t.ghost("top_lg1", "other")).toBeNull();
    expect(t.node("top_in1", "other")!.dataset.diff).toBeUndefined();
    expect(t.node(t.added, "other")).toBeNull();
    expect(t.node("top_in3", "other")!.dataset.diff).toBe("changed");
    expect(t.node(t.theirsAdded, "other")!.dataset.diff).toBe("added");
    expect(t.ghost("top_lg3", "other")!.dataset.diff).toBe("deleted");
    expect(t.node("top_lg3", "other")).toBeNull();
    expect(t.el.querySelector("[data-by]")).toBeNull();
    expect(t.versions("this")).toEqual(["ours:Blue draft"]);
    expect(t.versions("other")).toEqual(["theirs:Purple draft"]);

    const worlds = () => [...t.el.querySelectorAll<HTMLElement>(".ag-stage > .ag-canvas > .ag-world")].map((w) => w.style.transform);
    const other = t.el.querySelector(".ag-other")!;
    other.dispatchEvent(new WheelEvent("wheel", { deltaX: 25, deltaY: 40, bubbles: true, cancelable: true }));
    const [a, b] = worlds();
    expect(a).toBe(b);
    expect(a).toMatch(/^translate\(15px, 0px\)/);
    other.dispatchEvent(new WheelEvent("wheel", { deltaY: -50, ctrlKey: true, bubbles: true, cancelable: true }));
    expect(worlds()[0]).toBe(worlds()[1]);
    expect(worlds()[0]).not.toMatch(/scale\(1\)/);
    t.dispose();
  });

  it("follows the ancestor when the drafts exchange changes", async () => {
    const t = await mountCompared("side-by-side");
    t.handle.merge(t.theirs);
    await settle(400);
    // the other's changes are now shared: nothing left to mark in its pane
    expect(t.node("top_in3", "other")!.dataset.diff).toBeUndefined();
    expect(t.ghost("top_lg3", "other")).toBeNull();
    expect(t.node("top_in1")!.dataset.diff).toBe("changed");
    t.dispose();
  });

  it("combined: each draft's changes in its colour, what isn't here drawn faintly", async () => {
    const t = await mountCompared("inline", { collapsed: true });
    expect(t.el.querySelector(".ag-other")).toBeNull();
    const mark = (e: HTMLElement | null) => e && `${e.dataset.diff}:${e.dataset.by}`;
    expect(mark(t.node("top_in1"))).toBe("changed:ours");
    expect(mark(t.node("top_in2"))).toBe("moved:ours");
    expect(mark(t.node(t.added))).toBe("added:ours");
    expect(mark(t.ghost("top_lg1"))).toBe("deleted:ours");
    expect(mark(t.node("top_in3"))).toBe("changed:theirs");
    // deleted by the other, still here: marked, in its colour
    expect(mark(t.node("top_lg3"))).toBe("deleted:theirs");
    expect(mark(t.ghost(t.theirsAdded))).toBe("added:theirs");
    // the label, word by word, against what it was
    const label = t.node("top_in1")!.querySelector(".ag-html")!;
    expect(label.querySelector('mark[data-side="ours"][data-op="added"]')!.textContent).toBe("revised");
    expect(label.querySelector('mark[data-side="theirs"]')).toBeNull();
    const theirs = t.node("top_in3")!.querySelector(".ag-html")!;
    expect(theirs.querySelector('mark[data-side="theirs"][data-op="added"]')!.textContent).toBe("theirs revised");
    expect(t.el.querySelector(".ag-canvas")!.hasAttribute("data-focus")).toBe(true);
    expect(t.el.querySelector(".ag-versions")).toBeNull();
    t.dispose();
  });

  it("combined: a cell both drafts changed is marked as both", async () => {
    const t = await mountCompared("inline", { bothEdit: true });
    expect(t.node("top_in1")!.dataset.by).toBe("both");
    const label = t.node("top_in1")!.querySelector(".ag-html")!;
    expect(label.querySelector('mark[data-side="ours"]')!.textContent).toBe("revised");
    expect(label.querySelector('mark[data-side="theirs"]')!.textContent).toBe("theirs");
    t.dispose();
  });

  it("onion skin and swipe lay the other version over this one, unmarked", async () => {
    const onion = await mountCompared("onion-skin");
    expect(onion.el.querySelector<HTMLElement>(".ag-overlay")!.style.opacity).toBe("0.5");
    expect(onion.el.querySelector(".ag-world [data-diff]")).toBeNull();
    expect(onion.el.querySelector(".ag-ghosts")).toBeNull();
    onion.dispose();
    const swipe = await mountCompared("swipe");
    expect(swipe.el.querySelector<HTMLElement>(".ag-overlay")!.style.clipPath).toBe("inset(0 0 0 50%)");
    expect(swipe.el.querySelector(".ag-swipe")).not.toBeNull();
    expect(swipe.versions()).toEqual(["ours:Blue draft", "theirs:Purple draft"]);
    expect(swipe.el.querySelector('.ag-versions[data-at="right"]')!.textContent).toBe("Purple draft");
    swipe.dispose();
  });

  it("shows a page only the other version has, and won't edit it", async () => {
    const t = await mountCompared("side-by-side", { extraPage: true });
    const tab = [...t.el.querySelectorAll<HTMLButtonElement>(".ag-page")].find((b) => b.textContent === "Gone page")!;
    // the other draft added it
    expect(tab.dataset.diff).toBe("added");
    expect(tab.hasAttribute("data-ghost")).toBe(true);
    const top = [...t.el.querySelectorAll<HTMLButtonElement>(".ag-page")].find((b) => b.textContent !== "Gone page")!;
    expect(top.dataset.diff).toBe("changed");
    tab.click();
    await settle();
    expect(t.el.querySelectorAll(".ag-canvas:not(.ag-other) .ag-node").length).toBe(0);
    const before = JSON.stringify(t.handle.doc());
    [...t.el.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent!.trim() === "Trusted")!.click();
    expect(JSON.stringify(t.handle.doc())).toBe(before);
    expect(t.el.querySelector(".ag-status")!.textContent).toMatch(/Only in Purple draft/);
    t.dispose();
  });

  it("combined: page tabs take the colour of the draft that changed them", async () => {
    const t = await mountCompared("inline", { extraPage: true });
    const tab = (name: string) => [...t.el.querySelectorAll<HTMLButtonElement>(".ag-page")].find((b) => b.textContent === name)!;
    expect(tab("Gone page").dataset.by).toBe("theirs");
    expect(tab("Gone page").dataset.diff).toBe("added");
    t.dispose();
  });

  it("looking over a merge side by side: before, then after, the after marking all it changes", async () => {
    const t = await mountCompared("side-by-side", { merging: true });
    const stage = t.el.querySelector(".ag-stage")!;
    expect(stage.hasAttribute("data-merging")).toBe(true);
    expect(t.versions("other")).toEqual([":Before"]);
    expect(t.versions("this")).toEqual([":After"]);
    expect(t.node(t.added)!.dataset.diff).toBe("added");
    expect(t.ghost("top_lg1")!.dataset.diff).toBe("deleted");
    expect(t.node("top_lg1", "other")!.dataset.diff).toBeUndefined();
    expect(t.el.querySelector(".ag-other [data-diff]")).toBeNull();
    t.dispose();
  });

  it("shows just the drafts' dots when the panel doesn't name them", async () => {
    const t = await mountCompared("side-by-side", { unnamed: true });
    expect(t.versions("this")).toEqual(["ours:"]);
    expect(t.versions("other")).toEqual(["theirs:"]);
    t.dispose();
  });

  it("marks nothing when nothing's compared", async () => {
    const t = await mountCompared(null);
    expect(t.el.querySelector("[data-diff]")).toBeNull();
    expect(t.el.querySelector(".ag-other, .ag-overlay, .ag-versions")).toBeNull();
    t.dispose();
  });
});
