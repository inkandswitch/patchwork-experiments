// Materials to start from. Each is linear, elastic and the same in every
// direction, which is all this analysis models: a stiffness (Young's modulus
// E), how much it thins when stretched (Poisson's ratio ν), a density (for
// weight and for vibration) and a yield strength (what the safety factor is
// measured against; none for a material that has no yield).
//
// Typical handbook values at room temperature, for a first answer. A real
// part's material has a certificate; put its numbers in.

const q = (value, unit) => ({ value, unit });

export const MATERIALS = Object.freeze([
  { id: "steel", name: "Steel, structural (S235, A36)", E: q(200, "GPa"), nu: 0.3, density: q(7850, "kg/m³"), yield: q(250, "MPa") },
  { id: "stainless-316", name: "Stainless steel 316", E: q(193, "GPa"), nu: 0.3, density: q(8000, "kg/m³"), yield: q(205, "MPa") },
  { id: "aluminium-6061", name: "Aluminium 6061-T6", E: q(68.9, "GPa"), nu: 0.33, density: q(2700, "kg/m³"), yield: q(276, "MPa") },
  { id: "aluminium-5083", name: "Aluminium 5083-H116 (marine)", E: q(71, "GPa"), nu: 0.33, density: q(2660, "kg/m³"), yield: q(215, "MPa") },
  { id: "titanium", name: "Titanium Ti-6Al-4V", E: q(113.8, "GPa"), nu: 0.34, density: q(4430, "kg/m³"), yield: q(880, "MPa") },
  { id: "bronze", name: "Silicon bronze", E: q(105, "GPa"), nu: 0.35, density: q(8530, "kg/m³"), yield: q(205, "MPa") },
  { id: "pla", name: "PLA (printed solid)", E: q(3.5, "GPa"), nu: 0.36, density: q(1240, "kg/m³"), yield: q(50, "MPa"), note: "A print is weaker across its layers than this says, by half or more." },
  { id: "petg", name: "PETG (printed solid)", E: q(2.1, "GPa"), nu: 0.38, density: q(1270, "kg/m³"), yield: q(45, "MPa"), note: "A print is weaker across its layers than this says." },
  { id: "abs", name: "ABS", E: q(2.2, "GPa"), nu: 0.35, density: q(1040, "kg/m³"), yield: q(40, "MPa") },
  { id: "nylon", name: "Nylon 6/6, dry", E: q(2.9, "GPa"), nu: 0.4, density: q(1140, "kg/m³"), yield: q(70, "MPa") },
  { id: "fir", name: "Douglas fir, along the grain", E: q(12.4, "GPa"), nu: 0.3, density: q(530, "kg/m³"), yield: null, note: "Wood is far weaker and softer across the grain; this treats it as the same every way." },
  { id: "plywood", name: "Marine plywood, in its plane", E: q(8, "GPa"), nu: 0.3, density: q(600, "kg/m³"), yield: null, note: "Treated as the same every way; through its thickness it is much softer." },
]);

export const DEFAULT_MATERIAL = "aluminium-6061";

/** A setup's material from the list: a copy, so a study's material is its own from then on. */
export function materialFromList(id) {
  const m = MATERIALS.find((x) => x.id === id);
  if (!m) return null;
  return { name: m.name, E: { ...m.E }, nu: m.nu, density: { ...m.density }, yield: m.yield ? { ...m.yield } : null };
}
