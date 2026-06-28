import { describe, it, expect } from "vitest";
import { makeRepo, flush } from "./test-harness.js";
import {
  readPort,
  portWiring,
  streamType,
  inletAcceptsType,
  firstMatchingInlet,
  editorsForStream,
  makeEditorItem,
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

  it("returns null when there's no port in the ancestry", () => {
    expect(readPort(document.createElement("div"))).toBe(null);
  });
});

describe("portWiring", () => {
  it("context → {context}, peer → {peer,part}, automerge → {url,path}", () => {
    expect(portWiring({ kind: "context", name: "pointer" })).toEqual({ context: "pointer" });
    expect(portWiring({ kind: "peer", contactUrl: "automerge:bob", part: "cursor" })).toEqual({ peer: "automerge:bob", part: "cursor" });
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

  it("firstMatchingInlet prefers a required matching inlet", () => {
    expect(firstMatchingInlet(codemirror, "text").name).toBe("content");
    expect(firstMatchingInlet(codemirror, "bytes")).toBe(null); // language is not text/json
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
