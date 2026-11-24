// @vitest-environment node
import { describe, it, expect } from "vitest";
import { Box3, BoxGeometry, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { depthRange, nearestClear, sceneDepth } from "./clearance.js";

/** A shown object: a cube mesh `size` across at `at`, posed `pose`, with its world box. */
function cube(at = [0, 0, 0], size = 1, pose = {}) {
  const mesh = new Mesh(new BoxGeometry(size, size, size), new MeshBasicMaterial());
  mesh.position.set(...at);
  if (pose.rotation) mesh.rotation.set(...pose.rotation);
  if (pose.scale) mesh.scale.setScalar(pose.scale);
  mesh.updateMatrixWorld(true);
  return { content: mesh, box: new Box3().setFromObject(mesh) };
}

describe("the depth range", () => {
  it("near is half the clearance to the nearest geometry; far reaches past the scene; a holder's planes win", () => {
    expect(depthRange({ dist: 10, radius: 1, clear: 4 })).toEqual({ near: 2, far: 1000 });
    // touching: a tenth of a millimetre at least
    expect(depthRange({ dist: 10, radius: 1, clear: 0 }).near).toBe(1e-4);
    // inside something that couldn't be measured: dist / 200
    expect(depthRange({ dist: 10, radius: 1, clear: 0, known: false }).near).toBeCloseTo(0.05);
    expect(depthRange({ dist: 1, radius: 100, clear: 0 }).far).toBe(2001);
    expect(depthRange({ dist: 10, radius: 1, clear: 4, held: { near: 0.1 } })).toEqual({ near: 0.1, far: 1000 });
    expect(depthRange({ dist: 10, radius: 1, clear: 4, held: { far: 50 } })).toEqual({ near: 2, far: 50 });
  });

  it("the scene's radius is what's shown and every extent together; 1 with nothing", () => {
    expect(sceneDepth([], []).radius).toBe(1);
    const one = sceneDepth([cube()], []);
    expect(one.radius).toBeCloseTo(Math.sqrt(3) / 2);
    expect(sceneDepth([cube()], [new Box3(new Vector3(-10, 0, -10), new Vector3(10, 0, 10))]).radius).toBeGreaterThan(10);
  });
});

describe("how near the nearest geometry is", () => {
  it("a point inside a big scene's box but 0.4 m from the nearest object is centimetres clear, not the scene's size", () => {
    const { near } = sceneDepth([cube([-40, 0, -40], 2), cube([40, 5, 40], 2), cube([0, 0, 0], 1)], []);
    const { clear, known } = nearestClear(new Vector3(0, 0, 0.9), [], near);
    expect(known).toBe(true);
    // the cube's face is at z = 0.5; its box with its margin at 0.55
    expect(clear).toBeGreaterThan(0.3);
    expect(clear).toBeLessThanOrEqual(0.4 + 1e-9);
    expect(depthRange({ dist: 2, radius: 60, clear, known }).near).toBeGreaterThan(0.15);
  });

  it("inside an object's box, the distance is to its triangles, in world metres, also as it moves its own vertices", () => {
    // a 10 m box with the point 0.4 m inside its +x wall
    const hull = cube([0, 0, 0], 10);
    expect(nearestClear(new Vector3(4.6, 0, 0), [], sceneDepth([hull], []).near).clear).toBeCloseTo(0.4, 6);
    // turned and scaled
    const turned = cube([0, 0, 0], 10, { rotation: [0, 0.3, 0], scale: 2 });
    const near = sceneDepth([turned], []).near;
    expect(nearestClear(new Vector3(9.6, 0, 0), [], near).clear).toBeCloseTo(10 - 9.6 * Math.cos(0.3), 6);
    // a mesh that moves its own vertices (frustumCulled off) is measured as it is now
    turned.content.frustumCulled = false;
    turned.content.geometry.attributes.position.array.forEach((v, i, a) => (a[i] = v * 0.5));
    expect(nearestClear(new Vector3(9.6, 0, 0), [], near).clear).toBeCloseTo(9.6 * Math.cos(0.3) - 5, 6);
  });

  it("can't measure inside a box still loading (no content) or an extent: not known", () => {
    const hint = { content: null, box: new Box3(new Vector3(-5, -5, -5), new Vector3(5, 5, 5)) };
    const near = sceneDepth([hint], []).near;
    expect(nearestClear(new Vector3(0, 0, 0), [], near).known).toBe(false);
    expect(nearestClear(new Vector3(0, 0, 20), [], near).clear).toBeGreaterThan(14);
    const grid = [new Box3(new Vector3(-10, -1, -10), new Vector3(10, 1, 10))];
    expect(nearestClear(new Vector3(0, 0, 0), grid, []).known).toBe(false);
    expect(nearestClear(new Vector3(0, 3, 0), grid, [])).toEqual({ clear: 2, known: true });
    expect(nearestClear(new Vector3(0, 3, 0), [], [])).toEqual({ clear: 0, known: false });
  });
});
