import { describe, it, expect } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { signalToOpstream, storeOpstream, createStoreOpstream } from "../src/solid-opstream.js";
import { snapshot, splice, set as setOp, isSnapshot } from "../src/ops.js";

// drain microtasks so Solid effects flush
// a macrotask flush — drains microtasks AND lets Solid's scheduler settle (a
// 2-microtask tick occasionally raced the effect under load → a flaky failure)
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("signalToOpstream", () => {
  it("snapshots on connect, then a fresh snapshot per signal change", async () => {
    await createRoot(async (dispose) => {
      const [get, set] = createSignal("a");
      const s = signalToOpstream(get);
      const seen = [];
      s.connect((o) => seen.push(o));
      expect(seen[0]).toEqual(snapshot("a")); // connect snapshot
      expect(s.value).toBe("a");

      set("b");
      await tick();
      expect(s.value).toBe("b");
      expect(seen[1]).toEqual(snapshot("b")); // change → snapshot
      expect(seen).toHaveLength(2); // no spurious initial-run emit
      dispose();
    });
  });

  it("tracks a derived accessor (memo-like fn)", async () => {
    await createRoot(async (dispose) => {
      const [n, setN] = createSignal(2);
      const s = signalToOpstream(() => n() * 10);
      const seen = [];
      s.connect((o) => seen.push(o));
      expect(seen[0]).toEqual(snapshot(20));
      setN(3);
      await tick();
      expect(seen[1]).toEqual(snapshot(30));
      dispose();
    });
  });

  it("is read-only without a setter, writable with one", async () => {
    await createRoot(async (dispose) => {
      const [get] = createSignal("x");
      expect(signalToOpstream(get).apply).toBeUndefined();

      const [g, setG] = createSignal("hello");
      const s = signalToOpstream(g, { set: setG });
      const seen = [];
      s.connect((o) => seen.push(o));
      s.apply(splice([], 0, 1, "J")); // COW patch + write-back
      await tick();
      expect(g()).toBe("Jello");
      expect(s.value).toBe("Jello");
      expect(seen.at(-1)).toEqual(snapshot("Jello")); // one outgoing op via the effect
      dispose();
    });
  });
});

describe("storeOpstream — granular ops out", () => {
  it("a path-set becomes one universal op (path/range/value)", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore({ user: { name: "ann" }, list: [1, 2] });
      const [s, set] = storeOpstream(store, setStore);
      const seen = [];
      s.connect((o) => seen.push(o));
      expect(seen[0]).toEqual(snapshot({ user: { name: "ann" }, list: [1, 2] }));

      set("user", "name", "bob");
      expect(store.user.name).toBe("bob");
      expect(seen[1]).toEqual(setOp(["user"], "name", "bob"));

      set("list", 0, 9);
      expect(seen[2]).toEqual(setOp(["list"], 0, 9));
      dispose();
    });
  });

  it("a functional updater resolves to the post-set value, no proxy leaks", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore({ count: 1 });
      const [s, set] = storeOpstream(store, setStore);
      const seen = [];
      s.connect((o) => seen.push(o));
      set("count", (c) => c + 4);
      expect(seen[1]).toEqual(setOp([], "count", 5));
      dispose();
    });
  });

  it("a whole-root / produce set falls back to a snapshot", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore({ a: 1 });
      const [s, set] = storeOpstream(store, setStore);
      const seen = [];
      s.connect((o) => seen.push(o));
      set({ a: 2 }); // merge form → not one op
      expect(isSnapshot(seen[1])).toBe(true);
      expect(seen[1].value).toEqual({ a: 2 });
      dispose();
    });
  });
});

describe("storeOpstream — ops in, reconciled granularly", () => {
  it("apply patches the store and emits the op (no echo)", () => {
    createRoot((dispose) => {
      const [s, set, store] = createStoreOpstream({ user: { name: "ann" }, list: [1, 2] });
      const seen = [];
      s.connect((o) => seen.push(o));

      s.apply(setOp(["user"], "name", "zoe"));
      expect(store.user.name).toBe("zoe"); // reconciled into the live store
      expect(seen.at(-1)).toEqual(setOp(["user"], "name", "zoe"));

      // apply uses the RAW setter → it must NOT re-enter the wrapped `set`/echo.
      const before = seen.length;
      s.apply(splice(["list"], 0, 1, [7]));
      expect(unwrap(store).list).toEqual([7, 2]);
      expect(seen.length).toBe(before + 1); // exactly one emit, not two
      dispose();
    });
  });

  it("snapshot apply replaces the whole value", () => {
    createRoot((dispose) => {
      const [s, , store] = createStoreOpstream({ a: 1, b: 2 });
      s.apply(snapshot({ a: 9 }));
      expect(unwrap(store)).toEqual({ a: 9 });
      dispose();
    });
  });
});
