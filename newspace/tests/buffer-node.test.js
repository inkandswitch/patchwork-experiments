import { describe, it, expect } from "vitest";
import {
  pushCapped,
  recap,
  capSize,
  mountBuffer,
  plugin,
  DEFAULT_SIZE,
} from "../src/buffer-node.js";

// ── a controllable fake opstream (opstream-like) ─────────────────────────────
// connect(cb) fires immediately with the current snapshot, then on each push().
function fakeStream(initial) {
  const subs = new Set();
  return {
    value: initial,
    connect(cb) {
      cb({ type: "snapshot", value: this.value });
      subs.add(cb);
      return () => subs.delete(cb);
    },
    apply() {},
    // test helpers (not part of the opstream contract)
    push(v) { this.value = v; for (const cb of subs) cb({ type: "snapshot", value: v }); },
    bang() { for (const cb of subs) cb({ type: "snapshot", value: this.value }); },
  };
}

describe("pushCapped (pure)", () => {
  it("appends to the tail, preserving order", () => {
    let a = [];
    a = pushCapped(a, 1, 16);
    a = pushCapped(a, 2, 16);
    a = pushCapped(a, 3, 16);
    expect(a).toEqual([1, 2, 3]);
  });

  it("caps to the LAST n (FIFO, oldest dropped)", () => {
    let a = [];
    for (const v of [1, 2, 3, 4, 5]) a = pushCapped(a, v, 3);
    expect(a).toEqual([3, 4, 5]);
  });

  it("returns a NEW array (no mutation of input)", () => {
    const a = [1, 2];
    const b = pushCapped(a, 3, 16);
    expect(a).toEqual([1, 2]);
    expect(b).toEqual([1, 2, 3]);
    expect(b).not.toBe(a);
  });

  it("n <= 0 yields empty", () => {
    expect(pushCapped([1, 2], 3, 0)).toEqual([]);
  });

  it("tolerates a non-array seed", () => {
    expect(pushCapped(undefined, 7, 4)).toEqual([7]);
  });
});

describe("recap (pure)", () => {
  it("re-caps to the last n when size shrinks", () => {
    expect(recap([1, 2, 3, 4, 5], 2)).toEqual([4, 5]);
  });
  it("leaves a shorter array untouched", () => {
    expect(recap([1, 2], 5)).toEqual([1, 2]);
  });
  it("n <= 0 yields empty", () => {
    expect(recap([1, 2, 3], 0)).toEqual([]);
  });
});

describe("capSize (pure)", () => {
  it("defaults to DEFAULT_SIZE for non-numbers", () => {
    expect(capSize(undefined)).toBe(DEFAULT_SIZE);
    expect(capSize("nope")).toBe(DEFAULT_SIZE);
    expect(DEFAULT_SIZE).toBe(16);
  });
  it("floors and clamps to >= 0", () => {
    expect(capSize(3.9)).toBe(3);
    expect(capSize(-5)).toBe(0);
    expect(capSize("8")).toBe(8);
  });
});

describe("mountBuffer", () => {
  it("buffers FIFO from the `in` inlet, emitting the current array", () => {
    const element = document.createElement("div");
    const input = fakeStream(undefined);
    let out;
    const cleanup = mountBuffer({
      element,
      inlets: { in: input },
      setOutlet: (_n, s) => { out = s; },
      config: { size: 3 },
    });
    expect(out.value).toEqual([]); // initial undefined snapshot is skipped
    input.push(1);
    input.push(2);
    input.push(3);
    input.push(4);
    expect(out.value).toEqual([2, 3, 4]); // capped at 3
    cleanup();
  });

  it("a bang on `reset` clears to empty", () => {
    const element = document.createElement("div");
    const input = fakeStream(undefined);
    const reset = fakeStream(null);
    let out;
    const cleanup = mountBuffer({
      element,
      inlets: { in: input, reset },
      setOutlet: (_n, s) => { out = s; },
      config: { size: 8 },
    });
    input.push("a");
    input.push("b");
    expect(out.value).toEqual(["a", "b"]);
    reset.bang(); // the connect snapshot is skipped; this is a real edge
    expect(out.value).toEqual([]);
    cleanup();
  });

  it("shrinking the size field re-caps the buffer", () => {
    const element = document.createElement("div");
    const input = fakeStream(undefined);
    let out;
    let savedConfig;
    const cleanup = mountBuffer({
      element,
      inlets: { in: input },
      setOutlet: (_n, s) => { out = s; },
      config: { size: 10 },
      setConfig: (c) => { savedConfig = c; },
    });
    for (const v of [1, 2, 3, 4, 5]) input.push(v);
    expect(out.value).toEqual([1, 2, 3, 4, 5]);
    const field = element.querySelector(".ns-buffer-size");
    expect(field).toBeTruthy();
    field.value = "2";
    field.onchange();
    expect(savedConfig).toEqual({ size: 2 });
    expect(out.value).toEqual([4, 5]); // re-capped to the last 2
    cleanup();
  });

  it("reads config.size at mount and defaults when absent", () => {
    const element = document.createElement("div");
    const cleanup = mountBuffer({ element, inlets: {}, setOutlet: () => {}, config: {} });
    const field = element.querySelector(".ns-buffer-size");
    expect(field.value).toBe(String(DEFAULT_SIZE));
    cleanup();
  });
});

describe("plugin descriptor", () => {
  it("has the expected shape", () => {
    expect(plugin.type).toBe("sketchy:window");
    expect(plugin.id).toBe("buffer");
    expect(plugin.name).toBe("Buffer");
    expect(plugin.icon).toBe("List");
    expect(plugin.inlets.map((i) => i.name)).toEqual(["in", "reset"]);
    expect(plugin.inlets.find((i) => i.name === "reset").type).toBe("bang");
    expect(plugin.outlets).toHaveLength(1);
    expect(plugin.outlets[0].name).toBe("out");
    expect(plugin.outlets[0].type).toBe("json");
  });

  it("load() returns the mount function", async () => {
    expect(await plugin.load()).toBe(mountBuffer);
  });
});
