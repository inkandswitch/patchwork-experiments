import { describe, it, expect } from "vitest";
import { mountJs } from "./js-node.js";
import { Source } from "./opstreams.js";
import { snapshot } from "./ops.js";

// capture the outlet a node registers
function capture() {
  let out = null;
  return { setOutlet: (_name, s) => { out = s; }, get out() { return out; } };
}

describe("mountJs", () => {
  it("defaults to passthrough (x)=>x: emits the input value to out", () => {
    const input = new Source(7);
    const c = capture();
    const cleanup = mountJs({ element: document.createElement("div"), inlets: { in: input }, setOutlet: c.setOutlet });
    expect(c.out).toBeTruthy();
    expect(c.out.value).toBe(7); // passthrough on initial recompute
    input.push(42);
    expect(c.out.value).toBe(42); // tracks upstream via connect
    cleanup();
  });

  it("uses the persisted config.code function transform to map the value", () => {
    const input = new Source(3);
    const c = capture();
    const cleanup = mountJs({
      element: document.createElement("div"),
      inlets: { in: input },
      setOutlet: c.setOutlet,
      config: { code: "(x) => x * 10" },
    });
    expect(c.out.value).toBe(30);
    input.push(5);
    expect(c.out.value).toBe(50);
    cleanup();
  });

  it("registers the textarea with the code and a ready status into element", () => {
    const input = new Source(1);
    const c = capture();
    const element = document.createElement("div");
    const cleanup = mountJs({
      element,
      inlets: { in: input },
      setOutlet: c.setOutlet,
      config: { code: "(x) => x + 1" },
    });
    const ta = element.querySelector("textarea");
    expect(ta).toBeTruthy();
    expect(ta.value).toBe("(x) => x + 1");
    const status = element.querySelector(".ns-source-status");
    expect(status.textContent).toBe("ready"); // function only → one-way "ready"
    cleanup();
  });

  it("editing the textarea recompiles, persists via setConfig, and recomputes", () => {
    const input = new Source(4);
    const c = capture();
    const element = document.createElement("div");
    let saved = null;
    const cleanup = mountJs({
      element,
      inlets: { in: input },
      setOutlet: c.setOutlet,
      setConfig: (cfg) => { saved = cfg; },
    });
    expect(c.out.value).toBe(4); // default passthrough
    const ta = element.querySelector("textarea");
    ta.value = "(x) => x - 1";
    ta.oninput();
    expect(saved).toEqual({ code: "(x) => x - 1" });
    expect(c.out.value).toBe(3); // recomputed against current input
    cleanup();
  });

  it("a { get, set } object installs out.apply that writes back through set to the source's apply", () => {
    const applied = [];
    // a minimal editable in-opstream: snapshot on connect, records ops on apply
    const input = {
      value: 100,
      connect(cb) { cb(snapshot(this.value)); return () => {}; },
      apply(op) { applied.push(op); },
    };
    const c = capture();
    const element = document.createElement("div");
    const cleanup = mountJs({
      element,
      inlets: { in: input },
      setOutlet: c.setOutlet,
      // get halves, set doubles the write-back
      config: { code: "({ get:(x)=>x/2, set:(y,x)=>y*2 })" },
    });
    expect(c.out.value).toBe(50); // get applied to 100
    expect(typeof c.out.apply).toBe("function"); // bidi installed because set + editable source
    const status = element.querySelector(".ns-source-status");
    expect(status.textContent).toBe("⇄ ready");

    // writing out via a snapshot flows back through set() to source.apply
    c.out.apply(snapshot(70));
    expect(applied.length).toBe(1);
    expect(applied[0]).toEqual(snapshot(140)); // set(70) => 70*2
    cleanup();
  });

  it("does not install out.apply when the source is not editable (no apply fn)", () => {
    const input = new Source(8); // Source has no `apply`
    const c = capture();
    const cleanup = mountJs({
      element: document.createElement("div"),
      inlets: { in: input },
      setOutlet: c.setOutlet,
      config: { code: "({ get:(x)=>x, set:(y)=>y })" },
    });
    expect(c.out.value).toBe(8);
    expect(c.out.apply).toBeUndefined(); // Source defines no apply, bidi skipped
    cleanup();
  });

  it("invalid code sets a status string and does not throw", () => {
    const input = new Source(1);
    const c = capture();
    const element = document.createElement("div");
    let err;
    let cleanup;
    expect(() => {
      cleanup = mountJs({
        element,
        inlets: { in: input },
        setOutlet: c.setOutlet,
        config: { code: "(x) => (" }, // syntax error
      });
    }).not.toThrow();
    const status = element.querySelector(".ns-source-status");
    expect(typeof status.textContent).toBe("string");
    expect(status.textContent.startsWith("⚠")).toBe(true);
    // no spec → out stays at its initial undefined, no emit
    expect(c.out.value).toBeUndefined();
    if (cleanup) cleanup();
  });

  it("code that is neither a function nor { get, set } sets a warning status", () => {
    const input = new Source(1);
    const c = capture();
    const element = document.createElement("div");
    const cleanup = mountJs({
      element,
      inlets: { in: input },
      setOutlet: c.setOutlet,
      config: { code: "42" }, // a number, not function/object-with-get
    });
    const status = element.querySelector(".ns-source-status");
    expect(status.textContent).toContain("want a function or { get, set }");
    expect(c.out.value).toBeUndefined();
    cleanup();
  });

  it("a throwing transform reports the error in status without throwing", () => {
    const input = new Source(1);
    const c = capture();
    const element = document.createElement("div");
    let cleanup;
    expect(() => {
      cleanup = mountJs({
        element,
        inlets: { in: input },
        setOutlet: c.setOutlet,
        config: { code: "(x) => { throw new Error('boom'); }" },
      });
    }).not.toThrow();
    const status = element.querySelector(".ns-source-status");
    expect(status.textContent).toContain("boom");
    if (cleanup) cleanup();
  });

  it("works with no inlet at all (passthrough of undefined) and cleans up the DOM", () => {
    const c = capture();
    const element = document.createElement("div");
    const cleanup = mountJs({ element, setOutlet: c.setOutlet });
    expect(c.out.value).toBeUndefined();
    expect(element.querySelector(".ns-js")).toBeTruthy();
    cleanup();
    expect(element.querySelector(".ns-js")).toBeNull(); // root removed
  });
});
