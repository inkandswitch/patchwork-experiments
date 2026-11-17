import { describe, it, expect } from "vitest";
import { Euler, Matrix4 } from "three";
import {
  applyMat3,
  bakePoint,
  colorHex,
  convertPosition,
  convertRotation,
  convertTransform,
  eulerXYZ,
  sceneLocalToWorld,
  sceneRotationMatrix,
  ttsLocalToWorld,
  ttsUp,
  unityRotation,
} from "./convert.js";

const U = 0.0254;
const close = (a, b, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);

// Every rotation of a finite grid: each TTS angle (degrees) at the quarter
// turns (where an Euler triple is degenerate: the scene's Y at ±90° is gimbal
// lock), past a full turn either way, and at angles off every axis.
const ANGLES = [-270, -180, -90, -37, 0, 23, 90, 180, 405];
const ROTATIONS = ANGLES.flatMap((x) => ANGLES.flatMap((y) => ANGLES.map((z) => [x, y, z])));

describe("Unity's rotation", () => {
  it("applies z, then x, then y (Quaternion.Euler)", () => {
    // pitching 90° about x tips up (+y) onto +z, as in Unity
    expect(close(applyMat3(unityRotation([90, 0, 0]), [0, 1, 0]), [0, 0, 1])).toBe(true);
    // (90, 90, 0): x first takes +y to +z, then y takes +z to +x
    expect(close(applyMat3(unityRotation([90, 90, 0]), [0, 1, 0]), [1, 0, 0])).toBe(true);
    // (0, 90, 90): z first takes +y to -x, then y takes -x to +z
    expect(close(applyMat3(unityRotation([0, 90, 90]), [0, 1, 0]), [0, 0, 1])).toBe(true);
  });
  it("knows face down: rotZ 180 (or rotX 180) turns local up down", () => {
    expect(ttsUp([0, 180, 180])[1]).toBeCloseTo(-1);
    expect(ttsUp([180, 0, 0])[1]).toBeCloseTo(-1);
    expect(ttsUp([0, 37, 0])[1]).toBeCloseTo(1);
  });
});

describe("TTS → scene", () => {
  it("round-trips every point of an object: TTS world, converted == scene world of the baked point", () => {
    // Both ways round are affine maps of the local point, so agreeing at the
    // origin and the three unit points is agreeing at every point. The
    // position and the (non-uniform) scale are off every axis and unequal, so
    // no term of either cancels; the rotations are the whole grid.
    const POINTS = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const tableY = 0.96;
    expect(ROTATIONS.length).toBe(729);
    for (const [rotX, rotY, rotZ] of ROTATIONS) {
      const t = { posX: -32.5, posY: 2.25, posZ: 17.75, rotX, rotY, rotZ, scaleX: 0.5, scaleY: 2, scaleZ: 3 };
      const st = convertTransform(t, { unit: U, tableY });
      expect(st.scale).toBe(1);
      for (const p of POINTS) {
        const viaTTS = convertPosition(ttsLocalToWorld(t, p), { unit: U, tableY });
        const viaScene = sceneLocalToWorld(st, bakePoint(p, [t.scaleX, t.scaleY, t.scaleZ], U));
        expect(close(viaTTS, viaScene, 1e-5)).toBe(true);
      }
    }
  });

  it("a known object: Earthborne Rangers' first player mat", () => {
    // Custom_Tile at (-32.78, 0.96, -19.3277), rotY 180.001, scale 6.2229 — players sit at -Z
    const t = { posX: -32.78, posY: 0.96, posZ: -19.3277, rotX: 0, rotY: 180.001, rotZ: 0, scaleX: 6.2229, scaleY: 1, scaleZ: 6.2229 };
    const st = convertTransform(t, { unit: U, tableY: 0.96 });
    // on the table top, to the left, near the camera (+z in the scene), turned a half turn
    expect(close(st.position, [-32.78 * U, 0, 19.3277 * U], 1e-6)).toBe(true);
    expect(st.rotation[0]).toBe(0);
    expect(st.rotation[2]).toBe(0);
    expect(Math.abs(st.rotation[1])).toBeCloseTo(Math.PI, 4);
    // its far snap row (local z = 0.66) is further from the seat than its near one in both worlds
    const far = sceneLocalToWorld(st, bakePoint([0, 0.1, 0.66], [6.2229, 1, 6.2229], U));
    const near = sceneLocalToWorld(st, bakePoint([0, 0.1, 0.35], [6.2229, 1, 6.2229], U));
    expect(far[2]).toBeGreaterThan(near[2]); // rotated 180°: local +z points at the seat… in TTS, -z world
    expect(ttsLocalToWorld(t, [0, 0, 0.66])[2]).toBeLessThan(ttsLocalToWorld(t, [0, 0, 0.35])[2]);
  });

  it("prefers the Euler triple without roll: a half turn is (0, π, 0)", () => {
    expect(convertRotation([0, 180, 0])).toEqual([0, Math.round(Math.PI * 1e6) / 1e6, 0]);
    expect(convertRotation([0, 90, 0])[1]).toBeCloseTo(-Math.PI / 2, 6);
    expect(convertRotation([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("matches three's Euler XYZ for the same matrix", () => {
    for (const degrees of ROTATIONS) {
      const e = convertRotation(degrees);
      const m = sceneRotationMatrix(e);
      const three = new Matrix4().makeRotationFromEuler(new Euler(...e, "XYZ"));
      const el = three.elements; // column-major
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) expect(m[r][c]).toBeCloseTo(el[c * 4 + r], 5);
      const back = eulerXYZ(m);
      expect(close(sceneRotationMatrix(back).flat(), m.flat(), 1e-9)).toBe(true);
    }
  });

  it("positions and colours", () => {
    expect(convertPosition([1, 2, 3], { unit: 1, tableY: 1 })).toEqual([1, 1, -3]);
    expect(bakePoint([1, 1, 1], [2, 3, 4], 1)).toEqual([2, 3, -4]);
    expect(colorHex({ r: 1, g: 0.5, b: 0 })).toBe("#ff8000");
    expect(colorHex(null)).toBeNull();
  });
});
