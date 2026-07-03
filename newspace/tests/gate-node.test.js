import { describe, it, expect } from "vitest";
import { plugin, onBang, makeHold, inletValue } from "../src/gate-node.js";

// A fake opstream: emits an initial snapshot on connect, then lets the test drive
// later edges via push(). Mirrors the real connect(cb)->off contract.
function fakeStream(initial) {
  let value = initial;
  const subs = new Set();
  return {
    get value() { return value; },
    connect(cb) {
      subs.add(cb);
      cb({ type: "snapshot", value });
      return () => subs.delete(cb);
    },
    apply() {},
    // test driver: change value and notify (a real edge, post-initial)
    push(v) {
      value = v;
      for (const cb of subs) cb({ type: "snapshot", value });
    },
  };
}

describe("plugin descriptor", () => {
  it("has the gate spec", () => {
    expect(plugin.type).toBe("sketchy:window");
    expect(plugin.id).toBe("gate");
    expect(plugin.name).toBe("Gate");
    expect(plugin.icon).toBe("DoorOpen");
    expect(plugin.inlets.map((i) => i.name)).toEqual(["in", "bang"]);
    expect(plugin.inlets[1].type).toBe("bang");
    expect(plugin.outlets[0].name).toBe("out");
  });
});

describe("makeHold", () => {
  it("starts empty with no initial", () => {
    const h = makeHold();
    expect(h.hasValue()).toBe(false);
    expect(h.read()).toBe(undefined);
  });
  it("holds the latest set value", () => {
    const h = makeHold(1);
    expect(h.hasValue()).toBe(true);
    h.set(5);
    expect(h.read()).toBe(5);
    h.set(9);
    expect(h.read()).toBe(9);
  });
});

describe("onBang", () => {
  it("skips the initial connect callback, fires on later edges", () => {
    const s = fakeStream(0);
    let fired = 0;
    const off = onBang(s, () => fired++);
    expect(fired).toBe(0); // initial snapshot skipped
    s.push(1);
    expect(fired).toBe(1);
    s.push(2);
    expect(fired).toBe(2);
    off();
    s.push(3);
    expect(fired).toBe(2); // unsubscribed
  });
  it("tolerates a missing stream", () => {
    expect(typeof onBang(undefined, () => {})).toBe("function");
  });
});

describe("inletValue", () => {
  it("reads .value or undefined", () => {
    expect(inletValue({ value: 7 })).toBe(7);
    expect(inletValue(undefined)).toBe(undefined);
  });
});

async function mountGate(inlets) {
  const mount = await plugin.load();
  const element = document.createElement("div");
  let out = null;
  const cleanup = mount({ element, inlets, setOutlet: (name, src) => { if (name === "out") out = src; } });
  return { element, out, cleanup };
}

describe("gate mount behaviour", () => {
  it("does not emit on mount", async () => {
    const inn = fakeStream("a");
    const bang = fakeStream(false);
    const emitted = [];
    const { out, cleanup } = await mountGate({ in: inn, bang });
    out.connect((o) => emitted.push(o)); // first is the Source's own initial snapshot
    // only the initial connect snapshot, value still undefined — nothing passed
    expect(emitted.length).toBe(1);
    expect(emitted[0].value).toBe(undefined);
    cleanup();
  });

  it("in updates alone do not emit", async () => {
    const inn = fakeStream("a");
    const bang = fakeStream(false);
    const { out, cleanup } = await mountGate({ in: inn, bang });
    const after = [];
    out.connect(() => {}); // drain initial
    out.connect((o) => after.push(o.value));
    after.length = 0; // clear the connect-snapshot from this subscriber
    inn.push("b");
    inn.push("c");
    expect(after).toEqual([]); // never emitted without a bang
    cleanup();
  });

  it("a bang emits the current in", async () => {
    const inn = fakeStream("hello");
    const bang = fakeStream(false);
    const { out, cleanup } = await mountGate({ in: inn, bang });
    const seen = [];
    const off = out.connect((o) => seen.push(o.value));
    seen.length = 0; // drop initial connect snapshot
    bang.push(true);
    expect(seen).toEqual(["hello"]);
    off();
    cleanup();
  });

  it("repeated bangs re-emit the latest in", async () => {
    const inn = fakeStream(1);
    const bang = fakeStream(false);
    const { out, cleanup } = await mountGate({ in: inn, bang });
    const seen = [];
    out.connect((o) => seen.push(o.value));
    seen.length = 0;
    bang.push(true);          // emit current in = 1
    inn.push(2);              // held, no emit
    bang.push(true);          // emit current in = 2
    inn.push(3);
    inn.push(4);              // held
    bang.push(true);          // emit current in = 4
    expect(seen).toEqual([1, 2, 4]);
    cleanup();
  });

  it("with no bang inlet wired, never emits", async () => {
    const inn = fakeStream("x");
    const { out, cleanup } = await mountGate({ in: inn });
    const seen = [];
    out.connect((o) => seen.push(o.value));
    seen.length = 0;
    inn.push("y");
    expect(seen).toEqual([]);
    cleanup();
  });
});
