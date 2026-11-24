// @vitest-environment node
import { describe, it, expect } from "vitest";
import { BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster } from "three";
import { castRay, pickAt, projectPoint } from "./picking.js";

const r6 = (a) => a.map((v) => Math.round(v * 1e6) / 1e6 + 0);
const SIZE = { w: 200, h: 100 };

/** A body (as the viewport's: a group carrying the object's id) holding a double-sided cube `size` across, at `at`. */
function body(id, at = [0, 0, 0], size = 1) {
  const g = new Group();
  g.userData.objectId = id;
  g.position.set(...at);
  g.add(new Mesh(new BoxGeometry(size, size, size), new MeshBasicMaterial({ side: DoubleSide })));
  g.updateMatrixWorld(true);
  return g;
}

function camera(position, target = [0, 0, 0]) {
  const cam = new PerspectiveCamera(45, SIZE.w / SIZE.h, 0.01, 1000);
  cam.position.set(...position);
  cam.lookAt(...target);
  cam.updateMatrixWorld();
  return cam;
}

const pick = (cam, targets, x, y, opts) => pickAt({ raycaster: new Raycaster(), camera: cam, size: SIZE, targets, focusDistance: cam.position.length() }, x, y, opts);

describe("picking", () => {
  it("picks the nearest drawn body in port px, with a normal facing the eye", () => {
    const near = body("near", [0, 0, 2]);
    const far = body("far", [0, 0, -2]);
    const cam = camera([0, 0, 10]);
    const hit = pick(cam, [near, far], 100, 50);
    expect(hit.id).toBe("near");
    expect(hit.point[2]).toBeCloseTo(2.5);
    expect(r6(hit.normal)).toEqual([0, 0, 1]);
    expect(hit.distance).toBeCloseTo(7.5);
    expect(hit.snapped).toBe(false);
    // hidden: not drawn, so not hit
    near.visible = false;
    expect(pick(cam, [near, far], 100, 50).id).toBe("far");
    // nothing there
    expect(pick(cam, [near, far], 100, 0)).toBe(null);
  });

  it("snaps to a vertex within snapPx when asked, also one the ray misses by a hair", () => {
    const c = body("c");
    const cam = camera([0, 0, 10]);
    const corner = projectPoint(cam, SIZE, [0.5, 0.5, 0.5]);
    // just outside the front corner (the back one projects a few px inward of it): missed by a hair
    const hit = pick(cam, [c], corner.x + 1, corner.y - 1, { snapPx: 6 });
    expect(hit).toMatchObject({ id: "c", snapped: true });
    expect(r6(hit.point)).toEqual([0.5, 0.5, 0.5]);
    expect(pick(cam, [c], corner.x - 3, corner.y + 3).snapped).toBe(false);
  });

  it("falls to the ground plane when asked", () => {
    const hit = pick(camera([0, 5, 5]), [], 100, 50, { ground: true });
    expect(hit).toMatchObject({ id: null, ground: true, normal: [0, 1, 0] });
    expect(r6(hit.point)).toEqual([0, 0, 0]);
  });

  it("projects in port px: visible only in front, inside the depth range and the port", () => {
    const cam = camera([0, 0, 10]);
    expect(projectPoint(cam, SIZE, [0, 0, 0])).toMatchObject({ x: 100, y: 50, visible: true });
    expect(projectPoint(cam, SIZE, [0, 0, 20]).visible).toBe(false); // behind
    expect(projectPoint(cam, SIZE, [1000, 0, 0]).visible).toBe(false); // off the port
  });

  it("casts along any world ray, stopping short when asked; a zero direction hits nothing", () => {
    const a = body("a");
    const b = body("b", [3, 0, 0]);
    const rc = new Raycaster();
    const hit = castRay(rc, [a, b], [-5, 0, 0], [2, 0, 0]);
    expect(hit.id).toBe("a");
    expect(hit.distance).toBeCloseTo(4.5);
    expect(r6(hit.normal)).toEqual([-1, 0, 0]);
    expect(castRay(rc, [b], [-5, 0, 0], [1, 0, 0]).id).toBe("b");
    expect(castRay(rc, [a, b], [-5, 0, 0], [1, 0, 0], 4)).toBe(null);
    expect(castRay(rc, [a, b], [-5, 0, 0], [0, 0, 0])).toBe(null);
    // from inside a solid: the face met from behind
    expect(castRay(rc, [a], [0, 0, 0], [1, 0, 0])).toMatchObject({ id: "a", back: true });
  });
});
