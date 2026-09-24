/**
 * Harmonograph as a parametric source.
 *
 * Lifted from harmonograph/index.html. A damped Lissajous figure: for each set the
 * path sums two sines on X and two on Y, each multiplied by exp(-d * t), across
 * STEPS points, and emits one <path>. The math in render() is drawHarmonograph()
 * from the original, unchanged.
 *
 * Contract: ../DATATYPE.md. Plain browser ESM, no imports, no DOM at module scope.
 */

export const version = 3;

export const titleTemplate = "Harmonograph";

export const output = {
  surfaces: ["svg"],
  unit: "px",
  width: 600,
  height: 600,
  dpi: 96,
  background: "#fafafa",
  animated: false,
};

// Phases as the original's Math.PI fractions, written out because the template
// exports must be plain JSON.
const HALF_PI = 1.5707963267948966;   // π/2
const QUARTER_PI = 0.7853981633974483; // π/4
const THIRD_PI = 1.0471975511965976;   // π/3
const TAU = 6.283185307179586;         // 2π

const freq = (key) => ({ key, label: key, kind: "num", min: 0.1, max: 10, step: 0.001 });
const phase = (key) => ({ key, label: key, kind: "num", min: 0, max: TAU, step: 0.001 });

export const params = [
  { key: "d", label: "damp", kind: "num", default: 0.005, min: 0.0001, max: 0.02, step: 0.0001, note: "Damping per step. Smaller values keep the pen moving longer." },
  // View bucket: a pure CSS scale in the original. The renderer applies it as a
  // scale on the picture; render() below never reads it.
  { key: "zoom", label: "zoom", kind: "num", bucket: "view", default: 1, min: 0.5, max: 3, step: 0.01 },
  {
    key: "sets",
    label: "set",
    kind: "list",
    minItems: 1,
    // The first row is the original's defaultSets entry (the flower).
    default: [
      { f1: 3, f2: 4, f3: 3, f4: 3, p1: 0, p2: HALF_PI, p3: QUARTER_PI, p4: THIRD_PI, color: "#ff0000" },
    ],
    // Item defaults are the original's "+ add set" literal.
    item: [
      { ...freq("f1"), default: 3 },
      { ...freq("f2"), default: 3.05 },
      { ...freq("f3"), default: 3 },
      { ...freq("f4"), default: 2.95 },
      { ...phase("p1"), default: 0 },
      { ...phase("p2"), default: HALF_PI },
      { ...phase("p3"), default: QUARTER_PI },
      { ...phase("p4"), default: THIRD_PI },
      { key: "color", label: "color", kind: "color", default: "#ff0000" },
    ],
  },
];

export const presets = [
  {
    name: "flower",
    values: {
      d: 0.005,
      sets: [
        { f1: 3, f2: 4, f3: 3, f4: 3, p1: 0, p2: HALF_PI, p3: QUARTER_PI, p4: THIRD_PI, color: "#ff0000" },
      ],
    },
  },
];

const STEPS = 20000;
const DT = 0.01;
const COMPUTATION_SCALE = 100;
const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Draw one <path> per set into surface.root. Pure in (values, size); zoom is a
 * view value that the renderer applies outside this function.
 */
export function render(values, surface) {
  const { root, width, height } = surface;
  const d = values.d;
  const cx = width / 2;
  const cy = height / 2;

  for (const p of values.sets) {
    let pathData = "";
    for (let i = 0; i <= STEPS; i++) {
      const t = i * DT;
      const decay = Math.exp(-d * t);
      const X = cx + (Math.sin(t * p.f1 + p.p1) * decay + Math.sin(t * p.f2 + p.p2) * decay) * COMPUTATION_SCALE;
      const Y = cy + (Math.sin(t * p.f3 + p.p3) * decay + Math.sin(t * p.f4 + p.p4) * decay) * COMPUTATION_SCALE;
      pathData += (i === 0 ? "M" : "L") + X + " " + Y;
    }
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", pathData);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", p.color);
    path.setAttribute("stroke-width", "1");
    root.appendChild(path);
  }
}
