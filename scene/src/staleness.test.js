import { describe, it, expect } from "vitest";
import { builtInputsKey, changedKeys, currentInputsKey, debounceFor, defaultParams, depsKey, heldDeps, inputsKey, isContested, isStale, normalizeDeps, paramsKey, sameDeps, staleReason, withDefaults } from "./staleness.js";

const built = (params, heads, fingerprint = null) => ({ params, builtFrom: { heads, fingerprint, paramsKey: paramsKey(params) } });

describe("paramsKey", () => {
  it("is independent of key order and nested order", () => {
    expect(paramsKey({ b: 1, a: { d: 2, c: [1, { z: 1, y: 2 }] } })).toBe(paramsKey({ a: { c: [1, { y: 2, z: 1 }], d: 2 }, b: 1 }));
    expect(paramsKey({ a: 1 })).toBe('{"a":1}');
    expect(paramsKey(undefined)).toBe("{}");
    expect(paramsKey({ a: undefined, b: 2 })).toBe('{"b":2}');
  });
});

describe("staleness", () => {
  it("is stale when never built", () => {
    expect(staleReason({ params: {}, builtFrom: null }, { heads: ["a"] })).toBe("never-built");
  });
  it("compares params", () => {
    const r = built({ a: 1 }, ["x"]);
    expect(isStale(r, { heads: ["x"] })).toBe(false);
    expect(staleReason({ ...r, params: { a: 2 } }, { heads: ["x"] })).toBe("params");
  });
  it("compares heads order-insensitively", () => {
    const r = built({}, ["b", "a"]);
    expect(isStale(r, { heads: ["a", "b"] })).toBe(false);
    expect(staleReason(r, { heads: ["a", "c"] })).toBe("heads");
  });
  it("prefers the fingerprint over heads when there is one", () => {
    const r = built({}, ["old"], "fp1");
    expect(isStale(r, { heads: ["new"], fingerprint: "fp1" })).toBe(false);
    expect(staleReason(r, { heads: ["old"], fingerprint: "fp2" })).toBe("fingerprint");
  });
});

describe("contested fingerprints", () => {
  const r = built({ a: 1 }, ["h2", "h1"], "v2:x");
  const mine = builtInputsKey({ paramsKey: '{"a":1}', heads: ["h1", "h2"] });
  it("is contested only when heads and params match our own last build", () => {
    expect(isContested(r, { heads: ["h1", "h2"], fingerprint: "v1:x" }, mine)).toBe(true);
    expect(isContested(r, { heads: ["h1", "h2"], fingerprint: "v1:x" }, null)).toBe(false); // never built it here
    expect(isContested(r, { heads: ["h3"], fingerprint: "v1:y" }, mine)).toBe(false); // source moved
    expect(isContested({ ...r, params: { a: 2 } }, { heads: ["h1", "h2"], fingerprint: "v1:x" }, mine)).toBe(false);
    expect(isContested(r, { heads: ["h1", "h2"], fingerprint: "v2:x" }, mine)).toBe(false); // fresh
  });
});

describe("params", () => {
  const specs = [
    { key: "unit", kind: "enum", default: "mm", cost: "cheap" },
    { key: "res", kind: "integer", default: 32 },
    { key: "nodefault", kind: "string" },
  ];
  it("fills defaults without clobbering", () => {
    expect(defaultParams(specs)).toEqual({ unit: "mm", res: 32 });
    expect(withDefaults(specs, { res: 64, extra: true })).toEqual({ unit: "mm", res: 64, extra: true });
  });
  it("finds changed keys", () => {
    expect(changedKeys({ a: 1, b: [1] }, { a: 1, b: [2], c: 0 }).sort()).toEqual(["b", "c"]);
  });
  it("debounces by cost", () => {
    expect(debounceFor("never-built", { specs })).toBe(0);
    expect(debounceFor("params", { specs, changed: ["unit"] })).toBe(150);
    expect(debounceFor("params", { specs, changed: ["unit", "res"] })).toBe(800);
    expect(debounceFor("heads", { specs })).toBe(800);
    expect(debounceFor("heads", { specs: [specs[0]] })).toBe(150);
    expect(debounceFor("heads", { specs, providerCost: "cheap" })).toBe(150);
    expect(debounceFor("heads", { specs: [] })).toBe(800);
  });
  it("keys inputs by fingerprint or heads", () => {
    expect(inputsKey({ params: { a: 1 } }, { heads: ["b", "a"] })).toBe('{"a":1}|h:a,b');
    expect(inputsKey({ params: {} }, { heads: ["a"], fingerprint: "f" })).toBe("{}|fp:f");
  });
});

describe("dependencies", () => {
  const withDeps = (deps, fingerprint = null) => ({ params: {}, builtFrom: { heads: ["s"], fingerprint, paramsKey: "{}", ...(deps ? { deps } : {}) } });

  it("treats an old render without deps as having none", () => {
    expect(isStale(withDeps(undefined), { heads: ["s"] })).toBe(false);
    expect(isStale(withDeps(undefined), { heads: ["s"], deps: {} })).toBe(false);
    expect(staleReason(withDeps(undefined), { heads: ["s"], deps: { "automerge:a": ["x"] } })).toBe("deps");
  });

  it("is stale when the set of dependency urls changes", () => {
    const r = withDeps({ "automerge:a": ["x"] });
    expect(isStale(r, { heads: ["s"], deps: { "automerge:a": ["x"] } })).toBe(false);
    expect(staleReason(r, { heads: ["s"], deps: {} })).toBe("deps");
    expect(staleReason(r, { heads: ["s"], deps: { "automerge:a": ["x"], "automerge:b": [] } })).toBe("deps");
    expect(staleReason(r, { heads: ["s"], deps: { "automerge:b": ["x"] } })).toBe("deps");
  });

  it("compares each dependency's heads order-insensitively", () => {
    const r = withDeps({ "automerge:a": ["y", "x"] });
    expect(isStale(r, { heads: ["s"], deps: { "automerge:a": ["x", "y"] } })).toBe(false);
    expect(staleReason(r, { heads: ["s"], deps: { "automerge:a": ["x", "z"] } })).toBe("deps");
    expect(staleReason(r, { heads: ["s"], deps: { "automerge:a": [] } })).toBe("deps"); // not loaded
  });

  it("checks dependencies even when the provider fingerprints its source", () => {
    const r = withDeps({ "automerge:a": ["x"] }, "fp");
    expect(isStale(r, { heads: ["other"], fingerprint: "fp", deps: { "automerge:a": ["x"] } })).toBe(false);
    expect(staleReason(r, { heads: ["other"], fingerprint: "fp", deps: { "automerge:a": ["x2"] } })).toBe("deps");
    // the source reason wins when both moved
    expect(staleReason(r, { heads: ["s"], fingerprint: "fp2", deps: { "automerge:a": ["x2"] } })).toBe("fingerprint");
  });

  it("debounces dependency edits like source edits", () => {
    expect(debounceFor("deps", { specs: [] })).toBe(800);
    expect(debounceFor("deps", { specs: [], providerCost: "cheap" })).toBe(150);
  });

  it("keys inputs by dependency heads too, and a dependency move is never 'contested'", () => {
    expect(inputsKey({ params: {} }, { heads: ["a"], deps: {} })).toBe("{}|h:a");
    expect(inputsKey({ params: {} }, { heads: ["a"], deps: { "automerge:b": ["y", "x"] } })).toBe("{}|h:a|d:automerge:b=x,y");
    expect(builtInputsKey({ paramsKey: "{}", heads: ["a"] })).toBe("{}|a");
    expect(builtInputsKey({ paramsKey: "{}", heads: ["a"], deps: { "automerge:b": ["x"] } })).toBe("{}|a|d:automerge:b=x");
    const r = withDeps({ "automerge:a": ["x"] }, "v2");
    const mine = builtInputsKey(r.builtFrom);
    expect(isContested(r, { heads: ["s"], fingerprint: "v1", deps: { "automerge:a": ["x"] } }, mine)).toBe(true);
    expect(isContested(r, { heads: ["s"], fingerprint: "v1", deps: { "automerge:a": ["x2"] } }, mine)).toBe(false);
  });

  it("normalises and compares deps maps", () => {
    expect(normalizeDeps({ "automerge:b": ["2", "1"], "automerge:a": null, bad: "x" })).toEqual({ "automerge:a": [], "automerge:b": ["1", "2"] });
    expect(sameDeps(undefined, {})).toBe(true);
    expect(sameDeps({ u: ["a", "b"] }, { u: ["b", "a"] })).toBe(true);
    expect(depsKey({})).toBe("");
  });
});

describe("peers that disagree about dependencies", () => {
  const withDeps = (deps, fingerprint = null) => ({ params: {}, builtFrom: { heads: ["s"], fingerprint, paramsKey: "{}", deps } });
  it("is contested when we'd build exactly what we last built and a peer recorded other deps", () => {
    // we built with no deps (a provider without dependencies()); a newer peer recorded one
    const mine = currentInputsKey({ params: {} }, { heads: ["s"], deps: {} });
    const r = withDeps({ "automerge:x": ["x1"] }, "scad1:");
    expect(staleReason(r, { heads: ["s"], fingerprint: "scad1:", deps: {} })).toBe("deps");
    expect(isContested(r, { heads: ["s"], fingerprint: "scad1:", deps: {} }, mine)).toBe(true);
    // ...and from the other side
    const theirs = currentInputsKey({ params: {} }, { heads: ["s"], deps: { "automerge:x": ["x1"] } });
    expect(isContested(withDeps({}, "scad1:"), { heads: ["s"], fingerprint: "scad1:", deps: { "automerge:x": ["x1"] } }, theirs)).toBe(true);
  });
  it("is contested when a peer is ahead of us on a dependency, not when we moved it ourselves", () => {
    const mine = currentInputsKey({ params: {} }, { heads: ["s"], deps: { "automerge:x": ["x1"] } });
    const r = withDeps({ "automerge:x": ["x2"] });
    expect(isContested(r, { heads: ["s"], deps: { "automerge:x": ["x1"] } }, mine)).toBe(true); // we're behind: wait
    expect(isContested(withDeps({ "automerge:x": ["x1"] }), { heads: ["s"], deps: { "automerge:x": ["x3"] } }, mine)).toBe(false);
  });
  it("covers a fingerprint war where the deps differ too", () => {
    const mine = currentInputsKey({ params: {} }, { heads: ["s"], deps: {} });
    const r = withDeps({ "automerge:x": ["x1"] }, "v2");
    expect(staleReason(r, { heads: ["s"], fingerprint: "v1", deps: {} })).toBe("fingerprint");
    expect(isContested(r, { heads: ["s"], fingerprint: "v1", deps: {} }, mine)).toBe(true);
  });
  it("never contests the source moving", () => {
    const mine = currentInputsKey({ params: {} }, { heads: ["s"], deps: {} });
    expect(isContested(withDeps({ "automerge:x": ["x1"] }), { heads: ["s2"], deps: {} }, mine)).toBe(false);
  });
  it("heldDeps: recorded with heads, listed here, not loaded here", () => {
    const built = { "automerge:a": ["a1"], "automerge:b": [], "automerge:c": ["c1"], "automerge:d": ["d1"] };
    const cur = { "automerge:a": [], "automerge:b": [], "automerge:c": ["c2"] };
    const loaded = (u) => u === "automerge:c";
    expect(heldDeps(built, cur, loaded)).toEqual(["automerge:a"]);
    expect(heldDeps(undefined, cur, loaded)).toEqual([]);
  });
});
