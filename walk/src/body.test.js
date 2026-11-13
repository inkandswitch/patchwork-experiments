import { describe, it, expect } from "vitest";
import { REACH, SPAWN, WALK_KEYS, aimOf, carried, invertRigid, startOf, walkBody } from "./body.js";
import { BODY, lookDir } from "./walk.js";
import { plugins } from "./index.js";

const r6 = (a) => a.map((v) => Math.round(v * 1e6) / 1e6 + 0);
/** A yaw about +Y and a translation, column-major. */
const M = (yaw, [x, y, z]) => [Math.cos(yaw), 0, -Math.sin(yaw), 0, 0, 1, 0, 0, Math.sin(yaw), 0, Math.cos(yaw), 0, x, y, z, 1];

describe("riding what you stand on (pure)", () => {
  it("every move of the floor × every place on it: the feet keep their place on it, and turn with it", () => {
    const moves = [M(0, [0, 0, 0]), M(0, [3, 0, -2]), M(Math.PI / 2, [0, 0, 0]), M(0.3, [1, 0.5, 2]), M(-1.2, [-4, -0.2, 7])];
    let n = 0;
    for (const was of moves)
      for (const now of moves)
        for (const feet of [[0, 0, 0], [1, 0, 0], [0.5, 0.2, -2]]) {
          n++;
          const c = carried(feet, 0.4, was, now);
          // on the floor's own frame, the same place before and after
          const onWas = [0, 1, 2].map((r) => invertRigid(was)[r] * feet[0] + invertRigid(was)[4 + r] * feet[1] + invertRigid(was)[8 + r] * feet[2] + invertRigid(was)[12 + r]);
          const onNow = [0, 1, 2].map((r) => invertRigid(now)[r] * c.feet[0] + invertRigid(now)[4 + r] * c.feet[1] + invertRigid(now)[8 + r] * c.feet[2] + invertRigid(now)[12 + r]);
          expect(r6(onNow)).toEqual(r6(onWas));
          const turn = Math.atan2(now[8], now[10]) - Math.atan2(was[8], was[10]);
          expect(c.yaw).toBeCloseTo(0.4 + turn);
          if (was === now) expect(r6(c.feet)).toEqual(r6(feet));
        }
    expect(n).toBe(75);
  });
  it("nothing underfoot (or nothing before): no move", () => {
    expect(carried([1, 2, 3], 0.5, null, M(0, [1, 0, 0]))).toEqual({ feet: [1, 2, 3], yaw: 0.5 });
  });
});

describe("where a walk starts (pure)", () => {
  const spawn = M(Math.PI / 2, [5, 1, -3]);
  const eye = { position: [2, 3.6, 4], direction: lookDir(0.7, -0.2) };
  it("a spawn given as the place; else the eye; else any spawn; else above the scene's middle", () => {
    expect(r6(startOf({ place: spawn, eye, spawn: M(0, [9, 9, 9]) }).feet)).toEqual([5, 1.1, -3]);
    expect(startOf({ place: spawn }).yaw).toBeCloseTo(Math.PI / 2);
    const fromEye = startOf({ eye, spawn });
    expect(r6(fromEye.feet)).toEqual(r6([2, 3.6 - BODY.eye, 4]));
    expect(fromEye.yaw).toBeCloseTo(0.7);
    expect(fromEye.pitch).toBeCloseTo(-0.2);
    expect(r6(startOf({ spawn }).feet)).toEqual([5, 1.1, -3]);
    expect(startOf({ box: { min: [-2, 0, -2], max: [4, 3, 2] } }).feet).toEqual([1, 4, 0]);
    expect(startOf({}).feet).toEqual([0, 2, 0]);
  });
  it("aim is lookDir's inverse", () => {
    for (const yaw of [-2, -0.5, 0, 1, 2.5]) for (const pitch of [-1, 0, 0.6]) expect(r6(Object.values(aimOf(lookDir(yaw, pitch))))).toEqual(r6([yaw, pitch]));
  });
});

/** A stand-in stage for one walker: a floor at y = 0 (an object, "deck", that can move), a camera, presence, loops. */
function fakeApi({ objects = {}, camera = { position: [0, 1.6, 5], target: [0, 1.6, 0] } } = {}) {
  const calls = { holds: 0, released: 0, presence: {}, rate: [], camera: [] };
  const loops = [];
  let deck = M(0, [0, 0, 0]);
  let now = 0; // the stage's time (ms), moved by the frames
  const api = {
    clock: { now: () => now },
    scene: () => ({ objects }),
    worldOf: (id) => (id === "deck" ? deck : objects[id]?.m ?? null),
    sceneBox: () => ({ min: [-10, 0, -10], max: [10, 1, 10] }),
    raycast: (from, dir, { far = Infinity } = {}) => {
      if (dir[1] >= 0) return null; // nothing ahead: an open floor
      const top = deck[13];
      const d = from[1] - top;
      return d >= 0 && d <= far ? { id: "deck", distance: d, point: [from[0], top, from[2]], normal: [0, 1, 0] } : null;
    },
    camera: {
      get: () => camera,
      set: (c) => (calls.camera.push(c), (camera = c)),
      hold: () => (calls.holds++, () => calls.released++),
    },
    presence: { set: (k, v) => (calls.presence[k] = v), rate: (hz) => calls.rate.push(hz) },
    loop(fn) {
      loops.push(fn);
      return () => loops.splice(loops.indexOf(fn), 1);
    },
  };
  return { api, calls, frames: (n = 1) => { for (let i = 0; i < n; i++) { now += 1000 / 60; for (const fn of [...loops]) fn(1 / 60); } }, loops, moveDeck: (m) => (deck = m) };
}

describe("the walk body", () => {
  it("is `walk`: the walking keys, the pointer locked, 2 m of reach, offered by the chip", () => {
    const b = walkBody(fakeApi().api);
    expect(b).toMatchObject({ id: "walk", label: "Walk", keys: WALK_KEYS, lock: true, reach: REACH });
    expect(b.here).toBeUndefined();
    expect(WALK_KEYS.map((k) => k.code)).toEqual(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight", "Space"]);
    expect(plugins.find((p) => p.id === "walk.spawn").describes[SPAWN].name).toBe("Spawn point");
  });

  it("enters at the eye, holds the camera, walks on W and stands on the floor; leaving gives it all back", () => {
    const f = fakeApi();
    const s = walkBody(f.api).enter(null);
    expect(f.calls.holds).toBe(1);
    expect(r6(s.state.feet)).toEqual([0, 0, 5]);
    f.frames(30);
    expect(s.state.onGround).toBe(true);
    s.input.key({ code: "KeyW" });
    f.frames(60);
    expect(s.state.feet[2]).toBeLessThan(2);
    expect(r6(s.eye().position)).toEqual(r6([s.state.feet[0], s.state.feet[1] + BODY.eye, s.state.feet[2]]));
    // (published at 20 Hz: on entering, then at most every 50 ms)
    expect(f.calls.presence.avatar.feet).toHaveLength(3);
    expect(f.calls.rate).toEqual([20]);
    s.leave();
    expect(f.calls.released).toBe(1);
    expect(f.calls.presence.avatar).toBeUndefined();
    expect(f.loops).toEqual([]);
  });

  it("enters at a spawn point given as its place", () => {
    const f = fakeApi({ objects: { sp: { traits: { [SPAWN]: {} }, m: M(Math.PI, [3, 0, -4]) } } });
    const s = walkBody(f.api).enter("sp");
    expect(r6(s.state.feet)).toEqual([3, 0.1, -4]);
    expect(s.state.yaw).toBeCloseTo(Math.PI);
  });

  it("rides the deck it stands on: the deck moves and turns, the feet keep their place on it", () => {
    const f = fakeApi();
    const s = walkBody(f.api).enter(null);
    f.frames(30);
    const before = [...s.state.feet];
    f.moveDeck(M(0.5, [4, 0, 1]));
    f.frames(1);
    expect(r6(s.state.feet)).toEqual(r6(carried(before, 0, M(0, [0, 0, 0]), M(0.5, [4, 0, 1])).feet));
  });

  it("waits under another body (the camera let go, the loop stopped), and walks on from the eye when it goes", () => {
    const f = fakeApi();
    const s = walkBody(f.api).enter(null);
    s.input.key({ code: "KeyW" });
    s.input.suspended();
    expect(f.calls.released).toBe(1);
    expect(f.loops).toEqual([]);
    // a seat put the view somewhere else
    f.api.camera.set({ position: [7, 1.2 + BODY.eye, -1], target: [7, 1.2 + BODY.eye, -2] });
    s.input.resumed();
    expect(f.calls.holds).toBe(2);
    expect(r6(s.state.feet)).toEqual(r6([7, 1.2, -1]));
    f.frames(5);
    // the key went up while it waited: it stands
    expect(s.state.feet[2]).toBeCloseTo(-1);
  });

  it("presses: without the lock a drag looks round and a tap goes on as a click; under it a press is nothing", () => {
    const s = walkBody(fakeApi().api).enter(null);
    const look = s.input.press({ button: 0, locked: false, clientX: 0, clientY: 0 });
    look.move({ clientX: 100, clientY: 0 });
    expect(s.state.yaw).not.toBe(0);
    expect(look.tap()).toBe(false);
    expect(s.input.press({ button: 0, locked: true })).toBe(null);
    expect(s.input.wheel()).toBe(true);
  });
});
