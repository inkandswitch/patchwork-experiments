import { describe, it, expect } from "vitest";
import { BufferAttribute, BufferGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { BVH_MIN_TRIANGLES, installLazyBVH, triangleCount } from "./pick-accel.js";

// a strip of n triangles along x, in the z = 0 plane
function strip(n) {
  const p = [];
  for (let i = 0; i < n; i++) p.push(i, 0, 0, i + 1, 0, 0, i, 1, 0);
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(p), 3));
  return g;
}

describe("lazy pick BVH", () => {
  installLazyBVH();

  it("builds a big mesh's BVH on the first ray that crosses its box, and hits the same point", () => {
    const g = strip(BVH_MIN_TRIANGLES + 10);
    expect(triangleCount(g)).toBe(BVH_MIN_TRIANGLES + 10);
    const mesh = new Mesh(g, new MeshBasicMaterial());
    mesh.updateMatrixWorld(true);
    const rc = new Raycaster();
    rc.set(new Vector3(50.25, 0.25, 5), new Vector3(0, 0, 1)); // pointing away: misses the box
    expect(rc.intersectObject(mesh).length).toBe(0);
    expect(g.boundsTree).toBeUndefined();
    rc.set(new Vector3(50.25, 0.25, 5), new Vector3(0, 0, -1));
    rc.firstHitOnly = true;
    const hits = rc.intersectObject(mesh);
    expect(g.boundsTree).toBeTruthy();
    expect(hits.length).toBe(1);
    hits[0].point.toArray().forEach((v, i) => expect(v).toBeCloseTo([50.25, 0.25, 0][i], 6));
    expect(hits[0].faceIndex).toBe(50);
  });

  it("leaves small meshes on the plain raycast", () => {
    const g = strip(10);
    const mesh = new Mesh(g, new MeshBasicMaterial());
    mesh.updateMatrixWorld(true);
    const rc = new Raycaster(new Vector3(3.25, 0.25, 5), new Vector3(0, 0, -1));
    expect(rc.intersectObject(mesh).length).toBe(1);
    expect(g.boundsTree).toBeUndefined();
  });

  it("works per instance of an InstancedMesh", () => {
    const g = strip(BVH_MIN_TRIANGLES);
    const im = new InstancedMesh(g, new MeshBasicMaterial(), 2);
    im.setMatrixAt(0, new Matrix4());
    im.setMatrixAt(1, new Matrix4().makeTranslation(0, 10, 0));
    im.computeBoundingSphere();
    im.updateMatrixWorld(true);
    const rc = new Raycaster(new Vector3(7.25, 10.25, 5), new Vector3(0, 0, -1));
    const hits = rc.intersectObject(im);
    expect(hits.map((h) => h.instanceId)).toEqual([1]);
    expect(g.boundsTree).toBeTruthy();
  });
});
