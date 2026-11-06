// Playing back another view's held pose: the maths, as pure functions.
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  addSample,
  aheadOf,
  blendTransform,
  clockOffset,
  eulerFromQuat,
  GAP_INTERVALS,
  MAX_DELAY_MS,
  MAX_SAMPLES,
  OFFSET_CREEP_MS,
  playoutDelay,
  poseAt,
  quatFromEuler,
  slerp,
} from "./smooth.js";

const T = (position, rotation = [0, 0, 0], scale = 1) => ({ position, rotation, scale });
const close = (a, b, eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < eps);
/** The same rotation (as three builds it from Euler XYZ), whatever the angles look like. */
const sameRotation = (a, b, eps = 1e-9) => {
  const qa = new THREE.Quaternion().setFromEuler(new THREE.Euler(...a, "XYZ"));
  const qb = new THREE.Quaternion().setFromEuler(new THREE.Euler(...b, "XYZ"));
  return Math.abs(Math.abs(qa.dot(qb)) - 1) < eps;
};

describe("rotations", () => {
  it("Euler XYZ ↔ quaternion agree with three", () => {
    for (const r of [[0, 0, 0], [0.3, -1.2, 2.5], [Math.PI / 2, 0.1, -0.4], [-2, 1.4, 3]]) {
      const ours = quatFromEuler(r);
      const theirs = new THREE.Quaternion().setFromEuler(new THREE.Euler(...r, "XYZ"));
      expect(close(ours, theirs.toArray())).toBe(true);
      const back = new THREE.Euler().setFromQuaternion(theirs, "XYZ");
      expect(close(eulerFromQuat(ours), [back.x, back.y, back.z], 1e-7)).toBe(true);
    }
    // gimbal lock (y = ±90°): still the same rotation
    const locked = [0.4, Math.PI / 2, 0.2];
    expect(sameRotation(eulerFromQuat(quatFromEuler(locked)), locked, 1e-6)).toBe(true);
  });

  it("slerp agrees with three, takes the short way round, and carries on past 1", () => {
    const a = quatFromEuler([0, 0, 0]);
    const b = quatFromEuler([0, 1, 0]);
    for (const t of [0, 0.25, 0.5, 1]) {
      const theirs = new THREE.Quaternion(...a).slerp(new THREE.Quaternion(...b), t);
      expect(close(slerp(a, b, t), theirs.toArray(), 1e-9)).toBe(true);
    }
    // past 1: the same turn, further (a yaw of 1 rad per step, 1.5 steps)
    expect(sameRotation(eulerFromQuat(slerp(a, b, 1.5)), [0, 1.5, 0])).toBe(true);
    // -q is the same rotation as q: the short way, not the long one
    const negB = b.map((v) => -v);
    expect(sameRotation(eulerFromQuat(slerp(a, negB, 0.5)), [0, 0.5, 0])).toBe(true);
  });
});

describe("blendTransform", () => {
  it("lerps position and scale, slerps rotation; 0 and 1 are the ends exactly", () => {
    const a = T([0, 0, 0], [0, 0, 0], 1);
    const b = T([10, 2, -4], [0, Math.PI / 2, 0], 3);
    const mid = blendTransform(a, b, 0.5);
    expect(mid.position).toEqual([5, 1, -2]);
    expect(mid.scale).toBe(2);
    expect(sameRotation(mid.rotation, [0, Math.PI / 4, 0])).toBe(true);
    expect(blendTransform(a, b, 0)).toEqual(a);
    expect(blendTransform(a, b, 1)).toEqual(b);
  });

  it("turns through the short way across ±π (a heading that wraps)", () => {
    const a = T([0, 0, 0], [0, 0, Math.PI - 0.1]);
    const b = T([0, 0, 0], [0, 0, -Math.PI + 0.1]);
    const mid = blendTransform(a, b, 0.5);
    expect(sameRotation(mid.rotation, [0, 0, Math.PI])).toBe(true);
  });

  it("keeps an unchanged rotation exactly as given (no round trip)", () => {
    const r = [0.1, 0.2, 0.3];
    expect(blendTransform(T([0, 0, 0], r), T([1, 0, 0], r), 0.3).rotation).toEqual(r);
  });

  it("fills in a partial transform, and never carries a scale through zero", () => {
    expect(blendTransform({ position: [0, 0, 0] }, { position: [2, 0, 0] }, 0.5)).toEqual(T([1, 0, 0]));
    expect(blendTransform(T([0, 0, 0], [0, 0, 0], 1), T([0, 0, 0], [0, 0, 0], 0.5), 3).scale).toBe(1);
  });
});

describe("poseAt", () => {
  const s = [
    { at: 1000, transform: T([0, 0, 0]) },
    { at: 1050, transform: T([1, 0, 0], [0, 0.1, 0]) },
    { at: 1100, transform: T([2, 0, 0], [0, 0.2, 0]) },
  ];

  it("nothing for no samples; one sample is shown as it is, and is settled", () => {
    expect(poseAt([], 5)).toBeNull();
    expect(poseAt(null, 5)).toBeNull();
    expect(poseAt([s[0]], 0)).toEqual({ transform: s[0].transform, settled: true });
    expect(poseAt([s[0]], 1e9)).toEqual({ transform: s[0].transform, settled: true });
  });

  it("before the first: the first", () => {
    expect(poseAt(s, 900)).toEqual({ transform: s[0].transform, settled: false });
  });

  it("between two samples: the blend, by time", () => {
    const p = poseAt(s, 1025);
    expect(p.settled).toBe(false);
    expect(close(p.transform.position, [0.5, 0, 0])).toBe(true);
    expect(sameRotation(p.transform.rotation, [0, 0.05, 0])).toBe(true);
    const q = poseAt(s, 1090);
    expect(close(q.transform.position, [1.8, 0, 0])).toBe(true);
    expect(sameRotation(q.transform.rotation, [0, 0.18, 0])).toBe(true);
    // exactly on a sample
    expect(close(poseAt(s, 1050).transform.position, [1, 0, 0])).toBe(true);
  });

  it("past the last: carries on along the last step for `ahead` ms, then holds there", () => {
    const p = poseAt(s, 1125, { ahead: 50 });
    expect(p.settled).toBe(false);
    expect(close(p.transform.position, [2.5, 0, 0])).toBe(true);
    expect(sameRotation(p.transform.rotation, [0, 0.25, 0])).toBe(true);
    const held = poseAt(s, 1500, { ahead: 50 });
    expect(held.settled).toBe(true);
    expect(close(held.transform.position, [3, 0, 0])).toBe(true);
    expect(sameRotation(held.transform.rotation, [0, 0.3, 0])).toBe(true);
    // no extrapolation asked for: the last, settled
    expect(poseAt(s, 1101)).toEqual({ transform: s[2].transform, settled: true });
  });

  it("a still stream (keepalives of one pose) stays put", () => {
    const still = [
      { at: 0, transform: T([4, 0, 0]) },
      { at: 1000, transform: T([4, 0, 0]) },
    ];
    expect(poseAt(still, 500).transform.position).toEqual([4, 0, 0]);
    expect(poseAt(still, 1040, { ahead: 50 }).transform.position).toEqual([4, 0, 0]);
  });
});

describe("addSample", () => {
  const x = (n) => T([n, 0, 0]);

  it("appends in order, keeping the last MAX_SAMPLES", () => {
    let s = [];
    for (let i = 0; i < MAX_SAMPLES + 3; i++) s = addSample(s, { at: i * 50, transform: x(i) }, 50);
    expect(s).toHaveLength(MAX_SAMPLES);
    expect(s[0].at).toBe(3 * 50);
    expect(s.at(-1).transform).toEqual(x(MAX_SAMPLES + 2));
  });

  it("doesn't change the array it was given", () => {
    const s = [{ at: 0, transform: x(0) }];
    const next = addSample(s, { at: 50, transform: x(1) }, 50);
    expect(s).toHaveLength(1);
    expect(next).toHaveLength(2);
  });

  it("a sample no later than the last replaces it", () => {
    const s = addSample([{ at: 100, transform: x(0) }], { at: 100, transform: x(1) }, 50);
    expect(s).toEqual([{ at: 100, transform: x(1) }]);
  });

  it("after a pause, the last pose is taken to have held until one interval before the new one", () => {
    const s = addSample([{ at: 0, transform: x(0) }], { at: 1000, transform: x(1) }, 50);
    expect(s).toEqual([
      { at: 0, transform: x(0) },
      { at: 950, transform: x(0) },
      { at: 1000, transform: x(1) },
    ]);
    // so the move plays at its own speed, not smeared over the second
    expect(poseAt(s, 500).transform.position).toEqual([0, 0, 0]);
    // a late packet within GAP_INTERVALS is just late
    expect(addSample([{ at: 0, transform: x(0) }], { at: 50 * GAP_INTERVALS, transform: x(1) }, 50)).toHaveLength(2);
  });
});

describe("timing", () => {
  it("plays 1.5 send intervals late, carries on one interval past the last, both capped", () => {
    expect(playoutDelay(50)).toBe(75);
    expect(playoutDelay(1000 / 60)).toBeCloseTo(25);
    expect(playoutDelay(1000)).toBe(MAX_DELAY_MS);
    expect(aheadOf(50)).toBe(50);
    expect(aheadOf(1000)).toBe(MAX_DELAY_MS);
  });

  it("the clock offset follows the fastest delivery, creeping up slowly after a slower one", () => {
    // the sender's clock is 10 000 ms behind ours; deliveries take 30, 20, 80, 25, 15 ms
    let o = clockOffset(null, 0, 10_030);
    expect(o).toBe(10_030);
    o = clockOffset(o, 50, 10_070);
    expect(o).toBe(10_020);
    o = clockOffset(o, 100, 10_180);
    expect(o).toBe(10_020 + OFFSET_CREEP_MS);
    o = clockOffset(o, 150, 10_175);
    expect(o).toBe(10_020 + 2 * OFFSET_CREEP_MS);
    o = clockOffset(o, 200, 10_215);
    expect(o).toBe(10_015);
  });
});
