import { describe, it, expect } from "vitest";
import { getHeads, splice as amSplice } from "@automerge/automerge";
import { makeRepo, flush } from "./test-harness.js";
import { automergeOpstream } from "../src/opstreams.js";
import { defaultInlets, mountEditor } from "../src/editors.js";
import { mountCodemirror } from "../src/codemirror/sketchy-editor.js";

async function makeDoc(repo, initial) {
  const handle = repo.create();
  handle.change((d) => Object.assign(d, initial));
  await flush();
  return handle;
}

// the codemirror descriptor, as registered in index.jsx (load → the mount fn)
const codemirrorEditorDescriptor = {
  type: "sketchy:editor",
  id: "codemirror",
  name: "Code",
  supportedDatatypes: ["file", "*"],
  inlets: [
    { name: "content", type: "text", required: true },
    { name: "language", type: "language" },
  ],
  outlets: [{ name: "text", type: "text" }],
  load: async () => mountCodemirror,
};

describe("read-only opstream pinned at heads", () => {
  it("freezes the value at a past version and has NO apply", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "hello" });
    const past = getHeads(handle.doc());
    handle.change((d) => amSplice(d, ["content"], 5, 0, " world")); // move forward
    await flush();

    const live = automergeOpstream(handle, { path: ["content"] });
    const pinned = automergeOpstream(handle, { path: ["content"], heads: past });

    expect(live.value).toBe("hello world");
    expect(pinned.value).toBe("hello"); // frozen at the old heads
    expect(typeof live.apply).toBe("function");
    expect(pinned.apply).toBeUndefined(); // read-only = absence of apply
    expect(pinned.complement.heads).toEqual(past);
  });

  it("a pinned stream emits one snapshot on connect and never changes", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "v1" });
    const past = getHeads(handle.doc());
    const pinned = automergeOpstream(handle, { path: ["content"], heads: past });
    const seen = [];
    pinned.connect((o) => seen.push(o));
    handle.change((d) => amSplice(d, ["content"], 2, 0, "!")); // live edit
    await flush();
    expect(seen.length).toBe(1); // only the initial snapshot
    expect(pinned.value).toBe("v1");
  });
});

describe("defaultInlets", () => {
  it("builds a file text stream for a 'text' inlet", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "hi", mimeType: "text/plain" });
    const inlets = defaultInlets(codemirrorEditorDescriptor, handle);
    expect(inlets.content.value).toBe("hi");
    expect(inlets.content.complement.path).toEqual(["content"]);
    expect(inlets.language).toBeUndefined(); // language inlet has no doc source
  });

  it("pins inlets to heads when given (read-only)", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "first" });
    const past = getHeads(handle.doc());
    handle.change((d) => amSplice(d, ["content"], 5, 0, "!"));
    await flush();
    const inlets = defaultInlets(codemirrorEditorDescriptor, handle, { heads: past });
    expect(inlets.content.value).toBe("first");
    expect(inlets.content.apply).toBeUndefined();
  });
});

describe("mountEditor (the sketchy:editor mount path)", () => {
  it("mounts codemirror on a doc, edits round-trip, text outlet is exposed", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "abc", mimeType: "text/plain" });
    const element = document.createElement("div");
    document.body.append(element);
    const outlets = {};
    const cleanup = await mountEditor(codemirrorEditorDescriptor, { element, handle, outlets });

    // it mounted a codemirror view into the element
    const view = element.querySelector(".cm-editor");
    expect(view).toBeTruthy();
    // the text outlet is the content stream
    expect(outlets.text).toBeTruthy();
    expect(outlets.text.value).toBe("abc");
    // an edit through the outlet stream lands on the doc
    outlets.text.apply({ path: [], range: [3, 3], value: "d" });
    await flush();
    expect(handle.doc().content).toBe("abcd");

    cleanup();
  });

  it("mounts read-only when pinned at heads (no edits accepted)", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "frozen" });
    const past = getHeads(handle.doc());
    handle.change((d) => amSplice(d, ["content"], 6, 0, "!!"));
    await flush();
    const element = document.createElement("div");
    document.body.append(element);
    const cleanup = await mountEditor(codemirrorEditorDescriptor, { element, handle, heads: past });
    // editor shows the frozen value
    expect(element.querySelector(".cm-content")?.textContent).toContain("frozen");
    cleanup();
  });
});

import { nodeRole } from "../src/editors.js";

describe("nodeRole (topology → role)", () => {
  it("no inlets + outlets ⇒ source", () => {
    expect(nodeRole({ inlets: [], outlets: [{ name: "file" }] })).toBe("source");
    expect(nodeRole({ outlets: [{ name: "time" }] })).toBe("source"); // inlets absent
  });
  it("inlets + no outlets ⇒ sink", () => {
    expect(nodeRole({ inlets: [{ name: "value" }], outlets: [] })).toBe("sink");
    expect(nodeRole({ inlets: [{ name: "value" }] })).toBe("sink");
  });
  it("both ⇒ editor", () => {
    expect(nodeRole({ inlets: [{ name: "content" }], outlets: [{ name: "text" }] })).toBe("editor");
  });
  it("a lens descriptor ⇒ lens (explicit tag wins)", () => {
    expect(nodeRole({ lens: true, inlets: [{ name: "in" }], outlets: [{ name: "out" }] })).toBe("lens");
  });
  it("an explicit role override wins over topology", () => {
    expect(nodeRole({ role: "source", inlets: [{ name: "x" }], outlets: [{ name: "y" }] })).toBe("source");
  });
  it("nothing ⇒ editor (safe default)", () => {
    expect(nodeRole(null)).toBe("editor");
    expect(nodeRole({})).toBe("editor");
  });
});

import { paramsAsInlets, effectiveInlets } from "../src/editors.js";

describe("params schema → inlets", () => {
  const desc = {
    id: "x",
    inlets: [{ name: "value", type: "json", required: true }],
    params: [{ name: "size", type: "number", default: 4 }, { name: "color", type: "text" }],
  };
  it("paramsAsInlets projects each param to an optional, param-tagged inlet", () => {
    expect(paramsAsInlets(desc)).toEqual([
      { name: "size", type: "number", schema: undefined, default: 4, required: false, param: true },
      { name: "color", type: "text", schema: undefined, default: undefined, required: false, param: true },
    ]);
  });
  it("effectiveInlets = declared inlets followed by params-as-inlets", () => {
    const eff = effectiveInlets(desc);
    expect(eff.map((i) => i.name)).toEqual(["value", "size", "color"]);
    expect(eff[0].required).toBe(true); // a real inlet
    expect(eff[1].param).toBe(true);    // a param-inlet
  });
  it("no params ⇒ just the declared inlets", () => {
    expect(effectiveInlets({ inlets: [{ name: "a" }] }).map((i) => i.name)).toEqual(["a"]);
    expect(paramsAsInlets({})).toEqual([]);
  });
  it("reads a REAL schema's fields too (keyed by `key`, UI type → wire type)", async () => {
    const { paramsSchema } = await import("../src/ops.js");
    const d = { id: "y", schema: paramsSchema([
      { key: "color", label: "Colour", type: "color" },     // color → text
      { key: "size", label: "Size", type: "size", default: 8 }, // size  → number
      { key: "on", label: "On", type: "toggle" },           // toggle → json
    ]) };
    expect(paramsAsInlets(d)).toEqual([
      { name: "color", type: "text", schema: undefined, default: undefined, required: false, param: true },
      { name: "size", type: "number", schema: undefined, default: 8, required: false, param: true },
      { name: "on", type: "json", schema: undefined, default: undefined, required: false, param: true },
    ]);
  });
});

import { inletDefsFor, outletDefsFor } from "../src/editors.js";

describe("outletDefsFor (static vs dynamic outlets)", () => {
  it("returns the descriptor's static outlets by default", () => {
    const d = { outlets: [{ name: "out" }] };
    expect(outletDefsFor(d, { id: "x" }).map((o) => o.name)).toEqual(["out"]);
  });
  it("calls dynamicOutlets(config) when present (the LLM @out)", () => {
    const d = { dynamicOutlets: (cfg) => [{ name: "out" }, ...(cfg.extra ? [{ name: "extra" }] : [])] };
    expect(outletDefsFor(d, { config: { extra: 1 } }).map((o) => o.name)).toEqual(["out", "extra"]);
    expect(outletDefsFor(d, { config: {} }).map((o) => o.name)).toEqual(["out"]);
  });
  it("survives a throwing dynamicOutlets", () => {
    expect(outletDefsFor({ dynamicOutlets: () => { throw new Error("x"); } }, {})).toEqual([]);
  });
});

describe("inletDefsFor (static vs dynamic inlets)", () => {
  it("returns the descriptor's static inlets by default", () => {
    const d = { inlets: [{ name: "a" }, { name: "b" }] };
    expect(inletDefsFor(d, { id: "x" }).map((i) => i.name)).toEqual(["a", "b"]);
  });
  it("calls dynamicInlets(config) when present (the template doc)", () => {
    const d = { dynamicInlets: (cfg) => (cfg.n ? [{ name: "p" }] : []) };
    expect(inletDefsFor(d, { config: { n: 1 } }).map((i) => i.name)).toEqual(["p"]);
    expect(inletDefsFor(d, { config: {} })).toEqual([]);
    expect(inletDefsFor(d, {})).toEqual([]); // tolerates no config
  });
  it("survives a throwing dynamicInlets", () => {
    expect(inletDefsFor({ dynamicInlets: () => { throw new Error("x"); } }, {})).toEqual([]);
  });
});
