// G-code → line segments per feature type, for the preview. Reading the saved
// G-code (rather than keeping toolpaths in memory) means the preview always
// shows what the job's file actually says, whoever sliced it and whenever.
// Understands what gcode.js writes: ;LAYER:n, ;TYPE:WALL|SOLID|INFILL,
// absolute XYZ (G90) and relative E (M83).

export const FEATURES = ["wall", "solid", "infill"];

/**
 * @param {string} text
 * @returns {{ layers: number, positions: { wall: Float32Array, solid: Float32Array, infill: Float32Array },
 *             layerEnds: { wall: number[], solid: number[], infill: number[] } }}
 *   layerEnds[f][i] = vertex count of feature f up to and including layer i
 */
export function parseGcodePreview(text) {
  const pos = { wall: [], solid: [], infill: [] };
  const layerEnds = { wall: [], solid: [], infill: [] };
  let x = 0, y = 0, z = 0, type = "wall", layer = -1;
  const close = () => {
    if (layer >= 0) for (const f of FEATURES) layerEnds[f].push(pos[f].length / 3);
  };
  const lines = String(text).split("\n");
  for (const raw of lines) {
    if (raw.charCodeAt(0) === 59 /* ; */) {
      if (raw.startsWith(";LAYER:")) {
        close();
        layer++;
      } else if (raw.startsWith(";TYPE:")) {
        const t = raw.slice(6).trim().toLowerCase();
        type = t === "solid" ? "solid" : t === "infill" ? "infill" : "wall";
      }
      continue;
    }
    if (!(raw.startsWith("G1 ") || raw.startsWith("G0 "))) continue;
    let nx = x, ny = y, nz = z, e = 0, moved = false;
    for (const word of raw.split(" ")) {
      const c = word[0];
      const v = Number(word.slice(1));
      if (c === "X") (nx = v), (moved = true);
      else if (c === "Y") (ny = v), (moved = true);
      else if (c === "Z") nz = v;
      else if (c === "E") e = v;
      else if (c === ";") break;
    }
    if (moved && e > 0 && raw[1] === "1" && layer >= 0) pos[type].push(x, y, nz, nx, ny, nz);
    x = nx;
    y = ny;
    z = nz;
  }
  close();
  return {
    layers: Math.max(0, layer + 1),
    positions: { wall: new Float32Array(pos.wall), solid: new Float32Array(pos.solid), infill: new Float32Array(pos.infill) },
    layerEnds,
  };
}
