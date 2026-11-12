// The extension against a stand-in for the stage's api: the verb's reach,
// the hold while it moves, the one write, the presence key.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ext from "./extension.js";
import { HEAR_MS, KEY, REACH } from "./slide.js";
import { plugins } from "./index.js";

function fakeApi() {
  const doc = { objects: { door: { transform: { position: [1, 0, 2], rotation: [0, 0.5, 0], scale: 1 }, traits: { [KEY]: { axis: [0, 1, 0], stops: { closed: 0, open: 2 }, speed: 4, wait: 3, at: "closed" } } }, wall: { transform: { position: [0, 0, 0] } } } };
  const calls = { holds: [], releases: [], changes: 0, presence: {}, loops: [] };
  const api = {
    id: "joints",
    session: "me",
    doc: () => doc,
    scene: () => ({ objects: doc.objects }),
    change(fn) {
      calls.changes++;
      fn(doc);
    },
    pose: { hold: (id, t) => calls.holds.push([id, t]), release: (id, o) => calls.releases.push([id, o ?? null]) },
    heldBy: () => null,
    presence: { set: (k, v) => (calls.presence[k] = v), get: () => ({}), watch: () => {} },
    loop(fn) {
      calls.loops.push(fn);
      return () => (calls.loops = calls.loops.filter((f) => f !== fn));
    },
  };
  return { api, doc, calls };
}

describe("the slide's verb and motion, on the stage", () => {
  let f, x, cmd;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    f = fakeApi();
    x = ext.create(f.api);
    cmd = x.commands.find((c) => c.id === "use");
  });
  afterEach(() => {
    x.dispose();
    vi.useRealTimers();
  });

  it("says it's here, so the others know it will close what it opens", () => {
    expect(f.calls.presence.here).toBe(true);
  });

  it("on the use prompt: F, within arm's reach", () => {
    expect(cmd.key).toBe("f");
    expect(cmd.show).toEqual(["use"]);
    expect(cmd.state("door", {})).toBe(null); // the key map: no eye, so F while editing stays Frame all
    expect(cmd.state("door", { from: [0, 1.6, 0], hit: { id: "door", distance: REACH + 0.01 } })).toBe(null);
    expect(cmd.state("door", { from: [0, 1.6, 0], hit: { id: "door", distance: REACH } })).toEqual({ label: "Open" });
    expect(cmd.state("door", { from: [1, 1, 1], hit: { id: "door", point: [1, 1, 2] } })).toEqual({ label: "Open" });
    expect(cmd.state("wall", { from: [0, 1.6, 0], hit: { id: "wall", distance: 1 } })).toBe(null);
  });

  it("on the menu and the inspector: no key, no reach (a drawer opened while editing)", () => {
    const menu = x.commands.find((c) => c.id === "slide");
    expect(menu.key).toBeUndefined();
    expect(menu.show).toEqual(["menu", "inspector"]);
    expect(menu.state("door", {})).toEqual({ label: "Open" });
    expect(menu.state("wall", {})).toBe(null);
    menu.run("door");
    expect(f.calls.holds[0][0]).toBe("door");
    expect(menu.state("door", {})).toMatchObject({ label: "Opening", disabled: true });
  });

  it("opens: held each frame along its axis by the clock, written once where it stops, after it's been heard", () => {
    cmd.run("door");
    expect(f.calls.loops).toHaveLength(1);
    expect(f.calls.holds[0]).toEqual(["door", { position: [1, 0, 2], rotation: [0, 0.5, 0], scale: 1 }]);
    // 2 m at 4 m/s: half a second, whatever the frames say dt was
    for (let i = 0; i < 32; i++) {
      vi.advanceTimersByTime(1000 / 60);
      f.calls.loops[0]?.(0.0001);
    }
    const ys = f.calls.holds.map(([, t]) => t.position[1]);
    expect(ys.every((y, i) => i === 0 || y >= ys[i - 1])).toBe(true);
    expect(Math.max(...ys)).toBeCloseTo(2, 9);
    expect(f.calls.changes).toBe(0);
    expect(cmd.state("door", { from: [0, 0, 0], hit: { distance: 1 } })).toMatchObject({ label: "Opening", disabled: true });
    for (let i = 0; i < 60 && f.calls.loops.length; i++) {
      vi.advanceTimersByTime(1000 / 60);
      f.calls.loops[0]?.(1 / 60);
    }
    expect(f.calls.changes).toBe(1);
    expect(Date.now() - 1_000_000).toBeGreaterThanOrEqual(HEAR_MS);
    expect(f.doc.objects.door.transform.position).toEqual([1, 2, 2]);
    // since: when it got there, half a second in (the write waited for HEAR_MS)
    expect(f.doc.objects.door.traits[KEY]).toMatchObject({ at: "open", by: "me", since: 1_000_500 });
    expect(f.calls.releases.at(-1)).toEqual(["door", { landed: true }]);
    expect(f.calls.loops).toHaveLength(0); // no loop while nothing moves
    expect(cmd.state("door", { from: [0, 0, 0], hit: { distance: 1 } })).toEqual({ label: "Close" });
  });

  it("closes itself after its wait: the second write", () => {
    cmd.run("door");
    const frames = (n) => {
      for (let i = 0; i < n; i++) {
        vi.advanceTimersByTime(1000 / 60);
        f.calls.loops[0]?.(1 / 60);
      }
    };
    frames(70);
    expect(f.calls.changes).toBe(1);
    vi.advanceTimersByTime(3000); // its wait: the timer starts the close
    frames(70);
    expect(f.calls.changes).toBe(2);
    expect(f.doc.objects.door.transform.position).toEqual([1, 0, 2]);
    expect(f.doc.objects.door.traits[KEY]).toEqual({ axis: [0, 1, 0], stops: { closed: 0, open: 2 }, speed: 4, wait: 3, at: "closed" });
  });

  it("in a hidden tab (no frames ever drawn) it still lands, writes, and closes after its wait, by its timers", () => {
    cmd.run("door");
    // no loop callback is ever called: only timers run
    vi.advanceTimersByTime(HEAR_MS - 1);
    expect(f.calls.changes).toBe(0);
    vi.advanceTimersByTime(1);
    expect(f.calls.changes).toBe(1);
    expect(f.doc.objects.door.traits[KEY]).toMatchObject({ at: "open", since: 1_000_500 });
    expect(f.calls.releases.at(-1)).toEqual(["door", { landed: true }]);
    // its wait (3 s from when it got there), then the close's own HEAR_MS
    vi.advanceTimersByTime(3500 - HEAR_MS + HEAR_MS);
    expect(f.calls.changes).toBe(2);
    expect(f.doc.objects.door.traits[KEY].at).toBe("closed");
    expect(f.doc.objects.door.transform.position).toEqual([1, 0, 2]);
  });

  it("lets go of what it holds when it stops, writing nothing", () => {
    cmd.run("door");
    f.calls.loops[0](0.1);
    x.dispose();
    expect(f.calls.releases.at(-1)).toEqual(["door", null]);
    expect(f.calls.changes).toBe(0);
  });
});

describe("its metadata", () => {
  const meta = plugins[0];
  it("is plain data; the slide is described for the inspector; when and by whom it opened is runtime", () => {
    const { load, ...rest } = meta;
    expect(structuredClone(rest)).toEqual(rest);
    expect(meta.traits).toEqual(["joints.slide"]);
    expect(meta.describes["joints.slide"].runtime).toEqual(["since", "by"]);
    expect(meta.describes["joints.slide"].fields.map((x) => x.key)).toEqual(["axis", "stops", "speed", "wait"]);
  });
  it("runs whatever the viewer is doing, so it offers no activity of its own; and requires nothing (the prompt is a game's)", () => {
    expect(meta.activities).toBeUndefined();
    expect(meta.requires).toBeUndefined();
  });
});
