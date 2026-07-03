import { describe, it, expect } from "vitest";
import { makeRepo, flush } from "./test-harness.js";
import {
  nodeRole,
  paramsAsInlets,
  effectiveInlets,
  defaultInlets,
  inletDefsFor,
  outletDefsFor,
} from "../src/surfaces.js";

async function makeDoc(repo, initial) {
  const handle = repo.create();
  handle.change((d) => Object.assign(d, initial));
  await flush();
  return handle;
}

// ── nodeRole: topologies NOT covered by the sibling ─────────────────────────
describe("nodeRole (more topologies)", () => {
  it("undefined descriptor ⇒ editor (same safe default as null)", () => {
    expect(nodeRole(undefined)).toBe("editor");
  });

  it("both ports absent (no inlets/outlets keys at all) ⇒ editor", () => {
    // 0 ins && 0 outs falls through every branch to the editor default
    expect(nodeRole({})).toBe("editor");
  });

  it("both ports present but EMPTY arrays ⇒ editor (0 in, 0 out)", () => {
    expect(nodeRole({ inlets: [], outlets: [] })).toBe("editor");
  });

  it("inlets absent, outlets empty ⇒ editor (not source — outs must be > 0)", () => {
    expect(nodeRole({ outlets: [] })).toBe("editor");
  });

  it("outlets absent, inlets empty ⇒ editor (not sink — ins must be > 0)", () => {
    expect(nodeRole({ inlets: [] })).toBe("editor");
  });

  it("lens wins over an explicit role override too (lens checked first)", () => {
    expect(nodeRole({ lens: true, role: "source" })).toBe("lens");
  });

  it("lens wins even with a pure-source topology", () => {
    expect(nodeRole({ lens: true, inlets: [], outlets: [{ name: "o" }] })).toBe("lens");
  });

  it("explicit role passes through arbitrary strings verbatim", () => {
    expect(nodeRole({ role: "transform" })).toBe("transform");
    expect(nodeRole({ role: "whatever" })).toBe("whatever");
  });

  it("explicit role override beats a sink topology", () => {
    expect(nodeRole({ role: "editor", inlets: [{ name: "in" }] })).toBe("editor");
  });

  it("multiple inlets and multiple outlets ⇒ editor", () => {
    expect(
      nodeRole({ inlets: [{ name: "a" }, { name: "b" }], outlets: [{ name: "x" }, { name: "y" }] })
    ).toBe("editor");
  });
});

// ── paramsAsInlets: edge cases ───────────────────────────────────────────────
describe("paramsAsInlets (edge cases)", () => {
  it("null/undefined descriptor ⇒ [] (optional chaining guards)", () => {
    expect(paramsAsInlets(null)).toEqual([]);
    expect(paramsAsInlets(undefined)).toEqual([]);
  });

  it("descriptor with no params key ⇒ []", () => {
    expect(paramsAsInlets({ inlets: [{ name: "x" }] })).toEqual([]);
  });

  it("preserves a provided schema and stamps param:true / required:false", () => {
    const schema = { type: "object" };
    const [out] = paramsAsInlets({ params: [{ name: "cfg", type: "json", schema }] });
    expect(out).toEqual({
      name: "cfg",
      type: "json",
      schema,
      default: undefined,
      required: false,
      param: true,
    });
    expect(out.schema).toBe(schema); // same reference passed through
  });

  it("preserves a FALSY default (0) rather than dropping it", () => {
    const [out] = paramsAsInlets({ params: [{ name: "n", type: "number", default: 0 }] });
    expect(out.default).toBe(0);
  });

  it("always forces required:false even if the param said required:true", () => {
    const [out] = paramsAsInlets({ params: [{ name: "p", type: "text", required: true }] });
    expect(out.required).toBe(false);
  });
});

// ── effectiveInlets: edge cases ──────────────────────────────────────────────
describe("effectiveInlets (edge cases)", () => {
  it("null/undefined descriptor ⇒ []", () => {
    expect(effectiveInlets(null)).toEqual([]);
    expect(effectiveInlets(undefined)).toEqual([]);
  });

  it("only params (no declared inlets) ⇒ just the param-inlets", () => {
    const eff = effectiveInlets({ params: [{ name: "p", type: "text" }] });
    expect(eff.map((i) => i.name)).toEqual(["p"]);
    expect(eff[0].param).toBe(true);
  });

  it("declared inlets always precede param-inlets in order", () => {
    const eff = effectiveInlets({
      inlets: [{ name: "i1" }, { name: "i2" }],
      params: [{ name: "p1" }, { name: "p2" }],
    });
    expect(eff.map((i) => i.name)).toEqual(["i1", "i2", "p1", "p2"]);
    // the declared inlets are untouched (no param tag added)
    expect(eff[0].param).toBeUndefined();
    expect(eff[2].param).toBe(true);
  });

  it("returns a fresh array (not the descriptor's own inlets reference)", () => {
    const inlets = [{ name: "a" }];
    const eff = effectiveInlets({ inlets });
    expect(eff).not.toBe(inlets);
    expect(eff).toEqual(inlets);
  });
});

// ── defaultInlets: branches beyond the sibling's "text" + heads cases ────────
describe("defaultInlets (type branches)", () => {
  it("a null-typed inlet defaults to the whole-doc automerge stream", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { title: "hi", n: 3 });
    const desc = { inlets: [{ name: "doc" }] }; // type omitted ⇒ type == null branch
    const inlets = defaultInlets(desc, handle);
    expect(inlets.doc).toBeTruthy();
    expect(inlets.doc.value.title).toBe("hi");
    expect(inlets.doc.value.n).toBe(3);
  });

  it("an explicit 'json' inlet also yields the whole-doc automerge stream", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { a: 1 });
    const inlets = defaultInlets({ inlets: [{ name: "j", type: "json" }] }, handle);
    expect(inlets.j.value.a).toBe(1);
  });

  it("a 'language' inlet has NO doc source (left for explicit wiring)", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "x" });
    const inlets = defaultInlets({ inlets: [{ name: "lang", type: "language" }] }, handle);
    expect(inlets.lang).toBeUndefined();
    expect(Object.keys(inlets)).toEqual([]);
  });

  it("an unknown port type is skipped entirely (not text, not json/null)", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "x" });
    const inlets = defaultInlets({ inlets: [{ name: "gp", type: "gamepad" }] }, handle);
    expect(inlets.gp).toBeUndefined();
  });

  it("mixes text + json + skipped types in one descriptor", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "body", k: 5 });
    const desc = {
      inlets: [
        { name: "content", type: "text" },
        { name: "doc", type: "json" },
        { name: "lang", type: "language" }, // skipped
        { name: "anon" }, // null type ⇒ whole-doc
      ],
    };
    const inlets = defaultInlets(desc, handle);
    expect(Object.keys(inlets).sort()).toEqual(["anon", "content", "doc"]);
    expect(inlets.content.value).toBe("body");
    expect(inlets.doc.value.k).toBe(5);
    expect(inlets.anon.value.k).toBe(5);
  });

  it("descriptor without an inlets key ⇒ {} (no streams built)", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "x" });
    expect(defaultInlets({}, handle)).toEqual({});
  });

  it("a text inlet honours an explicit `path` for the file text stream", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { body: "deep" });
    const inlets = defaultInlets({ inlets: [{ name: "t", type: "text" }] }, handle, {
      path: ["body"],
    });
    expect(inlets.t.value).toBe("deep");
    expect(inlets.t.complement.path).toEqual(["body"]);
  });
});

// ── inletDefsFor: dynamic-vs-static + falsy returns + throwing ───────────────
describe("inletDefsFor (dynamic/static edge branches)", () => {
  it("a non-function dynamicInlets is ignored ⇒ falls back to static inlets", () => {
    const d = { dynamicInlets: "not a fn", inlets: [{ name: "s" }] };
    expect(inletDefsFor(d, {}).map((i) => i.name)).toEqual(["s"]);
  });

  it("dynamicInlets returning null falls through to [] (the `|| []` guard)", () => {
    const d = { dynamicInlets: () => null };
    expect(inletDefsFor(d, { config: {} })).toEqual([]);
  });

  it("dynamicInlets returning undefined falls through to []", () => {
    const d = { dynamicInlets: () => undefined };
    expect(inletDefsFor(d, {})).toEqual([]);
  });

  it("static path with no inlets key ⇒ [] (the `|| []` on descriptor.inlets)", () => {
    expect(inletDefsFor({}, { id: "x" })).toEqual([]);
  });

  it("null descriptor ⇒ [] (the leading descriptor && guard)", () => {
    expect(inletDefsFor(null, { config: { n: 1 } })).toEqual([]);
  });

  it("dynamicInlets receives {} when the item has no config", () => {
    let received;
    const d = { dynamicInlets: (cfg) => { received = cfg; return []; } };
    inletDefsFor(d, {}); // item with no .config
    expect(received).toEqual({});
  });

  it("dynamicInlets receives {} when the item itself is null", () => {
    let received;
    const d = { dynamicInlets: (cfg) => { received = cfg; return []; } };
    inletDefsFor(d, null);
    expect(received).toEqual({});
  });

  it("a throwing dynamicInlets is swallowed ⇒ [] (does NOT fall back to static)", () => {
    const d = { dynamicInlets: () => { throw new Error("boom"); }, inlets: [{ name: "s" }] };
    expect(inletDefsFor(d, {})).toEqual([]);
  });
});

// ── outletDefsFor: symmetric edge branches ──────────────────────────────────
describe("outletDefsFor (dynamic/static edge branches)", () => {
  it("a non-function dynamicOutlets is ignored ⇒ falls back to static outlets", () => {
    const d = { dynamicOutlets: 42, outlets: [{ name: "o" }] };
    expect(outletDefsFor(d, {}).map((o) => o.name)).toEqual(["o"]);
  });

  it("dynamicOutlets returning null falls through to []", () => {
    expect(outletDefsFor({ dynamicOutlets: () => null }, { config: {} })).toEqual([]);
  });

  it("dynamicOutlets returning undefined falls through to []", () => {
    expect(outletDefsFor({ dynamicOutlets: () => undefined }, {})).toEqual([]);
  });

  it("static path with no outlets key ⇒ []", () => {
    expect(outletDefsFor({}, { id: "x" })).toEqual([]);
  });

  it("null descriptor ⇒ []", () => {
    expect(outletDefsFor(null, {})).toEqual([]);
  });

  it("dynamicOutlets receives {} when the item has no config (and when null)", () => {
    const seen = [];
    const d = { dynamicOutlets: (cfg) => { seen.push(cfg); return []; } };
    outletDefsFor(d, {});
    outletDefsFor(d, null);
    expect(seen).toEqual([{}, {}]);
  });

  it("a throwing dynamicOutlets is swallowed ⇒ [] (no static fallback)", () => {
    const d = { dynamicOutlets: () => { throw new Error("nope"); }, outlets: [{ name: "o" }] };
    expect(outletDefsFor(d, {})).toEqual([]);
  });
});
