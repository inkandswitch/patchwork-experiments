// The extension against a stand-in for the stage's api: the verb's reach,
// the hold while it moves, the one write, the closing as a process stepped
// on the doc's world time.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ext from "./extension.js";
import { HEAR_MS, KEY } from "./slide.js";
import { plugins } from "./index.js";

function fakeApi() {
  const doc = { objects: { door: { transform: { position: [1, 0, 2], rotation: [0, 0.5, 0], scale: 1 }, traits: { [KEY]: { axis: [0, 1, 0], stops: { closed: 0, open: 2 }, speed: 4, wait: 3, at: "closed" } } }, wall: { transform: { position: [0, 0, 0] } } } };
  const calls = { holds: [], releases: [], changes: 0, loops: [], processes: [] };
  // the doc's clock: t moves only when the test says (as the computing view's would), stepping its processes on a 1/60 s grid
  const clock = { now: 0, k: 0 };
  const api = {
    id: "joints",
    session: "me",
    doc: () => doc,
    scene: () => ({ d: doc, objects: doc.objects }),
    change(fn) {
      calls.changes++;
      fn(doc);
    },
    pose: { hold: (id, t, o) => (calls.holds.push([id, t, o ?? null]), true), release: (id, o) => calls.releases.push([id, o ?? null]) },
    heldBy: () => null,
    clock: {
      // the stage's time (scene/src/stage/time.js): here the wall vitest's fake timers move
      now: () => Date.now(),
      after(ms, fn) {
        const h = setTimeout(fn, ms);
        return () => clearTimeout(h);
      },
      t: () => clock.now,
      process(spec) {
        calls.processes.push(spec);
        return () => (calls.processes = calls.processes.filter((p) => p !== spec));
      },
    },
    loop(fn) {
      calls.loops.push(fn);
      return () => (calls.loops = calls.loops.filter((f) => f !== fn));
    },
  };
  /** The world moves on to t (s), its processes stepped as the computing view steps them. */
  const advance = (t) => {
    const k1 = Math.floor(t * 60 + 1e-9);
    for (; clock.k < k1; ) {
      clock.k++;
      clock.now = clock.k / 60;
      for (const p of calls.processes) p.step(1 / 60, clock.now);
    }
    clock.now = Math.max(clock.now, t);
  };
  return { api, doc, calls, clock, advance };
}

describe("the slide's verb and motion, on the stage", () => {
  let f, x, cmd;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    f = fakeApi();
    x = ext.create(f.api);
    cmd = x.commands.find((c) => c.id === "slide");
  });
  afterEach(() => {
    x.dispose();
    vi.useRealTimers();
  });

  it("has a process while something closes itself, and none when nothing does", () => {
    expect(f.calls.processes).toHaveLength(1);
    f.doc.objects.door.traits[KEY].wait = 0;
    x.update({ d: f.doc, objects: f.doc.objects }, {}, { scene: null });
    expect(f.calls.processes).toHaveLength(0);
  });

  it("one verb on every surface: F, within the body's reach (the stage measures it: reach: true)", () => {
    expect(x.commands.map((c) => c.id)).toEqual(["slide"]);
    expect(cmd.key).toBe("f");
    expect(cmd.reach).toBe(true);
    expect(cmd.show).toEqual(["use", "menu", "inspector"]);
    // reach is the stage's: the state is the joint's alone, wherever the eye is
    expect(cmd.state("door", {})).toEqual({ label: "Open" });
    expect(cmd.state("door", { from: [0, 1.6, 0], hit: { id: "door", distance: 50 } })).toEqual({ label: "Open" });
    expect(cmd.state("wall", {})).toBe(null);
    cmd.run("door");
    expect(f.calls.holds[0][0]).toBe("door");
    expect(cmd.state("door", {})).toMatchObject({ label: "Opening", disabled: true });
  });

  it("opens: held each frame along its axis by the clock, written once where it stops, after it's been heard", () => {
    cmd.run("door");
    expect(f.calls.loops).toHaveLength(1);
    // a process's hold, yielding to a person's (someone carrying the door stops it)
    expect(f.calls.holds[0]).toEqual(["door", { position: [1, 0, 2], rotation: [0, 0.5, 0], scale: 1 }, { yields: true }]);
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
    // since: world time when it got there (the clock stood at 0 throughout: nobody computing here)
    expect(f.doc.objects.door.traits[KEY]).toMatchObject({ at: "open", since: 0 });
    expect(f.doc.objects.door.traits[KEY].by).toBeUndefined();
    expect(f.calls.releases.at(-1)).toEqual(["door", { landed: true }]);
    expect(f.calls.loops).toHaveLength(0); // no loop while nothing moves
    expect(cmd.state("door", { from: [0, 0, 0], hit: { distance: 1 } })).toEqual({ label: "Close" });
  });

  it("closes itself once the world is its wait past when it came to rest: the second write, by the process's step", () => {
    const frames = (n) => {
      for (let i = 0; i < n; i++) {
        vi.advanceTimersByTime(1000 / 60);
        f.advance(f.clock.now + 1 / 60);
        f.calls.loops[0]?.(1 / 60);
      }
    };
    cmd.run("door");
    frames(70);
    expect(f.calls.changes).toBe(1);
    // since: world time when it got there, half a second in (the write waited for HEAR_MS)
    expect(f.doc.objects.door.traits[KEY].since).toBeCloseTo(0.5, 6);
    // wall time with the world still (paused, or nobody computing): it stays open
    vi.advanceTimersByTime(10_000);
    expect(f.calls.changes).toBe(1);
    // world time: its wait, less a step, then the step that closes it
    f.advance(0.5 + 3 - 1 / 60 - 1e-6);
    expect(f.calls.holds.length).toBe(f.calls.holds.filter(([, , o]) => o).length);
    const before = f.calls.holds.length;
    f.advance(0.5 + 3 + 1 / 60);
    expect(f.calls.holds.length).toBeGreaterThan(before);
    frames(70);
    expect(f.calls.changes).toBe(2);
    expect(f.doc.objects.door.transform.position).toEqual([1, 0, 2]);
    expect(f.doc.objects.door.traits[KEY]).toEqual({ axis: [0, 1, 0], stops: { closed: 0, open: 2 }, speed: 4, wait: 3, at: "closed" });
  });

  it("in a hidden tab (no frames ever drawn) it still lands and writes by its timers; the close is the world's", () => {
    cmd.run("door");
    // no loop callback is ever called: only timers run
    vi.advanceTimersByTime(HEAR_MS - 1);
    expect(f.calls.changes).toBe(0);
    vi.advanceTimersByTime(1);
    expect(f.calls.changes).toBe(1);
    expect(f.doc.objects.door.traits[KEY]).toMatchObject({ at: "open", since: 0 });
    expect(f.calls.releases.at(-1)).toEqual(["door", { landed: true }]);
    // the close: when the world's step comes (on whichever view computes), and its act lands by the timer
    f.advance(3);
    vi.advanceTimersByTime(HEAR_MS);
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
  it("is plain data; the slide is described for the inspector; when it opened is runtime", () => {
    const { load, ...rest } = meta;
    expect(structuredClone(rest)).toEqual(rest);
    expect(meta.traits).toEqual(["joints.slide"]);
    expect(meta.describes["joints.slide"].runtime).toEqual(["since"]);
    expect(meta.describes["joints.slide"].fields.map((x) => x.key)).toEqual(["axis", "stops", "speed", "wait"]);
  });
  it("runs by its trait alone, whatever the viewer is doing", () => {
    for (const k of ["activities", "requires", "always", "general"]) expect(k in meta).toBe(false);
  });
});
