import { describe, it, expect } from "vitest";
import { registerPlugins } from "@inkandswitch/patchwork-plugins";
import { makeRepo, flush } from "./test-harness.js";
import { Source, Opstream } from "../src/opstreams.js";
import { createSketchyApi, describe as introspect } from "../src/api.js";

async function makeDoc(repo, initial) {
  const handle = repo.create();
  handle.change((d) => Object.assign(d, initial));
  await flush();
  return handle;
}

describe("createSketchyApi shape", () => {
  it("exposes the small public surface (find, registerProtocol, protocols, editors, describe)", () => {
    const repo = makeRepo();
    const element = {};
    const api = createSketchyApi({ repo, element });
    expect(api.repo).toBe(repo);
    expect(api.element).toBe(element);
    expect(typeof api.find).toBe("function");
    expect(typeof api.registerProtocol).toBe("function");
    expect(typeof api.editors).toBe("function");
    expect(typeof api.editorsFor).toBe("function");
    expect(api.describe).toBe(introspect);
    expect(typeof api.protocols.schemes).toBe("function");
  });

  it("defaults to an empty options object (no repo, no element)", () => {
    const api = createSketchyApi();
    expect(api.repo).toBeUndefined();
    expect(api.element).toBeUndefined();
    // with no repo, the automerge handler is NOT registered
    expect(api.protocols.has("automerge")).toBe(false);
  });

  it("registers the automerge protocol only when a repo is given", () => {
    expect(createSketchyApi({ repo: makeRepo() }).protocols.has("automerge")).toBe(true);
    expect(createSketchyApi({}).protocols.has("automerge")).toBe(false);
  });
});

describe("api.find resolves an automerge doc to an opstream", () => {
  it("resolves automerge:<id> to a live, editable whole-doc opstream", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { title: "T", n: 1 });
    const api = createSketchyApi({ repo });
    const stream = await api.find(handle.url);
    expect(stream.value).toMatchObject({ title: "T", n: 1 });
    expect(stream.complement.handle).toBe(handle);
    expect(stream.complement.url).toBe(handle.url);
    // editable: applying an op writes through to the real doc
    stream.apply({ path: [], range: "n", value: 9 });
    await flush();
    expect(handle.doc().n).toBe(9);
  });

  it("connect delivers a snapshot of the current doc value", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { greeting: "hi" });
    const api = createSketchyApi({ repo });
    const stream = await api.find(handle.url);
    let seen;
    const off = stream.connect((op) => { seen = op; });
    expect(seen.type).toBe("snapshot");
    expect(seen.value).toMatchObject({ greeting: "hi" });
    off();
  });

  it("passes opts.heads through to pin a read-only historical view", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "v1" });
    const past = (await import("@automerge/automerge")).getHeads(handle.doc());
    handle.change((d) => { d.content = "v2"; });
    await flush();
    const api = createSketchyApi({ repo });
    const pinned = await api.find(handle.url, { heads: past, path: ["content"] });
    expect(pinned.value).toBe("v1");
    expect(pinned.apply).toBeUndefined(); // read-only is the ABSENCE of apply
  });

  it("rejects a url whose scheme has no handler", async () => {
    const api = createSketchyApi({ repo: makeRepo() });
    await expect(api.find("https:example")).rejects.toThrow(/no protocol handler for "https:"/);
  });
});

describe("api.registerProtocol + custom-scheme find", () => {
  it("dispatches a custom scheme through the registered handler with the full url", async () => {
    const api = createSketchyApi({});
    let received;
    api.registerProtocol("mem", async (url, opts) => {
      received = { url, opts };
      return { value: url.slice(url.indexOf(":") + 1) };
    });
    const stream = await api.find("mem:payload");
    expect(stream.value).toBe("payload");
    expect(received.url).toBe("mem:payload");
    expect(received.opts).toEqual({});
  });

  it("forwards opts to a custom handler", async () => {
    const api = createSketchyApi({});
    api.registerProtocol("mem", async (_url, opts) => ({ value: opts.tag }));
    expect((await api.find("mem:x", { tag: 7 })).value).toBe(7);
  });

  it("returns an unregister function that removes the handler", async () => {
    const api = createSketchyApi({});
    const off = api.registerProtocol("temp", async () => ({ value: "ok" }));
    expect(api.protocols.has("temp")).toBe(true);
    off();
    expect(api.protocols.has("temp")).toBe(false);
    await expect(api.find("temp:y")).rejects.toThrow(/no protocol handler/);
  });

  it("a custom handler can shadow/extend alongside the built-in automerge one", async () => {
    const api = createSketchyApi({ repo: makeRepo() });
    api.registerProtocol("gopher", async () => ({ value: "G" }));
    expect(api.protocols.schemes()).toEqual(expect.arrayContaining(["automerge", "gopher"]));
    expect((await api.find("gopher:menu")).value).toBe("G");
  });
});

describe("describe (introspection)", () => {
  it("describes a registered plugin id by looking it up across registry types", () => {
    const id = "newspace-api-test-tool";
    registerPlugins([
      { type: "patchwork:tool", id, name: "API Test Tool", icon: "wrench", supportedDatatypes: ["folder"] },
    ]);
    const d = introspect(id);
    expect(d.kind).toBe("patchwork:tool");
    expect(d.id).toBe(id);
    expect(d.name).toBe("API Test Tool");
    expect(d.icon).toBe("wrench");
    expect(d.supportedDatatypes).toEqual(["folder"]);
  });

  it("returns kind:unknown for a string that matches no registered plugin", () => {
    expect(introspect("definitely-not-registered-xyz")).toEqual({
      kind: "unknown",
      id: "definitely-not-registered-xyz",
    });
  });

  it("describes a function: name, arity, normalized signature", () => {
    function place(descriptor, at, opts) { return [descriptor, at, opts]; }
    const d = introspect(place);
    expect(d.kind).toBe("function");
    expect(d.name).toBe("place");
    expect(d.arity).toBe(3);
    expect(d.signature).toBe("function place(descriptor, at, opts)");
  });

  it("names an anonymous arrow function as (anonymous) with arity 0", () => {
    const d = introspect(() => 42);
    expect(d.kind).toBe("function");
    expect(d.name).toBe("(anonymous)");
    expect(d.arity).toBe(0);
  });

  it("describes a real read-only Source opstream (readonly via absence of apply)", () => {
    const src = new Source("hello", { complement: { kind: "x" } });
    const d = introspect(src);
    expect(d.kind).toBe("opstream");
    expect(d.readonly).toBe(true); // Source has no `apply`
    expect(d.valueType).toBe("string");
    expect(d.complement).toEqual({ kind: "x" });
  });

  it("describes a real read-write Opstream (apply present ⇒ not readonly)", () => {
    const op = new Opstream(123);
    const d = introspect(op);
    expect(d.kind).toBe("opstream");
    expect(d.readonly).toBe(false);
    expect(d.valueType).toBe("number");
  });

  it("opstream branch wins over the descriptor branch when both connect and type/id exist", () => {
    const hybrid = { connect() {}, type: "sketchy:editor", id: "z", value: {} };
    expect(introspect(hybrid).kind).toBe("opstream");
  });

  it("describes a descriptor-shaped object (type + id, no connect)", () => {
    const d = introspect({ type: "sketchy:window", id: "w", name: "W", inlets: [], outlets: [] });
    expect(d).toMatchObject({ kind: "sketchy:window", id: "w", name: "W", inlets: [], outlets: [] });
  });

  it("describes a plain object as kind:object listing its keys", () => {
    const d = introspect({ a: 1, b: 2 });
    expect(d.kind).toBe("object");
    expect(d.keys).toEqual(["a", "b"]);
  });

  it("describes primitives by typeof + value", () => {
    expect(introspect(42)).toEqual({ kind: "number", value: 42 });
    expect(introspect(true)).toEqual({ kind: "boolean", value: true });
    expect(introspect(null)).toEqual({ kind: "object", value: null });
  });
});
