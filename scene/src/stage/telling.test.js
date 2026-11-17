// telling.js on its own, handed a clock, a scene and whether the extension
// still runs: what the stage's own tests can't easily reach. Each case is one
// row: what happens to a message while it waits (nothing, its extension
// stops, the stage is disposed), what `says` does (answers, throws), and
// what data comes (an object, or not).
import { describe, it, expect, vi, afterEach } from "vitest";
import { createTelling, TELL_MS } from "./telling.js";

afterEach(() => vi.restoreAllMocks());

/** A telling on a clock moved by hand; the doc "bears it out" once `scene.ok`. */
function rig({ says } = {}) {
  let t = 0;
  const timers = new Set();
  const scene = { ok: false };
  const told = [];
  const handed = []; // what `valid` was handed
  let running = true;
  const instance = {
    messages: {
      moved: {
        valid: (d) => (handed.push(d), typeof d.to === "number"),
        says: says ?? ((d, who, s) => (s.ok ? `${who.name} moved to ${d.to}` : null)),
      },
    },
  };
  const telling = createTelling({
    now: () => t,
    after(ms, fn) {
      const timer = { at: t + ms, fn };
      timers.add(timer);
      return () => timers.delete(timer);
    },
    scene: () => scene,
    notify: (text) => told.push(text),
    alive: (_ext, x) => running && x === instance,
  });
  const advance = (ms) => {
    t += ms;
    for (const timer of [...timers]) if (timer.at <= t && timers.delete(timer)) timer.fn();
  };
  const hear = (data) => telling.hear("t", instance, "moved", data, { session: "s", viewer: null });
  return { telling, scene, told, handed, timers, advance, hear, stop: () => (running = false) };
}

describe("a waiting message", () => {
  it("is told when the doc bears it out and its extension still runs", () => {
    const r = rig();
    r.hear({ to: 1 });
    expect(r.telling.waiting()).toBe(1);
    r.scene.ok = true;
    r.telling.ask();
    expect(r.told).toEqual(["Someone moved to 1"]);
    expect(r.telling.waiting()).toBe(0);
    expect(r.timers.size).toBe(0);
  });

  it("is forgotten, untold, once its extension has stopped (or another instance runs in its place)", () => {
    const r = rig();
    r.hear({ to: 1 });
    r.stop();
    r.scene.ok = true;
    r.telling.ask();
    expect(r.told).toEqual([]);
    expect(r.telling.waiting()).toBe(0);
    expect(r.timers.size).toBe(0);
  });

  it("is dropped, untold, when `says` throws, and never asked again", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let calls = 0;
    const r = rig({
      says: (d, who, s) => {
        calls++;
        if (calls === 1) throw new Error("no");
        return s.ok ? "said" : null;
      },
    });
    r.hear({ to: 1 });
    r.scene.ok = true;
    r.telling.ask();
    expect(r.told).toEqual([]);
    expect(r.telling.waiting()).toBe(0);
    expect(calls).toBe(1);
  });

  it("is forgotten at TELL_MS by its own timer, though nothing asks", () => {
    const r = rig();
    r.hear({ to: 1 });
    r.advance(TELL_MS - 1);
    expect(r.telling.waiting()).toBe(1);
    r.advance(1);
    expect(r.telling.waiting()).toBe(0);
    r.scene.ok = true;
    r.telling.ask();
    expect(r.told).toEqual([]);
  });

  it("is gone, with its timer, when the stage is disposed; nothing is told or taken after", () => {
    const r = rig();
    r.hear({ to: 1 });
    r.telling.dispose();
    expect(r.telling.waiting()).toBe(0);
    expect(r.timers.size).toBe(0);
    r.scene.ok = true;
    r.telling.ask();
    r.hear({ to: 1 });
    expect(r.telling.say("t", { messages: { moved: { valid: () => true, says: () => "x" } } }, "moved", {}, null)).toBe(false);
    expect(r.told).toEqual([]);
    expect(r.telling.waiting()).toBe(0);
  });
});

describe("what data may be told: an object, then `valid`", () => {
  // `valid` is never handed anything but an object, so no package checks that itself
  it.each([
    { data: null, taken: false },
    { data: undefined, taken: false },
    { data: 1, taken: false },
    { data: "to 1", taken: false },
    { data: { to: "1" }, taken: false },
    { data: { to: 1 }, taken: true },
  ])("$data → taken $taken", ({ data, taken }) => {
    const r = rig();
    r.scene.ok = true;
    r.hear(data);
    expect(r.told).toEqual(taken ? ["Someone moved to 1"] : []);
    expect(r.handed).toEqual(data !== null && typeof data === "object" ? [data] : []);
  });
});
