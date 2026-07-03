import { describe, it, expect } from "vitest";
import { pick, mountSwitch, NAMES, plugin } from "../src/switch-node.js";

// A fake opstream: holds a value, fires connect callbacks immediately with the
// current snapshot, and `set()` mutates + re-notifies subscribers (so a mount can
// recompute on change).
function fakeStream(initial) {
  let value = initial;
  const subs = new Set();
  return {
    get value() { return value; },
    connect(cb) { subs.add(cb); cb({ type: "snapshot", value }); return () => subs.delete(cb); },
    apply(_op) {},
    set(v) { value = v; for (const cb of [...subs]) cb({ type: "snapshot", value }); },
  };
}

describe("pick", () => {
  it("selects by floored sel", () => {
    expect(pick(0, ["a", "b", "c"])).toBe("a");
    expect(pick(1, ["a", "b", "c"])).toBe("b");
    expect(pick(2, ["a", "b", "c"])).toBe("c");
    expect(pick(1.9, ["a", "b", "c"])).toBe("b");
  });
  it("clamps below and above range", () => {
    expect(pick(-5, ["a", "b", "c"])).toBe("a");
    expect(pick(99, ["a", "b", "c"])).toBe("c");
  });
  it("returns undefined for an empty array", () => {
    expect(pick(0, [])).toBeUndefined();
    expect(pick(2, [])).toBeUndefined();
  });
  it("treats non-finite sel as index 0", () => {
    expect(pick(NaN, ["a", "b"])).toBe("a");
    expect(pick(undefined, ["a", "b"])).toBe("a");
  });
});

describe("plugin descriptor", () => {
  it("has the expected shape", async () => {
    expect(plugin.id).toBe("switch");
    expect(plugin.name).toBe("Switch");
    expect(plugin.icon).toBe("ToggleLeft");
    expect(plugin.inlets.map((i) => i.name)).toEqual(["sel", ...NAMES]);
    expect(plugin.outlets.map((o) => o.name)).toEqual(["out"]);
    expect(await plugin.load()).toBe(mountSwitch);
  });
});

describe("mountSwitch", () => {
  it("emits the selected input and recomputes on sel change", () => {
    const sel = fakeStream(0);
    const a = fakeStream("alpha");
    const b = fakeStream("bravo");
    const c = fakeStream("charlie");
    const d = fakeStream("delta");
    const element = document.createElement("div");
    let out;
    const cleanup = mountSwitch({
      element,
      inlets: { sel, a, b, c, d },
      setOutlet: (_name, src) => { out = src; },
    });

    expect(out.value).toBe("alpha"); // sel=0 → a
    sel.set(2);
    expect(out.value).toBe("charlie"); // sel=2 → c
    sel.set(99);
    expect(out.value).toBe("delta"); // clamped → d

    cleanup();
  });

  it("recomputes when the selected input changes", () => {
    const sel = fakeStream(1);
    const a = fakeStream("a0");
    const b = fakeStream("b0");
    const element = document.createElement("div");
    let out;
    const cleanup = mountSwitch({
      element,
      inlets: { sel, a, b },
      setOutlet: (_n, s) => { out = s; },
    });
    expect(out.value).toBe("b0"); // sel=1 → b
    b.set("b1");
    expect(out.value).toBe("b1");
    a.set("a1"); // not selected — out stays
    expect(out.value).toBe("b1");
    cleanup();
  });
});
