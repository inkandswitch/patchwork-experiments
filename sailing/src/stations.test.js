// The verbs aboard: reach, the wheel, the held verbs' sessions (pure),
// and the commands against a stand-in api and context. The cases are the
// finite list of what a look can be (DESIGN.md, "Stations"): at each kind of
// station, in reach (to the point looked at, or the origin without one), out
// of reach but in sight, past sight; the mast as the rig's parent, by its
// tag, or standing under the gooseneck (an older doc); and each station you
// lock in to, with which of the sail's keys work there.
import { describe, it, expect, vi } from "vitest";
import { FAR, FURL_RATE, RODE, WINCH_RATE, approach, heldTrim, heldWeigh, lookDistance, sheetAtMast, stationCommands, walkTo, wheelStep, within } from "./stations.js";

describe("reach", () => {
  it("is within 2.5 m of the eye", () => {
    expect(within([0, 1.6, 0], [0, 1.6, 2.4])).toBe(true);
    expect(within([0, 1.6, 0], [0, 0, 2.4])).toBe(false);
    expect(within(undefined, [0, 0, 0])).toBe(false);
    expect(within([0, 0, 0], null)).toBe(false);
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

describe("held verbs", () => {
  it("a trim moves toward its goal while held, live, and commits once where it got to", () => {
    const input = vi.fn();
    const commit = vi.fn();
    const done = vi.fn();
    const s = heldTrim({ value: 1, goal: 0, rate: 0.25, input, commit, done });
    for (let i = 0; i < 60; i++) s.update(1 / 60);
    expect(s.value).toBeCloseTo(0.75);
    expect(input).toHaveBeenLastCalledWith(s.value);
    s.end();
    s.cancel();
    s.update(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0][0]).toBeCloseTo(0.75);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("a cancelled trim commits where it got to; one whose claim is lost stops and writes nothing", () => {
    const commit = vi.fn();
    const c = heldTrim({ value: 0.5, goal: 1, rate: 0.25, input() {}, commit });
    c.update(1);
    c.cancel();
    expect(commit).toHaveBeenCalledWith(0.75);
    let alive = true;
    const commit2 = vi.fn();
    const done = vi.fn();
    const l = heldTrim({ value: 0.5, goal: 1, rate: 0.25, input() {}, commit: commit2, alive: () => alive, done });
    l.update(1);
    alive = false;
    l.update(1);
    expect(l.open).toBe(false);
    l.end();
    expect(commit2).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("weighing a full rode takes about six seconds, and up it commits at once", () => {
    const commit = vi.fn();
    const input = vi.fn();
    const s = heldWeigh({ rode: RODE, input, commit });
    let t = 0;
    while (s.open && t < 20) {
      s.update(1 / 60);
      t += 1 / 60;
    }
    expect(t).toBeCloseTo(6, 1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith({ down: false, rode: 0 });
    s.end();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("let go part way, the rode is where it got to; an anchor down short still takes a moment", () => {
    const commit = vi.fn();
    const s = heldWeigh({ rode: 20, input() {}, commit });
    s.update(1);
    s.end();
    expect(commit).toHaveBeenCalledWith({ rode: 20 - WINCH_RATE });
    const short = heldWeigh({ rode: 0, input() {}, commit: vi.fn() });
    short.update(0.5);
    expect(short.open).toBe(true);
    short.update(1);
    expect(short.open).toBe(false);
  });
});

// ─── the commands on a stand-in stage ───────────────────────────────────────

const at = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

/**
 * A sloop on a stand-in stage. `mainsheet`: she has one (in the cockpit).
 * `old`: the rig hangs from the hull beside the mast, as docs made before
 * the rig hung from the mast have it.
 */
function stage({ mainsheet = true, helm = true, old = false } = {}) {
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
      winchP: { traits: { "sailing.winch": { sail: "jib", side: "port", stand: [0.73, -0.51, 0] } } },
      winchS: { traits: { "sailing.winch": { sail: "jib", side: "starboard", stand: [-0.73, -0.51, 0] } } },
    },
    // the boom and sail hang from the mast, as the sloop's parts put them
    parents: new Map([["wheel", "hull"], ["rig", old ? "hull" : "mast"], ["sheet", "hull"], ["windlass", "hull"], ["ladder", "hull"], ["mast", "hull"], ["table", "hull"], ["board", "table"], ["jib", "mast"], ["winchP", "hull"], ["winchS", "winchP"]]),
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
  };
  const worlds = { hull: at(0, 0, 0), wheel: at(0, 1.6, 4), rig: at(0, 2.8, -1.5), sheet: at(0, 0.72, 3.3), windlass: at(0, 1.5, -3.8), ladder: at(1.8, 1.2, 0.4), mast: at(0, 1.4, -1.6), table: at(0, 0.7, -0.6), board: at(0, 1.4, -0.6), jib: at(0, 1.74, -6.12), winchP: at(-0.95, 1.23, 2.25), winchS: at(0.95, 1.23, 2.25) };
  s.worlds = worlds;
  // claims by id, each kind apart ("station" under the bare id, as the tests read it)
  const slot = (id, kind) => (kind === "station" ? id : `${id}:${kind}`);
  s.api = {
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
    sea: { clock: () => 0, ocean: { heightAt: () => 0 } },
    sim: {
      value: (id) => s.values[id],
      input: (id, f) => s.inputs.push([id, f]),
      commit: (id, f) => s.commits.push([id, f]),
      stationsOf: () => ({ helm: helm ? "wheel" : null, sail: "rig", anchor: "windlass", mainsheet: mainsheet ? "sheet" : null, jib: "jib", ladder: "ladder", winches: ["winchP", "winchS"] }),
      read: () => s.read,
      sailModels: () => ({ jib: { alpha0: -5, stall: 20, width: 30, wingFrom: 140 } }),
    },
    crew: {
      me: () => s.me,
      take(id, handlers) {
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
      board: vi.fn(),
      start: vi.fn(),
    },
  };
  s.commands = stationCommands(s.api, s.ctx);
  s.cmd = (id) => s.commands.find((c) => c.id === id);
  s.look = (from) => ({ scene: s.scene, local: {}, from, hit: null });
  /** A look that lands on `id`, `distance` away (from an eye that's wherever, `from`). */
  s.at = (id, distance, from = [0, 0, 100]) => ({ scene: s.scene, local: {}, from, hit: { id, point: null, distance } });
  /** The verbs the prompt would offer for a look at `target` (in order; it shows three), as [id, label?, disabled?]. */
  s.offered = (target, c) =>
    s.commands
      .map((cmd) => [cmd, cmd.state?.(target, c)])
      .filter(([, st]) => st)
      .map(([cmd, st]) => [cmd.id, st.label ?? null, !!st.disabled]);
  return s;
}

describe("the commands", () => {
  it("each has a key and shows on the use prompt; they apply only within reach, to what they work", () => {
    const s = stage();
    for (const c of s.commands.filter((c) => c.id !== "aboard")) {
      expect(c.key).toBeTruthy();
      expect(c.show).toEqual(["use"]);
    }
    const near = s.look([0, 2.3, 5]);
    const far = s.look([0, 2.3, 9]);
    expect(s.cmd("helm").state("wheel", near)).toEqual({});
    expect(s.cmd("helm").state("wheel", far)).toBe(null);
    expect(s.cmd("helm").state("wheel", { scene: s.scene, local: {} })).toBe(null); // no eye: the key map's
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
    expect(s.offered("sheet", s.at("sheet", 3))).toEqual([["far", "Mainsheet · walk to the cockpit", true]]); // out of reach
    const session = s.cmd("haul").run("sheet");
    session.update(1);
    session.end();
    expect(s.commits.at(-1)).toEqual(["rig", { sheet: 0.25 }]);
  });

  it("the mainsheet: F locks you in at it; Q / E trim and hold R hoists, each under the sail's claim; F leaves", () => {
    const s = stage();
    s.cmd("mainsheet").run("sheet");
    expect(s.taken.id).toBe("sheet"); // its stand spot, in her navmesh
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
    expect(s.offered("rig", s.at("rig", 3.2, [0, 2.6, -0.5]))).toEqual([["far", "Sail · work it at the mast (F)", true]]);
    expect(s.offered("rig", s.at("rig", 3.2, [0, 3, -5.2]))).toEqual([["far", "Sail · walk to the cockpit", true]]); // from the foredeck
  });

  it("no hit: reach falls back to the origin (the key map's look, a hover without a point)", () => {
    const s = stage();
    expect(s.cmd("sail").state("rig", s.look([0, 2.5, 0.4]))).toEqual({ label: "Lower sail" }); // 1.9 m from the gooseneck
    expect(s.cmd("sail").state("rig", s.look([0, 2.5, 2]))).toBe(null);
    expect(s.cmd("helm").state("wheel", { scene: s.scene, local: {} })).toBe(null); // no eye
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

  it("an older doc (the rig under the hull beside the mast): the mast still works the sail, a table a metre off doesn't", () => {
    const s = stage({ old: true });
    expect(s.offered("mast", s.at("mast", 0.8))).toEqual([
      ["halyard", null, false],
      ["sail", "Lower sail", false],
    ]);
    // the table, a metre aft of the mast, in reach: nothing of the sail's
    s.worlds.table = at(0, 0.7, -0.6);
    expect(s.offered("table", s.at("table", 0.8))).toEqual([]);
    // a mast moved off from under the gooseneck isn't it any more…
    s.worlds.mast = at(0, 1.4, -0.6);
    expect(s.offered("mast", s.at("mast", 0.8))).toEqual([]);
    // …unless it says it's the mast (the bin's tag)
    s.scene.objects.mast = { tags: ["sailing.mast"] };
    expect(s.offered("mast", s.at("mast", 0.8)).map(([id]) => id)).toEqual(["halyard", "sail"]);
    // a heeled ship: in her frame, the mast still stands under the gooseneck
    const t = stage({ old: true });
    const c = Math.cos(0.4);
    const sn = Math.sin(0.4);
    const heel = (x, y, z) => [c, sn, 0, 0, -sn, c, 0, 0, 0, 0, 1, 0, ...[c * x - sn * y, sn * x + c * y, z], 1];
    Object.assign(t.worlds, { hull: heel(0, 0, 0), mast: heel(0, 1.4, -1.6), rig: heel(0, 2.8, -1.5) });
    expect(t.offered("mast", t.at("mast", 0.8)).map(([id]) => id)).toEqual(["halyard", "sail"]);
  });

  // ─── out of reach: where to go ─────────────────────────────────────────

  it("aboard, a station looked at from beyond reach says where to go, greyed; past FAR, at a station, swimming or not aboard, nothing", () => {
    const s = stage();
    s.me.playing = true;
    expect(s.offered("mast", s.at("mast", 6.45))).toEqual([["far", "Sail · walk to the cockpit", true]]);
    expect(s.offered("rig", s.at("rig", 4.9))).toEqual([["far", "Sail · walk to the cockpit", true]]);
    expect(s.offered("wheel", s.at("wheel", 5))).toEqual([["far", "Helm · walk to the wheel", true]]);
    expect(s.offered("sheet", s.at("sheet", 5))).toEqual([["far", "Mainsheet · walk to the cockpit", true]]);
    expect(s.offered("windlass", s.at("windlass", 5))).toEqual([["far", "Anchor · walk to the windlass", true]]);
    expect(s.offered("table", s.at("table", 5))).toEqual([]);
    expect(s.offered("hull", s.at("hull", 5))).toEqual([]);
    expect(s.offered("mast", s.at("mast", FAR + 0.1))).toEqual([]);
    const t = stage({ mainsheet: false });
    t.me.playing = true;
    expect(t.offered("mast", t.at("mast", 6.45))).toEqual([["far", "Sail · walk to the wheel, or the mast", true]]);
    // from the cockpit (standing aft of the wheel), the mast or the sail overhead: take a station there, not "walk to the cockpit"
    const helmEye = [0, 2.32, 4.85];
    expect(s.offered("mast", s.at("mast", 6.45, helmEye))).toEqual([["far", "Sail · work it at the wheel or the mainsheet (F)", true]]);
    expect(s.offered("rig", s.at("rig", 4.9, helmEye))).toEqual([["far", "Sail · work it at the wheel or the mainsheet (F)", true]]);
    expect(t.offered("mast", t.at("mast", 6.45, helmEye))).toEqual([["far", "Sail · work it at the wheel (F)", true]]);
    s.me.station = "wheel";
    expect(s.offered("mast", s.at("mast", 6.45))).toEqual([]);
    s.me.station = null;
    s.me.swimming = true;
    expect(s.offered("mast", s.at("mast", 6.45))).toEqual([]);
    s.me.swimming = false;
    s.me.playing = false;
    expect(s.offered("mast", s.at("mast", 6.45))).toEqual([]);
  });

  it("every command the prompt can show for one look fits in its three", () => {
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
                expect(s.offered(target, s.at(target, d, from)).length, `${target} ${d} ${from}`).toBeLessThanOrEqual(3);
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
    expect(s.offered("winchP", s.at("winchP", 3))).toEqual([["far", "Jib winch · walk to the cockpit", true]]);
    const session = s.cmd("jibHaul").run("winchP");
    session.update(1);
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
    haul.update(1);
    haul.end();
    expect(s.claims.rig?.mine).toBe(true);
    ease.update(1);
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
    for (let i = 0; i < 7 * 60; i++) session.update(1 / 60);
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

  it("the ladder: Climb aboard only when you're swimming within reach, looking at it or the hull", () => {
    const s = stage();
    const near = s.look([2.4, 0.3, 0.4]);
    expect(s.cmd("climb").state("ladder", near)).toBe(null);
    s.me.swimming = true;
    expect(s.cmd("climb").state("ladder", near)).toEqual({});
    expect(s.cmd("climb").state("hull", near)).toEqual({});
    expect(s.cmd("climb").state("ladder", s.look([8, 0.3, 0.4]))).toBe(null);
    expect(s.cmd("climb").state("wheel", near)).toBe(null);
    s.cmd("climb").run("ladder");
    expect(s.ctx.crew.board).toHaveBeenCalledWith("hull");
  });

  it("Enter comes aboard, for the scene, until you have", () => {
    const s = stage();
    s.me.playing = false;
    const c = s.cmd("aboard");
    expect(c.key).toBe("Enter");
    expect(c.state(null, s.look(null))).toBeTruthy();
    expect(c.state("hull", s.look(null))).toBe(null);
    c.run(null);
    expect(s.ctx.crew.start).toHaveBeenCalled();
    s.me.playing = true;
    expect(c.state(null, s.look(null))).toBe(null);
  });
});
