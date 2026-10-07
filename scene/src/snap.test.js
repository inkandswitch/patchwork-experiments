import { describe, it, expect } from "vitest";
import { nearestScreenVertex } from "./viewport.js";

// Column-major identity: clip = model = world, w = 1, so a vertex at (x, y)
// lands on screen at ((x + 1) / 2 · W, (1 − y) / 2 · H).
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const view = { width: 200, height: 100, eye: [0, 0, 5] };

describe("nearestScreenVertex (measure snapping)", () => {
  const pts = new Float32Array([
    -0.5, 0, 0, // screen (50, 50)
    0.5, 0, 0, // screen (150, 50)
    0.52, 0.02, -3, // screen (152, 49), but 8 m from the eye
  ]);

  it("finds the vertex nearest the cursor within the radius", () => {
    const r = nearestScreenVertex(pts, { count: 2 }, I, I, { ...view, x: 147, y: 52, maxPx: 10 });
    expect(r.index).toBe(1);
    expect(r.d).toBeCloseTo(Math.hypot(3, 2));
    expect(r.world).toEqual([0.5, 0, 0]);
  });

  it("returns null when nothing is within the radius", () => {
    expect(nearestScreenVertex(pts, { count: 2 }, I, I, { ...view, x: 100, y: 50, maxPx: 10 })).toBeNull();
  });

  it("skips vertices behind the surface the ray hit", () => {
    // the third vertex is nearer the cursor on screen but 8 m away; the hit was at 5.1 m
    const all = nearestScreenVertex(pts, { count: 3 }, I, I, { ...view, x: 152, y: 49, maxPx: 10 });
    expect(all.index).toBe(2);
    const front = nearestScreenVertex(pts, { count: 3 }, I, I, { ...view, x: 152, y: 49, maxPx: 10, maxDepth: 5.1 });
    expect(front.index).toBe(1);
  });

  it("reads interleaved positions and ignores points behind the camera", () => {
    // stride 4, offset 1: [pad, x, y, z] per vertex
    const inter = new Float32Array([9, -0.5, 0, 0, 9, 0.5, 0, 0]);
    const r = nearestScreenVertex(inter, { count: 2, stride: 4, offset: 1 }, I, I, { ...view, x: 52, y: 50, maxPx: 10 });
    expect(r.index).toBe(0);
    // an mvp whose w row is negative puts everything behind the camera
    const behind = [...I];
    behind[15] = -1;
    expect(nearestScreenVertex(inter, { count: 2, stride: 4, offset: 1 }, behind, I, { ...view, x: 52, y: 50, maxPx: 10 })).toBeNull();
  });

  it("applies the model matrix to the world point it returns", () => {
    const moved = [...I];
    moved[12] = 2; // translate x by 2 in world, but not on screen (mvp is separate)
    const r = nearestScreenVertex(pts, { count: 2 }, I, moved, { ...view, x: 150, y: 50, maxPx: 10 });
    expect(r.world).toEqual([2.5, 0, 0]);
  });
});

describe("Viewport.nearestVertex culling and BVH", () => {
  it("finds the same vertex as a brute-force scan over every vertex", async () => {
    const { Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Matrix4, InstancedMesh, TorusKnotGeometry } = await import("three");
    const { MeshBVH } = await import("three-mesh-bvh");
    const { Viewport } = await import("./viewport.js");
    const cam = new PerspectiveCamera(45, 1.6, 0.01, 1000);
    cam.position.set(3, 2, 6);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const rect = { width: 800, height: 500 };
    const root = new Group();
    const mat = new MeshBasicMaterial();
    const knot = new Mesh(new TorusKnotGeometry(1, 0.3, 64, 12), mat); // with a BVH
    const ball = new Mesh(new IcosahedronGeometry(0.5, 2), mat); // without
    ball.position.set(-2, 0.5, 0);
    const far = new Mesh(new IcosahedronGeometry(0.5, 1), mat); // off to the side, culled
    far.position.set(40, 0, 0);
    const behind = new Mesh(new IcosahedronGeometry(0.5, 1), mat); // behind the camera
    behind.position.set(6, 4, 12);
    const inst = new InstancedMesh(new IcosahedronGeometry(0.2, 1), mat, 3);
    [[1.5, -1, 1], [-1, 1.2, 1], [0, -1.5, -1]].forEach((p, i) => inst.setMatrixAt(i, new Matrix4().makeTranslation(...p)));
    root.add(knot, ball, far, behind, inst);
    root.updateMatrixWorld(true);
    knot.geometry.boundsTree = new MeshBVH(knot.geometry, { indirect: true });
    const vp = Object.create(Viewport.prototype);
    vp.camera = cam;
    const viewProj = new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const brute = (sx, sy, maxPx, maxDepth) => {
      let best = null;
      const eye = cam.position.toArray();
      const inm = new Matrix4();
      root.traverse((o) => {
        if (!o.isMesh) return;
        const pos = o.geometry.getAttribute("position");
        for (let c = 0; c < (o.isInstancedMesh ? o.count : 1); c++) {
          const model = o.matrixWorld.clone();
          if (o.isInstancedMesh) model.multiply((o.getMatrixAt(c, inm), inm));
          const r = nearestScreenVertex(pos.array, { count: pos.count }, new Matrix4().multiplyMatrices(viewProj, model).elements, model.elements, { ...rect, x: sx, y: sy, maxPx: best ? best.d : maxPx, eye, maxDepth });
          if (r) best = r;
        }
      });
      return best;
    };
    let compared = 0;
    for (let i = 0; i < 400; i++) {
      const sx = (i % 20) * 40 + 7, sy = Math.floor(i / 20) * 25 + 3;
      for (const maxDepth of [Infinity, 6.5]) {
        const want = brute(sx, sy, 10, maxDepth);
        const got = vp.nearestVertex([root], sx, sy, 10, rect, maxDepth);
        expect(!!got).toBe(!!want);
        if (want) {
          expect(got.d).toBeCloseTo(want.d, 6);
          got.world.forEach((v, k) => expect(v).toBeCloseTo(want.world[k], 6));
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(50);
  });
});
