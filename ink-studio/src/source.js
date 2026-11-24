// scene:source "ink-scene": an ink-scene doc in a scene, as a GLB. The GLB is
// the proxy (proxy.js): what the scene picks, bounds and frames. The in-scene
// layer (extension.js) draws the splats over it with ink's own renderer.
//
// Building runs the doc's code (load-scene.js), as the tool does.

import * as toolkit from "./generated/toolkit.js";
import { loadScene } from "./load-scene.js";
import { proxyMesh } from "./proxy.js";
import { encodeGLB } from "./glb.js";

export const sourceKey = (doc) => JSON.stringify([doc?.kind ?? null, doc?.main ?? null, doc?.files ?? null]);

/** A short stable hash of a string (FNV-1a, 32 bits, base 36). */
export function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

export default {
  fingerprint: (doc) => `v1:${hash(sourceKey(doc))}`,
  async build({ doc, params }) {
    const scene = await loadScene(toolkit, doc);
    const world = await scene.build(scene.seed);
    if (!world?.data) throw new Error("the scene's build() returned no world");
    const mesh = proxyMesh(world, { cells: params?.cells ?? 48 });
    const glb = encodeGLB({
      meshes: mesh.indices.length
        ? [{ name: "ink-proxy", positions: mesh.positions, normals: mesh.normals, colors: mesh.colors, indices: mesh.indices, roughness: 1 }]
        : [],
      extras: { ink: { splats: world.count, cells: mesh.cells } },
      generator: "ink-studio proxy",
    });
    return {
      kind: "glb",
      glb,
      meta: {
        ...(mesh.bounds ? { bounds: mesh.bounds } : {}),
        notes: `${world.count.toLocaleString()} splats; the blocks are a stand-in for picking and framing`,
      },
    };
  },
};
