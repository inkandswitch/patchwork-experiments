import { describe, it, expect } from "vitest";
import { inkCamera, mul, rigidOf, withPlanes, planesOf } from "./layer-camera.js";

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const translate = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const scale = (s) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
const rotY = (a) => [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1];
const perspective = (fovY, aspect, near, far) => {
  const f = 1 / Math.tan(fovY / 2);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, -(far + near) / (far - near), -1, 0, 0, (-2 * far * near) / (far - near), 0];
};
const apply = (m, [x, y, z]) => [0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]);

describe("the matrix helpers", () => {
  it("multiply column-major", () => {
    expect(apply(mul(translate(1, 2, 3), scale(2)), [1, 1, 1])).toEqual([3, 4, 5]);
  });
  it("split a uniform scale from a rigid part", () => {
    const { s, rigid } = rigidOf(mul(mul(translate(4, 0, 0), rotY(0.7)), scale(3)));
    expect(s).toBeCloseTo(3);
    expect(apply(rigid, [0, 0, 0])).toEqual([4, 0, 0]);
    expect(Math.hypot(rigid[0], rigid[1], rigid[2])).toBeCloseTo(1);
  });
  it("change near and far and read them back", () => {
    const p = withPlanes(perspective(1, 1.5, 0.1, 100), 2, 50);
    expect(planesOf(p).near).toBeCloseTo(2);
    expect(planesOf(p).far).toBeCloseTo(50);
  });
});

describe("inkCamera", () => {
  const projection = perspective(0.8, 1.6, 0.1, 1000);
  const view = translate(0, 0, -20); // the stage's eye at z = 20, looking down -z

  it("is the stage's view space scaled by 1/s, for any object transform", () => {
    const object = mul(mul(translate(3, -1, 2), rotY(0.9)), scale(2.5));
    const cam = inkCamera({ view, projection, object, bounds: { centre: [0, 0, 0], radius: 1 } });
    for (const p of [[0, 0, 0], [1, 2, 3], [-2, 0.5, 1]]) {
      const stage = apply(mul(view, object), p);
      const ink = apply(cam.viewMatrix, p);
      for (let i = 0; i < 3; i++) expect(ink[i] * cam.scale).toBeCloseTo(stage[i], 9);
    }
  });
  it("keeps the projection's x and y and scales its planes", () => {
    const cam = inkCamera({ view, projection, object: scale(2), bounds: { centre: [0, 0, 0], radius: 1 } });
    expect(cam.projectionMatrix[0]).toBe(projection[0]);
    expect(cam.projectionMatrix[5]).toBe(projection[5]);
    expect(planesOf(cam.projectionMatrix).near).toBeCloseTo(0.05);
  });
  it("frames the depth window on the world, clamped to the near plane", () => {
    const cam = inkCamera({ view, projection, object: I, bounds: { centre: [0, 0, 0], radius: 4 } });
    expect(cam.depthRange[0]).toBeCloseTo(20 - 4.2);
    expect(cam.depthRange[1]).toBeCloseTo(20 + 4.2);
    const inside = inkCamera({ view: I, projection, object: I, bounds: { centre: [0, 0, 0], radius: 4 } });
    expect(inside.depthRange[0]).toBeCloseTo(0.1);
  });
  it("is null when the world is behind the eye", () => {
    expect(inkCamera({ view, projection, object: translate(0, 0, 40), bounds: { centre: [0, 0, 0], radius: 4 } })).toBeNull();
  });
});
