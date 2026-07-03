import { describe, it, expect, afterEach } from "vitest";
import { parseTemplate, fillTemplate, templateInlets, parseSlotType } from "./template-doc.js";

describe("parseSlotType", () => {
  it("maps the placeholder body to a port type + schema", () => {
    expect(parseSlotType("")).toMatchObject({ type: "json" });
    expect(parseSlotType("string")).toMatchObject({ type: "text" });
    expect(parseSlotType("number")).toMatchObject({ type: "number" });
    expect(parseSlotType("object")).toMatchObject({ type: "json" });
    expect(parseSlotType("boolean")).toMatchObject({ type: "json" });
  });
  it("reads an enum from quoted, pipe-separated options", () => {
    const t = parseSlotType('"a"|"b"|"c"');
    expect(t.type).toBe("text");
    expect(t.options).toEqual(["a", "b", "c"]);
  });
});

describe("parseTemplate", () => {
  it("punches a wireable inlet for each <…>, named by its path", () => {
    const { template, slots, error } = parseTemplate('{ "title": <string>, "size": <number> }');
    expect(error).toBe(null);
    expect(slots.map((s) => s.name).sort()).toEqual(["size", "title"]);
    expect(slots.find((s) => s.name === "title").type).toBe("text");
    expect(slots.find((s) => s.name === "size").type).toBe("number");
    // the parsed template still has sentinel placeholders at those paths
    expect(typeof template.title).toBe("string");
  });
  it("names nested + array holes by their full path", () => {
    const { slots } = parseTemplate('{ "a": { "b": <number> }, "list": [<string>, <string>] }');
    expect(slots.map((s) => s.name).sort()).toEqual(["a.b", "list.0", "list.1"]);
  });
  it("a whole-doc hole has path [] and name 'value'", () => {
    const { slots } = parseTemplate("<object>");
    expect(slots).toHaveLength(1);
    expect(slots[0].path).toEqual([]);
    expect(slots[0].name).toBe("value");
  });
  it("reports a JSON error for a malformed template", () => {
    expect(parseTemplate("{ not json").error).toBeTruthy();
  });
});

describe("fillTemplate", () => {
  it("fills each hole from getValue(slot), leaving static parts intact", () => {
    const { template, slots } = parseTemplate('{ "title": <string>, "n": <number>, "keep": "x" }');
    const vals = { title: "hi", n: 42 };
    const out = fillTemplate(template, slots, (s) => vals[s.name]);
    expect(out).toEqual({ title: "hi", n: 42, keep: "x" });
  });
  it("a whole-doc hole returns its value directly", () => {
    const { template, slots } = parseTemplate("<object>");
    expect(fillTemplate(template, slots, () => ({ a: 1 }))).toEqual({ a: 1 });
  });
  it("nested + array holes land at the right paths", () => {
    const { template, slots } = parseTemplate('{ "a": { "b": <number> }, "list": [<string>] }');
    const vals = { "a.b": 9, "list.0": "z" };
    expect(fillTemplate(template, slots, (s) => vals[s.name])).toEqual({ a: { b: 9 }, list: ["z"] });
  });
  it("unwired holes fill as undefined (dropped from JSON)", () => {
    const { template, slots } = parseTemplate('{ "title": <string>, "keep": 1 }');
    const out = fillTemplate(template, slots, () => undefined);
    expect(out.keep).toBe(1);
    expect("title" in out).toBe(true); // present, value undefined
  });
});

describe("templateInlets (the dynamicInlets hook)", () => {
  it("turns template text into inlet defs", () => {
    const inlets = templateInlets({ template: '{ "x": <number>, "y": <string> }' });
    expect(inlets.map((i) => i.name).sort()).toEqual(["x", "y"]);
    expect(inlets.find((i) => i.name === "x").type).toBe("number");
  });
  it("falls back to the default template when none given", () => {
    expect(templateInlets({}).length).toBeGreaterThan(0);
  });
});

import { stripUndefinedDeep, reconcileTemplateDoc } from "./template-doc.js";
import { makeRepo, flush } from "./test-harness.js";

describe("stripUndefinedDeep", () => {
  it("drops undefined-valued keys at ANY depth; array holes become null", () => {
    expect(stripUndefinedDeep({ a: undefined, b: { c: undefined, d: 1 }, e: [1, undefined, 2] }))
      .toEqual({ b: { d: 1 }, e: [1, null, 2] });
  });
  it("passes primitives and null through untouched", () => {
    expect(stripUndefinedDeep(null)).toBe(null);
    expect(stripUndefinedDeep(7)).toBe(7);
    expect(stripUndefinedDeep("s")).toBe("s");
  });
});

import { mountTemplateDoc } from "./template-doc.js";

describe("mountTemplateDoc — bind() generation guard + doc-stream lifecycle", () => {
  afterEach(() => { delete window.repo; });

  const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
  // enough handle for automergeOpstream + writeDoc: url/doc()/change/on/off (listener counts observable)
  const fakeHandle = (url) => ({
    url, _doc: {}, ons: 0, offs: 0,
    doc() { return this._doc; },
    change(fn) { fn(this._doc); },
    on() { this.ons++; },
    off() { this.offs++; },
  });

  it("a stale create2 resolving after a remote-url find neither swaps the outlet nor persists its loser url", async () => {
    const createDef = deferred(), findDef = deferred();
    const winner = fakeHandle("automerge:winner"), loser = fakeHandle("automerge:loser");
    window.repo = { create2: () => createDef.promise, find: () => findDef.promise };

    const element = document.createElement("div");
    const outlets = {}; let docSwaps = 0;
    const setOutlet = (name, s) => { outlets[name] = s; if (name === "doc") docSwaps++; };
    const cfgs = [];
    let onCfg;
    const cleanup = mountTemplateDoc({ element, inlets: {}, setOutlet, config: {}, setConfig: (c) => cfgs.push(c), onConfig: (cb) => (onCfg = cb) });
    expect(docSwaps).toBe(1); // the immediate placeholder

    // mount started bind(null) → slow create2; a remote peer's winning url arrives
    onCfg({ url: "automerge:winner" }); // → bind(winner) → fast find
    findDef.resolve(winner);
    await flush();
    expect(docSwaps).toBe(2); // swapped to the WINNER's stream
    expect(outlets.doc.complement.handle).toBe(winner);
    const persisted = cfgs.filter((c) => "url" in c);
    expect(persisted).toEqual([]); // a found url is never re-persisted

    // …then the STALE create2 finally resolves — it must do nothing
    createDef.resolve(loser);
    await flush();
    expect(docSwaps).toBe(2); // no third swap
    expect(outlets.doc.complement.handle).toBe(winner);
    expect(cfgs.filter((c) => "url" in c)).toEqual([]); // the loser url never overwrites the winner
    expect(loser.ons).toBe(0); // no stream was ever built on the loser

    cleanup();
    expect(winner.offs).toBe(winner.ons); // teardown disconnects the doc stream's change listener
  });

  it("rebinding disconnects the PREVIOUS doc stream (no change-listener leak per rebind)", async () => {
    const a = fakeHandle("automerge:aaa"), b = fakeHandle("automerge:bbb");
    window.repo = { create2: async () => fakeHandle("automerge:fresh"), find: async (url) => (url === "automerge:aaa" ? a : b) };
    const element = document.createElement("div");
    let onCfg;
    const cleanup = mountTemplateDoc({ element, inlets: {}, setOutlet() {}, config: { url: "automerge:aaa" }, setConfig() {}, onConfig: (cb) => (onCfg = cb) });
    await flush();
    expect(a.ons).toBe(1);
    onCfg({ url: "automerge:bbb" }); // rebind
    await flush();
    expect(a.offs).toBe(1); // the old stream was disconnect()ed, not orphaned
    expect(b.ons).toBe(1);
    cleanup();
    expect(b.offs).toBe(1); // and cleanup releases the current one
  });
});

describe("reconcileTemplateDoc (the writeDoc reconcile)", () => {
  it("NEVER deletes keys other tools put on the doc — only its own previous keys", async () => {
    const repo = makeRepo();
    const handle = repo.create({ "@patchwork": { type: "file" }, title: "kept" });
    let managed = new Set();
    handle.change((d) => { managed = reconcileTemplateDoc(d, { a: 1, b: "x" }, managed); });
    await flush();
    expect(handle.doc()["@patchwork"]).toEqual({ type: "file" }); // survived the first write
    expect(handle.doc().title).toBe("kept");
    expect(handle.doc().a).toBe(1);
    // template edited: `a` gone, `c` new — only `a` (template-managed) is deleted
    handle.change((d) => { managed = reconcileTemplateDoc(d, { b: "x", c: 2 }, managed); });
    await flush();
    const doc = handle.doc();
    expect(doc["@patchwork"]).toEqual({ type: "file" }); // STILL here after the recompute
    expect(doc.title).toBe("kept");
    expect("a" in doc).toBe(false); // the template's own stale key IS reconciled away
    expect(doc.c).toBe(2);
  });

  it("strips undefined-valued keys — including NESTED ones — so the change never throws", async () => {
    const repo = makeRepo();
    const handle = repo.create({});
    let managed = new Set();
    expect(() =>
      handle.change((d) => {
        managed = reconcileTemplateDoc(d, { top: undefined, nest: { hole: undefined, ok: 1 }, list: [undefined, "v"] }, managed);
      })
    ).not.toThrow();
    await flush();
    const doc = handle.doc();
    expect("top" in doc).toBe(false); // unwired top-level hole dropped
    expect(doc.nest).toEqual({ ok: 1 }); // unwired NESTED hole dropped, not thrown
    expect(doc.list.length).toBe(2);
    expect(doc.list[0]).toBe(null); // array hole becomes null (indices keep their spots)
    expect(String(doc.list[1])).toBe("v");
  });
});
