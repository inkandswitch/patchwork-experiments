// The HUD: its model (pure) and the DOM it keeps, against a stand-in api.
import { describe, it, expect, vi } from "vitest";
import { brokenClocks } from "./test/fakes.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compass, createHud, hudModel, inIrons, knots, luffing, sailDownNudge, sailRow, speedOver, stationGuide, windFrom } from "./hud.js";

describe("the HUD's model", () => {
  it("knots and the compass", () => {
    expect(knots(1)).toBeCloseTo(1.9);
    expect(knots(5.144)).toBeCloseTo(10);
    expect(compass(0)).toEqual({ deg: 0, point: "N" });
    expect(compass(Math.PI / 4)).toEqual({ deg: 45, point: "NE" });
    expect(compass(-Math.PI / 2)).toEqual({ deg: 270, point: "W" });
    expect(compass(2 * Math.PI - 0.001)).toEqual({ deg: 0, point: "N" });
  });

  it("the hint in every state × seated × near (12 cases): before coming aboard it is empty, since what a click on her does is the base's (Edit's selects); the way in is the bar's Come aboard", () => {
    // seated (the view rides a seat) and near (the eye within a click of her) were what the
    // lobby's "Click her to come aboard" hung on; neither changes what the HUD says now
    const HINT = { lobby: "", paused: "Click to carry on", aboard: "WASD walk · Shift run · Space jump · F use" };
    const ME = { lobby: { playing: false }, paused: { playing: true, paused: true }, aboard: { playing: true } };
    const rows = [];
    for (const state of ["lobby", "paused", "aboard"]) for (const seated of [false, true]) for (const near of [false, true]) rows.push([state, seated, near]);
    expect(rows).toHaveLength(12);
    for (const [state, seated, near] of rows) {
      const m = hudModel({ me: ME[state], seated, near });
      expect(m, `${state}, seated ${seated}, near ${near}`).toMatchObject({ state, hint: HINT[state], keys: "", panel: false });
      expect(m, `${state}: the model names no seat`).not.toHaveProperty("seated");
    }
  });

  it("takes no pointer event, by construction: its root says pointer-events none and no rule of its sheet gives one back", () => {
    // the sheet as written (vitest hands a ?inline stylesheet over empty)
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "hud.css"), "utf8");
    const decls = [...css.matchAll(/pointer-events\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(decls).toEqual(["none"]);
    // the one declaration is the root's (.sail-hud), which every node of the HUD inherits
    const rule = css.slice(css.lastIndexOf("}", css.indexOf("pointer-events")) + 1, css.indexOf("pointer-events"));
    expect(rule).toMatch(/\.sail-hud:where\([^)]*\)[^{]*\{[^}]*$/);
    expect(rule).not.toMatch(/\.sail-hud\s+\S/);
  });

  it("aboard: the walking keys, a station's own hint, swimming, paused, no lock", () => {
    expect(hudModel({ me: { playing: true } })).toMatchObject({ state: "aboard", keys: "" });
    expect(hudModel({ me: { playing: true } }).hint).toMatch(/^WASD walk/);
    expect(hudModel({ me: { playing: true, hint: "A / D steer · F leave" } }).hint).toBe("A / D steer · F leave");
    expect(hudModel({ me: { playing: true, swimming: true } }).hint).toMatch(/ladder/);
    expect(hudModel({ me: { playing: true, paused: true } })).toMatchObject({ state: "paused", hint: "Click to carry on" });
    expect(hudModel({ me: { playing: true, free: true } }).hint).toMatch(/^Drag to look/);
  });

  it("the panel: speed, heading, the true wind, the sail, the anchor; the dial's angles", () => {
    const m = hudModel({
      me: { playing: true },
      read: { speed: 3, heading: Math.PI / 2, apparentWind: { speed: 8, angle: -Math.PI / 4 } },
      wind: [3, 4],
      sail: { raised: 1, sheet: 0.25 },
      anchor: { down: false },
    });
    expect(m.panel).toBe(true);
    expect(m.speed).toBe("5.8 kn");
    expect(m.heading).toBe("090° E");
    expect(m.wind).toBe("10 kn NW"); // blowing toward the south-east: from the north-west
    expect(m.sail).toBe("100% · sheet 25%");
    expect(m.anchor).toBe("Up");
    expect(m.windAngle).toBe(-45); // from the port bow: anticlockwise of the boat's nose
    // the true wind's mark: from 323° (atan2 of the wind), heading 090°: abaft the port beam
    expect(m.trueAngle).toBe(-126.9);
    expect(m.north).toBe(-90); // heading east, north is off to port
  });

  it("speed is over the ground along her bow, steadied by the caller; going astern says so", () => {
    // heading east at 2 m/s over the ground, whatever the water under her does
    expect(speedOver({ heading: Math.PI / 2, velocity: [2, 0, 0], speed: 2.6 })).toBeCloseTo(2);
    expect(speedOver({ heading: 0, velocity: [0, 0, 1] })).toBeCloseTo(-1); // heading north, moving south
    expect(speedOver({ speed: 1.5 })).toBe(1.5); // no velocity: through the water
    const read = { speed: 0, heading: 0, apparentWind: { speed: 8, angle: 0 } };
    expect(hudModel({ me: { playing: true }, read, speed: -0.4 }).speed).toBe("astern 0.8 kn");
    expect(hudModel({ me: { playing: true }, read, speed: 0.01 }).speed).toBe("0.0 kn");
    expect(windFrom([0, 5])).toBeCloseTo(0); // blowing south: from the north
  });

  it("in irons, the hint says how to get out", () => {
    const irons = { speed: -0.5, heading: 0, apparentWind: { speed: 8, angle: 0.1 } };
    expect(inIrons(irons, { raised: 1 })).toBe(true);
    expect(inIrons(irons, { raised: 0 })).toBe(false); // sail down: she's only drifting
    expect(inIrons({ ...irons, speed: 1 }, { raised: 1 })).toBe(false);
    expect(hudModel({ me: { playing: true }, read: irons, sail: { raised: 1 } }).advice).toMatch(/In irons/);
    expect(hudModel({ me: { playing: false }, read: irons, sail: { raised: 1 } }).advice).toBe("");
    // the moment before: sail up, head to wind, stopped but not yet going astern: bear away
    const stopped = { ...irons, speed: 0.1 };
    expect(luffing(stopped, { raised: 1 }, { down: false })).toBe(true);
    expect(inIrons(stopped, { raised: 1 })).toBe(false);
    expect(hudModel({ me: { playing: true }, read: stopped, sail: { raised: 1 }, anchor: { down: false } }).advice).toMatch(/^Head to wind: bear away/);
    expect(luffing(stopped, { raised: 1 }, { down: true })).toBe(false); // at anchor she lies head to wind
    expect(luffing(stopped, { raised: 0 }, { down: false })).toBe(false);
    expect(luffing({ ...stopped, speed: 2 }, { raised: 1 }, { down: false })).toBe(false); // close-hauled and moving: sailing
    expect(luffing({ ...stopped, apparentWind: { ...irons.apparentWind, angle: 1.2 } }, { raised: 1 }, { down: false })).toBe(false);
  });

  const SLOOP = { helm: "wheel", sail: "rig", anchor: "windlass", mainsheet: "sheet", ladder: "ladder" };

  it("walking her deck, a line says where her stations are and what each works", () => {
    expect(stationGuide(SLOOP)).toBe("Wheel: steer, sheet, hoist · Mainsheet (cockpit): sheet, hoist · Mast: hoist · Windlass: anchor");
    // no mainsheet (a hull rigged from the bin without one)
    expect(stationGuide({ ...SLOOP, mainsheet: null })).toBe("Wheel: steer, sheet, hoist · Mast: hoist · Windlass: anchor");
    // nowhere else to trim: the mast
    expect(stationGuide({ sail: "rig" })).toBe("Mast: hoist, sheet");
    expect(stationGuide({ helm: "wheel" })).toBe("Wheel: steer");
    expect(stationGuide({})).toBe("");
    expect(stationGuide(null)).toBe("");
    const aboard = (me) => hudModel({ me: { playing: true, ...me }, stations: SLOOP }).guide;
    expect(aboard({})).toMatch(/^Wheel: /);
    expect(aboard({ station: "wheel" })).toBe(""); // at a station its own hint says it
    expect(aboard({ swimming: true })).toBe("");
    expect(hudModel({ me: { playing: false }, stations: SLOOP }).guide).toBe("");
    expect(hudModel({ me: { playing: true, paused: true }, stations: SLOOP }).guide).toBe("");
  });

  it("the sail down with her anchor up: where to raise it", () => {
    expect(sailDownNudge(SLOOP, { raised: 0 }, { down: false })).toBe("Sail down: take the helm or the mainsheet (F) and hold R, or hold R at the mast");
    expect(sailDownNudge({ ...SLOOP, mainsheet: null }, { raised: 0 }, { down: false })).toBe("Sail down: take the helm (F) and hold R, or hold R at the mast");
    expect(sailDownNudge({ sail: "rig" }, { raised: 0.2 }, null)).toBe("Sail down: hold R at the mast to raise it");
    expect(sailDownNudge(SLOOP, { raised: 0 }, { down: true })).toBe(""); // at anchor: lowered on purpose
    expect(sailDownNudge(SLOOP, { raised: 1 }, { down: false })).toBe("");
    expect(sailDownNudge({ ...SLOOP, sail: null }, { raised: 0 }, { down: false })).toBe("");
    // in irons says its own
    const irons = { speed: -0.5, heading: 0, apparentWind: { speed: 8, angle: 0.1 } };
    expect(hudModel({ me: { playing: true }, read: irons, sail: { raised: 1 }, anchor: { down: false }, stations: SLOOP }).advice).toMatch(/In irons/);
    expect(hudModel({ me: { playing: true }, sail: { raised: 0 }, anchor: { down: false }, stations: SLOOP }).advice).toMatch(/^Sail down/);
  });
});

describe("a row per sail, on a ship that flies them apart (12)", () => {
  const DEG = Math.PI / 180;
  const MAIN = { alpha0: -4, stall: 18, width: 22, wingFrom: null };
  const JIB = { alpha0: -5, stall: 20, width: 30, wingFrom: 140 };
  const MODELS = { main: MAIN, jib: JIB };
  // a sail on starboard tack, β_e 70, its sheet asking for `as`, standing at α `a` (pinned: as; free: alpha0)
  const at = (main, as, a = as, o = {}) => {
    const beta = o.beta ?? 70;
    const sheet = o.sheet ?? beta - a;
    return { id: main ? "main" : "jib", main, from: beta * DEG, angle: (o.angle ?? -sheet) * DEG, limit: (o.limit ?? beta - as) * DEG, sheet, alpha: a, area: o.area ?? 20, q: 20 };
  };
  it("the main: drawing, soft, luffing, stalled, reefed, down; no angles, so 'drawing' never reads a negative one", () => {
    expect(sailRow(at(true, 12), MAIN, { raised: 1, sheet: 0.4 })).toEqual({ state: "drawing", text: "drawing · sheet 40%" });
    expect(sailRow(at(true, 7), MAIN, { raised: 1, sheet: 0.5 })).toEqual({ state: "soft", text: "soft · sheet 50%" });
    expect(sailRow(at(true, -2), MAIN, { raised: 1, sheet: 0.6 })).toEqual({ state: "luffing", text: "luffing · sheet 60%" });
    expect(sailRow(at(true, -8, -4), MAIN, { raised: 1, sheet: 0.8 })).toEqual({ state: "luffing", text: "luffing · sheet 80%" });
    expect(sailRow(at(true, 31), MAIN, { raised: 1, sheet: 0.1 })).toEqual({ state: "stalled", text: "stalled · sheet 10%" });
    expect(sailRow(at(true, 14), MAIN, { raised: 0.7, sheet: 0.4 })).toEqual({ state: "drawing", text: "reefed 30% · drawing" });
    // a halyard stopping just short of the block is hoisted (HOISTED 0.95), not "reefed 2%"
    expect(sailRow(at(true, 14), MAIN, { raised: 0.98, sheet: 0.4 })).toEqual({ state: "drawing", text: "drawing · sheet 40%" });
    expect(sailRow(at(true, 14), MAIN, { raised: 0.94, sheet: 0.4 })).toEqual({ state: "drawing", text: "reefed 6% · drawing" });
    expect(sailRow(at(true, 14, 14, { area: 0 }), MAIN, { raised: 0, sheet: 0.4 })).toEqual({ state: "down", text: "down" });
  });
  it("the jib: drawing, backed (the side it's held on), winged, furled part way, furled", () => {
    expect(sailRow(at(false, 10), JIB, { sheet: 0.3, furl: 0 })).toEqual({ state: "drawing", text: "drawing · sheet 30%" });
    expect(sailRow(at(false, 0, 40, { beta: 30, sheet: -10, angle: -10, limit: 10 }), JIB, { sheet: 0, held: "port", furl: 0 })).toEqual({ state: "backed", text: "backed · port" });
    expect(sailRow(at(false, 0, 190, { beta: 150, sheet: -40, angle: 40, limit: 40 }), JIB, { sheet: 0.5, held: "starboard", furl: 0 })).toEqual({ state: "wing", text: "wing · sheet 50%" });
    expect(sailRow(at(false, -9, -5), JIB, { sheet: 1, furl: 0.4 })).toEqual({ state: "luffing", text: "furled 40% · luffing" });
    expect(sailRow(at(false, 10, 10, { area: 0 }), JIB, { furl: 1 })).toEqual({ state: "down", text: "furled" });
  });
  it("the jib: rolling out held on a side reads what the crew chose, 'unrolling · backed <side>', whatever its clew is doing on the way", () => {
    // the clew not yet across: the read says luffing, to port
    expect(sailRow(at(false, -9, -5), JIB, { sheet: 0.5, held: "starboard", furl: 0.03 })).toEqual({ state: "backed", text: "unrolling · backed starboard" });
    expect(sailRow(at(false, 0, 40, { beta: 30, sheet: -10, angle: -10, limit: 10 }), JIB, { sheet: 0.5, held: "port", furl: 0.5 })).toEqual({ state: "backed", text: "unrolling · backed port" });
  });
  it("the jib: stalled with its sheet right out reads 'eased out · stalled' in the neutral colour (state 'eased'); without a Jib piece, no sheet", () => {
    const k = { ...JIB, maxDeg: 60 };
    expect(sailRow(at(false, 40, 40, { beta: 100 }), k, { sheet: 1, furl: 0 })).toEqual({ state: "eased", text: "eased out · stalled · sheet 100%" });
    expect(sailRow(at(false, 41, 41, { beta: 100 }), k, { sheet: 0.98, furl: 0 })).toEqual({ state: "stalled", text: "stalled · sheet 98%" });
    expect(sailRow(at(false, 15), JIB, null)).toEqual({ state: "drawing", text: "drawing" });
  });
  it("hudModel: Main and Jib rows in place of Sail; without a contract, the Sail row as it was", () => {
    const read = { speed: 3, heading: 0, apparentWind: { speed: 8, angle: 1.2 }, sails: [at(true, 12), at(false, 10)] };
    const m = hudModel({ me: { playing: true }, read, sail: { raised: 1, sheet: 0.4 }, jib: { sheet: 0.3, held: null, furl: 0 }, models: MODELS });
    expect(m).toMatchObject({ sail: "", main: "drawing · sheet 40%", mainTrim: "drawing", jib: "drawing · sheet 30%", jibTrim: "drawing" });
    // no Jib piece (a contract jib trimmed with the main): no made-up sheet
    expect(hudModel({ me: { playing: true }, read, sail: { raised: 1, sheet: 0.4 }, jib: null, models: MODELS }).jib).toBe("drawing");
    const old = hudModel({ me: { playing: true }, read: { ...read, sails: undefined }, sail: { raised: 1, sheet: 0.4 } });
    expect(old).toMatchObject({ sail: "100% · sheet 40%", main: "", jib: "", mainTrim: "", jibTrim: "" });
  });
  it("in irons or head to wind on a contract ship with a Jib piece: back the jib from the helm, the wheel choosing the side", () => {
    const irons = { speed: -0.5, heading: 0, apparentWind: { speed: 8, angle: 0.1 }, sails: [at(true, -8, -4), at(false, -9, -5)] };
    const stations = { helm: "wheel", sail: "rig", jib: "jib", winches: ["p", "s"] };
    expect(hudModel({ me: { playing: true }, read: irons, sail: { raised: 1 }, models: MODELS, stations }).advice).toBe("In irons: back the jib (B at the helm; dead ahead, the wheel picks the way)");
    expect(hudModel({ me: { playing: true }, read: { ...irons, speed: 0.1 }, sail: { raised: 1 }, anchor: { down: false }, models: MODELS, stations }).advice).toBe("Head to wind: back the jib (B at the helm; dead ahead, the wheel picks the way)");
  });
  it("no jib to back (no Jib piece, or a main-only rig): the plain advice, never a key that does nothing", () => {
    const irons = { speed: -0.5, heading: 0, apparentWind: { speed: 8, angle: 0.1 }, sails: [at(true, -8, -4), at(false, -9, -5)] };
    const noPiece = { helm: "wheel", sail: "rig", jib: null, winches: [] };
    expect(hudModel({ me: { playing: true }, read: irons, sail: { raised: 1 }, models: MODELS, stations: noPiece }).advice).toBe("In irons, going astern: lower the sail and let her fall off, then raise it");
    const mainOnly = { ...irons, sails: [at(true, -8, -4)] };
    expect(hudModel({ me: { playing: true }, read: mainOnly, sail: { raised: 1 }, models: MODELS, stations: { helm: "wheel", sail: "rig", jib: "jib" } }).advice).toBe("In irons, going astern: lower the sail and let her fall off, then raise it");
    expect(hudModel({ me: { playing: true }, read: { ...mainOnly, speed: 0.1 }, sail: { raised: 1 }, anchor: { down: false }, models: MODELS }).advice).toBe("Head to wind: bear away (A / D at the helm) until the sail fills");
  });
  it("the jib furled with her anchor up: unroll it at a winch; walking her deck, the winches are named", () => {
    const st = { helm: "wheel", sail: "rig", anchor: "windlass", mainsheet: "sheet", jib: "jib", winches: ["p", "s"], ladder: "ladder" };
    expect(sailDownNudge(st, { raised: 1 }, { down: false }, { furl: 1 })).toBe("Jib furled: hold R at a winch");
    expect(sailDownNudge(st, { raised: 0 }, { down: false }, { furl: 1 })).toBe("Sail down: take the helm or the mainsheet (F) and hold R, or hold R at the mast · jib furled: hold R at a winch");
    expect(sailDownNudge(st, { raised: 1 }, { down: true }, { furl: 1 })).toBe(""); // at anchor: rolled away on purpose
    expect(sailDownNudge(st, { raised: 1 }, { down: false }, { furl: 0.2 })).toBe("");
    expect(sailDownNudge({ ...st, winches: [] }, { raised: 1 }, { down: false }, { furl: 1 })).toBe("");
    expect(stationGuide(st)).toBe("Wheel: steer, sheet, hoist · Mainsheet (cockpit): sheet, hoist · Mast: hoist · Winches: jib sheet, furl · Windlass: anchor");
  });
});

describe("the HUD", () => {
  function stage(me) {
    const overlay = document.createElement("div");
    const loops = [];
    const clock = { t: 0, asked: [] }; // the doc's world time, and the times the wind was read at
    const api = {
      style: vi.fn(),
      overlay: () => overlay,
      loop: (fn) => (loops.push(fn), () => {}),
      worldOf: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      clock: { t: () => clock.t },
    };
    const ctx = {
      // a boat alone: her doc is the world
      sea: { wind: { at: (x, z, t) => (clock.asked.push(t), [0, -5]) }, world: () => true },
      sim: {
        ships: () => ["hull"],
        read: () => ({ speed: 2, heading: 0, apparentWind: { speed: 6, angle: 0.5 } }),
        stationsOf: () => ({ sail: "rig", anchor: "windlass" }),
        value: (id) => (id === "rig" ? { raised: 0.5, sheet: 0.5 } : { down: true }),
      },
      crew: { me: () => me.current, start: vi.fn() },
    };
    const hud = createHud(api, ctx);
    return { overlay, loops, api, ctx, hud, clock, root: overlay.querySelector(".sail-hud"), tick: () => hud.tick(0.2) }; // play.js ticks it each frame
  }

  it("reads the wind at the doc's world time, api.clock.t(), at every t of the table", () => {
    const s = stage({ current: { playing: true, on: "hull" } });
    for (const t of [0, 1.5, 30]) {
      s.clock.t = t;
      s.clock.asked.length = 0;
      s.tick();
      expect([t, s.clock.asked]).toEqual([t, [t]]);
    }
  });

  it("has no fallback for the clock: broken each way, the tick throws and the wind is asked at no time", () => {
    const s = stage({ current: { playing: true, on: "hull" } });
    const clock = s.api.clock;
    for (const row of brokenClocks(clock)) {
      s.api.clock = row.clock;
      s.clock.asked.length = 0;
      expect(() => s.tick(), row.name).toThrow(row.throws);
      expect(s.clock.asked, row.name).toEqual([]);
    }
    s.api.clock = clock; // and whole again, it reads the wind once, at t
    s.clock.asked.length = 0;
    s.tick();
    expect(s.clock.asked).toEqual([0]);
  });

  it("never holds a button (S1): in every state it reads, and the way in is the bar's Come aboard", () => {
    // state → me, and whether the view rides a seat (a body over the stage's Look, not the crew's)
    const STATES = [
      ["lobby", { playing: false }, false],
      ["seated", { playing: false }, true],
      ["aboard", { playing: true, on: "hull" }, false],
      ["paused", { playing: true, on: "hull", paused: true }, false],
      ["swimming", { playing: true, on: null, swimming: true }, false],
    ];
    const me = { current: STATES[0][1] };
    const s = stage(me);
    for (const [name, m, seated] of STATES) {
      me.current = m;
      s.api.body = { current: () => (seated ? { depth: 1, ext: "tabletop" } : { depth: 0 }) };
      s.tick();
      expect(s.root.querySelector("button"), name).toBe(null);
      expect(s.root.dataset.state, name).toBe(name === "seated" || name === "lobby" ? "lobby" : name === "swimming" ? "aboard" : name);
      if (name === "lobby" || name === "seated") expect(s.root.querySelector('[data-k="hint"]').textContent, name).toBe("");
      expect(s.root.style.display, name).toBe(""); // shown: her doc is the world
    }
    // never asks the crew to start: only the command does (stations.js "aboard")
    expect(s.ctx.crew.start).not.toHaveBeenCalled();
  });

  it("before you're aboard: the dial is up (the ship is there to read), the hint empty, near her or not", () => {
    const me = { current: { playing: false } };
    const s = stage(me);
    expect(s.root.dataset.state).toBe("lobby");
    expect(s.root.querySelector('[data-k="hint"]').textContent).toBe("");
    expect(s.root.querySelector(".sail-panel").hidden).toBe(false);
    expect(s.root.querySelector('[data-k="speed"]').textContent).toBe("3.9 kn");
    // the eye a few metres from her (at the world's origin, as worldOf says): a click there is Look's
    // way aboard and Edit's selection, and the HUD can't tell which, so it still says nothing
    s.api.camera = { get: () => ({ position: [10, 5, 10] }) };
    s.tick();
    expect(s.root.querySelector('[data-k="hint"]').textContent).toBe("");
  });

  it("shows only where her doc is the world, or while you're aboard: linked into a harbour nobody sees it until they come aboard; with no ship, nobody does", () => {
    const me = { current: { playing: false } };
    const s = stage(me);
    const shown = () => s.root.style.display !== "none";
    expect(shown()).toBe(true);
    s.ctx.sea.world = () => false;
    s.tick();
    expect(shown()).toBe(false);
    me.current = { playing: true, on: "hull" };
    s.tick();
    expect(shown()).toBe(true);
    me.current = { playing: false };
    s.ctx.sea.world = () => true;
    s.ctx.sim.ships = () => [];
    s.tick();
    expect(shown()).toBe(false);
  });

  it("aboard: the crosshair's state, the hint line, and the numbers as they change", () => {
    const me = { current: { playing: true, on: "hull" } };
    const s = stage(me);
    expect(s.root.dataset.state).toBe("aboard");
    expect(s.root.querySelector('[data-k="hint"]').textContent).toMatch(/^WASD walk/);
    expect(s.root.querySelector('[data-k="wind"]').textContent).toBe("10 kn S");
    expect(s.root.querySelector('[data-k="sail"]').textContent).toBe("50% · sheet 50%");
    expect(s.root.querySelector('[data-k="anchor"]').textContent).toBe("Down");
    expect(s.root.querySelector('[data-k="guide"]').textContent).toBe("Mast: hoist, sheet · Windlass: anchor");
    expect(s.root.querySelector('[data-k="guide"]').hidden).toBe(false);
    me.current = { playing: true, on: "hull", station: "wheel", hint: "A / D steer · F leave" };
    s.tick();
    expect(s.root.querySelector('[data-k="hint"]').textContent).toBe("A / D steer · F leave");
    expect(s.root.querySelector('[data-k="guide"]').hidden).toBe(true);
    me.current = { playing: true, paused: true };
    s.tick();
    expect(s.root.dataset.state).toBe("paused");
  });

  it("on a contract ship: a Main and a Jib row, each coloured by its state (data-trim), the Sail row hidden", () => {
    const me = { current: { playing: true, on: "hull" } };
    const s = stage(me);
    const DEG = Math.PI / 180;
    s.ctx.sim.read = () => ({
      speed: 2,
      heading: 0,
      apparentWind: { speed: 6, angle: 0.5 },
      sails: [
        { id: "main", main: true, from: 60 * DEG, angle: -45 * DEG, limit: 45 * DEG, sheet: 45, alpha: 15, area: 30, q: 20 },
        // eased past its air: it lies at alpha0, inside its sheet's 30°
        { id: "jib", main: false, from: 20 * DEG, angle: -25 * DEG, limit: 30 * DEG, sheet: 25, alpha: -5, area: 30, q: 20 },
      ],
    });
    s.ctx.sim.sailModels = () => ({ main: { alpha0: -4, stall: 18, width: 22, wingFrom: null }, jib: { alpha0: -5, stall: 20, width: 30, wingFrom: 140 } });
    s.ctx.sim.stationsOf = () => ({ sail: "rig", anchor: "windlass", jib: "jib", winches: [] });
    s.ctx.sim.value = (id) => (id === "rig" ? { raised: 1, sheet: 0.5 } : id === "jib" ? { sheet: 1, held: null, furl: 0 } : { down: true });
    s.tick();
    const dd = (k) => s.root.querySelector(`[data-k="${k}"]`);
    expect(dd("main").textContent).toBe("drawing · sheet 50%");
    expect(dd("main").dataset.trim).toBe("drawing");
    expect(dd("jib").textContent).toBe("luffing · sheet 100%");
    expect(dd("jib").dataset.trim).toBe("luffing");
    expect(dd("sail").hidden).toBe(true);
  });
});
