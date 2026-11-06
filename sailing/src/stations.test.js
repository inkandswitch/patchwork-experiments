// The verbs aboard: reach, the wheel, the held verbs' sessions (pure),
// and the commands against a stand-in api and context.
import { describe, it, expect, vi } from "vitest";
import { RODE, WINCH_RATE, approach, heldTrim, heldWeigh, stationCommands, wheelStep, within } from "./stations.js";

describe("reach", () => {
  it("is within 2.5 m of the eye", () => {
    expect(within([0, 1.6, 0], [0, 1.6, 2.4])).toBe(true);
    expect(within([0, 1.6, 0], [0, 0, 2.4])).toBe(false);
    expect(within(undefined, [0, 0, 0])).toBe(false);
    expect(within([0, 0, 0], null)).toBe(false);
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

function stage() {
  const scene = {
    objects: {
      hull: { traits: { "sailing.ship": {} } },
      wheel: { traits: { "sailing.helm": { angle: 0 } } },
      rig: { traits: { "sailing.sail": { raised: 1, sheet: 0.5 } } },
      windlass: { traits: { "sailing.anchor": { down: true, rode: 0 } } },
      ladder: {},
      mast: {},
      // a card table in her cockpit, and a board on it: aboard, but no part of her rig
      table: {},
      board: {},
    },
    // the boom and sail hang from the mast, as the sloop's parts put them
    parents: new Map([["wheel", "hull"], ["rig", "mast"], ["windlass", "hull"], ["ladder", "hull"], ["mast", "hull"], ["table", "hull"], ["board", "table"]]),
  };
  const s = {
    scene,
    claims: {}, // id → { mine, onLost }
    values: { wheel: { angle: 0.2 }, rig: { raised: 1, sheet: 0.5 }, windlass: { down: true, rode: 25 } },
    inputs: [],
    commits: [],
    me: { playing: true, swimming: false, station: null },
    taken: null,
    holds: {}, // id → transform
    released: [], // [id, opts]
  };
  const worlds = { hull: at(0, 0, 0), wheel: at(0, 1.6, 4), rig: at(0, 2.3, -1.6), windlass: at(0, 1.5, -4.3), ladder: at(1.8, 1.2, 0.4), mast: at(0, 1.4, -1.6), table: at(0, 0.7, -0.6), board: at(0, 1.4, -0.6) };
  s.api = {
    scene: () => s.scene,
    worldOf: (id) => worlds[id] ?? null,
    content: (id) => (id === "hull" ? { box: { min: [-2, -2, -6.2], max: [2, 15, 6] } } : null),
    claim(id, kind, { onLost } = {}) {
      const c = s.claims[id];
      if (c && !c.mine) return null;
      s.claims[id] = { mine: true, onLost };
      return () => {
        if (s.claims[id]?.mine) delete s.claims[id];
      };
    },
    claimedBy: (id) => (s.claims[id] ? { viewer: "v", session: "x", mine: s.claims[id].mine } : null),
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
      stationsOf: () => ({ helm: "wheel", sail: "rig", anchor: "windlass", ladder: "ladder" }),
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

  it("the sail's verbs from the mast: looking at it works the sail", () => {
    const s = stage();
    const near = s.look([0, 2.5, -0.5]);
    expect(s.cmd("sail").state("mast", near)).toEqual({ label: "Lower sail" });
    expect(s.cmd("haul").state("mast", near)).toEqual({});
    expect(s.cmd("sail").state("mast", s.look([0, 2.5, 6]))).toBe(null); // out of reach of the sail
    expect(s.cmd("sail").state("hull", near)).toBe(null); // the deck isn't the mast
    expect(s.cmd("sail").state("windlass", near)).toBe(null); // a station of its own
    // something else aboard within reach of the sail, with no traits: no part of the sail
    expect(s.cmd("sail").state("table", near)).toBe(null);
    expect(s.cmd("sail").state("board", near)).toBe(null);
    expect(s.cmd("haul").state("board", near)).toBe(null);
    const session = s.cmd("haul").run("mast");
    session.update(1);
    session.end();
    expect(s.commits.at(-1)).toEqual(["rig", { sheet: 0.25 }]);
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

  it("the sail: F lowers a raised sail (and raises a lowered one), held, under the station's claim", () => {
    const s = stage();
    const near = s.look([0, 2.5, -0.5]);
    expect(s.cmd("sail").state("rig", near)).toEqual({ label: "Lower sail" });
    expect(s.cmd("sail").hold).toBe(true);
    const session = s.cmd("sail").run("rig");
    expect(s.claims.rig.mine).toBe(true);
    for (let i = 0; i < 120; i++) session.update(1 / 60);
    expect(s.inputs.at(-1)[1].raised).toBeCloseTo(0.5);
    session.end();
    expect(s.commits).toEqual([["rig", { raised: expect.closeTo(0.5, 5) }]]);
    expect(s.claims.rig).toBe(undefined);
    s.values.rig = { raised: 0.2, sheet: 0.5 };
    expect(s.cmd("sail").state("rig", near)).toEqual({ label: "Raise sail" });
  });

  it("the sheet: Q hauls in and E eases out; both at once share one claim, gone when the last lets go", () => {
    const s = stage();
    const haul = s.cmd("haul").run("rig");
    const ease = s.cmd("ease").run("rig");
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
    expect(s.cmd("haul").state("rig", s.look([0, 2.5, -0.5]))).toEqual({ disabled: true, label: "Someone's at the sheet" });
    expect(s.cmd("haul").run("rig")).toBe(undefined);
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
