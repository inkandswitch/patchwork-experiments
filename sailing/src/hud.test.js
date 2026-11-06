// The HUD: its model (pure) and the DOM it keeps, against a stand-in api.
import { describe, it, expect, vi } from "vitest";
import { compass, createHud, hudModel, inIrons, knots, speedOver, windFrom } from "./hud.js";

describe("the HUD's model", () => {
  it("knots and the compass", () => {
    expect(knots(1)).toBeCloseTo(1.9);
    expect(knots(5.144)).toBeCloseTo(10);
    expect(compass(0)).toEqual({ deg: 0, point: "N" });
    expect(compass(Math.PI / 4)).toEqual({ deg: 45, point: "NE" });
    expect(compass(-Math.PI / 2)).toEqual({ deg: 270, point: "W" });
    expect(compass(2 * Math.PI - 0.001)).toEqual({ deg: 0, point: "N" });
  });

  it("before coming aboard: the way in and the keys", () => {
    const m = hudModel({ me: { playing: false } });
    expect(m.state).toBe("lobby");
    expect(m.hint).toBe("Click to come aboard");
    expect(m.keys).toMatch(/WASD/);
    expect(m.panel).toBe(false);
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
  });
});

describe("the HUD", () => {
  function stage(me) {
    const overlay = document.createElement("div");
    const loops = [];
    const api = {
      style: vi.fn(),
      overlay: () => overlay,
      loop: (fn) => (loops.push(fn), () => {}),
      worldOf: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    };
    const ctx = {
      sea: { wind: { at: () => [0, -5] }, clock: () => 0 },
      sim: {
        ships: () => ["hull"],
        read: () => ({ speed: 2, heading: 0, apparentWind: { speed: 6, angle: 0.5 } }),
        stationsOf: () => ({ sail: "rig", anchor: "windlass" }),
        value: (id) => (id === "rig" ? { raised: 0.5, sheet: 0.5 } : { down: true }),
      },
      crew: { me: () => me.current, start: vi.fn() },
    };
    const hud = createHud(api, ctx);
    return { overlay, loops, ctx, hud, root: overlay.querySelector(".sail-hud"), tick: () => hud.tick(0.2) }; // play.js ticks it each frame
  }

  it("shows the way in before you're aboard: a button that comes aboard", () => {
    const me = { current: { playing: false } };
    const s = stage(me);
    expect(s.root.dataset.state).toBe("lobby");
    const button = s.root.querySelector("button");
    expect(button.hidden).toBe(false);
    expect(button.textContent).toBe("Click to come aboard");
    button.click();
    expect(s.ctx.crew.start).toHaveBeenCalled();
    // the panel is up already: the ship is there to read
    expect(s.root.querySelector(".sail-panel").hidden).toBe(false);
    expect(s.root.querySelector('[data-k="speed"]').textContent).toBe("3.9 kn");
  });

  it("aboard: the crosshair's state, the hint line, and the numbers as they change", () => {
    const me = { current: { playing: true, on: "hull" } };
    const s = stage(me);
    expect(s.root.dataset.state).toBe("aboard");
    expect(s.root.querySelector("button").hidden).toBe(true);
    expect(s.root.querySelector('[data-k="hint"]').textContent).toMatch(/^WASD walk/);
    expect(s.root.querySelector('[data-k="wind"]').textContent).toBe("10 kn S");
    expect(s.root.querySelector('[data-k="sail"]').textContent).toBe("50% · sheet 50%");
    expect(s.root.querySelector('[data-k="anchor"]').textContent).toBe("Down");
    me.current = { playing: true, on: "hull", station: "wheel", hint: "A / D steer · F leave" };
    s.tick();
    expect(s.root.querySelector('[data-k="hint"]').textContent).toBe("A / D steer · F leave");
    me.current = { playing: true, paused: true };
    s.tick();
    expect(s.root.dataset.state).toBe("paused");
  });
});
