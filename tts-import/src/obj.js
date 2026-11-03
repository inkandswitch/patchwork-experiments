// Wavefront OBJ → one indexed triangle mesh. Pure.
//
// Reads v, vt, vn and f (any polygon, fan-triangulated; negative indices
// count back from the end; "v", "v/vt", "v//vn", "v/vt/vn"). Groups,
// objects, smoothing groups and materials are ignored: TTS draws a custom
// model with one diffuse texture anyway. Vertices are split per distinct
// (v, vt, vn) triple, as a GPU needs them.
//
// Returns { positions: Float32Array, uvs: Float32Array | null, normals:
// Float32Array | null, indices: Uint32Array, faces: number }. The frame is the
// file's own (right-handed); UVs keep OBJ's convention (v = 0 at the image's
// bottom) — the caller flips v for glTF.

export function parseOBJ(text) {
  const src = typeof text === "string" ? text : new TextDecoder().decode(text);
  const v = [], vt = [], vn = [];
  const keyToIndex = new Map();
  const pos = [], uv = [], nor = [];
  const idx = [];
  let anyUV = false, anyNormal = false, faces = 0;

  const vertex = (token) => {
    const [a, b, c] = token.split("/");
    const resolve = (s, len) => {
      if (s == null || s === "") return -1;
      const i = parseInt(s, 10);
      if (!Number.isFinite(i) || i === 0) return -1;
      return i < 0 ? len + i : i - 1;
    };
    const vi = resolve(a, v.length / 3);
    const ti = resolve(b, vt.length / 2);
    const ni = resolve(c, vn.length / 3);
    if (vi < 0 || vi >= v.length / 3) throw new Error(`obj: face refers to vertex ${a}, which does not exist`);
    const key = `${vi}/${ti}/${ni}`;
    let out = keyToIndex.get(key);
    if (out === undefined) {
      out = pos.length / 3;
      keyToIndex.set(key, out);
      pos.push(v[vi * 3], v[vi * 3 + 1], v[vi * 3 + 2]);
      if (ti >= 0 && ti < vt.length / 2) {
        uv.push(vt[ti * 2], vt[ti * 2 + 1]);
        anyUV = true;
      } else uv.push(0, 0);
      if (ni >= 0 && ni < vn.length / 3) {
        nor.push(vn[ni * 3], vn[ni * 3 + 1], vn[ni * 3 + 2]);
        anyNormal = true;
      } else nor.push(0, 0, 0);
    }
    return out;
  };

  let start = 0;
  const len = src.length;
  while (start < len) {
    let end = src.indexOf("\n", start);
    if (end < 0) end = len;
    let line = src.slice(start, end);
    start = end + 1;
    // line continuation
    while (line.endsWith("\\") && start < len) {
      let e2 = src.indexOf("\n", start);
      if (e2 < 0) e2 = len;
      line = line.slice(0, -1) + " " + src.slice(start, e2);
      start = e2 + 1;
    }
    line = line.trim();
    if (!line || line[0] === "#") continue;
    const parts = line.split(/\s+/);
    const tag = parts[0];
    if (tag === "v") v.push(+parts[1] || 0, +parts[2] || 0, +parts[3] || 0);
    else if (tag === "vt") vt.push(+parts[1] || 0, +parts[2] || 0);
    else if (tag === "vn") vn.push(+parts[1] || 0, +parts[2] || 0, +parts[3] || 0);
    else if (tag === "f") {
      const corners = parts.slice(1).map(vertex);
      for (let i = 1; i + 1 < corners.length; i++) idx.push(corners[0], corners[i], corners[i + 1]);
      if (corners.length >= 3) faces++;
    }
  }
  return {
    positions: Float32Array.from(pos),
    uvs: anyUV ? Float32Array.from(uv) : null,
    normals: anyNormal ? Float32Array.from(nor) : null,
    indices: Uint32Array.from(idx),
    faces,
  };
}
