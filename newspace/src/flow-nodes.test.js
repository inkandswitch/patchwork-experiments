import { describe, it, expect } from "vitest";
import { mountCounter, mountSample } from "./flow-nodes.js";
import { Source } from "./opstreams.js";

describe("counter", () => {
  it("increments once per bang, skipping the initial connect snapshot", () => {
    const bang = new Source(0);
    let out;
    const cleanup = mountCounter({ element: document.createElement("div"), inlets: { bang }, setOutlet: (_n, s) => { out = s; } });
    expect(out.value).toBe(0);
    bang.push(1); // a bang
    bang.push(2); // another
    expect(out.value).toBe(2);
    cleanup();
  });

  it("+ increments, - decrements, reset zeroes, and persists to config", () => {
    const up = new Source(0), down = new Source(0), reset = new Source(0);
    let out, cfg = {};
    mountCounter({ element: document.createElement("div"), inlets: { "+": up, "-": down, reset }, setOutlet: (_n, s) => { out = s; }, setConfig: (p) => Object.assign(cfg, p) });
    up.push(1); up.push(2); // +2
    down.push(1);           // -1
    expect(out.value).toBe(1);
    expect(cfg.n).toBe(1);  // persisted
    reset.push(1);
    expect(out.value).toBe(0);
  });

  it("restores its count from config on (re)mount — wiring an inlet must not reset it", () => {
    let out;
    mountCounter({ element: document.createElement("div"), inlets: {}, setOutlet: (_n, s) => { out = s; }, config: { n: 41 } });
    expect(out.value).toBe(41);
  });
});

describe("sample & hold", () => {
  it("emits the current value only when triggered", () => {
    const value = new Source("a");
    const trigger = new Source(0);
    let out;
    const cleanup = mountSample({ element: document.createElement("div"), inlets: { value, trigger }, setOutlet: (_n, s) => { out = s; } });
    value.push("b"); // changes upstream, but no trigger yet
    expect(out.value).toBeUndefined();
    trigger.push(1); // bang → sample current value ("b")
    expect(out.value).toBe("b");
    value.push("c");
    expect(out.value).toBe("b"); // held until next trigger
    trigger.push(2);
    expect(out.value).toBe("c");
    cleanup();
  });
});
