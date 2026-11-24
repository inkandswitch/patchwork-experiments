import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDrawio, serializeDrawio } from "../src/drawio";
import { type Diagram, ZOOM_OUTPUT_ID, buildGraph, chosenPath, computeView, evidenceBundles, kindOf, newDiagram, plainText, sinks, toggleChoice } from "../src/model";
import { addBlock, connect, deleteCells, insertGraph, moveCells, toggleTrust } from "../src/ops";

const load = (name: string) => parseDrawio(readFileSync(resolve(__dirname, "../examples", name), "utf8"));
const page = (ds: Diagram[], id: string) => ds.find((d) => d.id === id)!;

describe("draw.io round trip", () => {
  for (const file of ["p1-graph.drawio", "zktls-graph.drawio"]) {
    it(`preserves ${file}`, async () => {
      const first = await load(file);
      const second = await parseDrawio(serializeDrawio(first));
      expect(second).toEqual(first);
    });
  }

  it("reads the example pages and classifies blocks", async () => {
    const ds = await load("p1-graph.drawio");
    expect(ds.map((d) => d.name)).toContain("Combined graph");
    const cmb = page(ds, "cmb");
    const kinds = Object.fromEntries(cmb.cells.filter((c) => c.vertex).map((c) => [c.id, kindOf(c)]));
    expect(kinds.cmb_Wrf).toBe("untrusted");
    expect(kinds.cmb_Wh).toBe("trusted");
    expect(kinds.cmb_WF).toBe("and");
    expect(kinds.cmb_top).toBe("or");
    expect(kinds.cmb_E).toBe("output");
    expect(kinds.cmb_Wrf_l).toBe("text");
  });
});

describe("collapse and zoom", () => {
  it("collapsing the inputs of the top OR gives a top-level view", async () => {
    const cmb = page(await load("p1-graph.drawio"), "cmb");
    const g = buildGraph(cmb.cells);
    expect(g.preds.get("cmb_top")).toEqual(["cmb_gW", "cmb_gA", "cmb_Zo"]);
    const full = computeView(cmb.cells, { collapsed: [], zoom: [] });
    const view = computeView(cmb.cells, { collapsed: ["cmb_gW", "cmb_gA", "cmb_Zo"], zoom: [] });
    expect(view.nodes.length).toBeLessThan(full.nodes.length / 2);
    const ids = new Set(view.nodes.map((n) => n.id));
    // the three branches are single nodes; their insides are gone
    for (const id of ["cmb_gW", "cmb_gA", "cmb_Zo"]) expect(view.nodeById.get(id)!.collapsed).toBe(true);
    for (const id of ["cmb_Wrf", "cmb_WF", "cmb_Wo", "cmb_Wph", "cmb_A4", "cmb_ZcA"]) expect(ids.has(id)).toBe(false);
    // everything downstream is untouched
    for (const id of ["cmb_top", "cmb_gF", "cmb_Bm", "cmb_Dl", "cmb_E"]) expect(ids.has(id)).toBe(true);
    // derived trust: attestations inside → untrusted; assumptions only → holds
    expect(view.nodeById.get("cmb_gW")!.holds).toBe(false);
    expect(view.nodeById.get("cmb_gA")!.holds).toBe(true);
    expect(plainText(view.nodeById.get("cmb_gW")!.caption)).toBe("[in1–in9]");
    expect(view.nodeById.get("cmb_Zo")!.html).toContain("zkTLS path");
    expect(view.edges.filter((e) => e.target === "cmb_top").length).toBe(3);
    expect(view.edges.some((e) => e.target === "cmb_gW")).toBe(false);
  });

  it("zooming shows only that subgraph, with a synthetic output", async () => {
    const cmb = page(await load("p1-graph.drawio"), "cmb");
    const view = computeView(cmb.cells, { collapsed: ["cmb_Wo"], zoom: ["cmb_Wo"] });
    const ids = new Set(view.nodes.map((n) => n.id));
    expect(view.zoomRoot).toBe("cmb_Wo");
    expect(view.nodeById.get("cmb_Wo")!.collapsed).toBe(false); // zoom root is always open
    expect(ids.has("cmb_Wrf")).toBe(true);
    expect(ids.has("cmb_Wm")).toBe(true);
    expect(ids.has("cmb_gW")).toBe(false);
    expect(ids.has("cmb_Zrf")).toBe(false);
    expect(ids.has("cmb_n")).toBe(false); // page notes and legend are hidden
    expect(ids.has(ZOOM_OUTPUT_ID)).toBe(true);
    expect(view.crumbs[0].title).toContain("print witness path");
    // nested: collapse inside the zoom
    const nested = computeView(cmb.cells, { collapsed: ["cmb_WF"], zoom: ["cmb_Wo"] });
    expect(nested.nodeById.get("cmb_WF")!.collapsed).toBe(true);
    expect(nested.nodeById.has("cmb_Wrf")).toBe(false);
    expect(plainText(nested.nodeById.get("cmb_WF")!.caption)).toBe("[in1–in3]");
  });

  it("keeps inputs that are shared with a branch outside the collapsed node", async () => {
    const pW = page(await load("p1-graph.drawio"), "pW");
    const view = computeView(pW.cells, { collapsed: ["pW_gB"], zoom: [] });
    expect(view.nodeById.has("pW_in5")).toBe(false); // only feeds gB
    expect(view.nodeById.has("pW_in8")).toBe(true); // also feeds gA
  });
});

describe("chosen path", () => {
  const leaves = {
    gF: ["cmb_E", "cmb_gF", "cmb_top", "cmb_Bm", "cmb_Dl"],
    gW: ["cmb_gW", "cmb_Wo", "cmb_Wph"],
    WcA: ["cmb_WcA", "cmb_WF", "cmb_WL", "cmb_Wm", "cmb_Wrf", "cmb_Wh", "cmb_Whf", "cmb_Wrl", "cmb_Wlc"],
  };
  const setup = async () => {
    const cmb = page(await load("p1-graph.drawio"), "cmb");
    const g = buildGraph(cmb.cells);
    const nodes = (chosen: Record<string, string>) => [...chosenPath(g, chosen, sinks(g)).nodes].sort();
    return { cmb, g, nodes };
  };

  it("always holds the decided part, and stops at an undecided OR", async () => {
    const { cmb, g, nodes } = await setup();
    expect(sinks(g)).toEqual(["cmb_E"]);
    expect(nodes({})).toEqual([...leaves.gF].sort());
    const view = computeView(cmb.cells, { collapsed: [], zoom: [] });
    expect(view.nodes.filter((n) => n.onPath).map((n) => n.id).sort()).toEqual([...leaves.gF].sort());
    expect(view.pathEdges.size).toBe(4);
    expect(view.nodeById.get("cmb_gW")!.choosable).toBe(true);
    expect(view.nodeById.get("cmb_Wph")!.choosable).toBe(false);
  });

  it("extends through chosen OR inputs down to the leaves, one sibling at a time", async () => {
    const { g, nodes } = await setup();
    let chosen = toggleChoice(g, {}, "cmb_gW");
    expect(nodes(chosen)).toEqual([...leaves.gF, ...leaves.gW].sort());
    chosen = toggleChoice(g, chosen, "cmb_WcA");
    expect(nodes(chosen)).toEqual([...leaves.gF, ...leaves.gW, ...leaves.WcA].sort());
    // a sibling replaces the choice
    chosen = toggleChoice(g, chosen, "cmb_gA");
    expect(chosen.cmb_top).toBe("cmb_gA");
    expect(nodes(chosen)).toEqual([...leaves.gF, "cmb_gA", "cmb_A4", "cmb_A5"].sort());
    // choosing again clears it
    chosen = toggleChoice(g, chosen, "cmb_gA");
    expect(nodes(chosen)).toEqual([...leaves.gF].sort());
  });

  it("choosing inside an unchosen branch switches to that branch", async () => {
    const { g, nodes } = await setup();
    let chosen = toggleChoice(g, {}, "cmb_gA");
    chosen = toggleChoice(g, chosen, "cmb_ZcC");
    expect(chosen.cmb_top).toBe("cmb_Zo");
    expect(nodes(chosen)).toEqual(
      [...leaves.gF, "cmb_Zo", "cmb_ZcC", "cmb_ZL", "cmb_ZaF", "cmb_Zrl", "cmb_Zlc"].sort(),
    );
  });

  it("is walked from the zoomed node when zoomed", async () => {
    const { cmb } = await setup();
    const view = computeView(cmb.cells, { collapsed: [], zoom: ["cmb_Wo"], chosen: { cmb_Wo: "cmb_WcB" } });
    expect(view.nodes.filter((n) => n.onPath).map((n) => n.id).sort()).toEqual(
      [ZOOM_OUTPUT_ID, "cmb_Wo", "cmb_WcB", "cmb_WF", "cmb_WaL", "cmb_Wrf", "cmb_Wh", "cmb_Whf"].sort(),
    );
  });
});

describe("evidence bundles", () => {
  const digits = (bits: boolean[]) => bits.map((b) => (b ? "1" : "0")).join("");

  it("lists the valid paths drawn by hand on the example's own page", async () => {
    const ds = await load("p1-graph.drawio");
    const table = evidenceBundles(buildGraph(page(ds, "cmb").cells));
    expect(table.inputs.map((i) => plainText(i.label))).toEqual(Array.from({ length: 13 }, (_, i) => `in${i + 1}`));
    expect(table.inputs[1].leaves).toEqual(["cmb_Wh", "cmb_Zh"]);
    expect(table.truncated).toBe(false);
    const drawn = page(ds, "vp")
      .cells.filter((c) => /^vp_r\db$/.test(c.id))
      .map((c) => plainText(c.value).replace(/\s/g, ""));
    expect(drawn.length).toBe(7);
    expect(table.bundles.map((b) => digits(b.bits)).sort()).toEqual([...drawn].sort());
    const matched = table.bundles.find((b) => b.choices.cmb_Wo === "cmb_WcA")!;
    expect(Object.keys(matched.choices)).toEqual(["cmb_top", "cmb_Wo"]);
    expect(matched.title).toContain(" · ");
  });

  it("drops combinations that disagree at a shared OR, and honours the limit", () => {
    const dg = newDiagram("t");
    const at = { x: 0, y: 0 };
    const a = addBlock(dg, "trusted", at);
    const b = addBlock(dg, "trusted", at);
    const or = addBlock(dg, "or", at);
    const and = addBlock(dg, "and", at);
    const and2 = addBlock(dg, "and", at);
    const out = addBlock(dg, "output", at);
    connect(dg, a, or);
    connect(dg, b, or);
    connect(dg, or, and);
    connect(dg, or, and2);
    connect(dg, and, out);
    connect(dg, and2, out);
    const table = evidenceBundles(buildGraph(dg.cells));
    expect(table.bundles.map((x) => digits(x.bits))).toEqual(["10", "01"]);
    const limited = evidenceBundles(buildGraph(dg.cells), 1);
    expect(limited.bundles.length).toBe(1);
    expect(limited.truncated).toBe(true);
  });
});

describe("editing", () => {
  it("adds, connects, toggles, moves and deletes blocks", () => {
    const dg = newDiagram("t");
    const a = addBlock(dg, "trusted", { x: 100, y: 100 });
    const b = addBlock(dg, "untrusted", { x: 400, y: 100 });
    const gate = addBlock(dg, "and", { x: 250, y: 300 });
    expect(plainText(dg.cells.find((c) => c.id === b + "_l")!.value)).toBe("in2");
    expect(connect(dg, a, gate)).not.toBeNull();
    expect(connect(dg, b, gate)).not.toBeNull();
    expect(connect(dg, a, gate)).toBeNull(); // duplicate
    expect(connect(dg, gate, a)).toBeNull(); // cycle
    const edges = dg.cells.filter((c) => c.edge);
    expect(edges.map((e) => /entryX=([\d.]+)/.exec(e.style)![1])).toEqual(["0.3333", "0.6667"]);

    toggleTrust(dg, a);
    expect(kindOf(dg.cells.find((c) => c.id === a)!)).toBe("untrusted");
    toggleTrust(dg, a);
    expect(kindOf(dg.cells.find((c) => c.id === a)!)).toBe("trusted");

    const before = dg.cells.find((c) => c.id === a)!.x!;
    moveCells(dg, [a, a + "_l"], 50, 0);
    expect(dg.cells.find((c) => c.id === a)!.x).toBe(before + 50);

    const c = addBlock(dg, "trusted", { x: 0, y: 0 }, gate);
    expect(dg.cells.filter((x) => x.edge && x.target === gate).length).toBe(3);
    deleteCells(dg, [c, c + "_l"]);
    expect(dg.cells.filter((x) => x.edge).length).toBe(2);
    expect(dg.cells.some((x) => x.id === c + "_l")).toBe(false);
  });

  it("inserts another graph in place of an input block", async () => {
    const ds = await load("p1-graph.drawio");
    const top = structuredClone(page(ds, "top"));
    const zoom = page(ds, "pW");
    const res = insertGraph(top, zoom, { x: 0, y: 0 }, "top_in1");
    expect(res.ids.length).toBeGreaterThan(10);
    expect(top.cells.some((c) => c.id === "top_in1")).toBe(false);
    expect(top.cells.some((c) => c.id === "top_in1_l")).toBe(false);
    const feeder = top.cells.find((c) => c.edge && c.target === "top_gW" && c.source !== "top_in2")!;
    expect(feeder.source!.endsWith("_pW_o")).toBe(true);
    // the dropped output's text survives as the subgraph title
    const view = computeView(top.cells, { collapsed: [feeder.source!], zoom: [] });
    expect(view.nodeById.get(feeder.source!)!.html).toContain("via print witness");
    // legend, notes and the output box were not copied
    expect(top.cells.some((c) => c.id.endsWith("_pW_E") || c.id.endsWith("_pW_lg0") || c.id.endsWith("_pW_n"))).toBe(false);
  });

  it("inserts another graph as a new input of a gate", async () => {
    const ds = await load("p1-graph.drawio");
    const top = structuredClone(page(ds, "top"));
    insertGraph(top, page(ds, "z9"), { x: 0, y: 0 }, "top_o");
    expect(top.cells.filter((c) => c.edge && c.target === "top_o").length).toBe(4);
    const free = structuredClone(page(ds, "top"));
    const n = free.cells.length;
    insertGraph(free, page(ds, "z9"), { x: 0, y: 0 });
    expect(free.cells.some((c) => c.id.endsWith("_z9_E"))).toBe(true);
    expect(free.cells.length).toBeGreaterThan(n);
  });
});
