// The stock sloop's walkable geometry as triangles in her body frame,
// straight from ship.js (partMeshes, placed by FIT), as the crew's input
// adapter gathers it from her GLBs in play: the hull, the mast and its
// rigging, the wheel as the cylinder its turn sweeps, the mainsheet's
// traveller, the windlass and the ladder. Not the boom and sail (they swing) nor the anchor (it hangs).
import { FIT, partMeshes } from "../ship.js";
import { apply, matrixOf } from "../frames.js";
import { sweptAbout } from "../navmesh.js";
import { seedsOf, standOff } from "../walker.js";

/** A part's triangles in its own frame (9 numbers each). */
export function partTriangles(kind) {
  const out = [];
  for (const mesh of partMeshes(kind)) {
    for (const p of mesh.primitives) {
      const pos = p.positions;
      const idx = p.indices ?? Array.from({ length: pos.length / 3 }, (_, i) => i);
      for (let t = 0; t + 2 < idx.length; t += 3) for (let k = 0; k < 3; k++) out.push(pos[idx[t + k] * 3], pos[idx[t + k] * 3 + 1], pos[idx[t + k] * 3 + 2]);
    }
  }
  return out;
}

const place = (tris, t) => {
  const m = matrixOf(t);
  const out = [];
  for (let k = 0; k < tris.length; k += 3) out.push(...apply(m, [tris[k], tris[k + 1], tris[k + 2]]));
  return out;
};

/** The sloop's triangles, body frame. */
export function sloopTriangles() {
  return [
    ...partTriangles("hull"),
    ...place(partTriangles("mast"), { ...FIT.mast, scale: 1 }),
    ...place(sweptAbout(partTriangles("wheel"), 2), { ...FIT.wheel, scale: 1 }),
    ...place(partTriangles("windlass"), { ...FIT.windlass, scale: 1 }),
    ...place(partTriangles("ladder"), { ...FIT.ladder, scale: 1 }),
    ...place(partTriangles("mainsheet"), { ...FIT.mainsheet, scale: 1 }),
  ];
}

/** Her seeds: spawn at the helm, a stand spot for each station, the ladder. */
export function sloopSeeds() {
  return seedsOf({
    helm: "wheel",
    stations: [
      { id: "wheel", at: FIT.wheel.position },
      { id: "rig", at: FIT.rig.position },
      { id: "windlass", at: FIT.windlass.position },
      { id: "mainsheet", at: FIT.mainsheet.position, by: standOff("mainsheet") },
    ],
    ladder: { id: "ladder", at: FIT.ladder.position },
  });
}
