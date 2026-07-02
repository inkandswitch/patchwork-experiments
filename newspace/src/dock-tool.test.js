// The dock/tiling layout: pure pane-tree operations (split/close/resize) + the
// DOM tool against a real repo. The pane tree is a FLAT ARRAY (parent refs,
// sibling order = array order), so every mutation is splices — see dock-tool.js.
import { describe, it, expect, afterEach } from "vitest";
import { makeRepo, makeSurface, flush } from "./test-harness.js";
import {
  DockTool,
  defaultPanes,
  findPane,
  rootPane,
  childrenOf,
  splitPane,
  closePane,
  resizeSizes,
} from "./dock-tool.js";

afterEach(() => { delete globalThis.repo; });

// ── pure pane-tree operations ─────────────────────────────────────────────────

describe("defaultPanes / lookups", () => {
  it("starts as a single empty root leaf", () => {
    const panes = defaultPanes();
    expect(panes.length).toBe(1);
    const root = rootPane(panes);
    expect(root.id).toBe("root");
    expect(root.dir).toBe("");
    expect(root.url).toBe("");
  });
  it("childrenOf respects array order (sibling order = array order)", () => {
    const panes = [
      { id: "r", parent: "", dir: "row", url: "", size: 1 },
      { id: "b", parent: "r", dir: "", url: "", size: 1 },
      { id: "a", parent: "r", dir: "", url: "", size: 1 },
    ];
    expect(childrenOf(panes, "r").map((p) => p.id)).toEqual(["b", "a"]);
  });
});

describe("splitPane", () => {
  const ids = () => { let n = 0; return () => `n${n++}`; };

  it("turns a leaf into a split carrying its doc into the first child", () => {
    const panes = defaultPanes();
    const root = rootPane(panes);
    root.url = "automerge:doc1";
    const nid = splitPane(panes, "root", "row", ids());
    expect(root.dir).toBe("row");
    expect(root.url).toBe(""); // the split holds no doc itself
    const kids = childrenOf(panes, "root");
    expect(kids.length).toBe(2);
    expect(kids[0].url).toBe("automerge:doc1"); // carried
    expect(kids[1].url).toBe(""); // the new empty leaf
    expect(kids[1].id).toBe(nid); // splitPane returns the NEW pane's id
  });

  it("inserts a SIBLING (not a nested split) when the parent already splits that way", () => {
    const panes = defaultPanes();
    splitPane(panes, "root", "row", ids());
    const [a] = childrenOf(panes, "root");
    const before = panes.length;
    const nid = splitPane(panes, a.id, "row", () => "sib");
    expect(nid).toBe("sib");
    expect(panes.length).toBe(before + 1); // one splice, no new level
    expect(childrenOf(panes, "root").map((p) => p.id)[1]).toBe("sib"); // right after `a`
    expect(findPane(panes, "sib").parent).toBe("root");
  });

  it("nests when splitting the OTHER way", () => {
    const panes = defaultPanes();
    const mk = ids(); // ONE counter — pane ids must stay unique across splits
    splitPane(panes, "root", "row", mk);
    const [a] = childrenOf(panes, "root");
    splitPane(panes, a.id, "column", mk);
    expect(findPane(panes, a.id).dir).toBe("column");
    expect(childrenOf(panes, a.id).length).toBe(2);
  });

  it("refuses to split a split (only leaves split) or a missing pane", () => {
    const panes = defaultPanes();
    splitPane(panes, "root", "row", ids());
    expect(splitPane(panes, "root", "column", ids())).toBe(null); // root is a split now
    expect(splitPane(panes, "nope", "row", ids())).toBe(null);
  });
});

describe("closePane", () => {
  const ids = () => { let n = 0; return () => `n${n++}`; };

  it("closing one of two siblings collapses the split back into the parent", () => {
    const panes = defaultPanes();
    rootPane(panes).url = "automerge:doc1";
    splitPane(panes, "root", "row", ids()); // root: [carried, empty]
    const [carried, fresh] = childrenOf(panes, "root");
    closePane(panes, fresh.id);
    expect(panes.length).toBe(1); // just the root again
    const root = rootPane(panes);
    expect(root.dir).toBe("");
    expect(root.url).toBe("automerge:doc1"); // the survivor was hoisted
    void carried;
  });

  it("hoisting a lone SPLIT child adopts its children (dir + grandchildren re-parented)", () => {
    const panes = defaultPanes();
    const mk = ids();
    splitPane(panes, "root", "row", mk); // root(row): [a, b]
    const [a, b] = childrenOf(panes, "root");
    splitPane(panes, a.id, "column", mk); // a(column): [a1, a2]
    closePane(panes, b.id); // root should BECOME the column split
    const root = rootPane(panes);
    expect(root.dir).toBe("column");
    expect(childrenOf(panes, "root").length).toBe(2);
    expect(panes.some((p) => p.id === a.id)).toBe(false); // the hoisted node is gone
  });

  it("closing a subtree removes every descendant", () => {
    const panes = defaultPanes();
    const mk = ids();
    splitPane(panes, "root", "row", mk); // [a, b]
    const [a, b] = childrenOf(panes, "root");
    splitPane(panes, a.id, "column", mk); // a: [a1, a2]
    closePane(panes, a.id);
    expect(panes.length).toBe(1); // a + its two kids gone, b hoisted into root
    void b;
  });

  it("closing the root empties it back to a bare leaf (the dock never dies)", () => {
    const panes = defaultPanes();
    rootPane(panes).url = "automerge:doc1";
    splitPane(panes, "root", "row", ids());
    closePane(panes, "root");
    expect(panes.length).toBe(1);
    expect(rootPane(panes).dir).toBe("");
    expect(rootPane(panes).url).toBe("");
  });
});

describe("resizeSizes (divider math)", () => {
  it("shifts weight between the pair, conserving the total", () => {
    const [a, b] = resizeSizes(1, 1, 0.25); // drag a quarter of the pair toward B
    expect(a).toBeCloseTo(1.5);
    expect(b).toBeCloseTo(0.5);
    expect(a + b).toBeCloseTo(2);
  });
  it("clamps so neither pane drops below 10% of the pair", () => {
    expect(resizeSizes(1, 1, 5)[1]).toBeCloseTo(0.2); // 10% of total 2
    expect(resizeSizes(1, 1, -5)[0]).toBeCloseTo(0.2);
  });
  it("treats missing sizes as weight 1", () => {
    const [a, b] = resizeSizes(undefined, undefined, 0);
    expect(a).toBeCloseTo(1);
    expect(b).toBeCloseTo(1);
  });
});

// ── the DOM tool ──────────────────────────────────────────────────────────────

// the tool's init awaits ensureLayoutDoc (create2/find) — poll until settled
async function until(fn, tries = 40) {
  for (let i = 0; i < tries; i++) { if (fn()) return; await flush(); }
}

function mount(folder, repo) {
  const element = document.createElement("div");
  element.repo = repo;
  const cleanup = DockTool(folder, element);
  return { element, cleanup };
}

describe("DockTool (the dock layout)", () => {
  it("creates its OWN complement (@layouts.dock) and seeds the pane tree", async () => {
    const repo = makeRepo();
    const { folder } = makeSurface(repo, { docs: [] });
    const { element, cleanup } = mount(folder, repo);
    await until(() => folder.doc()["@layouts"] && folder.doc()["@layouts"].dock);
    const dockUrl = folder.doc()["@layouts"].dock;
    expect(dockUrl).toBeTruthy();
    expect(dockUrl).not.toBe(folder.doc().newspace); // NOT the canvas complement
    const dock = await repo.find(dockUrl);
    expect(rootPane(dock.doc().panes)).toBeTruthy();
    await until(() => element.textContent.includes("empty"));
    cleanup();
  });

  it("an empty pane offers the folder's docs; placing one mounts a live patchwork-view", async () => {
    const repo = makeRepo();
    globalThis.repo = repo;
    const { folder } = makeSurface(repo, {
      docs: [
        { url: "automerge:a", name: "Alpha", type: "essay" },
        { url: "automerge:b", name: "Beta", type: "file" },
      ],
    });
    const { element, cleanup } = mount(folder, repo);
    await until(() => element.querySelectorAll("button").length > 0 && element.textContent.includes("Alpha"));
    // the picker lists the folder docs
    const pick = [...element.querySelectorAll("button")].find((b) => b.textContent === "Alpha");
    expect(pick).toBeTruthy();
    pick.click();
    await until(() => element.querySelector("patchwork-view"));
    const view = element.querySelector("patchwork-view");
    expect(view.getAttribute("doc-url")).toBe("automerge:a");
    // the pane header is a PORT for the placed doc
    expect(element.querySelector('[data-automerge-url="automerge:a"]')).toBeTruthy();
    cleanup();
  });

  it("keyed reconcile: an unrelated folder change does NOT remount the embedded view", async () => {
    const repo = makeRepo();
    const { folder } = makeSurface(repo, { docs: [{ url: "automerge:a", name: "Alpha", type: "essay" }] });
    const { element, cleanup } = mount(folder, repo);
    await until(() => [...element.querySelectorAll("button")].some((b) => b.textContent === "Alpha"));
    [...element.querySelectorAll("button")].find((b) => b.textContent === "Alpha").click();
    await until(() => element.querySelector("patchwork-view"));
    const view = element.querySelector("patchwork-view");
    folder.change((d) => { d.title = "renamed"; d.docs[0].name = "Alpha Prime"; });
    await flush(); await flush();
    expect(element.querySelector("patchwork-view")).toBe(view); // the SAME node
    expect(element.textContent).toContain("Alpha Prime"); // updated in place
    cleanup();
  });

  it("splitting a pane keeps the doc and opens a new empty pane; closing collapses back", async () => {
    const repo = makeRepo();
    const { folder } = makeSurface(repo, { docs: [{ url: "automerge:a", name: "Alpha", type: "essay" }] });
    const { element, cleanup } = mount(folder, repo);
    await until(() => [...element.querySelectorAll("button")].some((b) => b.textContent === "Alpha"));
    [...element.querySelectorAll("button")].find((b) => b.textContent === "Alpha").click();
    await until(() => element.querySelector("patchwork-view"));
    // split horizontally
    [...element.querySelectorAll("button")].find((b) => b.textContent === "⊞→").click();
    await until(() => element.textContent.includes("empty pane"));
    expect(element.querySelectorAll("patchwork-view").length).toBe(1); // doc carried, new pane empty
    // close the empty pane — back to one full-bleed doc pane
    const dockUrl = folder.doc()["@layouts"].dock;
    const dock = await repo.find(dockUrl);
    const empty = dock.doc().panes.find((p) => !p.dir && !p.url);
    dock.change((d) => closePane(d.panes, empty.id));
    await until(() => !element.textContent.includes("empty pane"));
    expect(element.querySelectorAll("patchwork-view").length).toBe(1);
    expect(dock.doc().panes.length).toBe(1);
    cleanup();
  });

  it("surfaces the CANVAS complement — what the dock isn't showing", async () => {
    const repo = makeRepo();
    const { folder } = makeSurface(repo, {
      docs: [{ url: "automerge:a", name: "Alpha", type: "essay" }],
      items: [
        { id: "i1", kind: "doc", url: "automerge:a", x: 10, y: 10, w: 100, h: 80 },
        { id: "s1", kind: "shape", type: "rectangle", x: 0, y: 0, w: 20, h: 20 },
      ],
    });
    const { element, cleanup } = mount(folder, repo);
    await until(() => element.textContent.includes("canvas layout"));
    expect(element.textContent).toMatch(/1 positioned doc/);
    expect(element.textContent).toMatch(/2 items/);
    cleanup();
  });

  it("the pane tree persists in the complement — a remount restores the tiling", async () => {
    const repo = makeRepo();
    const { folder } = makeSurface(repo, { docs: [{ url: "automerge:a", name: "Alpha", type: "essay" }] });
    const first = mount(folder, repo);
    await until(() => [...first.element.querySelectorAll("button")].some((b) => b.textContent === "Alpha"));
    [...first.element.querySelectorAll("button")].find((b) => b.textContent === "Alpha").click();
    await until(() => first.element.querySelector("patchwork-view"));
    [...first.element.querySelectorAll("button")].find((b) => b.textContent === "⊞↓").click();
    await until(() => first.element.textContent.includes("empty pane"));
    first.cleanup();
    // reopen: the split + the placed doc come back (the constant complement)
    const second = mount(folder, repo);
    await until(() => second.element.querySelector("patchwork-view"));
    expect(second.element.querySelector("patchwork-view").getAttribute("doc-url")).toBe("automerge:a");
    expect(second.element.textContent).toContain("empty pane");
    second.cleanup();
  });
});
