// Reading what OpenFOAM writes: legacy VTK (the surfaces and streamlines
// function objects, asked for `legacy true; format ascii`), the .dat tables
// of the forces / solverInfo / yPlus function objects, and the few lines of
// the meshing logs worth showing. Pure: text in, numbers out.

/**
 * A legacy ASCII VTK POLYDATA file.
 * @returns {{ points: Float32Array, polygons: number[][] | null, lines: number[][] | null,
 *             pointData: Record<string, { comps: number, values: Float32Array }> }}
 */
export function parseVTK(text) {
  const tok = text.split(/\s+/);
  let i = 0;
  const next = () => tok[i++];
  const out = { points: null, polygons: null, lines: null, pointData: {} };
  let mode = null;
  while (i < tok.length) {
    const t = next();
    if (t === undefined) break;
    if (t === "POINTS") {
      const n = Number(next());
      next(); // type
      const pts = new Float32Array(n * 3);
      for (let k = 0; k < n * 3; k++) pts[k] = Number(next());
      out.points = pts;
    } else if (t === "POLYGONS" || t === "LINES") {
      const n = Number(next());
      next(); // total ints
      const cells = [];
      for (let c = 0; c < n; c++) {
        const m = Number(next());
        const cell = new Array(m);
        for (let k = 0; k < m; k++) cell[k] = Number(next());
        cells.push(cell);
      }
      if (t === "POLYGONS") out.polygons = cells;
      else out.lines = cells;
    } else if (t === "POINT_DATA") {
      next();
      mode = "point";
    } else if (t === "CELL_DATA") {
      next();
      mode = "cell";
    } else if (t === "FIELD") {
      next(); // name
      const arrays = Number(next());
      for (let a = 0; a < arrays; a++) {
        const name = next();
        const comps = Number(next());
        const tuples = Number(next());
        next(); // type
        const values = new Float32Array(comps * tuples);
        for (let k = 0; k < values.length; k++) values[k] = Number(next());
        // the FieldData before POINTS (TimeValue) belongs to no points
        if (mode === "point") out.pointData[name] = { comps, values };
      }
    }
  }
  if (!out.points) throw new Error("vtk: no POINTS");
  return out;
}

/** Polygons → triangles (a fan from each polygon's first point; OpenFOAM's faces are convex-ish). */
export function triangulate(polygons) {
  const idx = [];
  for (const p of polygons ?? []) for (let k = 1; k + 1 < p.length; k++) idx.push(p[0], p[k], p[k + 1]);
  return idx;
}

/**
 * A whitespace-separated .dat table whose header line is the last "# Time …"
 * comment. Columns may be separated by tabs and padded; non-numbers become NaN
 * (solverInfo writes solver names and true/false).
 * @returns {{ cols: string[], rows: number[][] }}
 */
export function parseDat(text) {
  let cols = null;
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    if (line.startsWith("#")) {
      const h = line.slice(1).trim();
      if (/^Time\b/.test(h)) cols = h.split(/\s+/);
      continue;
    }
    rows.push(line.trim().split(/\s+/).map((v) => (v === "true" ? 1 : v === "false" ? 0 : Number(v))));
  }
  return { cols: cols ?? [], rows };
}

/**
 * Incremental reader for a growing .dat file: feed it the bytes appended
 * since last time; it keeps the partial last line and the header.
 */
export function datTail() {
  let carry = "";
  let cols = null;
  return {
    get cols() {
      return cols;
    },
    push(text) {
      const lines = (carry + text).split("\n");
      carry = lines.pop() ?? "";
      const rows = [];
      for (const line of lines) {
        if (!line.trim()) continue;
        if (line.startsWith("#")) {
          const h = line.slice(1).trim();
          if (/^Time\b/.test(h)) cols = h.split(/\s+/);
          continue;
        }
        rows.push(line.trim().split(/\s+/).map((v) => (v === "true" ? 1 : v === "false" ? 0 : Number(v))));
      }
      return rows;
    },
  };
}

/**
 * The forces function object's force.dat row (ESI ≥ v2112:
 * Time total_xyz pressure_xyz viscous_xyz), as RESISTANCE on the whole hull:
 * the stream runs toward −x, so resistance is −Fx; a half model's x and z
 * forces are doubled (its y force is the symmetry plane's, not the hull's).
 */
export function forceRow(cols, row, { half }) {
  const at = (name) => row[cols.indexOf(name)];
  const k = half ? 2 : 1;
  return {
    iter: at("Time"),
    Rt: -k * at("total_x"),
    Rp: -k * at("pressure_x"),
    Rv: -k * at("viscous_x"),
    Fz: k * at("total_z"),
    // the side force (to port positive): a half model's is its symmetry plane's, so none
    Fy: half ? 0 : at("total_y"),
  };
}

/**
 * The pitching moment about the forces function object's CofR, from a
 * moment.dat row (same layout as force.dat): M_y about +y, which is bow-down
 * positive in the floating frame. A half model's is doubled.
 */
export function momentRow(cols, row, { half }) {
  const at = (n) => row[cols.indexOf(n)];
  return {
    iter: at("Time"),
    My: (half ? 2 : 1) * at("total_y"),
    // roll about +x (starboard down positive, as heel) and yaw about +z (bow to port positive):
    // a half model's cancel with their mirror image
    Mx: half ? 0 : at("total_x"),
    Mz: half ? 0 : at("total_z"),
  };
}

/** The initial residual of each solved field, from a solverInfo.dat row. */
export function residualColumns(cols) {
  return cols.filter((c) => c.endsWith("_initial"));
}

/** checkMesh's log: cell count and whether it passed. */
export function parseCheckMesh(log) {
  const cells = Number(log.match(/^\s*cells:\s+(\d+)/m)?.[1]);
  const ok = /^Mesh OK\./m.test(log);
  const failed = Number(log.match(/Failed (\d+) mesh checks/)?.[1] ?? 0);
  const maxNonOrtho = Number(log.match(/Mesh non-orthogonality Max: ([\d.eE+-]+)/)?.[1]);
  const maxSkew = Number(log.match(/Max skewness = ([\d.eE+-]+)/)?.[1]);
  return { cells: Number.isFinite(cells) ? cells : null, ok, failed, maxNonOrtho: Number.isFinite(maxNonOrtho) ? maxNonOrtho : null, maxSkew: Number.isFinite(maxSkew) ? maxSkew : null };
}

/** snappyHexMesh's layer table: the hull's target and achieved layers, and how much of the target thickness. */
export function parseLayers(log) {
  const m = log.match(/^hull\s+(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.eE+-]+)\s+([\d.]+)\s*$/m);
  if (!m) return null;
  return { faces: Number(m[1]), target: Number(m[2]), achieved: Number(m[3]), thickness: Number(m[4]), percent: Number(m[5]) };
}

/** yPlus.dat's last row for the hull. */
export function parseYPlus(text) {
  const { cols, rows } = parseDat(text.replace(/\thull\t/g, "\t0\t"));
  const last = rows[rows.length - 1];
  if (!last) return null;
  const at = (n) => last[cols.indexOf(n)];
  return { min: at("min"), max: at("max"), average: at("average") };
}
