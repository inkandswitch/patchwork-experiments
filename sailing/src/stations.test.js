// The verbs aboard: reach, the wheel, the held verbs' sessions (pure),
// and the commands against a stand-in api and context. The cases are the
// finite list of what a look can be (DESIGN.md, "Stations"): at each kind of
// station, in reach (to the point looked at, or the origin without one), out
// of reach but in sight, past sight; the mast as the rig's parent, by its
// tag; and each station you
// lock in to, with which of the sail's keys work there.
import { describe, it, expect, vi } from "vitest";
import { FAR, FURL_RATE, RAISE_RATE, RODE, STEP_S, WINCH_RATE, approach, gridIndex, heldTrim, heldWeigh, lookDistance, sheetAtMast, stationCommands, walkTo, wheelStep, within, worldSteps } from "./stations.js";
import { REACH } from "./crew.js";
import { sloopObjects } from "./parts.js";

describe("reach", () => {
  it("is within the body's reach of the eye (the crew's: 2.5 m)", () => {
    expect(within([0, 1.6, 0], [0, 1.6, 2.4], REACH)).toBe(true);
    expect(within([0, 1.6, 0], [0, 0, 2.4], REACH)).toBe(false);
    expect(within([0, 1.6, 0], [0, 0, 2.4], Infinity)).toBe(true);
    expect(within(undefined, [0, 0, 0], REACH)).toBe(false);
    expect(within([0, 0, 0], null, REACH)).toBe(false);
  });

  it("is measured to where the look lands on the thing (or anything under it), else to its origin", () => {
    const scene = { objects: {}, parents: new Map([["rig", "mast"], ["mast", "hull"]]) };
    const from = [0, 1.6, 4];
    // the boom over your head: its gooseneck 4 m off, the look lands 1.7 m away
    expect(lookDistance({ scene, from, hit: { id: "rig", distance: 1.7 } }, "rig", [0, 2.8, 0])).toBe(1.7);
    // looking at the rig, offered on the mast it hangs from: still where the look landed
    expect(lookDistance({ scene, from, hit: { id: "rig", distance: 1.7 } }, "mast", [0, 1.4, 0])).toBe(1.7);
    // a hit with only a point: from the eye to it
    expect(lookDistance({ scene, from, hit: { id: "rig", point: [0, 1.6, 2] } }, "rig", [0, 2.8, 0])).toBe(2);
    // a hit on something else (not under the target): the target's origin
    expect(lookDistance({ scene, from, hit: { id: "hull", distance: 1 } }, "rig", [0, 1.6, 0])).toBe(4);
    // no hit: the origin; no eye: never
    expect(lookDistance({ scene, from, hit: null }, "rig", [0, 1.6, 1])).toBe(3);
    expect(lookDistance({ scene, hit: null }, "rig", [0, 1.6, 1])).toBe(Infinity);
  });

  it("out of reach, says where to go: the sail to the cockpit when she has a mainsheet, else the wheel or the mast", () => {
    expect(walkTo("helm", {})).toBe("Helm · walk to the wheel");
    expect(walkTo("mainsheet", {})).toBe("Mainsheet · walk to the cockpit");
    expect(walkTo("anchor", {})).toBe("Anchor · walk to the windlass");
    expect(walkTo("sail", { mainsheet: "m", helm: "w" })).toBe("Sail · walk to the cockpit");
    expect(walkTo("sail", { helm: "w" })).toBe("Sail · walk to the wheel, or the mast");
    expect(walkTo("sail", {})).toBe("Sail · walk to the mast");
    expect(walkTo("ladder", {})).toBe(null);
    // already at one of the sail's stations: which to take, not where to walk
    const sloop = { mainsheet: "m", helm: "w", sail: "s" };
    expect(walkTo("sail", sloop, { helm: true, mainsheet: true })).toBe("Sail · work it at the wheel or the mainsheet (F)");
    expect(walkTo("sail", sloop, { helm: true })).toBe("Sail · work it at the wheel (F)");
    expect(walkTo("sail", { helm: "w", sail: "s" }, { helm: true, mainsheet: true })).toBe("Sail · work it at the wheel (F)");
    expect(walkTo("sail", sloop, { mast: true })).toBe("Sail · work it at the mast (F)");
    expect(walkTo("helm", sloop, { helm: true })).toBe("Helm · walk to the wheel");
  });

  it("the sheet is worked at the mast only on a ship with nowhere else to work it", () => {
    expect(sheetAtMast({ helm: "w", mainsheet: "m" })).toBe(false);
    expect(sheetAtMast({ helm: "w" })).toBe(false);
    expect(sheetAtMast({ mainsheet: "m" })).toBe(false);
    expect(sheetAtMast({})).toBe(true);
  });
});

describe("the wheel", () => {
  it("turns toward ±1 at its rate while held, and stays where it's left", () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = wheelStep(a, 1, 1 / 60);
    expect(a).toBeCloseTo(0.6);
    for (let i = 0; i < 120; i++) a = wheelStep(a, 1, 1 / 60);
    expect(a).toBe(1);
    expect(wheelStep(a, 0, 1)).toBe(1);
    for (let i = 0; i < 60; i++) a = wheelStep(a, -1, 1 / 60);
    expect(a).toBeCloseTo(0.4);
    expect(approach(0.5, 0, 0.25, 4)).toBe(0);
  });
});

// A view's world time on the probe page, as scene's clock makes it: t goes on by each frame's dt, and the page's
// clock (scene/src/stage/time.js manualTime) reads now() as start + frames × frameMs (start 1e6 ms, frameMs
// 1000/60), a frame's dt the difference of two readings over 1000. Its last bits depend on how many frames the
// clock had run before (k0): a handful of different dts, unevenly. Readings from world time t0, one a frame.
const worldReadings = (t0, k0, n) => {
  const out = [t0];
  for (let i = 0; i < n; i++) out.push(out[i] + ((1e6 + (k0 + i + 1) * (1000 / 60)) - (1e6 + (k0 + i) * (1000 / 60))) / 1000);
  return out;
};
/** A clock that reads each of `ts` in turn, the first where it's made: [clock, next frame]. */
const readings = (ts) => {
  let i = 0;
  return [() => ts[i], () => i++];
};

describe("a held station's clock: world time in whole steps of the world's grid (DESIGN.md, \"Determinism\")", () => {
  const S = STEP_S;
  // each row: this view's world time where the hold begins, then at each frame → the steps' time out, frame by frame
  // (to the bit: toEqual compares numbers with Object.is)
  const ROWS = [
    ["one frame on the grid", [0, S], [S]],
    ["frames off the grid (a follower's t): a step as t crosses a grid point", [0.005, 0.02, 0.03, 0.04], [S, 0, S]],
    ["a 144 Hz display: a step when t has crossed a grid point, none between", [0, 1 / 144, 2 / 144, 3 / 144, 4 / 144, 5 / 144], [0, 0, S, 0, S]],
    ["a grid point read a hair short is crossed (scene's gridIndex)", [0, 60 * S - 1e-13], [60 * S]],
    ["a stall, or a follower's jump: its whole steps at once", [0, 0.1, 0.85], [6 * S, 45 * S]],
    ["the world paused: t stands, and so does the hold", [2, 2, 2], [0, 0]],
  ];
  it.each(ROWS)("%s", (_, ts, out) => {
    const [clock, frame] = readings(ts);
    const steps = worldSteps(clock);
    expect(out.map(() => (frame(), steps()))).toEqual(out);
  });

  it("over any frames, the steps are the grid points t crossed: whole steps, every one counted once", () => {
    for (const ts of [worldReadings(0, 0, 600), worldReadings(21.7, 123456, 600), Array.from({ length: 300 }, (_, i) => 3.001 + i / 144), Array.from({ length: 99 }, (_, i) => 0.0237 * i)]) {
      const [clock, frame] = readings(ts);
      const steps = worldSteps(clock);
      let n = 0;
      for (let i = 1; i < ts.length; i++) {
        frame();
        const out = steps();
        const k = Math.round(out / S);
        expect(out).toBe(k * S);
        n += k;
      }
      expect(n).toBe(gridIndex(ts.at(-1)) - gridIndex(ts[0]));
    }
  });

  // one key held for the same frames from the same world time, the page's clock having run on different numbers of
  // frames before (so the readings differ in their last bits): every value the verb puts in, to the bit
  const sameEachOffset = (make) => {
    const runs = [0, 1, 2, 1000, 123456].map((k0) => {
      const [clock, frame] = readings(worldReadings(21.7, k0, 450));
      const seen = [];
      const v = make(seen, clock);
      for (let i = 0; i < 450 && v.open; i++) frame(), v.update();
      return seen;
    });
    expect(new Set(runs.map((r) => JSON.stringify(r))).size).toBe(1);
    return runs[0];
  };
  it("the readings differ from run to run in their last bits (what the rows above are for)", () => {
    const ends = [0, 1, 2, 1000, 123456].map((k0) => worldReadings(21.7, k0, 450).at(-1));
    expect(new Set(ends).size).toBeGreaterThan(1);
  });
  it("the halyard held for the same frames puts in the same values, whatever frame the page's clock had reached", () => {
    const seen = sameEachOffset((seen, clock) => heldTrim({ value: 0, goal: 1, rate: RAISE_RATE, clock, input: (x) => seen.push(x), commit() {} }));
    // each frame one step's worth, up all the way in 4 s of world time: on the 241st frame, as 240 steps of 1/240 sum a hair short of 1
    expect(seen.length).toBe(450);
    expect(seen[0]).toBe(RAISE_RATE * S);
    expect(seen.indexOf(1)).toBe(240);
  });
  it("the windlass held for the same frames puts in the same rode, whatever frame the page's clock had reached", () => {
    const seen = sameEachOffset((seen, clock) => heldWeigh({ rode: RODE, clock, input: (f) => seen.push(f.rode), commit: (f) => seen.push(f) }));
    // a full rode in six seconds of world time: 360 frames of chain, and up on the 361st (360 steps leave a hair of it)
    expect(seen.length).toBe(361);
    expect(seen.at(-1)).toEqual({ down: false, rode: 0 });
  });
  it("held while the world is paused, a verb puts in nothing new; it goes on when the world does", () => {
    let t = 5;
    const seen = [];
    const v = heldTrim({ value: 0, goal: 1, rate: RAISE_RATE, clock: () => t, input: (x) => seen.push(x), commit() {} });
    for (let i = 0; i < 30; i++) v.update();
    expect(new Set(seen)).toEqual(new Set([0]));
    t += 1;
    v.update();
    expect(seen.at(-1)).toBe(RAISE_RATE * 60 * S);
  });
});

describe("held verbs", () => {
  it("a trim moves toward its goal while held, live, and commits once where it got to", () => {
    const input = vi.fn();
    const commit = vi.fn();
    const done = vi.fn();
    let t = 0;
    const s = heldTrim({ value: 1, goal: 0, rate: 0.25, clock: () => t, input, commit, done });
    for (let i = 0; i < 60; i++) (t += 1 / 60), s.update();
    expect(s.value).toBeCloseTo(0.75);
    expect(input).toHaveBeenLastCalledWith(s.value);
    s.end();
    s.cancel();
    t += 1;
    s.update();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0][0]).toBeCloseTo(0.75);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("a cancelled trim commits where it got to; one whose claim is lost stops and writes nothing", () => {
    const commit = vi.fn();
    let t = 0;
    const clock = () => t;
    const c = heldTrim({ value: 0.5, goal: 1, rate: 0.25, clock, input() {}, commit });
    t += 1;
    c.update();
    c.cancel();
    expect(commit).toHaveBeenCalledWith(0.75);
    let alive = true;
    const commit2 = vi.fn();
    const done = vi.fn();
    const l = heldTrim({ value: 0.5, goal: 1, rate: 0.25, clock, input() {}, commit: commit2, alive: () => alive, done });
    t += 1;
    l.update();
    alive = false;
    t += 1;
    l.update();
    expect(l.open).toBe(false);
    l.end();
    expect(commit2).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("weighing a full rode takes about six seconds, and up it commits at once", () => {
    const commit = vi.fn();
    const input = vi.fn();
    let t = 0;
    const s = heldWeigh({ rode: RODE, clock: () => t, input, commit });
    while (s.open && t < 20) {
      t += 1 / 60;
      s.update();
    }
    expect(t).toBeCloseTo(6, 1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith({ down: false, rode: 0 });
    s.end();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("let go part way, the rode is where it got to; an anchor down short still takes a moment", () => {
    const commit = vi.fn();
    let t = 0;
    const clock = () => t;
    const s = heldWeigh({ rode: 20, clock, input() {}, commit });
    t += 1;
    s.update();
    s.end();
    expect(commit).toHaveBeenCalledWith({ rode: 20 - WINCH_RATE });
    const short = heldWeigh({ rode: 0, clock, input() {}, commit: vi.fn() });
    t += 0.5;
    short.update();
    expect(short.open).toBe(true);
    t += 1;
    short.update();
    expect(short.open).toBe(false);
  });
});

// ─── the commands on a stand-in stage ───────────────────────────────────────

const at = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

/**
 * A sloop on a stand-in stage. `mainsheet`: she has one (in the cockpit).
 * `rehung`: the rig hangs from the hull beside the mast (moved there by
 * hand in the editor), not from the mast as the part puts it. `sail`,
 * `jib`: her stations name them (without, a station works neither).
 */
function stage({ mainsheet = true, helm = true, rehung = false, sail = true, jib = true } = {}) {
  const scene = {
    objects: {
      hull: { traits: { "sailing.ship": {} } },
      wheel: { traits: { "sailing.helm": { angle: 0 } } },
      rig: { traits: { "sailing.sail": { raised: 1, sheet: 0.5 } } },
      sheet: { traits: { "sailing.mainsheet": {} } },
      windlass: { traits: { "sailing.anchor": { down: true, rode: 0 } } },
      ladder: {},
      mast: {},
      // a card table in her cockpit, and a board on it: aboard, but no part of her rig
      table: {},
      board: {},
      // the jib under the mast, and its winches by the cockpit (the starboard one under the port, as the part puts them)
      jib: { traits: { "sailing.jib": { sheet: 0.5, held: null, furl: 0 } } },
      winchP: { traits: { "sailing.winch": { sail: "jib", side: "port" } } },
      winchS: { traits: { "sailing.winch": { sail: "jib", side: "starboard" } } },
    },
    // the boom and sail hang from the mast, as the sloop's parts put them
    parents: new Map([["wheel", "hull"], ["rig", rehung ? "hull" : "mast"], ["sheet", "hull"], ["windlass", "hull"], ["ladder", "hull"], ["mast", "hull"], ["table", "hull"], ["board", "table"], ["jib", "mast"], ["winchP", "hull"], ["winchS", "winchP"]]),
  };
  const s = {
    scene,
    claims: {}, // id → { mine, onLost }
    values: { wheel: { angle: 0.2 }, rig: { raised: 1, sheet: 0.5 }, windlass: { down: true, rode: 25 }, jib: { sheet: 0.5, held: null, furl: 0 } },
    // what her physics reads: on starboard tack (the wind from starboard), the jib drawing to port
    read: { jib: -0.2, apparentWind: { angle: 0.5 }, sails: [{ id: "jib", main: false, angle: -0.2, limit: 0.2, from: 0.5, alpha: 28.648 - 11.459, sheet: 11.459, area: 30, q: 20 }] },
    inputs: [],
    commits: [],
    me: { playing: true, swimming: false, station: null },
    taken: null,
    holds: {}, // id → transform
    released: [], // [id, opts]
    t: 0, // the world's time (api.clock.t()): a station's tick(dt) is a frame of the world running dt (take, below)
  };
  /** the world runs on by dt (s) */
  s.pass = (dt) => (s.t += dt);
  const worlds = { hull: at(0, 0, 0), wheel: at(0, 1.6, 4), rig: at(0, 2.8, -1.5), sheet: at(0, 0.72, 3.3), windlass: at(0, 1.5, -3.8), ladder: at(1.8, 1.2, 0.4), mast: at(0, 1.4, -1.6), table: at(0, 0.7, -0.6), board: at(0, 1.4, -0.6), jib: at(0, 1.74, -6.12), winchP: at(-0.95, 1.23, 2.25), winchS: at(0.95, 1.23, 2.25) };
  s.worlds = worlds;
  // claims by id, each kind apart ("station" under the bare id, as the tests read it)
  const slot = (id, kind) => (kind === "station" ? id : `${id}:${kind}`);
  s.api = {
    clock: { t: () => s.t },
    scene: () => s.scene,
    worldOf: (id) => worlds[id] ?? null,
    content: (id) => (id === "hull" ? { box: { min: [-2, -2, -6.2], max: [2, 15, 6] } } : null),
    claim(id, kind, { onLost } = {}) {
      const k = slot(id, kind);
      const c = s.claims[k];
      if (c && !c.mine) return null;
      s.claims[k] = { mine: true, onLost };
      return () => {
        if (s.claims[k]?.mine) delete s.claims[k];
      };
    },
    claimedBy: (id, kind) => (s.claims[slot(id, kind)] ? { viewer: "v", session: "x", mine: s.claims[slot(id, kind)].mine } : null),
    pose: {
      hold: (id, t) => (s.holds[id] = t),
      release: (id, o) => (s.released.push([id, o]), delete s.holds[id]),
    },
  };
  s.ctx = {
    sim: {
      value: (id) => s.values[id],
      input: (id, f) => s.inputs.push([id, f]),
      commit: (id, f) => s.commits.push([id, f]),
      stationsOf: () => ({ helm: helm ? "wheel" : null, sail: sail ? "rig" : null, anchor: "windlass", mainsheet: mainsheet ? "sheet" : null, jib: jib ? "jib" : null, ladder: "ladder", winches: ["winchP", "winchS"] }),
      read: () => s.read,
      sailModels: () => ({ jib: { alpha0: -5, stall: 20, width: 30, wingFrom: 140 } }),
    },
    crew: {
      me: () => s.me,
      take(id, held) {
        // each frame the stage ticks it, the world having run on by that frame's dt
        const handlers = { ...held, tick: (dt) => (s.pass(dt), held.tick(dt)) };
        s.taken = { id, handlers };
        s.me.station = id;
        const leave = () => {
          if (!s.taken) return;
          s.taken = null;
          s.me.station = null;
          handlers.left?.();
        };
        s.leave = leave;
        return leave;
      },
      start: vi.fn(),
    },
  };
  s.commands = stationCommands(s.api, s.ctx);
  s.cmd = (id) => s.commands.find((c) => c.id === id);
  // the command context every surface passes (scene/TOOLS.md §4): the eye, the body's reach (the crew's), the look
  const origin = (id) => (worlds[id] ? [worlds[id][12], worlds[id][13], worlds[id][14]] : null);
  const context = (from, hit, reach = REACH) => ({ scene: s.scene, local: {}, from, hit, reach, distance: (t) => lookDistance({ scene: s.scene, from, hit }, t, origin(t)) });
  s.look = (from, reach) => context(from, null, reach);
  /** A look that lands on `id`, `distance` away (from an eye that's wherever, `from`). */
  s.at = (id, distance, from = [0, 0, 100], reach) => context(from, { id, point: null, distance }, reach);
  /** A command's state as the stage gives it: a `reach: true` verb beyond the body's reach is disabled, "too far" (scene's commandState). */
  s.state = (cmd, target, c) => {
    const st = cmd.state?.(target, c) ?? null;
    if (st && cmd.reach === true && target != null && !(c.distance(target) <= c.reach)) return { ...st, disabled: true, title: "too far" };
    return st;
  };
  /** The verbs the prompt would offer for a look at `target` (in order; it shows three), as [id, label?, disabled?]. */
  s.offered = (target, c) =>
    s.commands
      .map((cmd) => [cmd, s.state(cmd, target, c)])
      .filter(([, st]) => st)
      .map(([cmd, st]) => [cmd.id, st.label ?? null, !!st.disabled]);
  return s;
}

describe("the commands", () => {
  it("each has a key and shows on the use prompt; each station's says reach: true (the stage's), and applies only to what it works", () => {
    const s = stage();
    for (const c of s.commands.filter((c) => c.id !== "aboard")) {
      expect(c.key).toBeTruthy();
      expect(c.show).toEqual(["use"]);
    }
    for (const id of ["helm", "mainsheet", "winch", "halyard", "sail", "haul", "ease", "jibHaul", "jibEase", "weigh", "drop"]) expect(s.cmd(id).reach, id).toBe(true);
    const near = s.look([0, 2.3, 5]);
    const far = s.look([0, 2.3, 9]);
    expect(s.state(s.cmd("helm"), "wheel", near)).toEqual({});
    expect(s.state(s.cmd("helm"), "wheel", far)).toEqual({ disabled: true, title: "too far" });
    // in Look (the orbit camera) the body reaches everything
    expect(s.state(s.cmd("helm"), "wheel", s.look([0, 2.3, 90], Infinity))).toEqual({});
    expect(s.cmd("helm").state("rig", near)).toBe(null);
    expect(s.cmd("sail").state("wheel", near)).toBe(null);
  });

  it("the helm: F takes it (a claim, a station), A/D turn the wheel live, F leaves and commits", () => {
    const s = stage();
    s.cmd("helm").run("wheel");
    expect(s.claims.wheel?.mine).toBe(true);
    expect(s.taken.id).toBe("wheel");
    const h = s.taken.handlers;
    expect(h.key({ code: "KeyD", key: "d" })).toBe(true);
    for (let i = 0; i < 30; i++) h.tick(1 / 60);
    expect(s.inputs.at(-1)[0]).toBe("wheel");
    expect(s.inputs.at(-1)[1].angle).toBeCloseTo(0.5);
    expect(h.hint()).toMatch(/^A \/ D steer · .* · F leave/);
    // the helmsman holds the wheel's pose, turned as far as the key has it
    expect(s.holds.wheel.rotation[2]).toBeCloseTo(-0.5 * 1.25 * 2 * Math.PI);
    h.keyup({ code: "KeyD", key: "d" });
    // let go of the wheel: where it was left is written down at once (a tab that closes keeps it)
    expect(s.commits).toEqual([["wheel", { angle: expect.closeTo(0.5, 5) }]]);
    const n = s.inputs.length;
    h.tick(1 / 60);
    expect(s.inputs.length).toBe(n); // left where it was
    expect(h.key({ code: "KeyW", key: "w" })).toBe(false);
    expect(h.key({ code: "KeyF", key: "f" })).toBe(true);
    expect(s.commits.at(-1)).toEqual(["wheel", { angle: expect.closeTo(0.5, 5) }]);
    expect(s.claims.wheel).toBe(undefined);
    // the wheel let go landed, so peers keep it there until the simulator draws it
    expect(s.released).toEqual([["wheel", { landed: true }]]);
    expect(s.taken).toBe(null);
  });

  it("the helm: Q and E trim the sheet from the wheel (it's led aft), under the sail's own claim", () => {
    const s = stage();
    s.cmd("helm").run("wheel");
    const h = s.taken.handlers;
    expect(h.hint()).toMatch(/Q \/ E sheet 50%/);
    expect(h.key({ code: "KeyQ", key: "q" })).toBe(true);
    expect(s.claims.rig?.mine).toBe(true);
    for (let i = 0; i < 60; i++) h.tick(1 / 60);
    expect(s.inputs.filter(([id]) => id === "rig").at(-1)[1].sheet).toBeCloseTo(0.25);
    h.keyup({ code: "KeyQ", key: "q" });
    expect(s.commits.at(-1)).toEqual(["rig", { sheet: expect.closeTo(0.25, 5) }]);
    expect(s.claims.rig).toBe(undefined);
    expect(s.claims.wheel?.mine).toBe(true); // still at the helm
  });

  // Every held key at the helm moves by world time, not by frames: each row a key held for 30 frames with the world
  // paused (frames pass, world time doesn't), then for one second of it running (DESIGN.md, "Determinism")
  it.each([
    ["the wheel (D)", "KeyD", "d", "wheel", "angle", 0.2, 0.2 + 0.6],
    ["the sheet led aft (Q)", "KeyQ", "q", "rig", "sheet", 0.5, 0.25],
    ["the halyard led aft (R)", "KeyR", "r", "rig", "raised", 1, 0.75],
  ])("the helm, %s: held while the world is paused, nothing moves; it moves once the world runs", (_, code, key, id, field, from, to) => {
    const s = stage();
    s.cmd("helm").run("wheel");
    const h = s.taken.handlers;
    s.pass(0.004); // off the grid, as a follower's t is
    const n = s.inputs.length;
    h.key({ code, key });
    for (let i = 0; i < 30; i++) h.tick(0);
    const moved = s.inputs.slice(n).filter(([i, f]) => i === id && f && f[field] !== from);
    expect(moved).toEqual([]);
    for (let i = 0; i < 60; i++) h.tick(1 / 60);
    expect(s.inputs.filter(([i, f]) => i === id && f && field in f).at(-1)[1][field]).toBeCloseTo(to, 9);
  });

  it("the helm: someone else there shows it, disabled; taking it then does nothing", () => {
    const s = stage();
    s.claims.wheel = { mine: false };
    expect(s.cmd("helm").state("wheel", s.look([0, 2.3, 5]))).toEqual({ disabled: true, label: "Someone's at the helm" });
    s.cmd("helm").run("wheel");
    expect(s.taken).toBe(null);
  });

  it("the helm: the claim lost steps you away without writing", () => {
    const s = stage();
    s.cmd("helm").run("wheel");
    const lost = s.claims.wheel.onLost;
    s.claims.wheel = { mine: false };
    lost();
    expect(s.taken).toBe(null);
    expect(s.commits).toEqual([]);
  });

  it("the helm: a wheel that's gone stops you", () => {
    const s = stage();
    s.cmd("helm").run("wheel");
    s.scene = { ...s.scene, objects: { hull: s.scene.objects.hull } };
    s.taken.handlers.tick(1 / 60);
    expect(s.taken).toBe(null);
    expect(s.commits).toEqual([]);
  });

  it("the helm: hold R raises or lowers the sail from the wheel (the halyard's led aft too)", () => {
    const s = stage();
    s.cmd("helm").run("wheel");
    const h = s.taken.handlers;
    expect(h.hint()).toMatch(/hold R lower sail/);
    expect(h.key({ code: "KeyR", key: "r" })).toBe(true);
    expect(s.claims.rig?.mine).toBe(true);
    expect(h.key({ code: "KeyR", key: "r", repeat: true })).toBe(true);
    for (let i = 0; i < 60; i++) h.tick(1 / 60);
    expect(s.inputs.filter(([id]) => id === "rig").at(-1)[1].raised).toBeCloseTo(0.75);
    h.keyup({ code: "KeyR", key: "r" });
    expect(s.commits.at(-1)).toEqual(["rig", { raised: expect.closeTo(0.75, 5) }]);
    expect(s.claims.rig).toBe(undefined);
    // and a lowered sail goes up
    s.values.rig = { raised: 0, sheet: 0.5 };
    expect(h.hint()).toMatch(/hold R raise sail/);
    h.key({ code: "KeyR", key: "r" });
    h.tick(1);
    h.keyup({ code: "KeyR", key: "r" });
    expect(s.commits.at(-1)).toEqual(["rig", { raised: 0.25 }]);
  });

  it("the helm: steering, the sheet and the halyard at once; leaving ends what's held, written where it got to", () => {
    const s = stage();
    s.cmd("helm").run("wheel");
    const h = s.taken.handlers;
    h.key({ code: "KeyD", key: "d" });
    h.key({ code: "KeyQ", key: "q" });
    h.key({ code: "KeyR", key: "r" });
    // E while Q is held: the sheet is one hand's
    h.key({ code: "KeyE", key: "e" });
    h.tick(1);
    h.key({ code: "KeyF", key: "f" });
    expect(s.taken).toBe(null);
    const rig = s.commits.filter(([id]) => id === "rig").map(([, f]) => f);
    expect(rig).toEqual(expect.arrayContaining([{ sheet: 0.25 }, { raised: 0.75 }]));
    expect(rig).toHaveLength(2);
    expect(s.claims.rig).toBe(undefined);
    expect(s.claims.wheel).toBe(undefined);
  });

  it("someone at the mast doesn't stop the helmsman trimming: the halyard's claim isn't the sail's", () => {
    const s = stage();
    s.claims["rig:halyard"] = { mine: false };
    s.cmd("helm").run("wheel");
    s.taken.handlers.key({ code: "KeyQ", key: "q" });
    expect(s.claims.rig?.mine).toBe(true);
    s.taken.handlers.keyup({ code: "KeyQ", key: "q" });
    expect(s.claims.rig).toBe(undefined);
  });

  // ─── the mainsheet, in the cockpit ─────────────────────────────────────

  it("the mainsheet: in reach, F takes it and Q / E trim it held; the sail's raise isn't offered on it", () => {
    const s = stage();
    expect(s.offered("sheet", s.at("sheet", 1.2))).toEqual([
      ["mainsheet", null, false],
      ["haul", null, false],
      ["ease", null, false],
    ]);
    // out of reach: where to go, then its verbs greyed (the stage's "too far")
    expect(s.offered("sheet", s.at("sheet", 3))).toEqual([
      ["far", "Mainsheet · walk to the cockpit", true],
      ["mainsheet", null, true],
      ["haul", null, true],
      ["ease", null, true],
    ]);
    const session = s.cmd("haul").run("sheet");
    s.pass(1);
    session.update();
    session.end();
    expect(s.commits.at(-1)).toEqual(["rig", { sheet: 0.25 }]);
  });

  it("the mainsheet: F locks you in at it; Q / E trim and hold R hoists, each under the sail's claim; F leaves", () => {
    const s = stage();
    s.cmd("mainsheet").run("sheet");
    expect(s.taken.id).toBe("sheet"); // its stand spot (walk.stand)
    expect(s.claims.sheet?.mine).toBe(true);
    const h = s.taken.handlers;
    expect(h.hint()).toBe("Q / E sheet 50% · hold R lower sail · F leave · sail 100%");
    expect(h.key({ code: "KeyE", key: "e" })).toBe(true);
    h.tick(1);
    h.keyup({ code: "KeyE", key: "e" });
    expect(s.commits.at(-1)).toEqual(["rig", { sheet: 0.75 }]);
    expect(h.key({ code: "KeyR", key: "r" })).toBe(true);
    h.tick(2);
    h.keyup({ code: "KeyR", key: "r" });
    expect(s.commits.at(-1)).toEqual(["rig", { raised: 0.5 }]);
    // walking keys aren't its: they go on (and the walker's still)
    expect(h.key({ code: "KeyW", key: "w" })).toBe(false);
    expect(s.cmd("mainsheet").state("sheet", s.at("sheet", 1))).toBe(null); // you're at it
    h.key({ code: "KeyF", key: "f" });
    expect(s.taken).toBe(null);
    expect(s.claims.sheet).toBe(undefined);
    expect(s.claims.rig).toBe(undefined);
  });

  it("the mainsheet: someone else at it shows it, disabled, and taking it does nothing; their claim lost steps them off", () => {
    const s = stage();
    s.claims.sheet = { mine: false };
    expect(s.cmd("mainsheet").state("sheet", s.at("sheet", 1))).toEqual({ disabled: true, label: "Someone's at the mainsheet" });
    s.cmd("mainsheet").run("sheet");
    expect(s.taken).toBe(null);
    delete s.claims.sheet;
    s.cmd("mainsheet").run("sheet");
    s.taken.handlers.key({ code: "KeyQ", key: "q" });
    const lost = s.claims.sheet.onLost;
    s.claims.sheet = { mine: false };
    lost();
    expect(s.taken).toBe(null);
    // the trim it had going ends where it got to (the sail's own claim is still this view's)
    expect(s.claims.rig).toBe(undefined);
  });

  it("the mainsheet: a sail that's gone steps you off", () => {
    const s = stage();
    s.cmd("mainsheet").run("sheet");
    const { rig: _gone, ...rest } = s.scene.objects;
    s.scene = { ...s.scene, objects: rest };
    s.taken.handlers.tick(1 / 60);
    expect(s.taken).toBe(null);
  });

  // ─── the mast and the rig ──────────────────────────────────────────────

  it("the mast: in reach, F works the halyard (lock in) and hold R raises or lowers; no sheet there", () => {
    const s = stage();
    expect(s.offered("mast", s.at("mast", 0.8))).toEqual([
      ["halyard", null, false],
      ["sail", "Lower sail", false],
    ]);
    // the rig by its gooseneck is at the mast too
    expect(s.offered("rig", s.at("rig", 0.8, [0, 2.6, -0.5]))).toEqual([
      ["halyard", null, false],
      ["sail", "Lower sail", false],
    ]);
    s.cmd("halyard").run("mast");
    expect(s.taken.id).toBe("rig"); // the sail's stand spot, aft of the gooseneck
    expect(s.claims["rig:halyard"]?.mine).toBe(true);
    expect(s.claims.rig).toBe(undefined); // the sail's own claim only while a key's down
    const h = s.taken.handlers;
    expect(h.hint()).toBe("hold R lower sail · F leave · sail 100%");
    expect(h.key({ code: "KeyQ", key: "q" })).toBe(false);
    h.key({ code: "KeyR", key: "r" });
    expect(s.claims.rig?.mine).toBe(true);
    h.tick(4);
    h.keyup({ code: "KeyR", key: "r" });
    expect(s.commits.at(-1)).toEqual(["rig", { raised: 0 }]);
    expect(s.cmd("halyard").state("mast", s.at("mast", 0.8))).toBe(null); // you're at it
    h.key({ code: "KeyF", key: "f" });
    expect(s.taken).toBe(null);
    expect(s.claims["rig:halyard"]).toBe(undefined);
  });

  it("the mast: on a ship with neither a helm nor a mainsheet, the sheet's worked there too", () => {
    const s = stage({ mainsheet: false, helm: false });
    s.cmd("halyard").run("mast");
    const h = s.taken.handlers;
    expect(h.hint()).toBe("Q / E sheet 50% · hold R lower sail · F leave · sail 100%");
    expect(h.key({ code: "KeyQ", key: "q" })).toBe(true);
    h.tick(1);
    h.keyup({ code: "KeyQ", key: "q" });
    expect(s.commits.at(-1)).toEqual(["rig", { sheet: 0.25 }]);
  });

  it("the mast: someone there shows it, disabled; the hoist is still anyone's", () => {
    const s = stage();
    s.claims["rig:halyard"] = { mine: false };
    expect(s.offered("mast", s.at("mast", 0.8))).toEqual([
      ["halyard", "Someone's at the mast", true],
      ["sail", "Lower sail", false],
    ]);
  });

  it("the rig over the cockpit: the boom in reach (its gooseneck not) offers the hoist; the sheet's at the mainsheet", () => {
    const s = stage();
    // the diagnosis' case: at anchor, sail down, the boom 1.73 m off, its gooseneck 4.13 m
    s.values.rig = { raised: 0, sheet: 0.5 };
    const look = s.at("rig", 1.73, [0, 2.3, 2.6]);
    expect(s.offered("rig", look)).toEqual([["sail", "Raise sail", false]]);
    // a ship with no mainsheet: the sheet from the boom too
    const t = stage({ mainsheet: false });
    expect(t.offered("rig", t.at("rig", 1.73, [0, 2.3, 2.6]))).toEqual([
      ["sail", "Lower sail", false],
      ["haul", null, false],
      ["ease", null, false],
    ]);
    // …but not by the gooseneck: that's the mast, no place to trim
    expect(t.offered("rig", t.at("rig", 0.8, [0, 2.6, -0.5])).map(([id]) => id)).toEqual(["halyard", "sail"]);
    // the hit's 3.2 m away: out of reach, wherever the gooseneck is; standing by the mast, the mast's where to work it
    expect(s.offered("rig", s.at("rig", 3.2, [0, 2.6, -0.5]))[0]).toEqual(["far", "Sail · work it at the mast (F)", true]);
    expect(s.offered("rig", s.at("rig", 3.2, [0, 3, -5.2]))[0]).toEqual(["far", "Sail · walk to the cockpit", true]); // from the foredeck
    expect(s.offered("rig", s.at("rig", 3.2, [0, 3, -5.2])).slice(1).every(([, , disabled]) => disabled)).toBe(true);
  });

  it("no hit: reach falls back to the origin (the key map's look, a hover without a point)", () => {
    const s = stage();
    expect(s.state(s.cmd("sail"), "rig", s.look([0, 2.5, 0.4]))).toEqual({ label: "Lower sail" }); // 1.9 m from the gooseneck
    expect(s.state(s.cmd("sail"), "rig", s.look([0, 2.5, 2]))).toEqual({ label: "Lower sail", disabled: true, title: "too far" });
  });

  it("the mast: nothing else traitless aboard is it (a table, a board on it), nor the deck, nor another station", () => {
    const s = stage();
    const near = s.look([0, 2.5, -0.5]);
    for (const t of ["hull", "windlass", "table", "board"]) {
      expect(s.cmd("sail").state(t, near), t).toBe(null);
      expect(s.cmd("halyard").state(t, near), t).toBe(null);
    }
    expect(s.cmd("haul").state("board", near)).toBe(null);
  });

  // one claim says who stands at a station: the one its take verb holds while you're there, which its
  // stand spot (parts.js walk.stand) names for walk.people to draw you by
  const STAND_CLAIM = (() => {
    const by = {};
    let n = 0;
    for (const [, o] of sloopObjects({ position: [0, 0, 0], yaw: 0 }, new Proxy({}, { get: () => ({ url: "automerge:f", hint: null }) }), (p) => `${p}${++n}`)) {
      const t = o.traits ?? {};
      const kind = t["sailing.helm"] ? "helm" : t["sailing.mainsheet"] ? "mainsheet" : t["sailing.sail"] ? "halyard" : t["sailing.winch"]?.side === "port" ? "winch" : null;
      if (kind) by[kind] = t["walk.stand"]?.claim;
    }
    return by;
  })();
  for (const [verb, target, holder] of [["helm", "wheel", "wheel"], ["mainsheet", "sheet", "sheet"], ["halyard", "mast", "rig"], ["winch", "winchP", "winchP"]])
    it(`${verb}: taking it holds the claim its stand spot names, on the object that carries it, for as long as you stand there`, () => {
      const s = stage();
      s.cmd(verb).run(target);
      expect(s.taken?.id).toBe(holder);
      const kind = STAND_CLAIM[verb];
      expect(typeof kind).toBe("string");
      expect(s.api.claimedBy(holder, kind)?.mine).toBe(true);
      s.leave();
      expect(s.api.claimedBy(holder, kind)).toBe(null);
    });

  it("the rig rehung under the hull beside the mast: only the mast's tag (the bin's) makes it the mast; a table never is", () => {
    const s = stage({ rehung: true });
    // untagged, with nothing of the sail's under it: just a thing aboard
    expect(s.offered("mast", s.at("mast", 0.8))).toEqual([]);
    s.scene.objects.mast = { tags: ["sailing.mast"] };
    expect(s.offered("mast", s.at("mast", 0.8))).toEqual([
      ["halyard", null, false],
      ["sail", "Lower sail", false],
    ]);
    // the table, a metre aft of the mast, in reach: nothing of the sail's
    s.worlds.table = at(0, 0.7, -0.6);
    expect(s.offered("table", s.at("table", 0.8))).toEqual([]);
  });

  // ─── out of reach: where to go ─────────────────────────────────────────

  it("aboard, a station looked at from beyond reach says where to go, greyed; past FAR, at a station, swimming or not aboard, nothing", () => {
    const s = stage();
    s.me.playing = true;
    // where to go first; the station's own verbs after it, greyed (the stage's "too far")
    const first = (o) => o[0] ?? null;
    const greyed = (o) => o.slice(1).every(([, , d]) => d);
    expect(first(s.offered("mast", s.at("mast", 6.45)))).toEqual(["far", "Sail · walk to the cockpit", true]);
    expect(first(s.offered("rig", s.at("rig", 4.9)))).toEqual(["far", "Sail · walk to the cockpit", true]);
    expect(s.offered("wheel", s.at("wheel", 5))).toEqual([["far", "Helm · walk to the wheel", true], ["helm", null, true]]);
    expect(first(s.offered("sheet", s.at("sheet", 5)))).toEqual(["far", "Mainsheet · walk to the cockpit", true]);
    expect(first(s.offered("windlass", s.at("windlass", 5)))).toEqual(["far", "Anchor · walk to the windlass", true]);
    for (const id of ["mast", "rig", "sheet", "windlass"]) expect(greyed(s.offered(id, s.at(id, 5))), id).toBe(true);
    expect(s.offered("table", s.at("table", 5))).toEqual([]);
    expect(s.offered("hull", s.at("hull", 5))).toEqual([]);
    expect(s.offered("mast", s.at("mast", FAR + 0.1)).map(([id]) => id)).not.toContain("far");
    const t = stage({ mainsheet: false });
    t.me.playing = true;
    expect(first(t.offered("mast", t.at("mast", 6.45)))).toEqual(["far", "Sail · walk to the wheel, or the mast", true]);
    // from the cockpit (standing aft of the wheel), the mast or the sail overhead: take a station there, not "walk to the cockpit"
    const helmEye = [0, 2.32, 4.85];
    expect(first(s.offered("mast", s.at("mast", 6.45, helmEye)))).toEqual(["far", "Sail · work it at the wheel or the mainsheet (F)", true]);
    expect(first(s.offered("rig", s.at("rig", 4.9, helmEye)))).toEqual(["far", "Sail · work it at the wheel or the mainsheet (F)", true]);
    expect(first(t.offered("mast", t.at("mast", 6.45, helmEye)))).toEqual(["far", "Sail · work it at the wheel (F)", true]);
    const noFar = (o) => !o.some(([id]) => id === "far");
    s.me.station = "wheel";
    expect(noFar(s.offered("mast", s.at("mast", 6.45)))).toBe(true);
    s.me.station = null;
    s.me.swimming = true;
    expect(noFar(s.offered("mast", s.at("mast", 6.45)))).toBe(true);
    s.me.swimming = false;
    s.me.playing = false;
    expect(noFar(s.offered("mast", s.at("mast", 6.45)))).toBe(true);
    // in Look (the body reaches everything) there's nowhere to go: the verbs themselves
    expect(noFar(s.offered("mast", s.at("mast", 6.45, [0, 0, 100], Infinity)))).toBe(true);
  });

  it("every command the prompt can show for one look in reach fits in its three (beyond it, where to go comes first)", () => {
    for (const o of [{ mainsheet: false, helm: false }, {}]) {
      const s = stage(o);
      s.me.playing = true;
      for (const target of ["wheel", "rig", "mast", "sheet", "windlass", "ladder", "hull", "table", "jib", "winchP", "winchS"]) {
        for (const d of [0.5, 1.5, 2.4, 3, 6, 20]) {
          for (const from of [[0, 2.6, -0.5], [0, 2.3, 2.6], [0, 0, 100]]) {
            for (const v of [{ raised: 1, sheet: 0.5 }, { raised: 0, sheet: 0.5 }]) {
              for (const jib of [{ sheet: 0.5, held: null, furl: 0 }, { sheet: 0.5, held: "port", furl: 1 }]) {
                s.values.rig = v;
                s.values.jib = jib;
                const o = s.offered(target, s.at(target, d, from));
                const live = o.filter(([id, , disabled]) => id !== "far" && !(disabled && s.state(s.cmd(id), target, s.at(target, d, from))?.title === "too far"));
                expect(live.length, `${target} ${d} ${from}`).toBeLessThanOrEqual(3);
                if (o.some(([id]) => id === "far")) expect(o[0][0]).toBe("far");
              }
            }
          }
        }
      }
    }
  });

  // ─── the jib and its winches ───

  it("a winch in reach: F takes its jib sheet, Q / E trim it held; the lazy winch's Q says where the jib is", () => {
    const s = stage();
    // the jib's to port (the wind from starboard): the port winch is the working one
    expect(s.offered("winchP", s.at("winchP", 1.2))).toEqual([
      ["winch", "Take the port jib sheet", false],
      ["jibHaul", null, false],
      ["jibEase", null, false],
    ]);
    expect(s.offered("winchS", s.at("winchS", 1.2))).toEqual([
      ["winch", "Take the starboard jib sheet", false],
      ["jibHaul", "Lazy sheet: the jib's to port", true],
    ]);
    expect(s.offered("winchP", s.at("winchP", 3))[0]).toEqual(["far", "Jib winch · walk to the cockpit", true]);
    const session = s.cmd("jibHaul").run("winchP");
    s.pass(1);
    session.update();
    session.end();
    expect(s.commits.at(-1)).toEqual(["jib", { sheet: 0.25 }]);
    expect(s.claims.jib).toBe(undefined);
    expect(s.cmd("jibEase").run("winchS")).toBe(undefined); // the lazy sheet does nothing
  });

  it("locked in at the working winch: Q / E trim, B makes the jib fast here (or lets it fly), hold R furls, each one change under the jib's claim; F leaves", () => {
    const s = stage();
    s.cmd("winch").run("winchP");
    expect(s.taken.id).toBe("winchP");
    expect(s.claims.winchP?.mine).toBe(true);
    const h = s.taken.handlers;
    // this side (port) is leeward: B makes it fast here, ready to heave to
    expect(h.hint()).toBe("Q / E jib sheet 50% · B hold jib here · hold R furl jib · F leave · jib drawing");
    expect(h.key({ code: "KeyQ", key: "q" })).toBe(true);
    expect(s.claims.jib?.mine).toBe(true);
    h.tick(1);
    h.keyup({ code: "KeyQ", key: "q" });
    expect(s.commits.at(-1)).toEqual(["jib", { sheet: 0.25 }]);
    expect(s.claims.jib).toBe(undefined);
    expect(h.key({ code: "KeyE", key: "e" })).toBe(true);
    h.tick(1);
    h.keyup({ code: "KeyE", key: "e" });
    expect(s.commits.at(-1)).toEqual(["jib", { sheet: 0.75 }]);
    expect(h.key({ code: "KeyB", key: "b" })).toBe(true);
    expect(s.commits.at(-1)).toEqual(["jib", { held: "port" }]);
    expect(s.claims.jib).toBe(undefined); // the press's claim is let go at once
    s.values.jib = { ...s.values.jib, held: "port" };
    expect(h.hint()).toMatch(/ · B let jib fly · /);
    h.key({ code: "KeyB", key: "b" });
    expect(s.commits.at(-1)).toEqual(["jib", { held: null }]);
    s.values.jib = { ...s.values.jib, held: null };
    expect(h.key({ code: "KeyR", key: "r" })).toBe(true);
    h.tick(2);
    h.keyup({ code: "KeyR", key: "r" });
    expect(s.commits.at(-1)).toEqual(["jib", { furl: 2 * FURL_RATE }]);
    s.values.jib = { ...s.values.jib, furl: 1 };
    expect(h.hint()).toMatch(/hold R unfurl jib/);
    h.key({ code: "KeyR", key: "r" });
    h.tick(1);
    h.keyup({ code: "KeyR", key: "r" });
    expect(s.commits.at(-1)).toEqual(["jib", { furl: 1 - FURL_RATE }]);
    expect(h.key({ code: "KeyW", key: "w" })).toBe(false);
    h.key({ code: "KeyF", key: "f" });
    expect(s.taken).toBe(null);
    expect(s.claims.winchP).toBe(undefined);
  });

  it("locked in at the lazy winch: Q / E do nothing; B backs the jib (this side is windward), and lets it fly again", () => {
    const s = stage();
    s.cmd("winch").run("winchS");
    const h = s.taken.handlers;
    expect(h.hint()).toBe("lazy sheet: the jib's to port · B back jib · hold R furl jib · F leave · jib drawing");
    const n = [s.inputs.length, s.commits.length];
    expect(h.key({ code: "KeyQ", key: "q" })).toBe(true);
    h.tick(1);
    h.keyup({ code: "KeyQ", key: "q" });
    expect([s.inputs.length, s.commits.length]).toEqual(n);
    expect(s.claims.jib).toBe(undefined);
    h.key({ code: "KeyB", key: "b" });
    expect(s.commits.at(-1)).toEqual(["jib", { held: "starboard" }]);
    s.values.jib = { ...s.values.jib, held: "starboard" };
    // backed: the clew's on this side now, so this is the working winch
    s.read = { ...s.read, jib: 0.12 };
    expect(h.hint()).toMatch(/^Q \/ E jib sheet 50% · B let jib fly · /);
    h.key({ code: "KeyB", key: "b" });
    expect(s.commits.at(-1)).toEqual(["jib", { held: null }]);
  });

  it("claims: a second person can't take a held winch; a second trimmer's key does nothing while the jib's claim is someone else's", () => {
    const s = stage();
    s.claims.winchP = { mine: false };
    expect(s.cmd("winch").state("winchP", s.at("winchP", 1))).toEqual({ disabled: true, label: "Someone's at the port winch" });
    s.cmd("winch").run("winchP");
    expect(s.taken).toBe(null);
    // at the other winch, while someone at the port one hauls on the jib
    s.claims.jib = { mine: false };
    expect(s.cmd("jibHaul").state("winchP", s.at("winchP", 1))).toEqual({ disabled: true, label: "Someone's trimming the jib" });
    expect(s.cmd("jibHaul").run("winchP")).toBe(undefined);
    s.cmd("winch").run("winchS");
    const h = s.taken.handlers;
    expect(h.hint()).toMatch(/ · F leave · someone's trimming the jib$/);
    const n = s.commits.length;
    h.key({ code: "KeyB", key: "b" });
    h.key({ code: "KeyR", key: "r" });
    h.tick(1);
    h.keyup({ code: "KeyR", key: "r" });
    expect(s.commits.length).toBe(n);
    // the helm's B too
    s.leave();
    s.cmd("helm").run("wheel");
    s.taken.handlers.key({ code: "KeyB", key: "b" });
    expect(s.commits.length).toBe(n);
  });

  it("the helm: B backs the jib to windward, and lets it fly; the main's keys and the jib's don't share a claim", () => {
    const s = stage();
    s.cmd("helm").run("wheel");
    const h = s.taken.handlers;
    expect(h.hint()).toMatch(/^A \/ D steer · Q \/ E sheet 50% · hold R lower sail · B back jib, bow to port · F leave · /);
    h.key({ code: "KeyB", key: "b" });
    expect(s.commits.at(-1)).toEqual(["jib", { held: "starboard" }]); // the wind's from starboard
    s.values.jib = { ...s.values.jib, held: "starboard" };
    expect(h.hint()).toMatch(/ · B let jib fly · /);
    h.key({ code: "KeyB", key: "b" });
    expect(s.commits.at(-1)).toEqual(["jib", { held: null }]);
    // on port tack it backs to port
    s.values.jib = { ...s.values.jib, held: null };
    s.read = { ...s.read, apparentWind: { angle: -0.3 }, sails: s.read.sails.map((x) => ({ ...x, from: -0.3 })) };
    h.key({ code: "KeyB", key: "b" });
    expect(s.commits.at(-1)).toEqual(["jib", { held: "port" }]);
    // someone trimming the jib at a winch doesn't stop the helmsman trimming the main
    s.claims.jib = { mine: false };
    h.key({ code: "KeyQ", key: "q" });
    expect(s.claims.rig?.mine).toBe(true);
    h.keyup({ code: "KeyQ", key: "q" });
  });

  it("the helm, dead ahead (the jib's air within its alpha0, where either side backs it): B backs it opposite the wheel, so her bow goes the way it's over; amidships, to windward; further off, the wind decides", () => {
    const s = stage();
    const air = (a) => (s.read = { ...s.read, apparentWind: { angle: a }, sails: s.read.sails.map((x) => ({ ...x, from: a })) });
    air(0.01); // a hair on her starboard bow: a coin toss
    s.values.wheel = { angle: 0 };
    s.cmd("helm").run("wheel");
    const h = s.taken.handlers;
    // amidships: windward, as anywhere else
    expect(h.hint()).toMatch(/ · B back jib, bow to port · /);
    // the wheel to port (A held 1 s): held to starboard, her bow to port
    h.key({ code: "KeyA", key: "a" });
    h.tick(1);
    h.keyup({ code: "KeyA", key: "a" });
    expect(h.hint()).toMatch(/ · B back jib, bow to port · /);
    h.key({ code: "KeyB", key: "b" });
    expect(s.commits.at(-1)).toEqual(["jib", { held: "starboard" }]);
    s.values.jib = { ...s.values.jib, held: null };
    // the wheel to starboard, even with the wind a hair on her starboard bow: held to port, her bow to starboard
    h.key({ code: "KeyD", key: "d" });
    h.tick(2);
    h.keyup({ code: "KeyD", key: "d" });
    expect(h.hint()).toMatch(/ · B back jib, bow to starboard · /);
    h.key({ code: "KeyB", key: "b" });
    expect(s.commits.at(-1)).toEqual(["jib", { held: "port" }]);
    // the band's edge is the jib's own alpha0 (5°), by its own air, not the apparent wind
    s.values.jib = { ...s.values.jib, held: null };
    air(4.9 * (Math.PI / 180));
    h.key({ code: "KeyB", key: "b" });
    expect(s.commits.at(-1)).toEqual(["jib", { held: "port" }]);
    s.values.jib = { ...s.values.jib, held: null };
    // past it only windward backs it: the wind decides whatever the wheel says, and the hint says so
    air(5.1 * (Math.PI / 180));
    expect(h.hint()).toMatch(/ · B back jib, bow to port · /);
    h.key({ code: "KeyB", key: "b" });
    expect(s.commits.at(-1)).toEqual(["jib", { held: "starboard" }]);
    // her jib's air decides, where it and the apparent wind disagree
    s.values.jib = { ...s.values.jib, held: null };
    s.read = { ...s.read, apparentWind: { angle: -0.3 }, sails: s.read.sails.map((x) => ({ ...x, from: 0.3 })) };
    h.key({ code: "KeyB", key: "b" });
    expect(s.commits.at(-1)).toEqual(["jib", { held: "starboard" }]);
  });

  it("the helm, the jib furled (as at anchor): B unrolls it backed, at FURL_RATE under the jib's claim, and lets the claim go once it's out", () => {
    const s = stage();
    s.values.jib = { sheet: 0.5, held: null, furl: 1 };
    s.read = { ...s.read, apparentWind: { angle: -0.02 }, sails: s.read.sails.map((x) => ({ ...x, from: -0.02 })) };
    s.cmd("helm").run("wheel");
    const h = s.taken.handlers;
    h.key({ code: "KeyD", key: "d" });
    h.tick(1);
    h.keyup({ code: "KeyD", key: "d" });
    expect(h.hint()).toMatch(/ · B unroll jib backed, bow to starboard · /);
    h.key({ code: "KeyB", key: "b" });
    expect(s.commits.at(-1)).toEqual(["jib", { held: "port" }]);
    s.values.jib = { ...s.values.jib, held: "port" };
    expect(s.claims.jib?.mine).toBe(true); // the unroll's
    h.tick(1);
    expect(s.inputs.at(-1)).toEqual(["jib", { furl: 1 - FURL_RATE }]);
    for (let i = 0; i < 4; i++) h.tick(1);
    expect(s.commits.at(-1)).toEqual(["jib", { furl: 0 }]);
    expect(s.claims.jib).toBe(undefined);
    s.values.jib = { ...s.values.jib, furl: 0 };
    expect(h.hint()).toMatch(/ · B let jib fly · /);
    // a furled jib let fly (B with it held) only lets it fly: no unroll
    s.values.jib = { sheet: 0.5, held: "port", furl: 1 };
    const n = s.inputs.length;
    h.key({ code: "KeyB", key: "b" });
    h.tick(1);
    expect(s.commits.at(-1)).toEqual(["jib", { held: null }]);
    expect(s.inputs.slice(n).some(([id, f]) => id === "jib" && f)).toBe(false);
  });

  it("the sheet: Q hauls in and E eases out; both at once share one claim, gone when the last lets go", () => {
    const s = stage();
    const haul = s.cmd("haul").run("sheet");
    const ease = s.cmd("ease").run("sheet");
    s.pass(1); // both held the same second
    haul.update();
    haul.end();
    expect(s.claims.rig?.mine).toBe(true);
    ease.update();
    ease.end();
    expect(s.claims.rig).toBe(undefined);
    expect(s.commits[0]).toEqual(["rig", { sheet: 0.25 }]);
    expect(s.commits[1]).toEqual(["rig", { sheet: 0.75 }]);
  });

  it("the sheet: someone else at it shows it, and a held verb then doesn't start", () => {
    const s = stage();
    s.claims.rig = { mine: false };
    expect(s.cmd("haul").state("sheet", s.at("sheet", 1))).toEqual({ disabled: true, label: "Someone's at the sheet" });
    expect(s.cmd("haul").run("sheet")).toBe(undefined);
  });

  it("the anchor: raise it (held) when it's down; drop it when it's up", () => {
    const s = stage();
    const near = s.look([0, 2.8, -3.5]);
    // how much chain there is to bring in
    expect(s.cmd("weigh").state("windlass", near)).toEqual({ label: "Raise anchor · 25 m of chain out" });
    expect(s.cmd("drop").state("windlass", near)).toBe(null);
    const session = s.cmd("weigh").run("windlass");
    for (let i = 0; i < 7 * 60; i++) s.pass(1 / 60), session.update();
    expect(s.commits).toEqual([["windlass", { down: false, rode: 0 }]]);
    expect(s.claims.windlass).toBe(undefined);
    session.end();
    expect(s.commits.length).toBe(1);
    s.values.windlass = { down: false, rode: 0 };
    expect(s.cmd("weigh").state("windlass", near)).toBe(null);
    expect(s.cmd("drop").state("windlass", near)).toEqual({});
    s.cmd("drop").run("windlass");
    const [id, f] = s.commits.at(-1);
    expect(id).toBe("windlass");
    // where it lies is the simulator's to work out and write
    expect(f).toEqual({ down: true, rode: RODE });
  });

  it("Come aboard: Enter, and a button on the stage's bar of tools in every body (show world); for the scene, until you have (S2)", () => {
    const s = stage();
    const c = s.cmd("aboard");
    expect(c.key).toBe("Enter");
    expect(c.show).toEqual(["world"]);
    // target × playing → applies (exactly the lobby: the scene's target and nobody aboard)
    const TABLE = [
      [null, false, true],
      [null, true, false],
      ["x", false, false],
      ["x", true, false],
    ];
    for (const [target, playing, applies] of TABLE) {
      s.me.playing = playing;
      const st = c.state(target, s.look(null));
      expect(st != null, `target ${target}, playing ${playing}`).toBe(applies);
      // no key in the title: the bar adds the key hint, so a title naming it would read "(Enter) (Enter)"
      if (applies) expect(st).toEqual({ title: "Walk the deck in first person" });
    }
    s.me.playing = false;
    c.run(null);
    expect(s.ctx.crew.start).toHaveBeenCalled();
  });
});

// ─── the keys a station declares ────────────────────────────────────────────

describe("the keys each station declares", () => {
  // every station a verb can take, in every variant stations.js can make: a post is the sail's keys
  // (Q E with the sheet, R with the halyard) + F; a winch the jib's (Q E R B, with a jib) + F; the
  // helm A D ← → + the sail's (sheet and halyard) + the jib's (B) + F. takePost always works the
  // halyard, so there is no post with the sheet alone. A winch declares the sheet's Q E on either
  // side, since which is the working one changes while you stand there (a tack, backing the jib):
  // at the lazy one they are declared and do nothing, a labelled action unavailable in this state
  // (a label names the action, not its state: scene/TOOLS.md §4). The last column is the codes
  // that do nothing from the station just taken.
  const Q = ["KeyQ", "Haul in"], E = ["KeyE", "Ease out"], R = ["KeyR", "Halyard"], F = ["KeyF", "Leave"];
  const FURL = ["KeyR", "Furler"], B = ["KeyB", "Back jib / let fly"];
  const STEER = [["KeyA", "Steer to port"], ["KeyD", "Steer to starboard"], ["ArrowLeft", "Steer to port"], ["ArrowRight", "Steer to starboard"]];
  const VARIANTS = {
    "the mainsheet": [{}, "mainsheet", "sheet", [Q, E, R, F]],
    "the mainsheet, no sail": [{ sail: false }, "mainsheet", "sheet", [F]],
    "the mast": [{}, "halyard", "mast", [R, F]],
    "the mast, the sheet led there (no helm, no mainsheet)": [{ helm: false, mainsheet: false }, "halyard", "mast", [Q, E, R, F]],
    "the working winch": [{}, "winch", "winchP", [Q, E, FURL, B, F]],
    "the lazy winch": [{}, "winch", "winchS", [Q, E, FURL, B, F], ["KeyQ", "KeyE"]],
    "a winch, no jib": [{ jib: false }, "winch", "winchP", [F]],
    "the helm, a sail and a jib": [{}, "helm", "wheel", [...STEER, Q, E, R, B, F]],
    "the helm, a sail only": [{ jib: false }, "helm", "wheel", [...STEER, Q, E, R, F]],
    "the helm, a jib only": [{ sail: false }, "helm", "wheel", [...STEER, B, F]],
    "the helm, neither": [{ sail: false, jib: false }, "helm", "wheel", [...STEER, F]],
  };
  const take = ([o, verb, target]) => {
    const s = stage(o);
    s.cmd(verb).run(target);
    return s;
  };
  // the key a keyboard sends with each code (the handlers read ev.key; the wheel ev.code)
  const keyOf = (code) => (code.startsWith("Key") ? code.slice(3).toLowerCase() : code);

  it.each(Object.keys(VARIANTS))("%s", (name) => {
    const v = VARIANTS[name];
    const s = take(v);
    expect(s.taken.handlers.keys).toEqual(v[3].map(([code, label]) => ({ code, label })));
  });

  it.each(Object.keys(VARIANTS))("%s: every code declared once, labelled", (name) => {
    const keys = take(VARIANTS[name]).taken.handlers.keys;
    expect(new Set(keys.map((k) => k.code)).size).toBe(keys.length);
    for (const k of keys) expect(typeof k.label === "string" && k.label.length > 0, k.code).toBe(true);
  });

  /** What holding `code` for half a second does, from a station just taken: the inputs, the writes, whether you're still there. */
  const effect = (v, code) => {
    const s = take(v);
    const h = s.taken.handlers;
    const [n, m] = [s.inputs.length, s.commits.length];
    h.key({ code, key: keyOf(code) });
    for (let i = 0; i < 30 && s.taken; i++) h.tick(1 / 60);
    h.keyup({ code, key: keyOf(code) });
    return JSON.stringify({ inputs: s.inputs.slice(n), commits: s.commits.slice(m), at: s.taken?.id ?? null });
  };

  // codes labelled alike do the same thing, and codes labelled apart don't (scene/TOOLS.md §4): a
  // touch pad shows one control per label, which presses the first of its codes. Checked from one
  // state, the station just taken in the stage's starting trim: exactly the variant's idle codes do
  // nothing there, and among the rest two codes do the same thing iff they share a label.
  it.each(Object.keys(VARIANTS))("%s: two codes do the same thing iff they share a label", (name) => {
    const v = VARIANTS[name];
    const keys = take(v).taken.handlers.keys;
    const did = Object.fromEntries(keys.map((k) => [k.code, effect(v, k.code)]));
    const nothing = JSON.stringify({ inputs: [], commits: [], at: take(v).taken.id });
    expect(keys.filter((k) => did[k.code] === nothing).map((k) => k.code)).toEqual(v[4] ?? []);
    const acting = keys.filter((k) => did[k.code] !== nothing);
    for (const a of acting) for (const b of acting) expect(did[a.code] === did[b.code], `${a.code} ${b.code}`).toBe(a.label === b.label);
  });
});
