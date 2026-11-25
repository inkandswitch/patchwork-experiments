// Reading what CalculiX writes: the .frd (fields at nodes) and the .dat
// (totals it prints). Pure, over text.
//
// The .frd is fixed-width text. A result block:
//
//     1PMODE                         3            (a mode's number, for a frequency step)
//   100CL  101 1.000000000       14499                     0    1           1
//  -4  DISP        4    1
//  -5  D1          1    2    1    0
//  …
//  -1         1 0.00000E+00-1.23457E-05 0.00000E+00     node (10 wide), then values (12 wide, touching)
//  -3
//
// Values touch when one is negative, so they are cut by column, never split
// on spaces. An exponent of three digits drops its E ("1.00000-100").

const value = (s) => {
  const t = s.trim();
  if (!t) return NaN;
  const v = Number(t);
  if (!Number.isNaN(v)) return v;
  // "1.23456-100": a mantissa and a three-digit exponent with no E
  const m = t.match(/^([-+]?\d*\.?\d+)([-+]\d+)$/);
  return m ? Number(`${m[1]}e${m[2]}`) : NaN;
};

/**
 * @param {string} text   the .frd
 * @param {number} nodes  how many nodes the deck had (node i of the mesh is id i + 1)
 * @returns {{ name: string, components: number, mode: number|null, value: number, values: Float64Array }[]}
 *   one per result block, in file order; values: `components` numbers a node, NaN where the file gave none
 */
export function readFrd(text, nodes) {
  const blocks = [];
  const lines = text.split(/\r?\n/);
  let mode = null, stepValue = NaN;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("    1PMODE")) mode = Number(line.slice(10).trim());
    else if (line.startsWith("  100C")) stepValue = value(line.slice(12, 24));
    else if (line.startsWith(" -4")) {
      const name = line.slice(5, 13).trim();
      const listed = Number(line.slice(13, 18));
      // the "ALL" a vector block ends its component list with isn't a column of numbers
      let components = 0;
      i++;
      while (i < lines.length && lines[i].startsWith(" -5")) {
        if (lines[i].slice(5, 13).trim() !== "ALL") components++;
        i++;
      }
      if (!(components > 0)) components = listed;
      const values = new Float64Array(nodes * components).fill(NaN);
      for (; i < lines.length && !lines[i].startsWith(" -3"); i++) {
        const row = lines[i];
        if (!row.startsWith(" -1")) continue; // (-2: continuation lines, for more than six components; none are asked for)
        const n = Number(row.slice(3, 13)) - 1;
        if (!(n >= 0 && n < nodes)) continue;
        for (let k = 0; k < components && k < 6; k++) values[n * components + k] = value(row.slice(13 + 12 * k, 25 + 12 * k));
      }
      blocks.push({ name, components, mode: name === "DISP" || name === "STRESS" ? mode : mode, value: stepValue, values });
    }
  }
  return blocks;
}

/**
 * The totals in a .dat.
 * @returns {{
 *   forces: { set: string, force: number[] }[],     // *NODE PRINT, TOTALS=ONLY, RF: one per set (the last step's)
 *   energy: number|null,                              // *EL PRINT, TOTALS=ONLY, ELSE: the strain energy
 *   frequencies: { mode: number, hz: number }[] }}    // a frequency step's eigenfrequencies
 */
export function readDat(text) {
  const lines = text.split(/\r?\n/);
  const forces = new Map();
  let energy = null;
  const frequencies = [];
  const numbers = (s) => s.trim().split(/\s+/).map(Number);
  const nextNumbers = (from) => {
    for (let j = from; j < lines.length; j++) {
      if (!lines[j].trim()) continue;
      const v = numbers(lines[j]);
      return v.every(Number.isFinite) ? v : null;
    }
    return null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m = line.match(/total force \(fx,fy,fz\) for set (\S+)/i);
    if (m) {
      const v = nextNumbers(i + 1);
      if (v?.length >= 3) forces.set(m[1].toUpperCase(), v.slice(0, 3));
      continue;
    }
    if (/total internal energy for set/i.test(line)) {
      const v = nextNumbers(i + 1);
      if (v?.length) energy = v[0];
      continue;
    }
    if (/E I G E N V A L U E\s+O U T P U T/i.test(line)) {
      // a table: mode, eigenvalue, then the frequency as rad/time, cycles/time, and its imaginary part
      for (let j = i + 1; j < lines.length; j++) {
        const t = lines[j].trim();
        if (/^[A-Z]( [A-Z])+/.test(t) && !/^M O D E/i.test(t) && frequencies.length) break;
        const v = numbers(t);
        if (v.length >= 4 && v.every(Number.isFinite) && Number.isInteger(v[0])) frequencies.push({ mode: v[0], hz: v[3] });
        else if (frequencies.length && t && !v.every(Number.isFinite)) break;
      }
    }
  }
  return { forces: [...forces].map(([set, force]) => ({ set, force })), energy, frequencies };
}
