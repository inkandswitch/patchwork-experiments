import { describe, it, expect } from "vitest";
import { makeRepo, flush } from "./test-harness.js";
import {
  readPort,
  portWiring,
  streamType,
  inletAcceptsType,
  inletAcceptsValue,
  firstMatchingInlet,
  editorsForStream,
  makeEditorItem,
  usedContextOutlets,
  outletFeedsInlet,
  descriptorsFeeding,
} from "./wire.js";
import { Opstream, automergeOpstream } from "./opstreams.js";

const codemirror = {
  id: "codemirror",
  inlets: [
    { name: "content", type: "text", required: true },
    { name: "language", type: "language" },
  ],
};
const inspector = { id: "inspector", inlets: [{ name: "doc", type: "json" }] };
const imageEd = { id: "image", inlets: [{ name: "pixels", type: "bytes" }] };

describe("readPort", () => {
  it("reads an automerge port (kind, url, path) off the nearest element", () => {
    const wrap = document.createElement("div");
    wrap.innerHTML =
      '<label><span>title</span><input data-automerge-url="automerge:abc" data-automerge-path="[&quot;title&quot;]"></label>';
    const input = wrap.querySelector("input");
    const port = readPort(input);
    expect(port.kind).toBe("automerge");
    expect(port.url).toBe("automerge:abc");
    expect(port.path).toEqual(["title"]);
    expect(port.element).toBe(input);
  });

  it("reads a context port (kind, name) and prefers it over automerge", () => {
    const el = document.createElement("div");
    el.setAttribute("data-sketchy-port", "pointer");
    const port = readPort(el);
    expect(port.kind).toBe("context");
    expect(port.name).toBe("pointer");
  });

  it("reads a peer port (kind, contactUrl, part)", () => {
    const el = document.createElement("div");
    el.setAttribute("data-sketchy-peer", "automerge:bob");
    el.setAttribute("data-sketchy-part", "cursor");
    const port = readPort(el);
    expect(port).toMatchObject({ kind: "peer", contactUrl: "automerge:bob", part: "cursor" });
  });

  it("reads a node outlet port (kind, node, outlet) — e.g. a lens output", () => {
    const el = document.createElement("div");
    el.setAttribute("data-sketchy-node", "ed-7");
    el.setAttribute("data-sketchy-outlet", "out");
    const port = readPort(el);
    expect(port).toMatchObject({ kind: "node", node: "ed-7", outlet: "out" });
  });

  it("returns null when there's no port in the ancestry", () => {
    expect(readPort(document.createElement("div"))).toBe(null);
  });
});

describe("portWiring", () => {
  it("context → {context}, peer → {peer,part}, node → {node,outlet}, automerge → {url,path}", () => {
    expect(portWiring({ kind: "context", name: "pointer" })).toEqual({ context: "pointer" });
    expect(portWiring({ kind: "peer", contactUrl: "automerge:bob", part: "cursor" })).toEqual({ peer: "automerge:bob", part: "cursor" });
    expect(portWiring({ kind: "node", node: "ed-7", outlet: "out" })).toEqual({ node: "ed-7", outlet: "out" });
    expect(portWiring({ kind: "automerge", url: "automerge:x", path: ["a"] })).toEqual({ url: "automerge:x", path: ["a"] });
  });
});

describe("streamType", () => {
  it("classifies by value shape", async () => {
    const repo = makeRepo();
    const h = repo.create();
    h.change((d) => Object.assign(d, { content: "hi", obj: { a: 1 } }));
    await flush();
    expect(streamType(automergeOpstream(h, { path: ["content"] }))).toBe("text");
    expect(streamType(automergeOpstream(h, { path: ["obj"] }))).toBe("json");
    expect(streamType(new Opstream(Uint8Array.from([1])))).toBe("bytes");
  });
});

describe("inlet matching", () => {
  it("untyped / json inlets accept anything; typed inlets must match", () => {
    expect(inletAcceptsType({ type: "text" }, "text")).toBe(true);
    expect(inletAcceptsType({ type: "text" }, "json")).toBe(false);
    expect(inletAcceptsType({ type: "json" }, "bytes")).toBe(true);
    expect(inletAcceptsType({}, "anything")).toBe(true);
  });

  it("firstMatchingInlet matches by VALUE (prefers a required inlet)", () => {
    expect(firstMatchingInlet(codemirror, "hi").name).toBe("content"); // a string value
    expect(firstMatchingInlet(codemirror, Uint8Array.from([1]))).toBe(null); // not text/json
  });

  it("inletAcceptsValue uses a Standard Schema when present (over the type tag)", () => {
    const strSchema = { "~standard": { version: 1, vendor: "t", validate: (v) => (typeof v === "string" ? { value: v } : { issues: [{ message: "no" }] }) } };
    const inlet = { name: "content", type: "json", schema: strSchema }; // type says json, schema says string
    expect(inletAcceptsValue(inlet, "hi")).toBe(true);
    expect(inletAcceptsValue(inlet, { a: 1 })).toBe(false); // schema wins over the lenient json tag
  });

  it("editorsForStream filters to editors that accept the stream's type", () => {
    const textStream = new Opstream("hi");
    const jsonStream = new Opstream({ a: 1 });
    const bytesStream = new Opstream(Uint8Array.from([1]));
    const all = [codemirror, inspector, imageEd];
    expect(editorsForStream(all, textStream).map((e) => e.id)).toEqual(["codemirror", "inspector"]);
    expect(editorsForStream(all, jsonStream).map((e) => e.id)).toEqual(["inspector"]);
    expect(editorsForStream(all, bytesStream).map((e) => e.id)).toEqual(["inspector", "image"]);
  });
});

describe("makeEditorItem", () => {
  it("builds an editor item with wiring inlets, defaults, and a unique id", () => {
    const a = makeEditorItem({ editorId: "codemirror", x: 10, y: 20, inlets: { content: { url: "automerge:abc", path: ["title"] } } }, 0);
    expect(a).toMatchObject({
      kind: "editor",
      editorId: "codemirror",
      x: 10,
      y: 20,
      w: 360,
      h: 260,
      inlets: { content: { url: "automerge:abc", path: ["title"] } },
    });
    const b = makeEditorItem({ editorId: "x", x: 0, y: 0 }, 0);
    expect(a.id).not.toBe(b.id); // unique
  });

  it("carries rotation/parent only when given", () => {
    const plain = makeEditorItem({ editorId: "x", x: 0, y: 0 }, 1);
    expect("rotation" in plain).toBe(false);
    expect("parent" in plain).toBe(false);
    const nested = makeEditorItem({ editorId: "x", x: 0, y: 0, rotation: 15, parent: "f1" }, 2);
    expect(nested.rotation).toBe(15);
    expect(nested.parent).toBe("f1");
  });
});

describe("usedContextOutlets", () => {
  it("is empty with no editors or floats", () => {
    expect(usedContextOutlets([], []).size).toBe(0);
    expect(usedContextOutlets().size).toBe(0); // tolerates missing args
  });

  it("collects context outlets referenced by editor inlets", () => {
    const items = [
      { id: "e1", kind: "editor", inlets: { value: { context: "pointer" } } },
      { id: "e2", kind: "editor", inlets: { value: { context: "camera" } } },
    ];
    const used = usedContextOutlets(items, []);
    expect([...used].sort()).toEqual(["camera", "pointer"]);
  });

  it("collects context outlets referenced by floating inspectors (top layer)", () => {
    // the regression: a float wired to a context outlet must keep it visible
    const floats = [{ id: "f1", source: { context: "selection" } }];
    const used = usedContextOutlets([], floats);
    expect(used.has("selection")).toBe(true);
  });

  it("unions editor inlets and floats, de-duping", () => {
    const items = [{ id: "e1", kind: "editor", inlets: { v: { context: "camera" } } }];
    const floats = [
      { id: "f1", source: { context: "camera" } }, // dup of the editor's
      { id: "f2", source: { context: "pointer" } },
    ];
    const used = usedContextOutlets(items, floats);
    expect([...used].sort()).toEqual(["camera", "pointer"]);
  });

  it("ignores non-context wirings (peer / automerge url)", () => {
    const items = [
      { id: "e1", kind: "editor", inlets: { a: { peer: "contact:x", part: "view" }, b: { url: "automerge:1", path: [] } } },
    ];
    const floats = [{ id: "f1", source: { peer: "contact:y" } }];
    expect(usedContextOutlets(items, floats).size).toBe(0);
  });

  it("ignores non-editor items and null/empty inlets", () => {
    const items = [
      { id: "s1", kind: "stroke" },
      { id: "e1", kind: "editor" }, // no inlets
      { id: "e2", kind: "editor", inlets: { x: null } }, // null wiring
    ];
    expect(usedContextOutlets(items, []).size).toBe(0);
  });
});

describe("outletFeedsInlet / descriptorsFeeding (the inlet-drop menu)", () => {
  it("permissive type compatibility (json/untyped on either side matches)", () => {
    expect(outletFeedsInlet({ type: "text" }, { type: "text" })).toBe(true);
    expect(outletFeedsInlet({ type: "text" }, { type: "number" })).toBe(false);
    expect(outletFeedsInlet({ type: "text" }, { type: "json" })).toBe(true); // inlet accepts anything
    expect(outletFeedsInlet({ type: "json" }, { type: "number" })).toBe(true); // outlet produces anything
    expect(outletFeedsInlet({ type: "text" }, {})).toBe(true); // untyped inlet
  });
  it("descriptorsFeeding picks descriptors with a compatible outlet", () => {
    const ds = [
      { id: "num", outlets: [{ name: "value", type: "number" }] },
      { id: "txt", outlets: [{ name: "out", type: "text" }] },
      { id: "any", outlets: [{ name: "out", type: "json" }] },
      { id: "sink", outlets: [] },
    ];
    expect(descriptorsFeeding(ds, { type: "number" }).map((d) => d.id)).toEqual(["num", "any"]);
    expect(descriptorsFeeding(ds, { type: "text" }).map((d) => d.id)).toEqual(["txt", "any"]);
  });
});
