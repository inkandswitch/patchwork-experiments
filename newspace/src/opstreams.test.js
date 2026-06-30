import { describe, it, expect } from "vitest";
import { createRoot } from "solid-js";
import { splice as amSplice } from "@automerge/automerge";
import { makeRepo, flush } from "./test-harness.js";
import {
  Opstream,
  Source,
  transform,
  automergeOpstream,
  fileTextOpstream,
  opstreamToSignal,
  apply,
  snapshot,
  op,
  splice,
  set,
} from "./opstreams.js";

async function makeDoc(repo, initial) {
  const handle = repo.create();
  handle.change((d) => Object.assign(d, initial));
  await flush();
  return handle;
}

// ── the one universal op covers text / bytes / json ──────────────────────────

describe("apply — one op for everything", () => {
  it("splices a string (insert, delete, replace)", () => {
    expect(apply("hello", splice([], 2, 2, "XX"))).toBe("heXXllo"); // insert
    expect(apply("hello", splice([], 1, 3, ""))).toBe("hlo"); // delete
    expect(apply("hello", splice([], 0, 1, "J"))).toBe("Jello"); // replace
  });

  it("a STRING-valued splice into undefined/null stays a STRING (not an array)", () => {
    // an unwired text buffer starts as Opstream(undefined); its first keystroke must keep it
    // text. Without this the codemirror `text` outlet became an array of characters.
    expect(apply(undefined, splice([], 0, 0, "hi"))).toBe("hi");
    expect(apply(null, splice([], 0, 0, "a"))).toBe("a");
    expect(apply(apply(undefined, splice([], 0, 0, "ho")), splice([], 2, 2, "la"))).toBe("hola");
  });

  it("splices bytes — and GROWS / SHRINKS (the old BytesOp couldn't)", () => {
    const b = Uint8Array.from([1, 2, 3]);
    const grown = apply(b, splice([], 1, 1, Uint8Array.from([9, 9]))); // insert 2
    expect(Array.from(grown)).toEqual([1, 9, 9, 2, 3]);
    const shrunk = apply(b, splice([], 0, 2, Uint8Array.from([7]))); // 2→1
    expect(Array.from(shrunk)).toEqual([7, 3]);
  });

  it("splices a nested list", () => {
    const v = { items: ["a", "b", "c"] };
    expect(apply(v, splice(["items"], 1, 2, ["B"]))).toEqual({ items: ["a", "B", "c"] });
  });

  it("assigns and deletes object keys", () => {
    expect(apply({ a: 1 }, set([], "b", 2))).toEqual({ a: 1, b: 2 });
    expect(apply({ user: { a: 1 } }, set(["user"], "name", "bob"))).toEqual({
      user: { a: 1, name: "bob" },
    });
    expect(apply({ a: 1, b: 2 }, op([], "b", undefined))).toEqual({ a: 1 }); // delete
  });
});

describe("apply is copy-on-write", () => {
  it("does not mutate the input; shares untouched subtrees, copies the touched path", () => {
    const before = { a: { x: 1 }, keep: { deep: true } };
    const after = apply(before, set(["a"], "y", 9));
    expect(before).toEqual({ a: { x: 1 }, keep: { deep: true } }); // input untouched
    expect(after.keep).toBe(before.keep); // untouched branch shared by reference
    expect(after.a).not.toBe(before.a); // touched branch copied
    expect(after.a).toEqual({ x: 1, y: 9 });
  });
});

describe("Opstream.connect / apply", () => {
  it("delivers a snapshot first, then streams ops, and bumps version", () => {
    const s = new Opstream("hello");
    const seen = [];
    const off = s.connect((o) => seen.push(o));
    expect(seen[0]).toEqual(snapshot("hello"));
    s.apply(splice([], 0, 1, "J"));
    expect(s.value).toBe("Jello");
    expect(seen[1]).toEqual(splice([], 0, 1, "J"));
    expect(s.version).toBe(1);
    off();
    s.apply(splice([], 0, 0, "x"));
    expect(seen.length).toBe(2); // unsubscribed
  });

  it("a snapshot op replaces the whole value", () => {
    const s = new Opstream({ a: 1 });
    s.apply(snapshot({ b: 2 }));
    expect(s.value).toEqual({ b: 2 });
  });
});

describe("complement", () => {
  it("an opstream carries its complement", () => {
    const s = new Opstream("x", { complement: { saveable: true, foo: 1 } });
    expect(s.complement).toEqual({ saveable: true, foo: 1 });
  });

  it("passes through a transform that ignores it — including FUNCTION capabilities", () => {
    let saved = null;
    const src = new Opstream("HELLO", {
      complement: { save: (v) => (saved = v), k: 1 }, // a capability is a function
    });
    const lower = transform(src, { value: (v) => v.toLowerCase() }); // no complement in spec
    expect(lower.value).toBe("hello");
    expect(lower.complement.k).toBe(1);
    expect(typeof lower.complement.save).toBe("function"); // the function survived the lens
    lower.complement.save("x"); // and it still works
    expect(saved).toBe("x");
  });

  it("a transform may extend the complement without dropping inherited keys", () => {
    const src = new Opstream("x", { complement: { saveable: true } });
    const t = transform(src, { value: (v) => v, complement: { tagged: true } });
    expect(t.complement).toEqual({ saveable: true, tagged: true });
  });
});

describe("transform: the two lens modes", () => {
  it("(b) recompute — omitting map re-snapshots the projected value", () => {
    const src = new Opstream("ab");
    const len = transform(src, { value: (v) => v.length });
    const seen = [];
    len.connect((o) => seen.push(o));
    expect(len.value).toBe(2);
    src.apply(splice([], 2, 2, "cd"));
    expect(len.value).toBe(4);
    expect(seen.at(-1)).toEqual(snapshot(4)); // a fresh op describing the new state
  });

  it("(a) map-the-op — map forwards a transformed op, preserving granularity", () => {
    const src = new Opstream("abc");
    // identity lens that FORWARDS the op (not a snapshot) — proves the op survives
    const echo = transform(src, { map: (o) => o });
    const seen = [];
    echo.connect((o) => seen.push(o));
    src.apply(splice([], 1, 1, "X"));
    const last = seen.at(-1);
    expect(last.type).toBeUndefined(); // an op, NOT a snapshot
    expect(last).toEqual(splice([], 1, 1, "X")); // granularity preserved
  });

  it("(a) map returning null drops the op", () => {
    const src = new Opstream("abc");
    const drop = transform(src, { map: () => null });
    const seen = [];
    drop.connect((o) => seen.push(o));
    const beforeCount = seen.length;
    src.apply(splice([], 0, 0, "z"));
    expect(seen.length).toBe(beforeCount); // nothing forwarded
  });
});

describe("Source (read-only output port)", () => {
  it("emits snapshots on push and has no apply", () => {
    const out = new Source(1, { complement: { port: "outlet" } });
    expect(out.apply).toBeUndefined();
    const seen = [];
    out.connect((o) => seen.push(o.value));
    out.push(2);
    expect(seen).toEqual([1, 2]);
    expect(out.complement.port).toBe("outlet");
  });
});

describe("automergeOpstream (generic bridge — ANY shape)", () => {
  it("streams a scoped text field and carries the automerge complement", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "hi", title: "t" });
    const s = automergeOpstream(handle, { path: ["content"] });
    expect(s.value).toBe("hi");
    expect(s.complement).toMatchObject({ automerge: true, path: ["content"] });
    expect(s.complement.handle).toBe(handle);
  });

  it("apply(op) splices scoped text, leaving the rest of the doc alone", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "hello", keep: 1 });
    const s = automergeOpstream(handle, { path: ["content"] });
    s.apply(splice([], 0, 1, "H"));
    await flush();
    expect(handle.doc().content).toBe("Hello");
    expect(handle.doc().keep).toBe(1);
  });

  it("streams the WHOLE doc and applies object/list ops", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { title: "t", items: ["a", "b"] });
    const s = automergeOpstream(handle); // path: []
    expect(s.value).toMatchObject({ title: "t", items: ["a", "b"] });
    s.apply(set([], "title", "T2")); // object assign
    s.apply(splice(["items"], 1, 2, ["B"])); // list splice (replace index 1)
    await flush();
    expect(handle.doc().title).toBe("T2");
    expect(handle.doc().items.map(String)).toEqual(["a", "B"]); // am3 wraps list strings

  });

  it("remote text edits arrive as ops (cursor-stable), not just snapshots", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "abc" });
    const s = automergeOpstream(handle, { path: ["content"] });
    const ops = [];
    s.connect((o) => ops.push(o));
    handle.change((d) => amSplice(d, ["content"], 1, 0, "X"));
    await flush();
    expect(ops.some((o) => !o.type && Array.isArray(o.range))).toBe(true);
    expect(s.value).toBe("aXbc");
  });

  it("remote object edits arrive as ops on the whole-doc stream", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { n: 1 });
    const s = automergeOpstream(handle);
    const ops = [];
    s.connect((o) => ops.push(o));
    handle.change((d) => (d.flag = true));
    await flush();
    expect(ops.some((o) => o.range === "flag" && o.value === true)).toBe(true);
  });

  it("ignores sibling changes outside a scoped path (no spurious emits)", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "x", other: 1 });
    const s = automergeOpstream(handle, { path: ["content"] });
    const ops = [];
    s.connect((o) => ops.push(o));
    const before = ops.length;
    handle.change((d) => (d.other = 2)); // sibling
    await flush();
    expect(ops.length).toBe(before); // nothing emitted for the scoped stream
  });
});

describe("fileTextOpstream convenience", () => {
  it("scopes to content and carries file metadata (no save — automerge auto-persists)", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, {
      content: "hi",
      mimeType: "text/markdown",
      name: "n.md",
      extension: "md",
    });
    const s = fileTextOpstream(handle);
    expect(s.value).toBe("hi");
    expect(s.complement).toMatchObject({
      automerge: true,
      path: ["content"],
      mimeType: "text/markdown",
      name: "n.md",
      extension: "md",
    });
    expect(s.complement.save).toBeUndefined(); // auto-persisted ⇒ no save capability
  });

  it("a caller can supply a save() capability via meta, and it rides the complement", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "hi" });
    let savedWith = null;
    const s = fileTextOpstream(handle, { save: () => (savedWith = s.value) });
    expect(typeof s.complement.save).toBe("function");
    s.complement.save();
    expect(savedWith).toBe("hi");
  });
});

describe("opstreamToSignal (outer Solid wrapper)", () => {
  it("tracks the opstream value reactively", () => {
    const src = new Opstream("a");
    createRoot((dispose) => {
      const text = opstreamToSignal(src);
      expect(text()).toBe("a");
      src.apply(splice([], 0, 1, "A"));
      expect(text()).toBe("A");
      dispose();
    });
  });
});
