// A ship's body frame (body.js): where it sits in her hull's frame, from her
// trait or her GLB, and her pose through it and back.
import { describe, it, expect } from "vitest";
import { IDENTITY, bodyBox, bodyBoxOf, bodyOf, frameFromAxes, frameMatrix, frameOf, placeIn, toBody, toObject, yawOf } from "./body.js";
import { apply, matrixOf, quatFromEuler, rotateQ } from "./frames.js";
import { composeMatrix, multiply } from "./test/fakes.js";

const near = (a, b, digits = 9) => {
  expect(a).toHaveLength(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
};
/** q and −q are one rotation. */
const sameRotation = (a, b) => expect(Math.abs(a.reduce((s, v, i) => s + v * b[i], 0))).toBeCloseTo(1, 9);

describe("the frame", () => {
  it("from a bow along +X (camber's): her bow −Z is the model's +X, her starboard +X the model's +Z, up is up", () => {
    const f = frameFromAxes([1, 0, 0], [0, 1, 0]);
    const m = frameMatrix(f);
    near(apply(m, [0, 0, -1]), [1, 0, 0]);
    near(apply(m, [1, 0, 0]), [0, 0, 1]);
    near(apply(m, [0, 1, 0]), [0, 1, 0]);
    near(f.position, [0, 0, 0]);
  });

  it("from the GLB, puts her body's origin where it says (midships on her waterline), else the middle of her box level with y = 0", () => {
    const content = { extras: { ship: { forward: [1, 0, 0] } }, box: { min: [0, -1, -1.2], max: [5, 0.8, 1.2] } };
    near(frameOf({}, content).position, [2.5, 0, 0]);
    near(frameOf({}, { ...content, extras: { ship: { forward: [1, 0, 0], origin: [2.2, 0, 0] } } }).position, [2.2, 0, 0]);
    // a GLB that says where her middle is but not which way: her origin moves, she isn't turned
    expect(frameOf({}, { extras: { ship: { origin: [0, 0, 0.4] } } })).toEqual({ position: [0, 0, 0.4], rotation: [0, 0, 0] });
    // a trait frame that gives only a turn keeps the GLB's origin, and one that gives only a place keeps its turn
    near(frameOf({ frame: { rotation: [0, -Math.PI / 2, 0] } }, content).position, [2.5, 0, 0]);
    expect(frameOf({ frame: { position: [1, 0, 0] } }, content).rotation).toEqual(frameOf({}, content).rotation);
  });

  it("from the sloop's own axes is no turn at all, and a raked bow is squared to up", () => {
    near(frameFromAxes([0, 0, -1]).rotation, [0, 0, 0]);
    const raked = frameMatrix(frameFromAxes([1, 0.2, 0]));
    near(apply(raked, [0, 0, -1]), [1, 0, 0]);
    expect(frameFromAxes([0, 1, 0], [0, 1, 0])).toBeNull();
    expect(frameFromAxes(null)).toBeNull();
  });

  it("is the trait's frame over the GLB's forward and up, else the hull's own", () => {
    const glb = { extras: { ship: { length: 5, forward: [1, 0, 0], up: [0, 1, 0] } } };
    expect(frameOf({ frame: { position: [1, 2, 3], rotation: [0, 0.5, 0] } }, glb)).toEqual({ position: [1, 2, 3], rotation: [0, 0.5, 0] });
    near(frameMatrix(frameOf({ frame: { rotation: [0, Math.PI / 2, 0] } }, glb)).slice(8, 11), [1, 0, 0]); // her +Z (aft) is the model's +X
    near(frameMatrix(frameOf({}, glb)).slice(8, 11), [-1, 0, 0]);
    expect(frameOf({}, { extras: { ship: { length: 12 } } })).toBe(IDENTITY);
    expect(frameOf(undefined, null)).toBe(IDENTITY);
  });
});

describe("her pose through the frame", () => {
  const frame = { position: [0.5, -0.3, 2], rotation: [0.1, -Math.PI / 2, 0.05] };
  const pose = { position: [10, 0.4, -7], quaternion: quatFromEuler([0.05, 1.2, -0.1]) };

  it("round-trips: object → body → object, at any scale", () => {
    for (const scale of [1, 2.5]) {
      const body = toBody(pose, frame, scale);
      const back = toObject(body, frame, scale);
      near(back.position, pose.position);
      sameRotation(back.quaternion, pose.quaternion);
    }
  });

  it("is the object's world matrix times the frame's", () => {
    const scale = 2;
    const body = toBody(pose, frame, scale);
    const m = multiply(composeMatrix({ position: pose.position, rotation: [0.05, 1.2, -0.1], scale }), frameMatrix(frame));
    near([m[12], m[13], m[14]], body.position);
    // her bow, in the world, both ways
    const bow = rotateQ(body.quaternion, [0, 0, -1]);
    const l = Math.hypot(m[8], m[9], m[10]);
    near([-m[8] / l, -m[9] / l, -m[10] / l], bow);
  });

  it("is nothing at all for the hull's own frame", () => {
    expect(toBody(pose, IDENTITY)).toEqual(pose);
    expect(toObject(pose, IDENTITY)).toEqual(pose);
  });

  it("gives her heading as a yaw (0: bow down −Z)", () => {
    expect(yawOf(quatFromEuler([0, 0.7, 0]))).toBeCloseTo(0.7, 9);
  });

  it("bodyOf: the stage's world matrix of her hull, through her frame", () => {
    const glb = { ship: { forward: [1, 0, 0] } };
    const t = { position: [3, 0, 4], rotation: [0, 0.3, 0], scale: 1 };
    const api = { worldOf: () => composeMatrix(t), scene: () => ({ objects: { h: { traits: { "sailing.ship": {} } } } }), content: () => ({ extras: glb, box: null }) };
    const m = bodyOf(api, "h");
    // her body's −Z is the hull object's +X, turned by the hull's yaw
    const hullX = composeMatrix(t).slice(0, 3);
    near([-m[8], -m[9], -m[10]], hullX);
    expect(bodyOf({ ...api, worldOf: () => null }, "h")).toBeNull();
  });

  it("bodyOf is rigid: a hull drawn a metre long and scaled ten times is walked in metres", () => {
    // camber's: bow +X, origin at the transom, the box 0..1 along X
    const glb = { ship: { forward: [1, 0, 0], up: [0, 1, 0] } };
    const t = { position: [3, 0, 4], rotation: [0, 0.3, 0], scale: 10 };
    const api = { worldOf: () => composeMatrix(t), scene: () => ({ objects: { h: { traits: { "sailing.ship": {} } } } }), content: () => ({ extras: glb, box: { min: [0, -0.1, -0.2], max: [1, 0.14, 0.2] } }) };
    const m = bodyOf(api, "h");
    for (const c of [0, 4, 8]) expect(Math.hypot(m[c], m[c + 1], m[c + 2])).toBeCloseTo(1, 9);
    // her origin midships: half her ten metres forward of the transom, along the hull's +X
    const hullX = composeMatrix({ ...t, scale: 1 }).slice(0, 3);
    near([m[12], m[13], m[14]], [3 + 5 * hullX[0], 0, 4 + 5 * hullX[2]]);
    // and the physics' body pose agrees
    const pose = toBody({ position: t.position, quaternion: quatFromEuler(t.rotation) }, frameOf({}, api.content()), 10);
    near([m[12], m[13], m[14]], pose.position);
    // her box in that frame is in metres too: her transom 5 m aft of midships, not half a model unit
    const box = bodyBoxOf(api, "h");
    near(box.max, [2, 1.4, 5]);
    near(box.min, [-2, -1, -5]);
  });
});

describe("where things sit", () => {
  it("a box in the model's frame, as her body sees it", () => {
    const f = frameFromAxes([1, 0, 0]);
    const box = bodyBox({ min: [0, -1, -2], max: [10, 2, 2] }, f);
    near(box.min, [-2, -1, -10]);
    near(box.max, [2, 2, 0]);
  });

  it("placeIn: the doc's transforms from under the root down, as the stage composes them", () => {
    const objects = {
      hull: { transform: { position: [5, 0, 0], rotation: [0, 1, 0], scale: 2 } },
      mast: { parent: "hull", transform: { position: [0, 1, -2], rotation: [0, 0.2, 0], scale: 1 } },
      rig: { parent: "mast", transform: { position: [0, 1.5, 0.1], rotation: [0, 0.4, 0], scale: 1.5 } },
    };
    const parents = new Map([["hull", null], ["mast", "hull"], ["rig", "mast"]]);
    const sc = { objects, parents };
    near(placeIn(sc, "rig", "hull"), multiply(composeMatrix(objects.mast.transform), composeMatrix(objects.rig.transform)));
    near(placeIn(sc, "rig", null), multiply(composeMatrix(objects.hull.transform), placeIn(sc, "rig", "hull")));
    near(placeIn(sc, "hull", "hull"), matrixOf(null));
    expect(placeIn(sc, "hull", "rig")).toBeNull();
    // a doc (no resolved parents) reads each object's own parent
    near(placeIn({ objects }, "rig", "hull"), placeIn(sc, "rig", "hull"));
  });

  it("matrixOf is the stage's T · R(XYZ) · S", () => {
    const t = { position: [1, 2, 3], rotation: [0.3, -0.7, 1.1], scale: 1.7 };
    near(matrixOf(t), composeMatrix(t));
  });
});
