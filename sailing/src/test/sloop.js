// The stock sloop's walkable geometry as triangles in her body frame,
// straight from ship.js (partMeshes, placed by FIT), as the crew's input
// adapter gathers it from her GLBs in play: the hull, the mast and its
// rigging, the wheel as the cylinder its turn sweeps, the mainsheet's
// traveller, the jib's winches, the windlass, the ladder, and the
// companionway with its hatch shut. Not the boom
// and sail nor the jib (they swing) nor the anchor (it hangs).
import { FIT, partMeshes, winchTrait } from "../ship.js";
import { apply, matrixOf } from "../frames.js";
import { sweptAbout } from "../navmesh.js";
import { facing, seedsOf, standOff } from "../walker.js";

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
    ...WINCHES.flatMap((w) => place(partTriangles("winch"), { position: w.at, rotation: [0, 0, 0], scale: 1 })),
    ...place(partTriangles("companionway"), { ...FIT.companionway, scale: 1 }),
    ...place(partTriangles("hatch"), { ...FIT.hatch, scale: 1 }),
  ];
}

/** Her jib's winches, port and starboard: where each stands and where you stand to work it (its trait's stand), body frame. */
export const WINCHES = [-1, 1].map((side) => {
  const at = [side * Math.abs(FIT.winch.position[0]), FIT.winch.position[1], FIT.winch.position[2]];
  const st = winchTrait(side).stand;
  return { id: side < 0 ? "winch-port" : "winch-starboard", side, at, stand: at.map((v, i) => v + st[i]) };
});

/** Her seeds: spawn at the helm, a stand spot for each station, the ladder. */
export function sloopSeeds() {
  return seedsOf({
    helm: "wheel",
    stations: [
      { id: "wheel", at: FIT.wheel.position },
      { id: "rig", at: FIT.rig.position },
      { id: "windlass", at: FIT.windlass.position },
      { id: "mainsheet", at: FIT.mainsheet.position, by: standOff("mainsheet") },
      ...WINCHES.map((w) => facing(w.id, w.at, w.stand)),
    ],
    ladder: { id: "ladder", at: FIT.ladder.position },
  });
}
