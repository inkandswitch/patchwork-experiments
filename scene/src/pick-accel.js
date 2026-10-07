// Faster picking for big meshes: a bounding-volume hierarchy (three-mesh-bvh),
// built lazily. A mesh with at least BVH_MIN_TRIANGLES gets one the first time
// a pick ray crosses its bounding box (or earlier, in idle time — see
// Viewport.queueBVH); smaller ones keep three's plain raycast. The patch is
// on this bundle's own copy of three, so it touches nothing outside the scene.

import { Matrix4, Mesh, Ray } from "three";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";

export const BVH_MIN_TRIANGLES = 2_000;

const inv = new Matrix4();
const localRay = new Ray();

export function triangleCount(geometry) {
  if (!geometry) return 0;
  const n = geometry.index ? geometry.index.count : (geometry.getAttribute?.("position")?.count ?? 0);
  return Math.floor(n / 3);
}

/** Does this geometry want a BVH (and doesn't have one yet)? */
export const wantsBVH = (g) => !!g && !g.boundsTree && !g.userData?.noBVH && triangleCount(g) >= BVH_MIN_TRIANGLES;

/** Build a geometry's BVH now. Leaves the index alone (indirect), so drawing is unchanged. */
export function buildBVH(g) {
  if (!wantsBVH(g)) return false;
  try {
    g.boundsTree = new MeshBVH(g, { indirect: true });
    return true;
  } catch {
    g.userData.noBVH = true; // e.g. no usable positions: plain raycast it is
    return false;
  }
}

/** Mesh#raycast: build the BVH on the first ray that crosses the box, then use it. */
export function lazyBVHRaycast(raycaster, intersects) {
  const g = this.geometry;
  if (wantsBVH(g)) {
    if (!g.boundingBox) g.computeBoundingBox();
    inv.copy(this.matrixWorld).invert();
    localRay.copy(raycaster.ray).applyMatrix4(inv);
    if (localRay.intersectsBox(g.boundingBox)) buildBVH(g);
  }
  return acceleratedRaycast.call(this, raycaster, intersects);
}

let installed = false;
/** Route every Mesh (and each InstancedMesh instance, which raycasts through a Mesh) through lazyBVHRaycast. */
export function installLazyBVH() {
  if (installed) return;
  installed = true;
  Mesh.prototype.raycast = lazyBVHRaycast;
}
