// A die's poses, checked for every shape, every face and a fixed fan of
// headings and starting poses: reading, resting, a roll's whole plan, and a
// turn by hand. Nothing is drawn at random: a roll is a function of its seed,
// and the seeds are listed.
import { describe, it, expect } from "vitest";
import { ROLL_LIFT, ROLL_SKID, builtOf, drawSeed, faceOfSeed, faceUp, middleAt, reach, rollPlan, scaleOf, seedFor, showing, turnTo } from "./roll.js";
import { apply, axisAngle, eulerMatrix, matrixEuler, mul, rotationBetween, toAxisAngle, transpose, unit } from "./m3.js";
import { PRESETS, dieOf } from "./die.js";
import { builtDie } from "./die-glb.js";
import { SHAPES } from "./solids.js";

const SHAPE_DIE = { d4: "d4", d6: "d6", d8: "d8", d10: "d10", d12: "d12", d20: "d20", coin: "coin" };
const builtFor = (shape) => builtDie(dieOf(PRESETS[SHAPE_DIE[shape]].make()));
const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
const THETAS = [0, 0.4, Math.PI / 2, 2, Math.PI, 4, 5.5];
/** Starting poses: as it stands, turned, lying on other faces, and tumbled (in mid-air, as the hand might leave it). */
const FROMS = [
  { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
  { position: [0.1, 0.7, -0.2], rotation: [0, 0.3, 0], scale: 1 },
  { position: [-0.3, 0, 0.05], rotation: [Math.PI / 2, 0, 0], scale: 1 },
  { position: [0.02, 0.01, 0.4], rotation: [0.7, -1.1, 2.3], scale: 1 },
  { position: [1, 2, 3], rotation: [3, Math.PI / 2, -2], scale: 2.5 },
];
/** The die's corners at a transform, in its parent's frame. */
function corners(built, t) {
  const m = eulerMatrix(t.rotation);
  const c = middleAt(built, t);
  return built.verts.map((v) => apply(m, v).map((x, k) => c[k] + x * (t.scale ?? 1)));
}
/** Is it at rest on `floor`: nothing below it, and three or more corners on it. */
function expectAtRest(built, t, floor) {
  const ys = corners(built, t).map((p) => p[1]);
  for (const y of ys) expect(y).toBeGreaterThan(floor - 2e-6 * (t.scale ?? 1));
  expect(ys.filter((y) => Math.abs(y - floor) < 2e-6 * (t.scale ?? 1)).length).toBeGreaterThanOrEqual(3);
}

describe("the rotations", () => {
  it("Euler XYZ goes to a matrix and back, gimbal lock included", () => {
    const A = [-3, -Math.PI / 2, -1, 0, 0.7, Math.PI / 2, 3];
    const Y = [-Math.PI / 2, -1.2, 0, 0.5, Math.PI / 2];
    for (const x of A) for (const y of Y) for (const z of A) {
      const m = eulerMatrix([x, y, z]);
      eulerMatrix(matrixEuler(m)).flat().forEach((v, i) => expect(v).toBeCloseTo(m.flat()[i], 9));
    }
  });

  it("the least turn between two directions lands the one on the other, opposite ones too", () => {
    const dirs = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [0, 0, -1], unit([1, 1, 1]), unit([-0.2, 0.9, 0.4])];
    for (const a of dirs) for (const b of dirs) {
      const m = rotationBetween(a, b);
      expect(det(m)).toBeCloseTo(1, 9);
      apply(m, a).forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
    }
  });

  it("a rotation is one turn about one axis, and comes back from it: none, part, and a half turn about every kind of axis", () => {
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1], unit([1, 1, 0]), unit([1, -2, 3]), unit([-1, 0, 1e-4])];
    for (const axis of axes) for (const angle of [0, 1e-3, 0.5, 2, 3.1, Math.PI]) {
      const m = axisAngle(axis, angle);
      const back = toAxisAngle(m, [0, 0, 1]);
      axisAngle(back.axis, back.angle).flat().forEach((v, i) => expect(v).toBeCloseTo(m.flat()[i], 6));
    }
  });
});

describe.each(SHAPES)("a built %s", (shape) => {
  const built = builtFor(shape);
  const n = built.faces.length;

  it("is well-formed, as a scene reads it back from its GLB", () => {
    expect(builtOf(JSON.parse(JSON.stringify(built)))).toBeTruthy();
  });

  it("shown on every face at every heading, reads back as that face: as a matrix, and as the six-place Euler angles a doc keeps", () => {
    let count = 0;
    for (let i = 0; i < n; i++) for (const theta of THETAS) {
      const m = showing(built, i, theta);
      expect(det(m)).toBeCloseTo(1, 9);
      apply(m, built.faces[i].up).forEach((v, k) => expect(v).toBeCloseTo([0, 1, 0][k], 8));
      expect(faceUp(m, built)).toBe(i);
      expect(faceUp(matrixEuler(m).map((v) => +v.toFixed(6)), built)).toBe(i);
      count++;
    }
    expect(count).toBe(n * THETAS.length);
  });

  it("shown on a face, rests flat: no corner below the table, the face's own corners on it, its middle `rest` above", () => {
    for (let i = 0; i < n; i++) for (const theta of THETAS) {
      const m = showing(built, i, theta);
      expect(reach(built, m)).toBeCloseTo(built.faces[i].rest, 8);
      const t = { position: built.centre.map((v, k) => (k === 1 ? built.faces[i].rest : 0) - apply(m, built.centre)[k]), rotation: matrixEuler(m), scale: 1 };
      expectAtRest(built, t, 0);
    }
  });

  it("is read at any orientation at all: tipped a little off a face it still shows that face", () => {
    const tips = [[0.2, 0, 0], [0, 0, -0.2], [0.12, 0.5, 0.12]];
    for (let i = 0; i < n; i++) for (const tip of tips) expect(faceUp(mul(eulerMatrix(tip), showing(built, i, 1)), built)).toBe(i);
  });

  it("a seed lands the face that is its remainder by the number of faces: the seeds 0 … n − 1 land every face once", () => {
    const landed = new Set();
    for (let seed = 0; seed < n; seed++) {
      expect(faceOfSeed(seed, n)).toBe(seed);
      const plan = rollPlan(seed, { built, from: FROMS[0] });
      expect(plan.face).toBe(seed);
      landed.add(plan.face);
    }
    expect(landed.size).toBe(n);
    expect(faceOfSeed(2 ** 32 - 1, n)).toBe((2 ** 32 - 1) % n);
  });

  it("a roll to every face from every starting pose ends showing that face in the doc, at rest on what it stood on, within a skid of where it was", () => {
    for (const from of FROMS) {
      const s = from.scale;
      const floor = Math.min(...corners(built, from).map((p) => p[1]));
      const c0 = middleAt(built, from);
      // (three seeds per face: other headings, skids and tumbles for the same face)
      for (let seed = 0; seed < 3 * n; seed++) {
        const plan = rollPlan(seed, { built, from });
        expect(plan.face).toBe(seed % n);
        expect(faceUp(plan.to.rotation, built)).toBe(plan.face);
        expect(plan.to.scale).toBe(s);
        expectAtRest(built, plan.to, floor);
        const c1 = middleAt(built, plan.to);
        expect(c1[1]).toBeCloseTo(floor + s * built.faces[plan.face].rest, 5);
        expect(Math.hypot(c1[0] - c0[0], c1[2] - c0[2])).toBeLessThanOrEqual(ROLL_SKID + 1e-5);
      }
    }
  });

  it("a roll starts as the die lies, tumbles in the air, and ends as it lands", () => {
    for (const from of FROMS) for (let seed = 0; seed < n; seed++) {
      const plan = rollPlan(seed, { built, from });
      const start = plan.at(0);
      start.position.forEach((v, k) => expect(v).toBeCloseTo(from.position[k], 9));
      eulerMatrix(start.rotation).flat().forEach((v, k) => expect(v).toBeCloseTo(eulerMatrix(from.rotation).flat()[k], 9));
      const end = plan.at(1);
      end.position.forEach((v, k) => expect(v).toBeCloseTo(plan.to.position[k], 5));
      eulerMatrix(end.rotation).flat().forEach((v, k) => expect(v).toBeCloseTo(eulerMatrix(plan.to.rotation).flat()[k], 5));
      // half way, its middle is well off the line between: tossed
      const mid = middleAt(built, plan.at(0.5));
      const c0 = middleAt(built, from), c1 = middleAt(built, plan.to);
      expect(mid[1]).toBeGreaterThan(c0[1] + (c1[1] - c0[1]) * 0.75 + ROLL_LIFT * 0.9);
      // and every pose on the way is a rotation
      for (const t of [0.1, 0.35, 0.6, 0.9]) expect(det(eulerMatrix(plan.at(t).rotation))).toBeCloseTo(1, 9);
    }
  });

  it("is the same roll for the same seed", () => {
    const a = rollPlan(123456789, { built, from: FROMS[3] });
    const b = rollPlan(123456789, { built, from: FROMS[3] });
    expect(a.to).toEqual(b.to);
    expect(a.at(0.4)).toEqual(b.at(0.4));
  });

  it("under a scaled parent, a skid and a toss are in metres: smaller in the parent's units", () => {
    for (let seed = 0; seed < n; seed++) {
      const plan = rollPlan(seed, { built, from: FROMS[0], unitScale: 4 });
      const c0 = middleAt(built, FROMS[0]), c1 = middleAt(built, plan.to);
      expect(Math.hypot(c1[0] - c0[0], c1[2] - c0[2])).toBeLessThanOrEqual(ROLL_SKID / 4 + 1e-5);
      expect(middleAt(built, plan.at(0.5))[1] - c0[1]).toBeLessThan(ROLL_LIFT / 4 + 1e-6 + Math.abs(c1[1] - c0[1]));
      expect(faceUp(plan.to.rotation, built)).toBe(plan.face);
    }
  });

  it("turned by hand from any pose to every face: shows it, at rest on what it stood on, where it was in plan", () => {
    for (const from of FROMS) {
      const floor = Math.min(...corners(built, from).map((p) => p[1]));
      const c0 = middleAt(built, from);
      for (let i = 0; i < n; i++) {
        const to = turnTo(built, i, from);
        expect(faceUp(to.rotation, built)).toBe(i);
        expectAtRest(built, to, floor);
        const c1 = middleAt(built, to);
        expect(c1[0]).toBeCloseTo(c0[0], 5);
        expect(c1[2]).toBeCloseTo(c0[2], 5);
      }
    }
  });

  it("turned to the face it already shows at rest, it stays exactly as it is", () => {
    for (let i = 0; i < n; i++) {
      const at = rollPlan(i, { built, from: FROMS[0] }).to;
      expect(turnTo(built, i, at)).toEqual(at);
    }
  });

  it("turned from each face to each other, it turns by the angle between them and no more", () => {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const m0 = showing(built, i, 0.3);
      const from = { position: [0, 0, 0], rotation: matrixEuler(m0), scale: 1 };
      const m1 = eulerMatrix(turnTo(built, j, from).rotation);
      const between = Math.acos(Math.max(-1, Math.min(1, built.faces[i].up.reduce((s, v, k) => s + v * built.faces[j].up[k], 0))));
      expect(toAxisAngle(mul(m1, transpose(m0))).angle).toBeCloseTo(between, 4);
    }
  });
});

describe("what a scene may take for a built die", () => {
  it("only a well-formed one: versioned, unit ups, real numbers, a label on every face", () => {
    const good = builtFor("d6");
    const broken = (fn) => {
      const b = JSON.parse(JSON.stringify(good));
      fn(b);
      return builtOf(b);
    };
    expect(builtOf(good)).toBe(good);
    for (const x of [null, undefined, 7, "die", [], {}]) expect(builtOf(x)).toBeNull();
    expect(broken((b) => (b.v = 2))).toBeNull();
    expect(broken((b) => (b.centre = [0, "1", 0]))).toBeNull();
    expect(broken((b) => (b.verts = b.verts.slice(0, 3)))).toBeNull();
    expect(broken((b) => (b.verts[0][1] = null))).toBeNull();
    expect(broken((b) => (b.faces = [b.faces[0]]))).toBeNull();
    expect(broken((b) => (b.faces[2].up = [0, 2, 0]))).toBeNull();
    expect(broken((b) => (b.faces[2].rest = 0))).toBeNull();
    expect(broken((b) => delete b.faces[2].label)).toBeNull();
  });
});

describe("seeds", () => {
  it("a throw's seed gives each die its own: different by place, the same every time", () => {
    for (const seed of [0, 1, 0xffffffff, 123456789]) {
      const each = Array.from({ length: 64 }, (_, k) => seedFor(seed, k));
      expect(new Set(each).size).toBe(64);
      for (const s of each) expect(Number.isInteger(s) && s >= 0 && s < 2 ** 32).toBe(true);
      expect(Array.from({ length: 64 }, (_, k) => seedFor(seed, k))).toEqual(each);
    }
  });

  it("a drawn seed is an unsigned 32-bit integer", () => {
    const s = drawSeed();
    expect(Number.isInteger(s) && s >= 0 && s < 2 ** 32).toBe(true);
  });

  it("a parent's scale is read off its matrix", () => {
    expect(scaleOf(null)).toBe(1);
    expect(scaleOf([0, 0, 3, 0, 0, 3, 0, 0, 3, 0, 0, 0, 1, 2, 3, 1])).toBeCloseTo(3, 12);
  });
});
