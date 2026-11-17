// How a carried piece lies where it lands (carry-math landedPose, and the
// carry that uses it): a pure function of how it is held, the snap's frame
// (or yaw, or none) and the landing rules' answer. Every expected pose here
// is written out by hand as the three body axes in world, from the rules in
// landedPose's comment, not by the code under test.

import { describe, it, expect } from "vitest";
import { createCarry, flipMatrix, intoFrame, landedPose, layFlat, rotateAbout, yawOfMatrix } from "./carry-math.js";
import { composeMatrix } from "../transform.js";

const H = Math.PI / 2;
/** A rotation from its three body axes in world (columns). */
const frame = (x, y, z) => [...x, 0, ...y, 0, ...z, 0, 0, 0, 0, 1];
const axes = (m) => [0, 1, 2].map((k) => {
  const l = Math.hypot(m[4 * k], m[4 * k + 1], m[4 * k + 2]);
  return [m[4 * k] / l, m[4 * k + 1] / l, m[4 * k + 2] / l];
});
const near = (a, b, eps = 1e-9) => a.flat().every((v, i) => Math.abs(v - b.flat()[i]) < eps);
const yawOfZ = ([x, , z]) => (Math.hypot(x, z) < 1e-9 ? null : Math.atan2(x, z));

const PX = [1, 0, 0], NX = [-1, 0, 0], PY = [0, 1, 0], NY = [0, -1, 0], PZ = [0, 0, 1], NZ = [0, 0, -1];

// a domino: 25 mm across (X), 9.5 mm thick (Y, its face), 50 mm long (Z); origin at the middle of its back
const TILE = { min: [-0.0125, 0, -0.025], max: [0.0125, 0.0095, 0.025] };

/** How it is held when it lands: its body axes X, Y (face), Z (length). */
const STARTS = {
  "flat face up": [PX, PY, PZ],
  "flat face down": [NX, NY, PZ],
  "standing facing +Z": [PY, PZ, PX],
  "standing facing −X": [PY, NX, PZ],
};
const ANSWERS = { none: null, faceUp: { faceUp: true }, flat: { flat: true }, "faceUp+flat": { faceUp: true, flat: true } };
// a rack's place: standing a tile on edge, its face toward +Z, its length along +X (X up), yaw π/2
const STAND = [H, H, 0];
const SNAPS = { none: null, "yaw-only connector (π/2)": { rotation: null, yaw: H }, "framed standing connector": { rotation: STAND, yaw: H } };

// Worked out by hand (the rules, in order: flat lays it on its broadest face,
// face up from standing; faceUp turns a face-down one over about its length;
// a frame takes it whole, face kept unless the frame stands it; a yaw turns
// it about the vertical). `turned`: the faceUp turn happened and shows.
const R = {
  I: [PX, PY, PZ],
  yawed: [NZ, PY, PX], // flat face up, length along +X (I turned a quarter about +Y)
  downYawed: [PZ, NY, PX], // flat face down, length along +X
  F: [PY, PZ, PX], // the rack's place
  D: [NX, NY, PZ], // flat face down, length along +Z
  standX: [PY, NX, PZ],
};
const EXPECTED = {
  "flat face up": {
    none: { none: [R.I], "yaw-only connector (π/2)": [R.yawed], "framed standing connector": [R.F] },
    faceUp: { none: [R.I], "yaw-only connector (π/2)": [R.yawed], "framed standing connector": [R.F] },
    flat: { none: [R.I], "yaw-only connector (π/2)": [R.yawed], "framed standing connector": [R.F] },
    "faceUp+flat": { none: [R.I], "yaw-only connector (π/2)": [R.yawed], "framed standing connector": [R.F] },
  },
  "flat face down": {
    none: { none: [R.D], "yaw-only connector (π/2)": [R.downYawed], "framed standing connector": [R.F] },
    faceUp: { none: [R.I, true], "yaw-only connector (π/2)": [R.yawed, true], "framed standing connector": [R.F] },
    flat: { none: [R.D], "yaw-only connector (π/2)": [R.downYawed], "framed standing connector": [R.F] },
    "faceUp+flat": { none: [R.I, true], "yaw-only connector (π/2)": [R.yawed, true], "framed standing connector": [R.F] },
  },
  // standing: faceUp leaves a face that is level alone; flat lays it face up about its length, so its yaw (π/2) stays
  "standing facing +Z": {
    none: { none: [R.F], "yaw-only connector (π/2)": [R.F], "framed standing connector": [R.F] },
    faceUp: { none: [R.F], "yaw-only connector (π/2)": [R.F], "framed standing connector": [R.F] },
    flat: { none: [R.yawed], "yaw-only connector (π/2)": [R.yawed], "framed standing connector": [R.F] },
    "faceUp+flat": { none: [R.yawed], "yaw-only connector (π/2)": [R.yawed], "framed standing connector": [R.F] },
  },
  // its length along +Z (yaw 0): laid flat it stays so; the yaw-only connector turns it a quarter
  "standing facing −X": {
    none: { none: [R.standX], "yaw-only connector (π/2)": [R.F], "framed standing connector": [R.F] },
    faceUp: { none: [R.standX], "yaw-only connector (π/2)": [R.F], "framed standing connector": [R.F] },
    flat: { none: [R.I], "yaw-only connector (π/2)": [R.yawed], "framed standing connector": [R.F] },
    "faceUp+flat": { none: [R.I], "yaw-only connector (π/2)": [R.yawed], "framed standing connector": [R.F] },
  },
};

const CASES = [];
for (const start of Object.keys(STARTS)) for (const answer of Object.keys(ANSWERS)) for (const snap of Object.keys(SNAPS)) CASES.push([start, answer, snap]);

describe("landedPose: start × answer × snap (48 cases)", () => {
  it("is 48 cases", () => expect(CASES).toHaveLength(48));

  it.each(CASES)("%s, answer %s, snap %s", (start, answer, snap) => {
    const own = frame(...STARTS[start]);
    own[12] = 0.3;
    own[13] = 0.01;
    own[14] = -0.2;
    const [want, turned = false] = EXPECTED[start][answer][snap];
    const p = landedPose(own, TILE, { snap: SNAPS[snap], answer: ANSWERS[answer], faceYou: true });
    expect(near(axes(p.W), want)).toBe(true);
    // the up body axis, and the yaw its length faces
    const up = want.findIndex((a) => Math.abs(a[1]) > 0.5);
    expect(Math.abs(axes(p.W)[up][1] - want[up][1])).toBeLessThan(1e-9);
    const yaw = yawOfZ(want[2]);
    if (yaw == null) expect(Math.hypot(p.W[8], p.W[10])).toBeLessThan(1e-9);
    else expect(Math.abs(Math.atan2(Math.sin(yawOfMatrix(p.W) - yaw), Math.cos(yawOfMatrix(p.W) - yaw)))).toBeLessThan(1e-9);
    expect(p.turned).toBe(turned);
    // turned where it is: its origin kept
    expect(p.W.slice(12)).toEqual([0.3, 0.01, -0.2, 1]);
  });

  it("with no snap and no answer it is how it is held, exactly", () => {
    for (const start of Object.keys(STARTS)) {
      const own = composeMatrix({ position: [1, 2, 3], rotation: [0.3, -1.1, 2.2], scale: 1.5 });
      const R0 = frame(...STARTS[start]);
      const m = own.map((v, i) => (i < 12 ? R0[i] * 1.5 : v));
      expect(landedPose(m, TILE).W).toEqual(m);
      expect(landedPose(m, TILE, { answer: { faceUp: true }, faceYou: false }).W).toEqual(m);
    }
  });

  it("faceUp is heeded only while faceYou", () => {
    const own = frame(...STARTS["flat face down"]);
    expect(near(axes(landedPose(own, TILE, { answer: { faceUp: true }, faceYou: false }).W), R.D)).toBe(true);
    expect(near(axes(landedPose(own, TILE, { answer: { faceUp: true }, faceYou: true }).W), R.I)).toBe(true);
  });

  // a flat frame (a Lost Cities tray's, turned a quarter): face up or down as it is, or as faceUp asks
  it.each([
    ["flat face up", null, [NZ, PY, PX], false],
    ["flat face down", null, [PZ, NY, PX], false],
    ["flat face down", { faceUp: true }, [NZ, PY, PX], true],
    ["standing facing +Z", null, [NZ, PY, PX], false], // a level face: the frame as given
    ["standing facing −X", { faceUp: true }, [NZ, PY, PX], false],
  ])("into a flat frame: %s, answer %j", (start, answer, want, turned) => {
    const p = landedPose(frame(...STARTS[start]), TILE, { snap: { rotation: [0, H, 0], yaw: H }, answer, faceYou: true });
    expect(near(axes(p.W), want)).toBe(true);
    expect(p.turned).toBe(turned);
  });
});

describe("intoFrame and layFlat", () => {
  it("into a frame keeps its own scale and origin", () => {
    const W = composeMatrix({ position: [1, 2, 3], rotation: [0.2, 0.4, 0.6], scale: 2 });
    const out = intoFrame(W, STAND, 1);
    expect(near(axes(out), R.F)).toBe(true);
    expect([0, 1, 2].map((k) => Math.hypot(out[4 * k], out[4 * k + 1], out[4 * k + 2]))).toEqual([2, 2, 2].map((v, k) => expect.closeTo(v, 12)));
    expect(out.slice(12)).toEqual([1, 2, 3, 1]);
  });

  it("a frame read with 32-bit noise in its face is still standing: never turned over", () => {
    // the rack's place, its face a hair off level (as a GLB's floats give it)
    for (const e of [3e-8, -3e-8]) {
      const out = intoFrame(frame(...STARTS["flat face down"]), [H + e, H, 0], -1);
      expect(near(axes(out), R.F, 1e-6)).toBe(true);
    }
  });

  it("lays flat about its length when its length is level; a piece already flat is left; on its end it falls back", () => {
    expect(layFlat(frame(...STARTS["flat face up"]), TILE)).toEqual(frame(...STARTS["flat face up"]));
    expect(layFlat(frame(...STARTS["flat face down"]), TILE)).toEqual(frame(...STARTS["flat face down"]));
    // standing on its end (length up, face toward +Z): face up, its top falls away from its face, to −Z
    const onEnd = frame(NX, PZ, PY);
    expect(near(axes(layFlat(onEnd, TILE)), [NX, PY, NZ])).toBe(true);
    // a cube: whichever axis is most upright already stays so
    const cube = { min: [-1, -1, -1], max: [1, 1, 1] };
    const tipped = rotateAbout(frame(PX, PY, PZ), PX, 0.3);
    const laid = axes(layFlat(tipped, cube));
    expect(near(laid, [PX, PY, PZ])).toBe(true);
    const onSide = frame(PY, NX, PZ); // its X up
    expect(layFlat(onSide, cube)).toEqual(onSide);
    // standing, its face a hair below level (as decomposed and composed again): still laid face up
    for (const e of [1e-9, -1e-9]) {
      const hair = rotateAbout(frame(...STARTS["standing facing +Z"]), PX, e);
      expect(near(axes(layFlat(hair, TILE)), R.yawed, 1e-8)).toBe(true);
    }
  });

  // into a frame that lies face down (a tray hung underneath): flat first, so a standing tile goes in face up
  it("flat comes before a frame: a tile standing on edge goes into a face-down frame face up", () => {
    const under = [Math.PI, 0, 0]; // X kept, Y down, Z toward −Z
    const p = landedPose(frame(...STARTS["standing facing +Z"]), TILE, { snap: { rotation: under, yaw: Math.PI }, answer: { flat: true }, faceYou: true });
    expect(near(axes(p.W), [NX, PY, NZ])).toBe(true); // the frame turned over about its length
    const q = landedPose(frame(...STARTS["standing facing +Z"]), TILE, { snap: { rotation: under, yaw: Math.PI }, answer: null, faceYou: true });
    expect(near(axes(q.W), [PX, NY, NZ])).toBe(true); // its face level: the frame as given
  });
});

// The same rules through the carry: picked up at the origin, carried to x = 1
// where the snap is (if any) and the rules answer.
describe("the carry lands each case as landedPose says", () => {
  const ground = () => null;
  const down = (x, z) => ({ origin: [x, 10, z], dir: [0, -1, 0] });

  it.each(CASES)("%s, answer %s, snap %s", (start, answer, snap) => {
    const s = SNAPS[snap];
    const snaps = s ? [{ world: [1, 0, 0], rotation: s.rotation, yaw: s.yaw, radius: 0.5, objectId: "rack" }] : [];
    const landing = (id, p) => (p[0] > 0.5 ? ANSWERS[answer] : null);
    const c = createCarry({ id: "tile", W: frame(...STARTS[start]), box: TILE, snaps, raycast: ground, landing });
    c.move(down(1, 0));
    const W = c.put();
    const [want, turned = false] = EXPECTED[start][answer][snap];
    expect(near(axes(W), want)).toBe(true);
    expect(c.state.flips).toBe(turned ? 1 : 0);
    // and it rests on the ground: its lowest point at 0
    let low = Infinity;
    for (let i = 0; i < 8; i++) {
      const p = [i & 1 ? TILE.max[0] : TILE.min[0], i & 2 ? TILE.max[1] : TILE.min[1], i & 4 ? TILE.max[2] : TILE.min[2]];
      low = Math.min(low, W[1] * p[0] + W[5] * p[1] + W[9] * p[2] + W[13]);
    }
    expect(low).toBeCloseTo(0, 9);
  });

  it("a snap's or a rule's turn lasts only while it is over that place", () => {
    const snaps = [{ world: [1, 0, 0], rotation: STAND, yaw: H, radius: 0.5, objectId: "rack" }];
    const landing = (id, p) => (p[0] < -0.5 ? { flat: true } : null);
    const c = createCarry({ id: "tile", W: frame(...STARTS["standing facing −X"]), box: TILE, snaps, raycast: ground, landing });
    c.move(down(1, 0));
    expect(near(axes(c.state.W), R.F)).toBe(true);
    c.move(down(-1, 0));
    expect(near(axes(c.state.W), R.I)).toBe(true); // laid flat, its yaw its own
    c.move(down(3, 0));
    expect(near(axes(c.state.W), R.standX)).toBe(true); // as held
  });

  it("F turns over what you see: a tile laid flat goes face down, and stays so off the flat place", () => {
    const landing = (id, p) => (p[0] > 0.5 ? { flat: true } : null);
    const c = createCarry({ id: "tile", W: frame(...STARTS["standing facing +Z"]), box: TILE, raycast: ground, landing });
    c.move(down(1, 0));
    expect(near(axes(c.state.W), R.yawed)).toBe(true);
    c.flip();
    expect(near(axes(c.state.W), R.downYawed)).toBe(true);
    expect(c.state.flips).toBe(1);
    c.move(down(-1, 0)); // nowhere asks flat now: it is held as F left it
    expect(near(axes(c.state.W), R.downYawed)).toBe(true);
    expect(c.state.flips).toBe(1);
  });

  it("F over a place that turned it face up turns it face down, once", () => {
    const landing = (id, p) => (p[0] > 0.5 ? { faceUp: true } : null);
    const c = createCarry({ id: "card", W: flipMatrix(frame(PX, PY, PZ)), box: TILE, raycast: ground, landing });
    c.move(down(1, 0));
    expect(c.state.W[5]).toBeGreaterThan(0);
    c.flip();
    expect(c.state.W[5]).toBeLessThan(0);
    expect(c.state.flips).toBe(2);
    c.move(down(1.1, 0));
    expect(c.state.W[5]).toBeLessThan(0);
    expect(c.state.flips).toBe(2);
  });
});
