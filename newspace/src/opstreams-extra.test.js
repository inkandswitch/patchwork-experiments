import { describe, it, expect } from "vitest";
import { getHeads, splice as amSplice } from "@automerge/automerge";
import { makeRepo, flush } from "./test-harness.js";
import {
  Opstream,
  Source,
  transform,
  automergeOpstream,
  opstreamToSignal,
  snapshot,
  isSnapshot,
  splice,
  set,
} from "./opstreams.js";

async function makeDoc(repo, initial) {
  const handle = repo.create();
  handle.change((d) => Object.assign(d, initial));
  await flush();
  return handle;
}

// ── automergeOpstream pinned at heads — read-only is the ABSENCE of apply ─────
describe("automergeOpstream { heads } — read-only via missing apply", () => {
  it("freezes the value at the given heads and has no apply method", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "hello" });
    const pinnedHeads = getHeads(handle.doc());

    const s = automergeOpstream(handle, { path: ["content"], heads: pinnedHeads });
    expect(s.value).toBe("hello");
    expect(s.apply).toBeUndefined(); // read-only is feature-detected by absence

    // mutate the live doc; the pinned stream stays frozen at the old heads
    handle.change((d) => amSplice(d, ["content"], 0, 0, "X"));
    await flush();
    expect(handle.doc().content).toBe("Xhello"); // live doc moved
    expect(s.value).toBe("hello"); // pinned stream did NOT
  });

  it("connect delivers exactly one frozen snapshot and never streams further", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "abc" });
    const heads = getHeads(handle.doc());
    const s = automergeOpstream(handle, { path: ["content"], heads });

    const seen = [];
    const off = s.connect((o) => seen.push(o));
    expect(seen).toEqual([snapshot("abc")]); // one snapshot on connect

    handle.change((d) => amSplice(d, ["content"], 1, 0, "Z"));
    await flush();
    expect(seen).toEqual([snapshot("abc")]); // frozen — no further emits
    off(); // unsubscribe is a no-op but must be callable
  });

  it("carries heads in its complement (alongside automerge metadata)", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "hi", extra: 9 });
    const heads = getHeads(handle.doc());
    const s = automergeOpstream(handle, { path: ["content"], heads, tag: "snap" });
    expect(s.complement).toMatchObject({
      automerge: true,
      path: ["content"],
      heads,
      tag: "snap",
    });
    expect(s.complement.handle).toBe(handle);
  });

  it("a live (unpinned) stream IS writable — apply is present", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "go" });
    const live = automergeOpstream(handle, { path: ["content"] });
    expect(typeof live.apply).toBe("function"); // writable: apply present
    live.apply(splice([], 0, 0, "let's "));
    await flush();
    expect(handle.doc().content).toBe("let's go");
  });
});

// ── transform: map forwarding (a→a / a→many) vs recompute ────────────────────
describe("transform map mode — op forwarding", () => {
  it("map may return an ARRAY of ops, all forwarded in order", () => {
    const src = new Opstream("ab");
    const fanout = transform(src, {
      // for each source op, forward it twice (proves array fan-out)
      map: (o) => [o, set([], "echoed", true)],
    });
    const seen = [];
    fanout.connect((o) => seen.push(o));
    const beforeCount = seen.length; // the connect snapshot
    src.apply(splice([], 0, 0, "z"));
    const forwarded = seen.slice(beforeCount);
    expect(forwarded).toHaveLength(2);
    expect(forwarded[0]).toEqual(splice([], 0, 0, "z")); // original op survives
    expect(forwarded[1]).toEqual(set([], "echoed", true)); // second op too
  });

  it("connect always opens with a projected snapshot even in map mode", () => {
    const src = new Opstream("hi");
    const t = transform(src, { value: (v) => v.toUpperCase(), map: (o) => o });
    const seen = [];
    t.connect((o) => seen.push(o));
    expect(seen[0]).toEqual(snapshot("HI")); // projected snapshot first
  });

  it("a source SNAPSHOT is re-projected (not forwarded raw) even in map mode", () => {
    const src = new Opstream("ab");
    const t = transform(src, { value: (v) => v.length, map: (o) => o });
    const seen = [];
    t.connect((o) => seen.push(o));
    src.apply(snapshot("abcd")); // source replaces whole value
    expect(t.value).toBe(4);
    expect(seen.at(-1)).toEqual(snapshot(4)); // snapshot path re-projects, ignores map
  });
});

describe("transform recompute mode — value tracking", () => {
  it("reflects the latest projection through .value without connecting", () => {
    const src = new Opstream({ n: 1 });
    const t = transform(src, { value: (v) => v.n * 2 });
    expect(t.value).toBe(2);
    src.apply(set([], "n", 5));
    expect(t.value).toBe(10); // .value recomputes lazily off the source
  });

  it("disconnect detaches from the source so further ops do not propagate", () => {
    const src = new Opstream("a");
    const t = transform(src, { value: (v) => v.length });
    const seen = [];
    t.connect((o) => seen.push(o));
    const before = seen.length;
    t.disconnect(); // tear down the source subscription
    src.apply(splice([], 1, 1, "bcd"));
    expect(seen.length).toBe(before); // nothing arrived after disconnect
  });
});

// ── complement passthrough carrying functions across a chain ─────────────────
describe("complement passthrough across a transform chain", () => {
  it("a function capability survives MULTIPLE chained passthrough lenses", () => {
    const calls = [];
    const src = new Opstream("WORD", {
      complement: { save: (v) => calls.push(v), meta: "x" },
    });
    const lower = transform(src, { value: (v) => v.toLowerCase() }); // passthrough
    const trimmed = transform(lower, { value: (v) => v.trim() }); // passthrough again
    expect(typeof trimmed.complement.save).toBe("function"); // function reached the end
    expect(trimmed.complement.meta).toBe("x");
    trimmed.complement.save("ok");
    expect(calls).toEqual(["ok"]); // and it still invokes the original
  });

  it("extending the complement at one link still preserves upstream functions", () => {
    const cap = () => 42;
    const src = new Opstream("x", { complement: { cap } });
    const mid = transform(src, { complement: { added: true } }); // EXTEND
    const end = transform(mid, { value: (v) => v }); // passthrough of the extended
    expect(end.complement.cap).toBe(cap); // original function reference intact
    expect(end.complement.added).toBe(true); // extension carried onward
  });

  it("a later link may OVERRIDE an inherited complement key", () => {
    const src = new Opstream("x", { complement: { role: "src" } });
    const t = transform(src, { complement: { role: "view" } });
    expect(t.complement.role).toBe("view"); // spec wins on key collision
  });
});

// ── Source: read-only output port, COW-style snapshot-on-connect ─────────────
describe("Source — snapshot on connect + push", () => {
  it("late subscribers get a snapshot of the CURRENT value, not the initial", () => {
    const out = new Source(1);
    out.push(2);
    out.push(3);
    const seen = [];
    out.connect((o) => seen.push(o)); // subscribe after two pushes
    expect(seen[0]).toEqual(snapshot(3)); // current value, snapshot-on-connect
  });

  it("push wraps the value in a snapshot op for all subscribers", () => {
    const out = new Source("a");
    const seen = [];
    out.connect((o) => seen.push(o));
    out.push("b");
    expect(seen.map((o) => o.type)).toEqual(["snapshot", "snapshot"]);
    expect(seen.at(-1)).toEqual(snapshot("b"));
    expect(isSnapshot(seen.at(-1))).toBe(true);
  });

  it("unsubscribe stops delivery", () => {
    const out = new Source(0);
    const seen = [];
    const off = out.connect((o) => seen.push(o.value));
    off();
    out.push(99);
    expect(seen).toEqual([0]); // only the connect snapshot
  });
});

// ── Opstream apply COW: input objects are not mutated in place ────────────────
describe("Opstream apply — copy-on-write value identity", () => {
  it("an apply produces a NEW value object, sharing untouched subtrees", () => {
    const initial = { a: { x: 1 }, keep: { deep: true } };
    const s = new Opstream(initial);
    s.apply(set(["a"], "y", 2));
    expect(s.value).not.toBe(initial); // new root
    expect(initial).toEqual({ a: { x: 1 }, keep: { deep: true } }); // input untouched
    expect(s.value.keep).toBe(initial.keep); // untouched branch shared
    expect(s.value.a).toEqual({ x: 1, y: 2 });
  });

  it("connect snapshot carries the LIVE value reference at connect time", () => {
    const v = { count: 0 };
    const s = new Opstream(v);
    let first;
    s.connect((o) => {
      if (first === undefined) first = o;
    });
    expect(first).toEqual(snapshot(v));
    expect(first.value).toBe(v); // snapshot wraps the actual current value
  });

  it("each apply bumps version monotonically", () => {
    const s = new Opstream("");
    expect(s.version).toBe(0);
    s.apply(splice([], 0, 0, "a"));
    s.apply(splice([], 1, 1, "b"));
    s.apply(snapshot("done")); // snapshots count too
    expect(s.version).toBe(3);
    expect(s.value).toBe("done");
  });
});

// ── opstreamToSignal outside a reactive root ─────────────────────────────────
describe("opstreamToSignal — dispose handle outside a root", () => {
  it("exposes a .dispose that detaches the connection when not in a root", () => {
    const src = new Opstream("a");
    const get = opstreamToSignal(src); // called OUTSIDE createRoot
    expect(get()).toBe("a");
    expect(typeof get.dispose).toBe("function");
    get.dispose(); // manual teardown
    src.apply(splice([], 0, 1, "Z"));
    expect(get()).toBe("a"); // no longer tracking after dispose
  });

  it("tracks a derived transform value while connected", () => {
    const src = new Opstream("xy");
    const len = transform(src, { value: (v) => v.length });
    const get = opstreamToSignal(len);
    expect(get()).toBe(2);
    src.apply(splice([], 2, 2, "zzz"));
    expect(get()).toBe(5); // recompute snapshot flowed through the signal
    get.dispose();
  });
});
