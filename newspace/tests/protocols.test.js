import { describe, it, expect } from "vitest";
import { getHeads, splice as amSplice } from "@automerge/automerge";
import { makeRepo, flush } from "./test-harness.js";
import { createProtocols, automergeProtocol } from "../src/protocols.js";
import { createSketchyApi, describe as introspect } from "../src/api.js";

async function makeDoc(repo, initial) {
  const handle = repo.create();
  handle.change((d) => Object.assign(d, initial));
  await flush();
  return handle;
}

describe("createProtocols / find", () => {
  it("dispatches by scheme and errors on an unknown one", async () => {
    const p = createProtocols();
    p.register("test", async (url) => ({ url }));
    expect((await p.find("test:hi")).url).toBe("test:hi");
    expect(p.schemes()).toContain("test");
    await expect(p.find("nope:x")).rejects.toThrow(/no protocol handler/);
  });

  it("register returns an unregister", async () => {
    const p = createProtocols();
    const off = p.register("x", async () => 1);
    expect(p.has("x")).toBe(true);
    off();
    expect(p.has("x")).toBe(false);
  });
});

describe("automerge protocol", () => {
  it("resolves automerge:<id> to a whole-doc opstream", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { title: "T", content: "hi" });
    const resolve = automergeProtocol(repo);
    const stream = await resolve(handle.url);
    expect(stream.value).toMatchObject({ title: "T", content: "hi" });
    expect(stream.complement.handle).toBe(handle);
  });

  it("a #path fragment scopes to a subtree", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "hello" });
    const resolve = automergeProtocol(repo);
    const stream = await resolve(handle.url + "#content");
    expect(stream.value).toBe("hello");
    // and it's live + editable
    stream.apply({ path: [], range: [0, 1], value: "H" });
    await flush();
    expect(handle.doc().content).toBe("Hello");
  });

  it("heads makes it read-only (no apply)", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "v1" });
    const past = getHeads(handle.doc());
    handle.change((d) => amSplice(d, ["content"], 2, 0, "!"));
    await flush();
    const stream = await automergeProtocol(repo)(handle.url + "#content", { heads: past });
    expect(stream.value).toBe("v1");
    expect(stream.apply).toBeUndefined();
  });
});

describe("createSketchyApi", () => {
  it("api.find(url) returns an opstream attached to an automerge doc", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "yo" });
    const api = createSketchyApi({ repo });
    const stream = await api.find(handle.url + "#content");
    expect(stream.value).toBe("yo");
  });

  it("callers can register their own protocol", async () => {
    const api = createSketchyApi({});
    api.registerProtocol("mem", async (url) => ({ value: url.split(":")[1] }));
    expect((await api.find("mem:hello")).value).toBe("hello");
  });
});

describe("describe (introspection)", () => {
  it("describes a function (name, signature, arity)", () => {
    function place(descriptor, at) { return [descriptor, at]; }
    const d = introspect(place);
    expect(d.kind).toBe("function");
    expect(d.name).toBe("place");
    expect(d.arity).toBe(2);
    expect(d.signature).toContain("place(descriptor, at)");
  });
  it("describes an opstream (readonly via absence of apply)", () => {
    const ro = { connect() {}, complement: { a: 1 }, value: "x" };
    expect(introspect(ro)).toMatchObject({ kind: "opstream", readonly: true, valueType: "string" });
    const rw = { connect() {}, apply() {}, value: 1 };
    expect(introspect(rw).readonly).toBe(false);
  });
  it("describes a descriptor object and an unknown id", () => {
    expect(introspect({ type: "sketchy:editor", id: "x", name: "X", inlets: [] })).toMatchObject({ kind: "sketchy:editor", id: "x" });
    expect(introspect("nope-not-registered")).toEqual({ kind: "unknown", id: "nope-not-registered" });
  });
});
