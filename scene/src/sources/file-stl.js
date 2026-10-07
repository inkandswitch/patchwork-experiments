// scene:source "file-stl" — STL (binary or ASCII) → GLB, converted from the
// file's units and up axis to Y-up metres, with computed normals.
import { fileContent, stripExtension } from "../file-content.js";
import { computeBounds, computeNormals, encodeGLB } from "../glb.js";
import { parseSTL, toYUpMeters } from "../stl.js";

export function stlToGLB(content, { unit = "mm", up = "z" } = {}, name = "STL") {
  const stl = parseSTL(content);
  const positions = toYUpMeters(stl.positions, { unit, up });
  const normals = computeNormals(positions);
  const glb = encodeGLB({ meshes: [{ name, positions, normals }] });
  const bounds = computeBounds(positions);
  return {
    kind: "glb",
    glb,
    meta: {
      ...(bounds ? { bounds } : {}),
      notes: `${stl.triangles} triangle${stl.triangles === 1 ? "" : "s"} (${stl.format} STL)`,
    },
  };
}

export default {
  async build({ doc, params }) {
    const name = stripExtension(doc?.name) || "STL";
    return stlToGLB(fileContent(doc), params ?? {}, name);
  },
};
