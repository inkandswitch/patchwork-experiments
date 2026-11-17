// How a carried piece lies where it lands (carry-math landedPose, and the
// carry that uses it): a pure function of how it is held, the snap's frame
// (or yaw, or none) and the landing rules' answer. Every expected pose here
// is written out by hand as the three body axes in world, from the rules in
// landedPose's comment, not by the code under test.

import { describe, it, expect } from "vitest";
import { createCarry, flipMatrix, landedPose, layFlat, rotateAbout, yawOfMatrix } from "./carry-math.js";
import { faceOf, intoFrame, intoSnap } from "../carry-rules.js";
import { composeMatrix, decomposeMatrix } from "../transform.js";

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
// it about the vertical). `turned`: the faceUp turn happened and shows (not
// in a frame that stands it, `stands`).
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
    expect(p.turned && !p.stands).toBe(turned);
    expect(p.stands).toBe(snap === "framed standing connector");
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
    expect(p.stands).toBe(false);
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
    const { W } = c.put();
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

// Which frames stand a piece and which lay it flat is decided by the frame's
// most upright axis (carry-rules sideOf), never by a hair off level: a rack
// leaning toward its player still stands a tile, facing the way the rack
// says, whichever way up the tile was held. Every row's answer is the
// frame's own axes, or those turned over about its length (X and Y
// reversed), written out from the frame.
describe("leaning and tilted frames", () => {
  const D = Math.PI / 180;
  // the rack's place (face +Z, length +X, X up) leaned about its length by a: + tips its face down, − up
  const leaned = (a) => [[0, Math.cos(a), Math.sin(a)], [0, -Math.sin(a), Math.cos(a)], PX];
  // a tray (face up, length +Z) tilted about +X by a
  const tilted = (a) => [PX, [0, Math.cos(a), Math.sin(a)], [0, -Math.sin(a), Math.cos(a)]];
  const over = ([x, y, z]) => [x.map((v) => -v), y.map((v) => -v), z];
  const rotationOf = (ax) => decomposeMatrix(frame(...ax)).rotation;
  const PIECES = ["flat face up", "flat face down", "standing facing +Z"];
  const ROWS = [];
  for (const a of [5, -5, 30, -30, 44, -44]) for (const start of PIECES) ROWS.push([`rack leaned ${a}°`, leaned(a * D), start, true, false]);
  // past 45° the face is the most upright axis: a frame that lays a piece flat, face kept as held
  for (const start of PIECES) ROWS.push(["rack leaned −50° (face up)", leaned(-50 * D), start, false, start === "flat face down"]);
  for (const start of PIECES) ROWS.push(["rack leaned 50° (face down)", leaned(50 * D), start, false, start === "flat face up"]);
  for (const a of [5, -5, 30, -30]) for (const start of PIECES) ROWS.push([`tray tilted ${a}°`, tilted(a * D), start, false, start === "flat face down"]);

  it("is 36 rows", () => expect(ROWS).toHaveLength(36));

  it.each(ROWS)("%s, %s held %s", (_, F, start, stands, isOver) => {
    const p = landedPose(frame(...STARTS[start]), TILE, { snap: { rotation: rotationOf(F), yaw: null } });
    expect(p.stands).toBe(stands);
    expect(near(axes(p.W), isOver ? over(F) : F)).toBe(true);
  });

  it("the reviewer's rack leaned back 10°: a face-down tile carried in with flat stands facing its player", () => {
    const rotation = [H - 0.1745, H, 0];
    const F = axes(composeMatrix({ rotation }));
    const p = landedPose(frame(...STARTS["flat face down"]), TILE, { snap: { rotation, yaw: H }, answer: { flat: true } });
    expect(p.stands).toBe(true);
    expect(near(axes(p.W), F)).toBe(true);
    expect(axes(p.W)[1][2]).toBeGreaterThan(0.98); // its face toward the player, at +Z
  });

  it("faceOf is the face's side when the face is the most upright axis, else 0, and ties go to the face", () => {
    expect([faceOf(frame(PX, PY, PZ)), faceOf(frame(NX, NY, PZ)), faceOf(frame(PY, PZ, PX))]).toEqual([1, -1, 0]);
    const at45 = frame(PX, [0, Math.SQRT1_2, Math.SQRT1_2], [0, -Math.SQRT1_2, Math.SQRT1_2]);
    expect(faceOf(at45)).toBe(1);
  });
});

describe("what the landing rules turn, pinned", () => {
  // thinnest across (X), held face down with X level: flat first lays it on its side (X up), and its
  // face, now level, is no longer down, so faceUp doesn't turn it. (faceUp first would turn it over.)
  it("flat comes before faceUp", () => {
    const THIN_X = { min: [-0.005, -0.02, -0.03], max: [0.005, 0.02, 0.03] };
    const p = landedPose(frame(PX, NY, NZ), THIN_X, { answer: { flat: true, faceUp: true }, faceYou: true });
    expect(near(axes(p.W), [PY, PX, NZ])).toBe(true);
    expect(p.turned).toBe(false);
  });

  // which way a standing tile goes down is by its most upright axis, as a frame's is: tipped 30° toward
  // its face it is still on edge (laid face up), tipped 60° it lies face down already (kept so)
  it.each([
    [30, R.yawed],
    [44, R.yawed],
    [46, R.downYawed],
    [60, R.downYawed],
  ])("a standing tile tipped %i° toward its face lays flat as %j", (deg, want) => {
    const tipped = rotateAbout(frame(...STARTS["standing facing +Z"]), PX, (deg * Math.PI) / 180);
    expect(near(axes(layFlat(tipped, TILE)), want)).toBe(true);
  });

  it("a mirrored piece stays mirrored in a frame, its X reversed", () => {
    const M = frame(NX, PY, PZ); // mirrored in X
    const out = intoFrame(M, STAND, 0);
    expect(near(axes(out), [NY, PZ, PX])).toBe(true);
    const det = (m) => m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
    expect(det(out)).toBeCloseTo(-1, 12);
    // and through a yaw-only connector
    expect(det(landedPose(M, TILE, { snap: { rotation: null, yaw: 1 } }).W)).toBeCloseTo(-1, 12);
  });

  // a start turned 0.3 and a connector at 1.0, so the yaw column tells "the connector turned it" apart
  it.each([
    ["flat face up, yawed 0.3", rotateAbout(frame(PX, PY, PZ), PY, 0.3), 1],
    ["flat face down, yawed 0.3", rotateAbout(frame(NX, NY, PZ), PY, 0.3), -1],
    ["standing facing +Z, yawed 0.3", rotateAbout(frame(PY, PZ, PX), PY, 0.3), 0],
  ])("a yaw-only connector at 1.0 turns %s to face 1.0, its up kept", (_, own, face) => {
    const p = landedPose(own, TILE, { snap: { rotation: null, yaw: 1 } });
    expect(yawOfMatrix(p.W)).toBeCloseTo(1, 12);
    expect(faceOf(p.W)).toBe(face);
    expect(p.W[1]).toBeCloseTo(own[1], 12); // X's height: turned only about the vertical
    expect(landedPose(own, TILE).W).toEqual(own);
  });

  it("a piece whose length is straight up faces no way: a yaw-only connector leaves it", () => {
    const onEnd = frame(NX, PZ, PY);
    expect(landedPose(onEnd, TILE, { snap: { rotation: null, yaw: 1 } }).W).toEqual(onEnd);
    // within VERTICAL (1e-6) of straight up: noise, not a heading
    const hair = rotateAbout(onEnd, PX, 1e-8);
    expect(intoSnap(hair, { rotation: null, yaw: 1 })).toEqual(hair);
    // further off, it has a heading and turns to it
    const off = rotateAbout(onEnd, PX, 1e-3);
    expect(yawOfMatrix(intoSnap(off, { rotation: null, yaw: 1 }))).toBeCloseTo(1, 9);
  });
});

describe("the carry: where the rules are asked, and turns over that show", () => {
  const ground = () => null;
  const down = (x, z) => ({ origin: [x, 10, z], dir: [0, -1, 0] });
  const rack = [{ world: [1, 0, 0], rotation: STAND, yaw: H, radius: 0.5, objectId: "rack" }];

  // asked where it would go down turned to the snap: its footprint on the place as it stands there
  it("landing is asked at where it goes down in the snap's frame, on what it snaps to", () => {
    const asked = [];
    const landing = (id, p, on) => {
      asked.push({ p, on });
      return null;
    };
    const c = createCarry({ id: "tile", W: frame(...STARTS["flat face up"]), box: TILE, snaps: rack, raycast: ground, landing });
    c.move(down(1, 0));
    const { W } = c.put();
    const last = asked.at(-1);
    expect(last.on).toBe("rack");
    expect(last.p.map((v) => +v.toFixed(12))).toEqual([W[12], W[13], W[14]].map((v) => +v.toFixed(12)));
    // where it would go down as held (flat) is elsewhere: the frame moved its footprint
    expect(Math.hypot(last.p[0] - 1, last.p[2])).toBeGreaterThan(1e-3);
  });

  it("F in a frame that stands it shows nothing; it turns over in the air as it leaves", () => {
    const c = createCarry({ id: "tile", W: frame(...STARTS["flat face up"]), box: TILE, snaps: rack, raycast: ground });
    c.move(down(1, 0));
    const inRack = c.state.W.slice();
    c.flip();
    expect(near(c.state.W, inRack, 1e-12)).toBe(true);
    expect(c.state.flips).toBe(0);
    c.move(down(3, 0)); // off the place: face down now, and that turn shows
    expect(faceOf(c.state.W)).toBe(-1);
    expect(c.state.flips).toBe(1);
    c.move(down(1, 0)); // back in: nothing shows
    expect(c.state.flips).toBe(1);
    c.move(down(3, 0)); // out again face down, as it was last seen: no turn
    expect(c.state.flips).toBe(1);
  });

  it("F twice in a frame that stands it: nothing ever shows", () => {
    const c = createCarry({ id: "tile", W: frame(...STARTS["flat face up"]), box: TILE, snaps: rack, raycast: ground });
    c.move(down(1, 0));
    c.flip();
    c.flip();
    c.move(down(3, 0));
    expect(faceOf(c.state.W)).toBe(1);
    expect(c.state.flips).toBe(0);
  });

  it("Q over a yaw-only snap turns how it is held, seen as it leaves", () => {
    const snaps = [{ world: [1, 0, 0], rotation: null, yaw: 1, radius: 0.5, objectId: "slot" }];
    const own = rotateAbout(frame(PX, PY, PZ), PY, 0.3);
    const c = createCarry({ id: "card", W: own, box: TILE, snaps, raycast: ground });
    c.move(down(1, 0));
    expect(yawOfMatrix(c.state.W)).toBeCloseTo(1, 12);
    c.turn(0.5);
    expect(yawOfMatrix(c.state.W)).toBeCloseTo(1, 12);
    c.move(down(3, 0));
    expect(yawOfMatrix(c.state.W)).toBeCloseTo(0.8, 12);
  });
});
