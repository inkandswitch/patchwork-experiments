// Starting arrangements the editor can load. Pure data.
import { RANKINE_SEED } from "./datatype.js";

const U = 2;
const sphereS = +(2 * Math.PI * U * 1.4 ** 3).toFixed(2); // a 1.4 m sphere in a 2 m/s stream

export const PRESETS = Object.freeze([
  {
    id: "rankine",
    name: "Rankine body (10 m hull)",
    freestream: RANKINE_SEED.freestream,
    elements: RANKINE_SEED.elements,
  },
  {
    id: "half-body",
    name: "Rankine half-body",
    freestream: { speed: U, headingDeg: 0 },
    elements: { nose: { kind: "source", position: [0.7, 0, 0], strength: 12.4 } },
  },
  {
    id: "sphere",
    name: "Sphere (doublet)",
    freestream: { speed: U, headingDeg: 0 },
    elements: { sphere: { kind: "doublet", position: [5, 0, 0], strength: sphereS } },
  },
  {
    id: "spinning",
    name: "Sphere with circulation",
    freestream: { speed: U, headingDeg: 0 },
    elements: {
      sphere: { kind: "doublet", position: [5, 0, 0], strength: sphereS },
      spin: { kind: "vortex-line", position: [5, 0, 0], strength: -14 },
    },
  },
  {
    id: "catamaran",
    name: "Catamaran (two bodies)",
    freestream: { speed: U, headingDeg: 0 },
    elements: {
      "port-bow": { kind: "source", position: [0.7, 2.4, 0], strength: 5 },
      "port-stern": { kind: "sink", position: [9.3, 2.4, 0], strength: 5 },
      "stbd-bow": { kind: "source", position: [0.7, -2.4, 0], strength: 5 },
      "stbd-stern": { kind: "sink", position: [9.3, -2.4, 0], strength: 5 },
    },
  },
]);

/** A deep, plain copy of a preset's flow, ready to assign into a doc. */
export function presetFlow(id) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) return null;
  return JSON.parse(JSON.stringify({ freestream: p.freestream, elements: p.elements }));
}
